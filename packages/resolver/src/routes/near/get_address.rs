use crate::utils::get_tee_account;
use std::{str::FromStr, sync::{Arc, RwLock}};
use borsh::BorshDeserialize as _;
use k256::sha2::Sha256;
use lazy_static::lazy_static;
use near_api::{Contract, Data};
use omni_transaction::near::types::{ED25519Signature, Signature};
use serde_json::json;
use sha3::Digest;
use crate::utils::get_testnet_mpc_signer_account_id;
use near_crypto::{PublicKey, ED25519PublicKey};
use near_primitives::{action::base64, types::AccountId};


lazy_static! {
    static ref FUNDING_NEAR_ADDRESS: Arc<RwLock<String>> = Arc::new(RwLock::new(String::new()));
    static ref FUNDING_NEAR_PUBLIC_KEY: Arc<RwLock<String>> = Arc::new(RwLock::new(String::new()));
}

pub fn update_funding_near_address(value: String) {
    let mut funding_near_address = FUNDING_NEAR_ADDRESS.write().unwrap();
    *funding_near_address = value;
}

pub fn update_funding_near_public_key(value: String) {
    let mut funding_near_public_key = FUNDING_NEAR_PUBLIC_KEY.write().unwrap();
    *funding_near_public_key = value;
}

pub async fn get_funding_near_address() -> String {
    let funding_near_address = FUNDING_NEAR_ADDRESS.read().unwrap();
    funding_near_address.clone()
}

pub async fn get_funding_near_public_key() -> String {
    let funding_near_public_key = FUNDING_NEAR_PUBLIC_KEY.read().unwrap();
    funding_near_public_key.clone()
}

pub async fn setup_funding_near_address() {
    let derived_address_data : Data<String> =Contract(get_testnet_mpc_signer_account_id().await)
    .call_function("derived_public_key", json!(
        {
            "path": "oneprime-funding-eth",
            "predecessor": std::env::var("NEXT_PUBLIC_contractId").unwrap(),
            "domain_id": 1
        }
    ))
    .unwrap()
    .read_only()
        .fetch_from_testnet()
    .await
    .expect("Failed to fetch near address");

    // Parse the ED25519 public key from the data
    let public_key_str = derived_address_data.data;
    update_funding_near_public_key(public_key_str.clone());

    println!("Public Key Data: {:?}", public_key_str);
    let public_key = PublicKey::from_str(&public_key_str)
        .expect("Failed to parse public key");

    // Convert to implicit NEAR address
    let implicit_address = hex::encode(public_key.key_data());
    println!("Implicit Address: {:?}", implicit_address);
    let near_address = format!("{}", implicit_address);

    update_funding_near_address(near_address);
}

pub async fn get_signature(encoded_tx: Vec<u8>) -> Option<Signature> {
    let transaction_hash = Sha256::digest(&encoded_tx);
    let hash_hex = hex::encode(transaction_hash);
    
    println!("Transaction hash for signing: {}", hash_hex);
    
    // Now use this hash for signing with your agent
    let request_signature_result = crate::agent::request_signature(
        "oneprime-funding-eth", // or your NEAR key identifier
        &hash_hex,
        Some("Eddsa"),
        &crate::agent::AgentConfig::from_env()
    ).await;

    if request_signature_result.is_err() {
        eprintln!("Failed to get signature: {:?}", request_signature_result.err());
        return None;
    }

    let signature_data = request_signature_result.unwrap();
    println!("Signature data: {:?}", signature_data);

    let signature_bytes = signature_data["signature"].as_array().expect("Failed to get signature array");
    let signature_u8_vec: Vec<u8> = signature_bytes.iter()
        .map(|v| v.as_u64().expect("Failed to convert to u64") as u8)
        .collect();
    let signature_array: [u8; 64] = signature_u8_vec.try_into().expect("Signature must be exactly 64 bytes");

    Some(Signature::ED25519(ED25519Signature::try_from_slice(&signature_array).unwrap()))
}

pub async fn send_transaction(signed_tx: Vec<u8>, signer_id: String) {
    let base64_tx = base64(&signed_tx);
    println!("{}", base64_tx);


    let near_testnet_url = near_api::RPCEndpoint::testnet().url.to_string();
    let request_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": signer_id,
        "method": "send_tx",
        "params": {
            "signed_tx_base64": base64_tx,
            "wait_until": "INCLUDED_FINAL"
        }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&near_testnet_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_else(|_| "Failed to read response body".to_string());
            println!("Response status: {}", status);
            println!("Response body: {}", body);
        }
        Err(e) => {
            eprintln!("Failed to send transaction: {:?}", e);
        }
    }
}