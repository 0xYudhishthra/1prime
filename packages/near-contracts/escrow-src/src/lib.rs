use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::Vector;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};
use sha2::{Digest, Sha256};

#[cfg(not(target_arch = "wasm32"))]
use near_sdk::schemars::{self, JsonSchema};

// Gas constants
const NEP141_TRANSFER_GAS: Gas = Gas::from_tgas(5);
const CALLBACK_GAS: Gas = Gas::from_tgas(2);

/// Copy of Immutables struct from factory
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct Immutables {
    pub order_hash: String,
    pub hashlock: String,
    pub maker: AccountId,
    pub taker: AccountId, // Resolver address
    pub token: AccountId, // Token contract address ("near" for native NEAR)
    pub amount: u128,
    pub safety_deposit: u128,
    pub timelocks: Timelocks,
}

/// Timelock configuration
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct Timelocks {
    pub deployed_at: u64,
    pub src_withdrawal: u32,          // A1: Finality lock
    pub src_public_withdrawal: u32,   // A2: Resolver exclusive period
    pub src_cancellation: u32,        // A3: Public withdrawal
    pub src_public_cancellation: u32, // A4: Maker can cancel
    pub dst_withdrawal: u32,
    pub dst_public_withdrawal: u32,
    pub dst_cancellation: u32,
}

/// Escrow state
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct EscrowState {
    pub is_withdrawn: bool,
    pub is_cancelled: bool,
    pub revealed_secret: Option<String>,
    pub withdrawn_at: Option<u64>,
    pub cancelled_at: Option<u64>,
}

/// Merkle proof for partial fills
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(not(target_arch = "wasm32"), derive(JsonSchema))]
#[serde(crate = "near_sdk::serde")]
pub struct MerkleProof {
    pub proof: Vec<String>,
    pub index: u32,
}

// NEP-141 token interface
#[ext_contract(ext_nep141)]
pub trait NEP141Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: String, memo: Option<String>);
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct EscrowSrc {
    pub immutables: Immutables,
    pub factory: AccountId,
    pub state: EscrowState,
    pub merkle_root: Option<String>,
    pub used_secret_indices: Vector<u32>,
}

#[near_bindgen]
impl EscrowSrc {
    /// Initialize the escrow (called by factory during deployment)
    #[init]
    #[payable]
    pub fn init(immutables: Immutables, factory: AccountId) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            factory,
            "Only factory can initialize escrow"
        );

        // For source escrows, funds should be attached during creation
        let expected_amount = if immutables.token.as_str() == "near" {
            immutables.amount + immutables.safety_deposit
        } else {
            immutables.safety_deposit
        };

        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            expected_amount,
            "Incorrect deposit amount"
        );

        // Extract Merkle root if this supports multiple fills
        let merkle_root = if immutables.hashlock.starts_with("merkle:") {
            Some(immutables.hashlock[7..].to_string())
        } else {
            None
        };

        let state = EscrowState {
            is_withdrawn: false,
            is_cancelled: false,
            revealed_secret: None,
            withdrawn_at: None,
            cancelled_at: None,
        };

        Self {
            immutables,
            factory,
            state,
            merkle_root,
            used_secret_indices: Vector::new("used_secrets".as_bytes()),
        }
    }

    /// Withdraw with secret (resolver/taker only, A2 phase)
    pub fn withdraw(&mut self, secret: String, merkle_proof: Option<MerkleProof>) -> Promise {
        self.assert_taker();
        self.assert_not_withdrawn();
        self.assert_not_cancelled();

        // Check timelock - must be after finality, before public cancellation
        let current_time = env::block_timestamp_ms();
        let withdrawal_start = self.get_timelock_timestamp(TimelockStage::SrcWithdrawal);
        let public_cancellation_start =
            self.get_timelock_timestamp(TimelockStage::SrcPublicCancellation);

        assert!(
            current_time >= withdrawal_start,
            "Finality lock not expired"
        );
        assert!(
            current_time < public_cancellation_start,
            "Public cancellation period started"
        );

        // Verify secret
        self.verify_secret(&secret, merkle_proof.as_ref());

        // Update state
        self.state.is_withdrawn = true;
        self.state.revealed_secret = Some(secret.clone());
        self.state.withdrawn_at = Some(current_time);

        env::log_str(&format!(
            "SrcEscrowWithdrawal: order_hash={}, secret={}, withdrawn_by={}",
            self.immutables.order_hash,
            secret,
            env::predecessor_account_id()
        ));

        // Transfer funds to taker (resolver) and return safety deposit
        self.transfer_funds_to_taker()
            .then(self.transfer_safety_deposit())
    }

    /// Public withdraw (anyone with access token, A3 phase)
    pub fn public_withdraw(
        &mut self,
        secret: String,
        merkle_proof: Option<MerkleProof>,
    ) -> Promise {
        self.assert_not_withdrawn();
        self.assert_not_cancelled();

        // Check timelock - must be in public withdrawal phase
        let current_time = env::block_timestamp_ms();
        let public_withdrawal_start =
            self.get_timelock_timestamp(TimelockStage::SrcPublicWithdrawal);
        let cancellation_start = self.get_timelock_timestamp(TimelockStage::SrcCancellation);

        assert!(
            current_time >= public_withdrawal_start,
            "Public withdrawal not started"
        );
        assert!(
            current_time < cancellation_start,
            "Cancellation period started"
        );

        // Verify secret
        self.verify_secret(&secret, merkle_proof.as_ref());

        // Update state
        self.state.is_withdrawn = true;
        self.state.revealed_secret = Some(secret.clone());
        self.state.withdrawn_at = Some(current_time);

        env::log_str(&format!(
            "SrcEscrowPublicWithdrawal: order_hash={}, secret={}, withdrawn_by={}",
            self.immutables.order_hash,
            secret,
            env::predecessor_account_id()
        ));

        // Transfer to taker and safety deposit to caller
        self.transfer_funds_to_taker()
            .then(self.transfer_safety_deposit())
    }

    /// Cancel escrow (maker only during A3, anyone during A4)
    pub fn cancel(&mut self) -> Promise {
        self.assert_not_withdrawn();
        self.assert_not_cancelled();

        let current_time = env::block_timestamp_ms();
        let cancellation_start = self.get_timelock_timestamp(TimelockStage::SrcCancellation);
        let public_cancellation_start =
            self.get_timelock_timestamp(TimelockStage::SrcPublicCancellation);

        if current_time < public_cancellation_start {
            // A3 phase - only maker can cancel
            assert_eq!(
                env::predecessor_account_id(),
                self.immutables.maker,
                "Only maker can cancel during private cancellation"
            );
            assert!(
                current_time >= cancellation_start,
                "Private cancellation not started"
            );
        } else {
            // A4 phase - anyone can cancel
            assert!(
                current_time >= public_cancellation_start,
                "Public cancellation not started"
            );
        }

        // Update state
        self.state.is_cancelled = true;
        self.state.cancelled_at = Some(current_time);

        env::log_str(&format!(
            "SrcEscrowCancelled: order_hash={}, cancelled_by={}",
            self.immutables.order_hash,
            env::predecessor_account_id()
        ));

        // Return funds to maker and safety deposit to caller
        self.transfer_funds_to_maker()
            .then(self.transfer_safety_deposit())
    }

    /// Emergency fund rescue (maker only, after rescue delay)
    pub fn rescue_funds(&mut self, token: AccountId, amount: u128) -> Promise {
        assert_eq!(
            env::predecessor_account_id(),
            self.immutables.maker,
            "Only maker can rescue funds"
        );

        let current_time = env::block_timestamp_ms();
        let rescue_start = self.immutables.timelocks.deployed_at + (30 * 24 * 60 * 60 * 1000);

        assert!(current_time >= rescue_start, "Rescue delay not expired");

        env::log_str(&format!("FundsRescued: token={}, amount={}", token, amount));

        if token.as_str() == "near" {
            Promise::new(self.immutables.maker.clone()).transfer(NearToken::from_yoctonear(amount))
        } else {
            ext_nep141::ext(token)
                .with_static_gas(NEP141_TRANSFER_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .ft_transfer(
                    self.immutables.maker.clone(),
                    amount.to_string(),
                    Some("Emergency rescue".to_string()),
                )
        }
    }

    // View methods
    pub fn get_current_phase(&self) -> String {
        let current_time = env::block_timestamp_ms();
        let withdrawal_start = self.get_timelock_timestamp(TimelockStage::SrcWithdrawal);
        let public_withdrawal_start =
            self.get_timelock_timestamp(TimelockStage::SrcPublicWithdrawal);
        let cancellation_start = self.get_timelock_timestamp(TimelockStage::SrcCancellation);
        let public_cancellation_start =
            self.get_timelock_timestamp(TimelockStage::SrcPublicCancellation);

        if current_time < withdrawal_start {
            "A1_FINALITY_LOCK".to_string()
        } else if current_time < public_withdrawal_start {
            "A2_RESOLVER_EXCLUSIVE".to_string()
        } else if current_time < cancellation_start {
            "A3_PUBLIC_WITHDRAWAL".to_string()
        } else if current_time < public_cancellation_start {
            "A3_PRIVATE_CANCELLATION".to_string()
        } else {
            "A4_PUBLIC_CANCELLATION".to_string()
        }
    }

    // Private helper methods
    fn verify_secret(&mut self, secret: &str, merkle_proof: Option<&MerkleProof>) {
        if let Some(merkle_root) = &self.merkle_root {
            let proof = merkle_proof.expect("Merkle proof required for partial fills");

            assert!(
                !self
                    .used_secret_indices
                    .iter()
                    .any(|idx| idx == proof.index),
                "Secret index already used"
            );

            let secret_hash = self.hash_secret(secret);
            assert!(
                self.verify_merkle_proof(&secret_hash, &proof.proof, proof.index, merkle_root),
                "Invalid Merkle proof"
            );

            self.used_secret_indices.push(&proof.index);
        } else {
            let secret_hash = self.hash_secret(secret);
            let expected_hash = hex::decode(&self.immutables.hashlock).expect("Invalid hashlock");
            assert_eq!(secret_hash, expected_hash, "Invalid secret");
        }
    }

    fn hash_secret(&self, secret: &str) -> Vec<u8> {
        let secret_bytes = hex::decode(secret).expect("Invalid secret format");
        Sha256::digest(&secret_bytes).to_vec()
    }

    fn verify_merkle_proof(&self, leaf: &[u8], proof: &[String], index: u32, root: &str) -> bool {
        let mut hash = leaf.to_vec();
        let mut current_index = index;

        for sibling_hex in proof {
            let sibling = hex::decode(sibling_hex).expect("Invalid proof format");
            let mut hasher = Sha256::new();

            if current_index % 2 == 0 {
                hasher.update(&hash);
                hasher.update(&sibling);
            } else {
                hasher.update(&sibling);
                hasher.update(&hash);
            }

            hash = hasher.finalize().to_vec();
            current_index /= 2;
        }

        hex::encode(&hash) == root
    }

    fn get_timelock_timestamp(&self, stage: TimelockStage) -> u64 {
        let delay_seconds = match stage {
            TimelockStage::SrcWithdrawal => self.immutables.timelocks.src_withdrawal,
            TimelockStage::SrcPublicWithdrawal => self.immutables.timelocks.src_public_withdrawal,
            TimelockStage::SrcCancellation => self.immutables.timelocks.src_cancellation,
            TimelockStage::SrcPublicCancellation => {
                self.immutables.timelocks.src_public_cancellation
            }
        };

        self.immutables.timelocks.deployed_at + (delay_seconds as u64 * 1000)
    }

    fn transfer_funds_to_maker(&self) -> Promise {
        if self.immutables.token.as_str() == "near" {
            Promise::new(self.immutables.maker.clone())
                .transfer(NearToken::from_yoctonear(self.immutables.amount))
        } else {
            ext_nep141::ext(self.immutables.token.clone())
                .with_static_gas(NEP141_TRANSFER_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .ft_transfer(
                    self.immutables.maker.clone(),
                    self.immutables.amount.to_string(),
                    Some("Escrow cancellation to maker".to_string()),
                )
        }
    }

    fn transfer_funds_to_taker(&self) -> Promise {
        if self.immutables.token.as_str() == "near" {
            Promise::new(self.immutables.taker.clone())
                .transfer(NearToken::from_yoctonear(self.immutables.amount))
        } else {
            ext_nep141::ext(self.immutables.token.clone())
                .with_static_gas(NEP141_TRANSFER_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .ft_transfer(
                    self.immutables.taker.clone(),
                    self.immutables.amount.to_string(),
                    Some("Escrow withdrawal to taker".to_string()),
                )
        }
    }

    fn transfer_safety_deposit(&self) -> Promise {
        Promise::new(env::predecessor_account_id())
            .transfer(NearToken::from_yoctonear(self.immutables.safety_deposit))
    }

    // Access control
    fn assert_taker(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.immutables.taker,
            "Only taker can call this method"
        );
    }

    fn assert_not_withdrawn(&self) {
        assert!(!self.state.is_withdrawn, "Already withdrawn");
    }

    fn assert_not_cancelled(&self) {
        assert!(!self.state.is_cancelled, "Already cancelled");
    }
}

/// Timelock stages for source chain
pub enum TimelockStage {
    SrcWithdrawal,
    SrcPublicWithdrawal,
    SrcCancellation,
    SrcPublicCancellation,
}
