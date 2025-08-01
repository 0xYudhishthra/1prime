use std::str::FromStr;

use borsh::BorshDeserialize;
use k256::sha2::Sha256;
use near_api::{Account, AccountId, Chain, Signer, Tokens};
use near_crypto::ED25519PublicKey;
use near_primitives::{action::base64, block};
use omni_transaction::{near::{types::{Action, BlockHash, TransferAction, U128, U64}, utils::PublicKeyStrExt}, TxBuilder, NEAR};
use omni_transaction::near::types::{Signature, ED25519Signature};
use sha3::Digest;

use crate::routes::near::get_address::{get_funding_near_address, get_funding_near_public_key};

pub async fn mock_transfer_funds() {


    let block_hash = Chain::block_hash().fetch_from_testnet().await.unwrap();
    
    let signer_id = get_funding_near_address().await;
    let signer_account_id = AccountId::from_str(&signer_id.clone()).expect("Invalid NEAR account ID");
    let signer_public_key = get_funding_near_public_key().await;
    let signer_public_key_bytes: [u8; 32] = signer_public_key.to_public_key_as_bytes()
        .expect("Failed to get public key bytes")
        .try_into()
        .expect("Public key must be exactly 32 bytes");

    let nonce_data = Account(signer_account_id.clone())
            .access_key(
                near_crypto::PublicKey::ED25519(ED25519PublicKey(signer_public_key_bytes))
            )
            .fetch_from_testnet()
            .await.unwrap();

    let mut nonce = U64(nonce_data.data.nonce);
    let receiver_id = "victorevolves.testnet";
    let transfer_action = Action::Transfer(TransferAction {deposit: U128(1)});
    let actions = vec![transfer_action];

    let near_tx = omni_transaction::TransactionBuilder::new::<NEAR>()
        .signer_id(signer_id.clone())
        .receiver_id(receiver_id.to_string())
        .nonce(nonce.0 + 1)
        .actions(actions)
        .block_hash(BlockHash(block_hash.0))
        .signer_public_key(signer_public_key.to_public_key().unwrap())
        .build();

    let encoded_tx = near_tx.build_for_signing();
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
        return;
    }

    let signature_data = request_signature_result.unwrap();
    println!("Signature data: {:?}", signature_data);

    let signature_bytes = signature_data["signature"].as_array().expect("Failed to get signature array");
    let signature_u8_vec: Vec<u8> = signature_bytes.iter()
        .map(|v| v.as_u64().expect("Failed to convert to u64") as u8)
        .collect();
    let signature_array: [u8; 64] = signature_u8_vec.try_into().expect("Signature must be exactly 64 bytes");

    let signature = Signature::ED25519(ED25519Signature::try_from_slice(&signature_array).unwrap());
    let signed_tx = near_tx.build_with_signature(signature);
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