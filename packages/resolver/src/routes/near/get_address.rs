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