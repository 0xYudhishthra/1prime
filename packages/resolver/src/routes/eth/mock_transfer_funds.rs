use ethers::providers::{Http, Middleware, Provider};
use ethers::types::{Address, U256};
use near_api::near_primitives;
use omni_transaction::{evm::{types::{Signature}, utils::parse_eth_address, EVMTransaction}, TxBuilder, EVM};
use sha3::{Digest, Keccak256};
use std::env;
use std::str::FromStr;

use crate::{agent::{request_signature, AgentConfig}, routes::eth::get_address::get_funding_eth_address};

pub async fn mock_transfer_funds() -> String{
    println!("Mock transfer funds called");

    let provider = Provider::<Http>::try_from(crate::utils::SEPOLIA_RPC_URL.as_str());
    if provider.is_err() {
        return format!("Failed to create provider: {:?}", provider.err());
    }
    let provider = provider.unwrap();
   
   let to_address_str = env::var("MOCK_DESTINATION_ADDRESS").unwrap();
   let to_address = parse_eth_address(&to_address_str);
   let max_gas_fee: u128 = 20_000_000_000;
   let max_priority_fee_per_gas: u128 = 2_000_000_000;
   let gas_limit: u128 = 21_000;
   let chain_id: u64 = 11155111; // Sepolia Testnet Chain ID
   
   let from_address_str = get_funding_eth_address().await;
   let from_address = Address::from_str(&from_address_str).unwrap();
   
   let nonce = provider.get_transaction_count(from_address, None).await.unwrap();
   let data: Vec<u8> = vec![];
   let value: u128 = 100_000_000_000_000; // 0.001 ETH

   let evm_tx: EVMTransaction = omni_transaction::TransactionBuilder::new::<EVM>()
   .nonce(nonce.as_u64())
   .to(to_address)
   .value(value)
   .gas_limit(gas_limit)
   .max_fee_per_gas(max_gas_fee)
   .max_priority_fee_per_gas(max_priority_fee_per_gas)
   .input(data.clone())
   .chain_id(chain_id)
   .build();

   let transaction_encoded = evm_tx.build_for_signing();
   let transaction_hash = Keccak256::digest(&transaction_encoded);

   let request_signature_result = request_signature(
       "oneprime-funding-eth",
       &hex::encode(transaction_hash),
       None,
       &AgentConfig::from_env()
   ).await;

   if request_signature_result.is_err() {
       return format!("Failed to get signature: {:?}", request_signature_result.err());
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

    let signed_transaction = evm_tx.build_with_signature(&signature);

    match provider.send_raw_transaction(signed_transaction.clone().into()).await {
        Ok(pending_tx) => {
            println!("Transaction sent successfully: {:?}", pending_tx);
            let receipt = pending_tx.await;
            match receipt {
                Ok(Some(receipt)) => {
                    format!("Transaction receipt: {:?}", receipt)
                }
                Ok(None) => {
                    format!("Transaction receipt not found")
                }
                Err(e) => {
                    format!("Failed to get transaction receipt: {}", e)
                }
            }
        }
        Err(e) => {
            format!("Failed to send transaction: {}", e)
        }
    }

}