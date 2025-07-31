use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::Vector;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};
use sha2::{Digest, Sha256};

// Gas constants for cross-contract calls
const NEP141_TRANSFER_GAS: Gas = Gas::from_tgas(5); // 5 TGas
const CALLBACK_GAS: Gas = Gas::from_tgas(2); // 2 TGas

/// Copy of Immutables struct from factory
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
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

/// Timelock configuration
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
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

/// Escrow state tracking
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct EscrowState {
    pub is_funded: bool,
    pub is_withdrawn: bool,
    pub is_cancelled: bool,
    pub revealed_secret: Option<String>,
    pub withdrawn_at: Option<u64>,
    pub cancelled_at: Option<u64>,
}

/// Merkle proof for partial fills
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct MerkleProof {
    pub proof: Vec<String>, // Hex-encoded sibling hashes
    pub index: u32,         // Index in the Merkle tree
}

/// Escrow information for external queries
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EscrowInfo {
    pub order_hash: String,
    pub maker: AccountId,
    pub taker: AccountId,
    pub token: AccountId,
    pub amount: u128,
    pub safety_deposit: u128,
    pub current_phase: String,
    pub state: EscrowState,
    pub time_remaining: Option<u64>,
}

// NEP-141 token interface
#[ext_contract(ext_nep141)]
pub trait NEP141Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: String, memo: Option<String>);
    fn ft_transfer_from(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: String,
        memo: Option<String>,
    );
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct EscrowDst {
    pub immutables: Immutables,
    pub factory: AccountId,
    pub state: EscrowState,
    pub merkle_root: Option<String>,      // For multiple fills
    pub used_secret_indices: Vector<u32>, // Track used secrets for partial fills
}

#[near_bindgen]
impl EscrowDst {
    /// Initialize the escrow contract (called by factory)
    #[init]
    #[payable]
    pub fn init(immutables: Immutables, factory: AccountId) -> Self {
        // Verify that this is being called during contract deployment
        assert_eq!(
            env::predecessor_account_id(),
            factory,
            "Only factory can initialize escrow"
        );

        // Extract Merkle root if this supports multiple fills
        let merkle_root = if immutables.hashlock.starts_with("merkle:") {
            Some(immutables.hashlock[7..].to_string()) // Remove "merkle:" prefix
        } else {
            None
        };

        // Initialize state
        let state = EscrowState {
            is_funded: false,
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

    /// Deposit funds after contract creation (for NEP-141 tokens)
    pub fn deposit_funds(&mut self) -> Promise {
        self.assert_taker();
        assert!(!self.state.is_funded, "Already funded");

        if self.immutables.token.as_str() == "near" {
            // For native NEAR, funds should already be attached during init
            self.state.is_funded = true;
            Promise::new(env::current_account_id()) // No-op promise
        } else {
            // For NEP-141 tokens, transfer from taker
            self.state.is_funded = true;
            ext_nep141::ext(self.immutables.token.clone())
                .with_static_gas(NEP141_TRANSFER_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1)) // Yocto NEAR for storage
                .ft_transfer_from(
                    self.immutables.taker.clone(),
                    env::current_account_id(),
                    self.immutables.amount.to_string(),
                    Some("Escrow deposit".to_string()),
                )
        }
    }

    /// Withdraw with secret (taker only, B2 phase)
    pub fn withdraw(&mut self, secret: String, merkle_proof: Option<MerkleProof>) -> Promise {
        self.assert_taker();
        self.assert_funded();
        self.assert_not_withdrawn();
        self.assert_not_cancelled();

        // Check timelock - must be after finality lock, before cancellation
        let current_time = env::block_timestamp_ms();
        let withdrawal_start = self.get_timelock_timestamp(TimelockStage::DstWithdrawal);
        let cancellation_start = self.get_timelock_timestamp(TimelockStage::DstCancellation);

        assert!(
            current_time >= withdrawal_start,
            "Finality lock not expired"
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

        // Log withdrawal event
        env::log_str(&format!(
            "EscrowWithdrawal: order_hash={}, secret={}, withdrawn_by={}",
            self.immutables.order_hash,
            secret,
            env::predecessor_account_id()
        ));

        // Transfer funds to maker and safety deposit to caller
        self.transfer_funds_to_maker()
            .then(self.transfer_safety_deposit())
    }

    /// Public withdraw with secret (anyone with access token, B3 phase)
    pub fn public_withdraw(
        &mut self,
        secret: String,
        merkle_proof: Option<MerkleProof>,
    ) -> Promise {
        // Note: In EVM, this requires access token. For NEAR, we'll allow anyone during public phase
        self.assert_funded();
        self.assert_not_withdrawn();
        self.assert_not_cancelled();

        // Check timelock - must be in public withdrawal phase
        let current_time = env::block_timestamp_ms();
        let public_withdrawal_start =
            self.get_timelock_timestamp(TimelockStage::DstPublicWithdrawal);
        let cancellation_start = self.get_timelock_timestamp(TimelockStage::DstCancellation);

        assert!(
            current_time >= public_withdrawal_start,
            "Public withdrawal period not started"
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

        // Log withdrawal event
        env::log_str(&format!(
            "EscrowPublicWithdrawal: order_hash={}, secret={}, withdrawn_by={}",
            self.immutables.order_hash,
            secret,
            env::predecessor_account_id()
        ));

        // Transfer funds to maker and safety deposit to caller
        self.transfer_funds_to_maker()
            .then(self.transfer_safety_deposit())
    }

    /// Cancel escrow (taker only, B4 phase)
    pub fn cancel(&mut self) -> Promise {
        self.assert_taker();
        self.assert_funded();
        self.assert_not_withdrawn();
        self.assert_not_cancelled();

        // Check timelock - must be in cancellation phase
        let current_time = env::block_timestamp_ms();
        let cancellation_start = self.get_timelock_timestamp(TimelockStage::DstCancellation);

        assert!(
            current_time >= cancellation_start,
            "Cancellation period not started"
        );

        // Update state
        self.state.is_cancelled = true;
        self.state.cancelled_at = Some(current_time);

        // Log cancellation event
        env::log_str(&format!(
            "EscrowCancelled: order_hash={}, cancelled_by={}",
            self.immutables.order_hash,
            env::predecessor_account_id()
        ));

        // Return funds to taker and safety deposit to caller
        self.transfer_funds_to_taker()
            .then(self.transfer_safety_deposit())
    }

    /// Emergency fund rescue (taker only, after rescue delay)
    pub fn rescue_funds(&mut self, token: AccountId, amount: u128) -> Promise {
        self.assert_taker();

        // Check rescue delay (similar to EVM BaseEscrow.rescueFunds)
        let current_time = env::block_timestamp_ms();
        let rescue_start = self.immutables.timelocks.deployed_at + (30 * 24 * 60 * 60 * 1000); // 30 days in milliseconds

        assert!(current_time >= rescue_start, "Rescue delay not expired");

        env::log_str(&format!("FundsRescued: token={}, amount={}", token, amount));

        if token.as_str() == "near" {
            Promise::new(self.immutables.taker.clone()).transfer(NearToken::from_yoctonear(amount))
        } else {
            ext_nep141::ext(token)
                .with_static_gas(NEP141_TRANSFER_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .ft_transfer(
                    self.immutables.taker.clone(),
                    amount.to_string(),
                    Some("Emergency rescue".to_string()),
                )
        }
    }

    // View methods
    pub fn get_escrow_info(&self) -> EscrowInfo {
        let current_phase = self.get_current_phase();
        let time_remaining = self.get_time_remaining();

        EscrowInfo {
            order_hash: self.immutables.order_hash.clone(),
            maker: self.immutables.maker.clone(),
            taker: self.immutables.taker.clone(),
            token: self.immutables.token.clone(),
            amount: self.immutables.amount,
            safety_deposit: self.immutables.safety_deposit,
            current_phase,
            state: self.state.clone(),
            time_remaining,
        }
    }

    pub fn get_current_phase(&self) -> String {
        let current_time = env::block_timestamp_ms();
        let withdrawal_start = self.get_timelock_timestamp(TimelockStage::DstWithdrawal);
        let public_withdrawal_start =
            self.get_timelock_timestamp(TimelockStage::DstPublicWithdrawal);
        let cancellation_start = self.get_timelock_timestamp(TimelockStage::DstCancellation);

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

    pub fn get_time_remaining(&self) -> Option<u64> {
        let current_time = env::block_timestamp_ms();
        let current_phase = self.get_current_phase();

        match current_phase.as_str() {
            "B1_FINALITY_LOCK" => {
                let next_phase_start = self.get_timelock_timestamp(TimelockStage::DstWithdrawal);
                Some(next_phase_start.saturating_sub(current_time))
            }
            "B2_RESOLVER_EXCLUSIVE" => {
                let next_phase_start =
                    self.get_timelock_timestamp(TimelockStage::DstPublicWithdrawal);
                Some(next_phase_start.saturating_sub(current_time))
            }
            "B3_PUBLIC_WITHDRAWAL" => {
                let next_phase_start = self.get_timelock_timestamp(TimelockStage::DstCancellation);
                Some(next_phase_start.saturating_sub(current_time))
            }
            _ => None,
        }
    }

    pub fn supports_partial_fills(&self) -> bool {
        self.merkle_root.is_some()
    }

    // Private helper methods
    fn verify_secret(&mut self, secret: &str, merkle_proof: Option<&MerkleProof>) {
        if let Some(merkle_root) = &self.merkle_root {
            // Partial fill with Merkle proof
            let proof = merkle_proof.expect("Merkle proof required for partial fills");

            // Check if this secret index was already used
            assert!(
                !self
                    .used_secret_indices
                    .iter()
                    .any(|used_idx| used_idx == proof.index),
                "Secret index already used"
            );

            // Verify Merkle proof
            let secret_hash = self.hash_secret(secret);
            assert!(
                self.verify_merkle_proof(&secret_hash, &proof.proof, proof.index, merkle_root),
                "Invalid Merkle proof"
            );

            // Mark secret index as used
            self.used_secret_indices.push(&proof.index);
        } else {
            // Single fill - direct hash comparison
            let secret_hash = self.hash_secret(secret);
            let expected_hash =
                hex::decode(&self.immutables.hashlock).expect("Invalid hashlock format");

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
                // Current hash is left child
                hasher.update(&hash);
                hasher.update(&sibling);
            } else {
                // Current hash is right child
                hasher.update(&sibling);
                hasher.update(&hash);
            }

            hash = hasher.finalize().to_vec();
            current_index /= 2;
        }

        let computed_root = hex::encode(&hash);
        computed_root == root
    }

    fn get_timelock_timestamp(&self, stage: TimelockStage) -> u64 {
        let delay_seconds = match stage {
            TimelockStage::DstWithdrawal => self.immutables.timelocks.dst_withdrawal,
            TimelockStage::DstPublicWithdrawal => self.immutables.timelocks.dst_public_withdrawal,
            TimelockStage::DstCancellation => self.immutables.timelocks.dst_cancellation,
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
                    Some("Escrow withdrawal to maker".to_string()),
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
                    Some("Escrow cancellation to taker".to_string()),
                )
        }
    }

    fn transfer_safety_deposit(&self) -> Promise {
        Promise::new(env::predecessor_account_id())
            .transfer(NearToken::from_yoctonear(self.immutables.safety_deposit))
    }

    // Access control helpers
    fn assert_taker(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.immutables.taker,
            "Only taker can call this method"
        );
    }

    fn assert_funded(&self) {
        assert!(self.state.is_funded, "Escrow not funded");
    }

    fn assert_not_withdrawn(&self) {
        assert!(!self.state.is_withdrawn, "Already withdrawn");
    }

    fn assert_not_cancelled(&self) {
        assert!(!self.state.is_cancelled, "Already cancelled");
    }
}

/// Timelock stages for destination chain
pub enum TimelockStage {
    DstWithdrawal,
    DstPublicWithdrawal,
    DstCancellation,
}
