use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use near_sdk::log;

#[cfg(not(target_arch = "wasm32"))]
use near_sdk::schemars::{self, JsonSchema};

/// Resolver contract for NEAR that handles cross-chain swap orders
/// Similar to Resolver.sol but adapted for NEAR
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Resolver {
    pub owner: AccountId,
    pub escrow_factory: AccountId,
    pub dst_chain_resolver: String, // ETH address for the resolver on destination chain
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct Order {
    pub maker: AccountId,
    pub taker: AccountId,
    pub making_amount: u128,
    pub taking_amount: u128,
    pub maker_asset: AccountId, // "near" for native NEAR
    pub taker_asset: String,    // ETH address of token on destination
    pub salt: String,
    pub extension: OrderExtension,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct OrderExtension {
    pub hashlock: String,
    pub src_chain_id: u64,
    pub dst_chain_id: u64,
    pub src_safety_deposit: u128,
    pub dst_safety_deposit: u128,
    pub timelocks: Timelocks,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct Timelocks {
    pub deployed_at: u64, // Deployment timestamp (MUST match factory)
    pub src_withdrawal: u32,
    pub src_public_withdrawal: u32,
    pub src_cancellation: u32,
    pub src_public_cancellation: u32,
    pub dst_withdrawal: u32,
    pub dst_public_withdrawal: u32,
    pub dst_cancellation: u32,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct Immutables {
    pub order_hash: String,
    pub hashlock: String,
    pub maker: AccountId,
    pub taker: AccountId,
    pub token: AccountId,
    pub amount: u128,
    pub safety_deposit: u128,
    pub timelocks: Timelocks,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct DstImmutablesComplement {
    pub maker: AccountId,
    pub amount: u128,
    pub token: AccountId,
    pub safety_deposit: u128,
    pub chain_id: String,
}

#[near_bindgen]
impl Resolver {
    #[init]
    pub fn new(owner: AccountId, escrow_factory: AccountId, dst_chain_resolver: String) -> Self {
        Self {
            owner,
            escrow_factory,
            dst_chain_resolver,
        }
    }

    /// Deploy source escrow on NEAR for NEAR -> ETH swaps
    /// This replaces the EVM flow of Resolver.deploySrc -> LOP.fillOrderArgs -> postInteraction
    #[payable]
    pub fn deploy_src(
        &mut self,
        order: Order,
        order_signature: String, // For future validation
        amount: u128,
    ) -> Promise {
        // Only owner can deploy
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Only owner can deploy escrows"
        );

        // Validate amount matches order
        assert!(
            amount <= order.making_amount,
            "Amount exceeds order making amount"
        );

        // Compute order hash
        let order_hash = self.compute_order_hash(&order);

        // Create immutables for source escrow
        let mut timelocks = order.extension.timelocks.clone();
        timelocks.deployed_at = 0; // Will be set by factory during deployment

        let immutables = Immutables {
            order_hash: order_hash.clone(),
            hashlock: order.extension.hashlock.clone(),
            maker: order.maker.clone(),
            taker: env::current_account_id(), // Resolver is the taker
            token: order.maker_asset.clone(),
            amount,
            safety_deposit: order.extension.src_safety_deposit,
            timelocks,
        };

        // Create destination complement info
        let dst_complement = DstImmutablesComplement {
            maker: order.maker.clone(), // Can be different if order.receiver is set
            amount: u128::from((order.taking_amount * amount) / order.making_amount), // Pro-rata
            token: order.taker_asset.parse().unwrap(),
            safety_deposit: order.extension.dst_safety_deposit,
            chain_id: u64::from(order.extension.dst_chain_id).to_string(),
        };

        // Calculate required deposit
        let required_deposit = if order.maker_asset.as_str() == "near" {
            NearToken::from_yoctonear(u128::from(amount) + u128::from(order.extension.src_safety_deposit))
        } else {
            NearToken::from_yoctonear(u128::from(order.extension.src_safety_deposit))
        };

        log!("Gas left: {:?}", Gas::from_gas(env::prepaid_gas().as_gas() - env::used_gas().as_gas()));

        // Call factory to create source escrow
        Promise::new(self.escrow_factory.clone()).function_call(
            "create_src_escrow".to_string(),
            serde_json::to_vec(&(order_hash, immutables, dst_complement)).unwrap(),
            required_deposit,
            Gas::from_tgas(250),
        )
    }

    /// Deploy destination escrow on NEAR for ETH -> NEAR swaps
    /// Called by resolver after source escrow is created on ETH
    #[payable]
    pub fn deploy_dst(
        &mut self,
        dst_immutables: Immutables,
        src_cancellation_timestamp: U64,
    ) -> Promise {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Only owner can deploy escrows"
        );

        // Forward to factory
        Promise::new(self.escrow_factory.clone()).function_call(
            "create_dst_escrow".to_string(),
            serde_json::to_vec(&(dst_immutables, src_cancellation_timestamp)).unwrap(),
            env::attached_deposit(),
            Gas::from_tgas(50),
        )
    }

    /// Withdraw from escrow (called by resolver after getting secret)
    pub fn withdraw(&self, escrow: AccountId, secret: String, immutables: Immutables) -> Promise {
        // Forward to escrow contract
        Promise::new(escrow).function_call(
            "withdraw".to_string(),
            serde_json::to_vec(&(secret, immutables)).unwrap(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(30),
        )
    }

    /// Cancel escrow
    pub fn cancel(&self, escrow: AccountId, immutables: Immutables) -> Promise {
        // Forward to escrow contract
        Promise::new(escrow).function_call(
            "cancel".to_string(),
            serde_json::to_vec(&immutables).unwrap(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(30),
        )
    }

    /// Compute order hash (simplified - should match cross-chain protocol)
    fn compute_order_hash(&self, order: &Order) -> String {
        use near_sdk::env::sha256;

        let data = format!(
            "{}:{}:{}:{}:{}:{}:{}",
            order.maker,
            u128::from(order.making_amount),
            u128::from(order.taking_amount),
            order.maker_asset,
            order.taker_asset,
            order.salt,
            order.extension.hashlock
        );

        let hash = sha256(data.as_bytes());
        format!("0x{}", hex::encode(hash))
    }

    /// View methods
    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_factory(&self) -> AccountId {
        self.escrow_factory.clone()
    }

    pub fn get_dst_resolver(&self) -> String {
        self.dst_chain_resolver.clone()
    }
}
