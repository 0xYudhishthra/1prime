use ethers::{contract::{BaseContract, Contract, ContractFactory}, providers::{Http, Middleware, Provider}, types::{transaction::eip2718::TypedTransaction, Address, TransactionRequest, U256}, utils::keccak256};
use k256::pkcs8::der::Encode;
use omni_transaction::{evm::{types::Signature, utils::parse_eth_address, EVMTransaction}, TransactionBuilder, TxBuilder, EVM};
use sha3::{Digest, Keccak256};
use crate::{agent::{request_signature, AgentConfig}, routes::eth::get_address::get_funding_eth_address};
use std::str::FromStr;
use std::sync::{Arc, RwLock};
use lazy_static::lazy_static;

lazy_static! {
    static ref ETH_RESOLVER_CONTRACT_ADDRESS: Arc<RwLock<String>> = Arc::new(RwLock::new(String::new()));
}

pub struct TimelocksBuilder {
    data: U256,
}

impl TimelocksBuilder {
    pub fn new() -> Self {
        Self { data: U256::zero() }
    }

    pub fn set_stage_offset(mut self, stage: u8, offset: u32) -> Self {
        let bit_shift = stage * 32;
        let mask = U256::from(0xffffffffu64) << bit_shift;
        self.data = (self.data & !mask) | (U256::from(offset) << bit_shift);
        self
    }

    pub fn set_deployed_at(mut self, timestamp: u32) -> Self {
        let deployed_at_offset = 224;
        let deployed_at_mask = U256::from(0xffffffffu64) << deployed_at_offset;
        self.data = (self.data & !deployed_at_mask) | (U256::from(timestamp) << deployed_at_offset);
        self
    }

    pub fn build(self) -> U256 {
        self.data
    }
}

pub fn create_timelocks(
    src_withdrawal_offset: u32,
    src_public_withdrawal_offset: u32,
    src_cancellation_offset: u32,
    src_public_cancellation_offset: u32,
    dst_withdrawal_offset: u32,
    dst_public_withdrawal_offset: u32,
    dst_cancellation_offset: u32,
    deployed_at: u32,
) -> U256 {
    TimelocksBuilder::new()
        .set_stage_offset(0, src_withdrawal_offset)
        .set_stage_offset(1, src_public_withdrawal_offset)
        .set_stage_offset(2, src_cancellation_offset)
        .set_stage_offset(3, src_public_cancellation_offset)
        .set_stage_offset(4, dst_withdrawal_offset)
        .set_stage_offset(5, dst_public_withdrawal_offset)
        .set_stage_offset(6, dst_cancellation_offset)
        .set_deployed_at(deployed_at)
        .build()
}

pub struct Immutables {
    pub order_hash: [u8; 32],
    pub hashlock: [u8; 32],  // Hash of the secret.
    pub maker: Address,
    pub taker: Address,
    pub token: Address,
    pub amount: U256,
    pub safety_deposit: U256,
    pub timelocks: U256,
}


pub struct MakerTraitsBuilder {
    data: U256,
}

impl MakerTraitsBuilder {
    pub fn new() -> Self {
        Self { data: U256::zero() }
    }

    pub fn set_allowed_sender(mut self, sender: Address) -> Self {
        let allowed_sender_mask = U256::from(u128::MAX) >> 48; // type(uint80).max
        let sender_u160 = U256::from_big_endian(sender.as_bytes());
        let last_10_bytes = sender_u160 & allowed_sender_mask;
        self.data = (self.data & !allowed_sender_mask) | last_10_bytes;
        self
    }

    pub fn set_expiration(mut self, expiration: u64) -> Self {
        let expiration_offset = 80;
        let expiration_mask = U256::from(u64::from(u32::MAX)) << expiration_offset; // type(uint40).max
        self.data = (self.data & !expiration_mask) | (U256::from(expiration) << expiration_offset);
        self
    }

    pub fn set_nonce_or_epoch(mut self, nonce_or_epoch: u64) -> Self {
        let nonce_offset = 120;
        let nonce_mask = U256::from(u64::from(u32::MAX)) << nonce_offset; // type(uint40).max
        self.data = (self.data & !nonce_mask) | (U256::from(nonce_or_epoch) << nonce_offset);
        self
    }

    pub fn set_series(mut self, series: u64) -> Self {
        let series_offset = 160;
        let series_mask = U256::from(u64::from(u32::MAX)) << series_offset; // type(uint40).max
        self.data = (self.data & !series_mask) | (U256::from(series) << series_offset);
        self
    }

    pub fn no_partial_fills(mut self) -> Self {
        self.data |= U256::from(1) << 255;
        self
    }

    pub fn allow_multiple_fills(mut self) -> Self {
        self.data |= U256::from(1) << 254;
        self
    }

    pub fn pre_interaction_call(mut self) -> Self {
        self.data |= U256::from(1) << 252;
        self
    }

    pub fn post_interaction_call(mut self) -> Self {
        self.data |= U256::from(1) << 251;
        self
    }

    pub fn need_check_epoch_manager(mut self) -> Self {
        self.data |= U256::from(1) << 250;
        self
    }

    pub fn has_extension(mut self) -> Self {
        self.data |= U256::from(1) << 249;
        self
    }

    pub fn use_permit2(mut self) -> Self {
        self.data |= U256::from(1) << 248;
        self
    }

    pub fn unwrap_weth(mut self) -> Self {
        self.data |= U256::from(1) << 247;
        self
    }

    pub fn build(self) -> U256 {
        self.data
    }
}

pub struct TakerTraitsBuilder {
    data: U256,
}

impl TakerTraitsBuilder {
    pub fn new() -> Self {
        Self { data: U256::zero() }
    }

    pub fn set_threshold(mut self, threshold: U256) -> Self {
        let threshold_mask = U256::from_str("0x000000000000000000ffffffffffffffffffffffffffffffffffffffffffffff").unwrap();
        self.data = (self.data & !threshold_mask) | (threshold & threshold_mask);
        self
    }

    pub fn set_args_interaction_length(mut self, length: u32) -> Self {
        let interaction_offset = 200;
        let interaction_mask = U256::from(0xffffffu64) << interaction_offset;
        self.data = (self.data & !interaction_mask) | (U256::from(length) << interaction_offset);
        self
    }

    pub fn set_args_extension_length(mut self, length: u32) -> Self {
        let extension_offset = 224;
        let extension_mask = U256::from(0xffffffu64) << extension_offset;
        self.data = (self.data & !extension_mask) | (U256::from(length) << extension_offset);
        self
    }

    pub fn args_has_target(mut self) -> Self {
        self.data |= U256::from(1) << 251;
        self
    }

    pub fn use_permit2(mut self) -> Self {
        self.data |= U256::from(1) << 252;
        self
    }

    pub fn skip_maker_permit(mut self) -> Self {
        self.data |= U256::from(1) << 253;
        self
    }

    pub fn unwrap_weth(mut self) -> Self {
        self.data |= U256::from(1) << 254;
        self
    }

    pub fn is_making_amount(mut self) -> Self {
        self.data |= U256::from(1) << 255;
        self
    }

    pub fn build(self) -> U256 {
        self.data
    }
}

pub struct Order {
    pub salt: U256,
    pub maker: U256,
    pub receiver: U256,
    pub maker_asset: U256,
    pub taker_asset: U256,
    pub making_amount: U256,
    pub taking_amount: U256,
    pub maker_traits: U256,
}




pub fn update_eth_resolver_contract_address(value: String) {
    let mut contract_address = ETH_RESOLVER_CONTRACT_ADDRESS.write().unwrap();
    *contract_address = value;
}

pub fn get_eth_resolver_contract_address() -> String {
    let contract_address = ETH_RESOLVER_CONTRACT_ADDRESS.read().unwrap();
    contract_address.clone()
}

async fn get_signature(transaction_encoded: Vec<u8>) -> Result<Signature, String>{
   let transaction_hash = Keccak256::digest(&transaction_encoded);

   let request_signature_result = request_signature(
       "oneprime-funding-eth",
       &hex::encode(transaction_hash),
       None,
       &AgentConfig::from_env()
   ).await;

   if request_signature_result.is_err() {
       return Err(format!("Failed to get signature: {:?}", request_signature_result.err()));
   }

   let signature_data = request_signature_result.unwrap();

   let big_r_hex = signature_data["big_r"]["affine_point"].as_str().expect("Failed to get big_r affine point").trim_start_matches("0x");
   let s_hex = signature_data["s"]["scalar"].as_str().expect("Failed to get s scalar").trim_start_matches("0x");
   let v = signature_data["recovery_id"].as_u64().expect("Failed to get recovery ID");

   let big_r_hex_trimmed = &big_r_hex[2..];
   let r_bytes = hex::decode(big_r_hex_trimmed).expect("Failed to decode big_r hex");
   let s_bytes = hex::decode(s_hex).expect("Failed to decode s hex");

    let signature = Signature {
        v: v as u64,
        r: r_bytes.clone(),
        s: s_bytes.clone(),
    };

    Ok(signature)
}

async fn send_transaction(signed_transaction: Vec<u8>) -> Result<String, String>{
    let provider = Provider::<Http>::try_from(crate::utils::SEPOLIA_RPC_URL.as_str());
    if provider.is_err() {
        return Err(format!("Failed to create provider: {:?}", provider.err()));
    }
    let provider = provider.unwrap();
    match provider.send_raw_transaction(signed_transaction.clone().into()).await {
        Ok(pending_tx) => {
            println!("Transaction sent successfully: {:?}", pending_tx);
            let receipt = pending_tx.await;
            match receipt {
                Ok(Some(receipt)) => {
                    Ok(format!("Transaction receipt: {:?}", receipt))
                }
                Ok(None) => {
                    Ok(format!("Transaction receipt not found"))
                }
                Err(e) => {
                    Err(format!("Failed to get transaction receipt: {}", e))
                }
            }
        }
        Err(e) => {
            Err(format!("Failed to send transaction: {}", e))
        }
    }
}

pub async fn deploy_eth_resolver_contract() -> Result<Address, String> {
    let provider = Provider::<Http>::try_from(crate::utils::SEPOLIA_RPC_URL.as_str())
        .map_err(|e| format!("Failed to create provider: {:?}", e)).expect("Failed to create provider");
    
    let from_address_str = get_funding_eth_address();
    let from_address = Address::from_str(&from_address_str).unwrap();

    let max_gas_fee: u128 = 500_000_000;
    let max_priority_fee_per_gas: u128 = 1_000_000;
    let gas_limit: u128 = 5_000_000;

    // Load contract bytecode
    let contract_bytecode_string = include_str!("../../eth_resolver.bin");
    let contract_bytecode = hex::decode(contract_bytecode_string.trim_start_matches("0x"))
        .map_err(|e| format!("Failed to decode contract bytecode: {}", e))?;

    // Encode constructor arguments using ethers ABI encoding
    let constructor_args = ethers::abi::encode(&[
        ethers::abi::Token::Address("0x128ce802AB730FbB360b784CA8C16dD73147649c".parse().unwrap()),
        ethers::abi::Token::Address("0x111111125421ca6dc452d289314280a0f8842a65".parse().unwrap()),
        ethers::abi::Token::Address(from_address_str.parse().unwrap()),
    ]);

    // Combine bytecode with constructor arguments
    let mut deployment_data = contract_bytecode.clone();
    deployment_data.extend(constructor_args);

    // Get nonce
    let nonce = provider
        .get_transaction_count(from_address, None)
        .await
        .map_err(|e| format!("Failed to get nonce: {}", e)).unwrap();

    // Get gas price
    let gas_price = provider
        .get_gas_price()
        .await
        .map_err(|e| format!("Failed to get gas price: {}", e)).unwrap();

    let evm_tx: EVMTransaction = omni_transaction::TransactionBuilder::new::<EVM>()
    .nonce(nonce.as_u64())
    //.to(parse_eth_address("0000000000000000000000000000000000000000"))
    .input(deployment_data.to_vec())
    .gas_limit(gas_limit)
    .max_fee_per_gas(max_gas_fee)
    .max_priority_fee_per_gas(max_priority_fee_per_gas)
    .chain_id(11155111)
    .build();

    let encoded_tx = evm_tx.build_for_signing();
    // Get signature using your MPC implementation
    let signature = get_signature(encoded_tx.to_vec()).await?;
    
    // Create signed transaction bytes
    let signed_tx_bytes = evm_tx.build_with_signature(&signature);
    
    // Send the raw transaction
    let tx_hash = send_raw_transaction(signed_tx_bytes).await?;
    
    // Calculate contract address deterministically
    let contract_address = calculate_contract_address(&from_address, &nonce);
    update_eth_resolver_contract_address(format!("{:?}", contract_address));
    println!("Contract deployed at: {:?}", contract_address);
    println!("Transaction hash: {}", tx_hash);
    
    Ok(contract_address)
}

pub async fn deploy_eth_src_contract(immutables: Immutables, order: Order, r: [u8; 32], vs: [u8; 32], amount: U256, taker_trait: U256, call_data: Vec<u8>) {
    let provider = Provider::<Http>::try_from(crate::utils::SEPOLIA_RPC_URL.as_str())
    .map_err(|e| format!("Failed to create provider: {:?}", e)).expect("Failed to create provider");
    
    let from_address_str = get_funding_eth_address();
    let from_address = Address::from_str(&from_address_str).unwrap();
    
    let to_address_str = get_eth_resolver_contract_address();
    let to_address = Address::from_str(&to_address_str).unwrap();

    let max_gas_fee: u128 = 500_000_000;
    let max_priority_fee_per_gas: u128 = 1_000_000;
    let gas_limit: u128 = 5_000_000;

    // Fix: Parse the full contract artifact and extract ABI
    let contract_artifact_json = include_str!("../../eth_resolver.json");
    let contract_artifact: serde_json::Value = serde_json::from_str(contract_artifact_json)
        .map_err(|e| format!("Failed to parse contract artifact: {}", e)).unwrap();

    // Extract ABI from the artifact
    let abi_value = contract_artifact["abi"].clone();
    let contract_abi: ethers::abi::Abi = serde_json::from_value(abi_value)
        .map_err(|e| format!("Failed to parse contract ABI: {}", e)).unwrap();

    let deploy_src_function = contract_abi.function("deploySrc")
        .map_err(|e| format!("Failed to find deploySrc function: {}", e)).unwrap();

    let function_signature = deploy_src_function.signature();
    let function_selector = &keccak256(function_signature.as_bytes())[0..4];
 
    let function_args = ethers::abi::encode(&[
        ethers::abi::Token::Tuple(vec![
            ethers::abi::Token::FixedBytes(immutables.order_hash.to_vec()),
            ethers::abi::Token::FixedBytes(immutables.hashlock.to_vec()),
            ethers::abi::Token::Address(immutables.maker),
            ethers::abi::Token::Address(immutables.taker),
            ethers::abi::Token::Address(immutables.token),
            ethers::abi::Token::Uint(immutables.amount),
            ethers::abi::Token::Uint(immutables.safety_deposit),
            ethers::abi::Token::Uint(immutables.timelocks),
        ]),
        ethers::abi::Token::Tuple(vec![
            ethers::abi::Token::Uint(order.salt),
            ethers::abi::Token::Uint(order.maker),
            ethers::abi::Token::Uint(order.receiver),
            ethers::abi::Token::Uint(order.maker_asset),
            ethers::abi::Token::Uint(order.taker_asset),
            ethers::abi::Token::Uint(order.making_amount),
            ethers::abi::Token::Uint(order.taking_amount),
            ethers::abi::Token::Uint(order.maker_traits),
        ]),
        ethers::abi::Token::FixedBytes(r.to_vec()),
        ethers::abi::Token::FixedBytes(vs.to_vec()),
        ethers::abi::Token::Uint(amount),
        ethers::abi::Token::Uint(taker_trait),
        ethers::abi::Token::Bytes(call_data),
    ]);

    let nonce = provider
        .get_transaction_count(from_address, None)
        .await
        .map_err(|e| format!("Failed to get nonce: {}", e)).unwrap();

    let mut contract_call = function_selector.to_vec();
    contract_call.extend(function_args);

    let evm_tx = omni_transaction::TransactionBuilder::new::<EVM>()
        .nonce(nonce.as_u64())
        .to(to_address.to_fixed_bytes())
        .input(contract_call.to_vec())
        .gas_limit(gas_limit)
        .max_fee_per_gas(max_gas_fee)
        .max_priority_fee_per_gas(max_priority_fee_per_gas)
        .chain_id(11155111)
        .build();
    
    let encoded_tx = evm_tx.build_for_signing();
    // Get signature using your MPC implementation
    let signature = get_signature(encoded_tx.to_vec()).await.unwrap();
    
    // Create signed transaction bytes
    let signed_tx_bytes = evm_tx.build_with_signature(&signature);
    
    // Send the raw transaction
    let tx_hash = send_raw_transaction(signed_tx_bytes).await.unwrap();
    
    println!("Transaction hash: {}", tx_hash);
}


pub async fn deploy_eth_dest_contract(dstImmutables: Immutables, srcCancellationTimestamp: U256) {
    let provider = Provider::<Http>::try_from(crate::utils::SEPOLIA_RPC_URL.as_str())
    .map_err(|e| format!("Failed to create provider: {:?}", e)).expect("Failed to create provider");
    
    let from_address_str = get_funding_eth_address();
    let from_address = Address::from_str(&from_address_str).unwrap();
    
    let to_address_str = get_eth_resolver_contract_address();
    let to_address = Address::from_str(&to_address_str).unwrap();

    let max_gas_fee: u128 = 500_000_000;
    let max_priority_fee_per_gas: u128 = 1_000_000;
    let gas_limit: u128 = 5_000_000;

    // Fix: Parse the full contract artifact and extract ABI
    let contract_artifact_json = include_str!("../../eth_resolver.json");
    let contract_artifact: serde_json::Value = serde_json::from_str(contract_artifact_json)
        .map_err(|e| format!("Failed to parse contract artifact: {}", e)).unwrap();

    // Extract ABI from the artifact
    let abi_value = contract_artifact["abi"].clone();
    let contract_abi: ethers::abi::Abi = serde_json::from_value(abi_value)
        .map_err(|e| format!("Failed to parse contract ABI: {}", e)).unwrap();

    let deploy_src_function = contract_abi.function("deployDst")
        .map_err(|e| format!("Failed to find deploySrc function: {}", e)).unwrap();

    let function_signature = deploy_src_function.signature();
    let function_selector = &keccak256(function_signature.as_bytes())[0..4];
 
    let function_args = ethers::abi::encode(&[
        ethers::abi::Token::Tuple(vec![
            ethers::abi::Token::FixedBytes(dstImmutables.order_hash.to_vec()),
            ethers::abi::Token::FixedBytes(dstImmutables.hashlock.to_vec()),
            ethers::abi::Token::Address(dstImmutables.maker),
            ethers::abi::Token::Address(dstImmutables.taker),
            ethers::abi::Token::Address(dstImmutables.token),
            ethers::abi::Token::Uint(dstImmutables.amount),
            ethers::abi::Token::Uint(dstImmutables.safety_deposit),
            ethers::abi::Token::Uint(dstImmutables.timelocks),
        ]),
        ethers::abi::Token::Uint(srcCancellationTimestamp)
    ]);

    let nonce = provider
        .get_transaction_count(from_address, None)
        .await
        .map_err(|e| format!("Failed to get nonce: {}", e)).unwrap();

    let mut contract_call = function_selector.to_vec();
    contract_call.extend(function_args);

    let evm_tx = omni_transaction::TransactionBuilder::new::<EVM>()
        .nonce(nonce.as_u64())
        .to(to_address.to_fixed_bytes())
        .input(contract_call.to_vec())
        .gas_limit(gas_limit)
        .max_fee_per_gas(max_gas_fee)
        .max_priority_fee_per_gas(max_priority_fee_per_gas)
        .chain_id(11155111)
        .build();
    
    let encoded_tx = evm_tx.build_for_signing();
    // Get signature using your MPC implementation
    let signature = get_signature(encoded_tx.to_vec()).await.unwrap();
    
    // Create signed transaction bytes
    let signed_tx_bytes = evm_tx.build_with_signature(&signature);
    
    // Send the raw transaction
    let tx_hash = send_raw_transaction(signed_tx_bytes).await.unwrap();
    
    println!("Transaction hash: {}", tx_hash);
}

// Helper functions
fn create_signed_transaction(tx: &TypedTransaction, signature: &Signature) -> Result<Vec<u8>, String> {
    // Convert your signature format to ethers format
    let ethers_signature = ethers::types::Signature {
        r: U256::from_big_endian(&signature.r),
        s: U256::from_big_endian(&signature.s),
        v: signature.v,
    };
    
    // Sign the transaction
    let signed_tx = tx.rlp_signed(&ethers_signature);
    Ok(signed_tx.to_vec())
}

async fn send_raw_transaction(signed_tx_bytes: Vec<u8>) -> Result<String, String> {
    let provider = Provider::<Http>::try_from(crate::utils::SEPOLIA_RPC_URL.as_str())
        .map_err(|e| format!("Failed to create provider: {:?}", e))?;
    
    let pending_tx = provider
        .send_raw_transaction(signed_tx_bytes.into())
        .await
        .map_err(|e| format!("Failed to send transaction: {}", e))?;
    
    Ok(format!("{:?}", pending_tx.tx_hash()))
}

fn calculate_contract_address(deployer: &Address, nonce: &U256) -> Address {
    use ethers::utils::rlp;

    let deployer_value = deployer.to_fixed_bytes();
    let nonce_bytes = if *nonce == U256::zero() {
        vec![0x80] // RLP encoding for empty byte string
    } else {
        let mut nonce_be_bytes = [0u8; 32];
        nonce.to_big_endian(&mut nonce_be_bytes);
        // Find the first non-zero byte
        let start = nonce_be_bytes.iter().position(|&x| x != 0).unwrap_or(31);
        nonce_be_bytes[start..].to_vec()
    };

    let input = rlp::encode_list::<Vec<u8>, Vec<u8>>(&[deployer_value.to_vec(), nonce_bytes]);
    let hash = keccak256(&input);
    Address::from_slice(&hash[12..])
}

pub async fn deploy_with_constructor_args(
    bytecode: &[u8],
    constructor_args: Vec<u8>
) -> Result<Address, String> {
    let provider = Provider::<Http>::try_from(crate::utils::SEPOLIA_RPC_URL.as_str())
        .map_err(|e| format!("Failed to create provider: {:?}", e))?;
    
    let from_address_str = get_funding_eth_address();
    let from_address = Address::from_str(&from_address_str).unwrap();

    // Combine bytecode + constructor args
    let mut deployment_data = bytecode.to_vec();
    deployment_data.extend(constructor_args);
    
    let nonce = provider.get_transaction_count(from_address, None).await
        .map_err(|e| format!("Failed to get nonce: {}", e))?;
    let gas_price = provider.get_gas_price().await
        .map_err(|e| format!("Failed to get gas price: {}", e))?;

    let deployment_tx = TransactionRequest::new()
        .from(from_address)
        .to(Address::zero())
        .data(deployment_data)
        .gas(3_000_000u64)
        .gas_price(gas_price)
        .nonce(nonce)
        .chain_id(11155111u64);

    let typed_tx: TypedTransaction = deployment_tx.into();
    let encoded_tx = typed_tx.rlp();
    let signature = get_signature(encoded_tx.to_vec()).await?;
    let signed_tx_bytes = create_signed_transaction(&typed_tx, &signature)?;
    let tx_hash = send_raw_transaction(signed_tx_bytes).await?;
    let contract_address = calculate_contract_address(&from_address, &nonce);
    
    Ok(contract_address)
}