use near_api::{AccountId, Contract, Data};
use serde_json::json;
use sha3::{Digest, Keccak256};

use crate::utils::{get_testnet_mpc_signer_account_id, get_tee_account};

/// <summary>
/// Retrieves the Etherum Address controls by the TEE which will act as the holder account that holds gas for sponsoring transactions
/// </summary>L
pub async fn get_funding_eth_address() -> String{

    let tee_account = get_tee_account().await;
    println!("TEE Account: {:?}", tee_account);

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