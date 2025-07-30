use near_api::{AccountId, Contract, Data};
use serde_json::json;
use sha3::{Digest, Keccak256};

use crate::{agent::{request_signature, AgentConfig}, utils::{get_tee_account, get_testnet_mpc_signer_account_id}};
use std::sync::{Arc, RwLock};
use lazy_static::lazy_static;

lazy_static! {
    static ref FUNDING_ETH_ADDRESS: Arc<RwLock<String>> = Arc::new(RwLock::new(String::new()));
}

pub fn update_funding_eth_address(value: String) {
    let mut funding_eth_address = FUNDING_ETH_ADDRESS.write().unwrap();
    *funding_eth_address = value;
}

pub async fn get_funding_eth_address() -> String {
    let funding_eth_address = FUNDING_ETH_ADDRESS.read().unwrap();
    funding_eth_address.clone()
}

pub async fn setup_funding_eth_address() {
    
    let derived_address_data : Data<String> =Contract(get_testnet_mpc_signer_account_id().await)
    .call_function("derived_public_key", json!(
        {
            "path": "oneprime-funding-eth",
            "predecessor": std::env::var("NEXT_PUBLIC_contractId").unwrap()
        }
    ))
    .unwrap()
    .read_only()
        .fetch_from_testnet()
    .await
    .expect("Failed to fetch etherum address");

    let data = derived_address_data.data;
    let base58_key = data.trim_start_matches("secp256k1:");
    let pubkey_bytes = bs58::decode(base58_key.trim()).into_vec().expect("Failed to decode base58 public key");
    let hash = Keccak256::digest(&pubkey_bytes);
    let eth_address = &hash[12..];
    update_funding_eth_address(
        format!("0x{}",hex::encode(eth_address))
    );
}

/* <summary>
Retrieves the Etherum Address controls by the TEE which will act as the holder account that holds gas for sponsoring transactions
</summary>
pub async fn get_funding_eth_address() -> String{

    let tee_account = get_tee_account().await;
    println!("TEE Account: {:?}", tee_account);

    println!("TEE Sig: {:?}", get_tee_acc().await);

    let derived_address_data : Data<String> =Contract(get_testnet_mpc_signer_account_id().await)
    .call_function("derived_public_key", json!(
        {
            "path": "eth-1",
            "predecessor": tee_account
        }
    ))
    .unwrap()
    .read_only()
    .fetch_from_testnet()
    .await
    .expect("Failed to fetch etherum address");

    let data = derived_address_data.data;
    let base58_key = data.trim_start_matches("secp256k1:");
    let pubkey_bytes = bs58::decode(base58_key.trim()).into_vec().expect("Failed to decode base58 public key");
    let hash = Keccak256::digest(&pubkey_bytes);
    let eth_address = &hash[12..];
    format!("0x{}",hex::encode(eth_address))
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_funding_eth_address() {
        let result = get_funding_eth_address().await;
        assert_eq!(result, "0x28bff41b990348624a1d4e057b8f0fe94e75830d");
    }
}
*/