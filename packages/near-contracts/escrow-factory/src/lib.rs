use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::env::promise_batch_action_use_global_contract_by_account_id;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json;
use near_sdk::{env, log, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise};

#[cfg(not(target_arch = "wasm32"))]
use near_sdk::schemars::{self, JsonSchema};
use sha2::{Digest, Sha256};

// Gas constants
const CREATE_ESCROW_GAS: Gas = Gas::from_tgas(50); // 50 TGas
const CALLBACK_GAS: Gas = Gas::from_tgas(10); // 10 TGas

/// Immutables struct matching EVM BaseEscrow.Immutables
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct Immutables {
    pub order_hash: String,
    pub hashlock: String, // Hash of the secret (hex encoded)
    pub maker: AccountId,
    pub taker: AccountId, // Resolver address
    pub token: AccountId, // Token contract address ("near" for native NEAR)
    pub amount: u128,     // Using u128 instead of Balance
    pub safety_deposit: u128,
    pub timelocks: Timelocks,
}

/// Arguments for creating new escrow instances
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct CreateEscrowArgs {
    pub immutables: Immutables,
    pub factory: AccountId,
}

/// Timelock configuration matching EVM TimelocksLib
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct Timelocks {
    pub deployed_at: u64,             // Deployment timestamp
    pub src_withdrawal: u32,          // Source chain withdrawal delay
    pub src_public_withdrawal: u32,   // Source chain public withdrawal delay
    pub src_cancellation: u32,        // Source chain cancellation delay
    pub src_public_cancellation: u32, // Source chain public cancellation delay
    pub dst_withdrawal: u32,          // Destination chain withdrawal delay (B1)
    pub dst_public_withdrawal: u32,   // Destination chain public withdrawal delay (B2→B3)
    pub dst_cancellation: u32,        // Destination chain cancellation delay (B4)
}

/// Destination chain immutables complement (from EVM)
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

/// Escrow creation result
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct EscrowCreationResult {
    pub escrow_account: AccountId,
    pub order_hash: String,
    pub success: bool,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct EscrowFactory {
    pub owner: AccountId,
    pub escrow_src_template: AccountId, // Template contract for source escrows
    pub escrow_dst_template: AccountId, // Template contract for destination escrows
    pub deployed_escrows: LookupMap<String, AccountId>, // orderHash -> escrow_account
    pub escrow_counter: u64,
    pub rescue_delay: u32, // Delay for emergency fund rescue
}

#[near_bindgen]
impl EscrowFactory {
    #[init]
    pub fn new(
        owner: AccountId,
        rescue_delay: u32,
        escrow_src_template: AccountId,
        escrow_dst_template: AccountId,
    ) -> Self {
        Self {
            owner,
            escrow_src_template,
            escrow_dst_template,
            deployed_escrows: LookupMap::new("escrows".as_bytes()),
            escrow_counter: 0,
            rescue_delay,
        }
    }

    /// Update the source escrow template contract (only owner)
    pub fn set_escrow_src_template(&mut self, template: AccountId) {
        self.assert_owner();
        self.escrow_src_template = template;
        env::log_str("Source escrow template updated");
    }

    /// Update the destination escrow template contract (only owner)
    pub fn set_escrow_dst_template(&mut self, template: AccountId) {
        self.assert_owner();
        self.escrow_dst_template = template;
        env::log_str("Destination escrow template updated");
    }

    /// Create destination escrow contract (equivalent to EVM createDstEscrow)
    #[payable]
    pub fn create_dst_escrow(
        &mut self,
        dst_immutables: Immutables,
        src_cancellation_timestamp: u64,
    ) -> Promise {
        // Validate payment for safety deposit and native tokens
        let required_deposit = if dst_immutables.token.as_str() == "near" {
            dst_immutables.amount + dst_immutables.safety_deposit
        } else {
            dst_immutables.safety_deposit // Only safety deposit for NEP-141 tokens
        };

        assert!(
            env::attached_deposit().as_yoctonear() >= required_deposit,
            "Insufficient deposit: required {}, got {}",
            required_deposit,
            env::attached_deposit().as_yoctonear()
        );

        // Create immutables with current timestamp
        let mut immutables = dst_immutables;
        immutables.timelocks.deployed_at = env::block_timestamp_ms();

        // Validate cancellation timing
        let dst_cancellation_start = immutables.timelocks.deployed_at
            + (immutables.timelocks.dst_cancellation as u64 * 1000);
        assert!(
            dst_cancellation_start <= src_cancellation_timestamp,
            "Invalid creation time: dst cancellation would start after src"
        );

        // Generate unique escrow account
        let escrow_account = format!(
            "escrow-{}-{}.{}",
            self.escrow_counter,
            &immutables.order_hash[..8], // Use first 8 chars of order hash
            env::current_account_id()
        );
        self.escrow_counter += 1;

        // Store escrow mapping
        self.deployed_escrows
            .insert(&immutables.order_hash, &escrow_account.parse().unwrap());

        // Create escrow using template factory pattern
        let escrow_id: AccountId = escrow_account.parse().unwrap();

        // Call the template contract to create a new escrow instance
        Promise::new(self.escrow_dst_template.clone())
            .function_call(
                "create_escrow".to_string(),
                near_sdk::serde_json::to_vec(&serde_json::json!({
                    "escrow_account": escrow_id.to_string(),
                    "immutables": immutables,
                    "factory": env::current_account_id().to_string(),
                }))
                .unwrap(),
                if immutables.token.as_str() == "near" {
                    NearToken::from_yoctonear(immutables.amount + immutables.safety_deposit)
                } else {
                    NearToken::from_yoctonear(immutables.safety_deposit)
                },
                CREATE_ESCROW_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_escrow_created(immutables.order_hash, escrow_id),
            )
    }

    /// Creates a source escrow on NEAR for NEAR -> ETH swaps
    /// This replaces the LOP postInteraction mechanism used on EVM chains
    #[payable]
    pub fn create_src_escrow(
        &mut self,
        order_hash: String,
        immutables: Immutables,
        dst_complement: DstImmutablesComplement,
    ) -> Promise {

        // Set deployed timestamp
        let mut immutables = immutables;
        immutables.timelocks.deployed_at = env::block_timestamp_ms() / 1000; // Convert to seconds

        let required_deposit = if immutables.token.as_str() == "near" {
            immutables.amount + immutables.safety_deposit
        } else {
            immutables.safety_deposit // For NEP-141 tokens
        };

        // For NEP-141 tokens, check balance and allowance
        if immutables.token.as_str() != "near" {
            // Check if maker has sufficient token balance
            let token_balance_check = Promise::new(immutables.token.clone())
                .function_call(
                    "allowance".to_string(),
                    near_sdk::serde_json::to_vec(&serde_json::json!({
                        "holder_id": immutables.maker,
                        "spender_id": env::current_account_id()
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(5),
                );

            log!("Token balance check initiated for account: {}", immutables.maker.clone());
            token_balance_check.then(
                Self::ext(env::current_account_id())
                    .with_attached_deposit(env::attached_deposit())
                    .src_contract_deployment(order_hash, immutables, dst_complement, 0)
            )
            // Note: In a real implementation, you'd need to handle this asynchronously
            // For now, we assume the balance check will be done in the escrow contract
        } else {
            Self::ext(env::current_account_id())
                .with_attached_deposit(env::attached_deposit())
                .src_contract_deployment(order_hash, immutables, dst_complement, 0)
        }
    }

    #[private]
    #[payable]
    pub fn on_token_balance_checked_result_received(
        &mut self, 
        order_hash: String,
        immutables: Immutables,
        dst_complement: DstImmutablesComplement,
        #[callback_result] call_result: Result<u128, near_sdk::PromiseError>,
    ) -> Promise {
        match call_result {
            Ok(balance) => {
                log!("Token balance check successful: {}", balance);
                // Here you would typically handle the balance check result
                Self::ext(env::current_account_id())
                .src_contract_deployment(
                    order_hash.clone(),
                    immutables.clone(),
                    dst_complement.clone(),
                    NearToken::from_yoctonear(balance).as_yoctonear()
                )
            }
            Err(e) => {
                log!("Token balance check failed: {:?}", e);
                Self::ext(env::current_account_id())
                .src_contract_deployment(
                    order_hash.clone(),
                    immutables.clone(),
                    dst_complement.clone(),
                    NearToken::from_yoctonear(0).as_yoctonear()
                )
            }
        }
    }

    #[private]
    #[payable]
    pub fn src_contract_deployment(&mut self, order_hash: String, immutables: Immutables, dst_complement: DstImmutablesComplement, attached_non_native_token: u128) -> Promise {
        
        let mut immutables = immutables;
        immutables.timelocks.deployed_at = env::block_timestamp_ms() / 1000; // Convert to seconds

        let required_deposit = if immutables.token.as_str() == "near" {
            immutables.amount + immutables.safety_deposit
        } else {
            immutables.safety_deposit // For NEP-141 tokens
        };

        let required_approval = if immutables.token.as_str() != "near" {
            immutables.amount
        } else {
            0
        };

        assert!(attached_non_native_token >= required_approval, "Insufficient attached deposit for non-native token: required {}, got {}", required_approval, attached_non_native_token);

        assert!(
            env::attached_deposit().as_yoctonear() >= required_deposit,
            "Insufficient deposit: required {}, got {}",
            required_deposit,
            env::attached_deposit().as_yoctonear()
        );
        
        // Generate deterministic escrow account
        let escrow_account = self.compute_escrow_address(&immutables);

        // Log event similar to EVM's SrcEscrowCreated
        log!(
            "SrcEscrowCreated: {{\"immutables\": {:?}, \"complement\": {:?}}}",
            immutables,
            dst_complement
        );

        let promise = Promise::new(escrow_account.clone())
            .create_account()
            .add_full_access_key(env::signer_account_pk())
            .transfer(env::attached_deposit())
            .use_global_contract_by_account_id(self.escrow_src_template.clone())
            .function_call(
                "init".to_string(),
                near_sdk::serde_json::to_vec(&serde_json::json!({
                    "args": &InitEscrowArgs {
                        immutables: immutables.clone(),
                        factory: env::current_account_id(),
                    }
                }
                ))
                .unwrap(),
                NearToken::from_yoctonear(required_deposit), // No additional deposit needed
                Gas::from_tgas(30), // 30 TGas for initialization
            );

        // Store mapping
        self.deployed_escrows.insert(&order_hash, &escrow_account);
        self.escrow_counter += 1;

        // Callback for verification
        promise.then(Promise::new(env::current_account_id()).function_call(
            "on_src_escrow_created".to_string(),
            near_sdk::serde_json::to_vec(&(order_hash.clone(), escrow_account.clone())).unwrap(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(5),
        ))
    }

    #[private]
    pub fn on_src_escrow_created(
        &mut self,
        order_hash: String,
        escrow_account: AccountId,
        #[callback_result] call_result: Result<(), near_sdk::PromiseError>,
    ) -> EscrowCreationResult {
        match call_result {
            Ok(_) => {
                log!("Source escrow created: {}", escrow_account);
                EscrowCreationResult {
                    escrow_account,
                    order_hash,
                    success: true,
                }
            }
            Err(e) => {
                log!("Failed to create source escrow: {:?}", e);
                self.deployed_escrows.remove(&order_hash);
                self.escrow_counter -= 1;
                EscrowCreationResult {
                    escrow_account,
                    order_hash,
                    success: false,
                }
            }
        }
    }

    #[private]
    pub fn on_escrow_created(
        &mut self,
        order_hash: String,
        escrow_account: AccountId,
        #[callback_result] call_result: Result<(), near_sdk::PromiseError>,
    ) -> EscrowCreationResult {
        match call_result {
            Ok(_) => {
                env::log_str(&format!(
                    "DstEscrowCreated: escrow={}, order_hash={}, taker={}",
                    escrow_account,
                    order_hash,
                    env::predecessor_account_id()
                ));

                EscrowCreationResult {
                    escrow_account,
                    order_hash,
                    success: true,
                }
            }
            Err(e) => {
                env::log_str(&format!(
                    "Failed to create escrow for order {}: {:?}",
                    order_hash, e
                ));

                // Remove from mapping on failure
                self.deployed_escrows.remove(&order_hash);

                EscrowCreationResult {
                    escrow_account,
                    order_hash,
                    success: false,
                }
            }
        }
    }

    /// Get escrow address for a given order hash
    pub fn get_escrow_address(&self, order_hash: String) -> Option<AccountId> {
        self.deployed_escrows.get(&order_hash)
    }

    /// Compute deterministic escrow address (similar to EVM addressOfEscrowDst)
    pub fn compute_escrow_address(&self, immutables: &Immutables) -> AccountId {
        // Use hash of immutables for deterministic address generation
        let hash = self.compute_immutables_hash(immutables);
        format!(
            "escrow-{}.{}",
            &hex::encode(&hash)[..16], // Use first 16 hex chars
            env::current_account_id()
        )
        .parse()
        .unwrap()
    }

    /// Compute hash of immutables (similar to EVM ImmutablesLib.hash)
    pub fn compute_immutables_hash(&self, immutables: &Immutables) -> Vec<u8> {
        let serialized = near_sdk::serde_json::to_vec(immutables).unwrap();
        Sha256::digest(&serialized).to_vec()
    }

    /// Check if an order supports multiple fills (Merkle tree)
    pub fn supports_multiple_fills(&self, hashlock: String) -> bool {
        // In EVM, this is determined by checking if hashlock is a Merkle root
        // For now, we'll check if hashlock has a specific prefix or length
        // This should be coordinated with the client SDK
        hashlock.starts_with("merkle:") || hashlock.len() > 64
    }

    /// Validate partial fill (similar to EVM _isValidPartialFill)
    pub fn validate_partial_fill(
        &self,
        making_amount: u128,
        remaining_making_amount: u128,
        order_making_amount: u128,
        parts_amount: u32,
        validated_index: u32,
    ) -> bool {
        let calculated_index = ((order_making_amount - remaining_making_amount + making_amount
            - 1)
            * parts_amount as u128)
            / order_making_amount;

        if remaining_making_amount == making_amount {
            // Order filled to completion - use secret with index i + 1
            return (calculated_index + 2) as u32 == validated_index;
        } else if order_making_amount != remaining_making_amount {
            // Calculate previous fill index if not first fill
            let prev_calculated_index = ((order_making_amount - remaining_making_amount - 1)
                * parts_amount as u128)
                / order_making_amount;
            if calculated_index == prev_calculated_index {
                return false;
            }
        }

        (calculated_index + 1) as u32 == validated_index
    }

    /// Get factory statistics
    pub fn get_stats(&self) -> FactoryStats {
        FactoryStats {
            owner: self.owner.clone(),
            total_escrows_created: self.escrow_counter,
            rescue_delay: self.rescue_delay,
            escrow_src_template: self.escrow_src_template.clone(),
            escrow_dst_template: self.escrow_dst_template.clone(),
        }
    }

    // Private helper methods
    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Only owner can call this method"
        );
    }
}

/// Arguments for escrow initialization
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct InitEscrowArgs {
    pub immutables: Immutables,
    pub factory: AccountId,
}

/// Factory statistics
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct FactoryStats {
    pub owner: AccountId,
    pub total_escrows_created: u64,
    pub rescue_delay: u32,
    pub escrow_src_template: AccountId,
    pub escrow_dst_template: AccountId,
}

impl Timelocks {
    /// Get timestamp for a specific timelock stage
    pub fn get_timestamp(&self, stage: TimelockStage) -> u64 {
        let delay_seconds = match stage {
            TimelockStage::DstWithdrawal => self.dst_withdrawal,
            TimelockStage::DstPublicWithdrawal => self.dst_public_withdrawal,
            TimelockStage::DstCancellation => self.dst_cancellation,
            TimelockStage::SrcWithdrawal => self.src_withdrawal,
            TimelockStage::SrcPublicWithdrawal => self.src_public_withdrawal,
            TimelockStage::SrcCancellation => self.src_cancellation,
            TimelockStage::SrcPublicCancellation => self.src_public_cancellation,
        };

        self.deployed_at + (delay_seconds as u64 * 1000)
    }

    /// Get current timelock phase for destination chain
    pub fn get_current_dst_phase(&self) -> String {
        let current_time = env::block_timestamp_ms();
        let withdrawal_start = self.get_timestamp(TimelockStage::DstWithdrawal);
        let public_withdrawal_start = self.get_timestamp(TimelockStage::DstPublicWithdrawal);
        let cancellation_start = self.get_timestamp(TimelockStage::DstCancellation);

        if current_time < withdrawal_start {
            "B1_FINALITY_LOCK".to_string()
        } else if current_time < public_withdrawal_start {
            "B2_RESOLVER_EXCLUSIVE".to_string()
        } else if current_time < cancellation_start {
            "B3_PUBLIC_WITHDRAWAL".to_string()
        } else {
            "B4_CANCELLATION".to_string()
        }
    }
}

/// Timelock stages matching EVM TimelocksLib.Stage
pub enum TimelockStage {
    SrcWithdrawal,
    SrcPublicWithdrawal,
    SrcCancellation,
    SrcPublicCancellation,
    DstWithdrawal,
    DstPublicWithdrawal,
    DstCancellation,
}
