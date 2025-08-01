use std::str::FromStr;

use k256::sha2::Sha256;
use near_api::{Account, AccountId, Chain, Contract, Data, NearToken};
use serde::Serialize;
use sha3::Digest;
use crate::{routes::near::get_address::{get_funding_near_address, get_funding_near_public_key}, utils::get_testnet_mpc_signer_account_id};
use serde_json::json;
use near_primitives::{action::{base64, delegate::{self, NonDelegateAction}, FunctionCallAction}, block, hash::CryptoHash, signable_message::{SignableMessage, SignableMessageType}};
use omni_transaction::{near::{types::{Action, BlockHash, DelegateAction, ED25519PublicKey, TransferAction, U128, U64}, utils::PublicKeyStrExt}, TxBuilder, NEAR};
use omni_transaction::near::types::{Signature, ED25519Signature, SignedDelegateAction};
use borsh::{BorshSerialize, BorshDeserialize};
use near_primitives::hash;

#[derive(BorshSerialize, BorshDeserialize)]
struct FtTransferCallArgs {
    receiver_id: AccountId,
    amount: NearToken,
}

/// first value being near address
/// second value being public key
pub async fn get_additional_mock_details() -> (String, String){
    let derived_address_data : Data<String> =Contract(get_testnet_mpc_signer_account_id().await)
    .call_function("derived_public_key", json!(
        {
            "path": "oneprime-funding-eth-mock",
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

    println!("Public Key Data: {:?}", public_key_str);
    let public_key = near_crypto::PublicKey::from_str(&public_key_str)
        .expect("Failed to parse public key");
    println!("Public Key: {:?}", public_key);

    // Convert to implicit NEAR address
    let implicit_address = hex::encode(public_key.key_data());
    println!("Implicit Address: {:?}", implicit_address);
    let near_address = format!("{}", implicit_address);

    (near_address, public_key_str)
}

pub async fn get_additional_mock_address() -> String {
    let (near_address, _) = get_additional_mock_details().await;
    near_address
}

pub async fn get_additional_mock_public_key() -> String {
    let (_, public_key_str) = get_additional_mock_details().await;
    public_key_str
}

pub fn get_nep461_hash(delegation_action: DelegateAction) -> CryptoHash {
    let signable = SignableMessage::new(&delegation_action, SignableMessageType::DelegateAction);
    let bytes = borsh::to_vec(&signable).expect("Failed to deserialize");
    hash::hash(&bytes)
}

pub fn json_bytes<T>(structure: T) -> Vec<u8> where T: Serialize {
    let mut bytes: Vec<u8> = Vec::new();
    serde_json::to_writer(&mut bytes, &structure).unwrap();
    bytes
}

async fn generate_near_mock_usdc_transfer_delegate_action() -> Option<SignedDelegateAction> {

    let block_hash = Chain::block_hash().fetch_from_testnet().await.unwrap();
    let maximum_block_height = Chain::block_number().fetch_from_testnet().await.unwrap() + 1000;

    let (signer_id, signer_public_key) = get_additional_mock_details().await;
    let signer_account_id = AccountId::from_str(&signer_id.clone()).expect("Invalid NEAR account ID");
    let signer_public_key_bytes: [u8; 32] = signer_public_key.to_public_key_as_bytes()
        .expect("Failed to get public key bytes")
        .try_into()
        .expect("Public key must be exactly 32 bytes");

    let nonce_data = Account(signer_account_id.clone())
        .access_key(
            near_crypto::PublicKey::ED25519(near_crypto::ED25519PublicKey(signer_public_key_bytes))
        )
        .fetch_from_testnet()
        .await.unwrap();
    let mut nonce = U64(nonce_data.data.nonce);

    let transfer_usdc_action = omni_transaction::near::types::Action::FunctionCall(
        Box::new(omni_transaction::near::types::FunctionCallAction     {
            method_name: "ft_transfer".to_string(),
            args: json_bytes(json!({
                "receiver_id": AccountId::from_str("victorevolves.testnet").unwrap(),
                "amount": NearToken::from_yoctonear(1000000), // 1 USDC
            })),
            gas: U64(300000000000000), // 30 TGas
            deposit: U128(1)
        })
    );
    
   
    let actions = vec![omni_transaction::near::types::NonDelegateAction::try_from(transfer_usdc_action).unwrap()];
    

    let value = signer_public_key.to_public_key().unwrap();
    println!("printing public key: {:?}", value);

    let delegated_action = DelegateAction{
        sender_id: AccountId::from_str(&signer_id.clone()).unwrap(),
        receiver_id: AccountId::from_str("3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af").unwrap(),
        actions: actions.clone(),
        nonce: U64(nonce.0 + 1),
        max_block_height: U64(maximum_block_height),
        public_key: value.clone(),
    };

    let transaction_hash = get_nep461_hash(delegated_action.clone());
    let hash_hex = hex::encode(transaction_hash);

    let request_signature_result = crate::agent::request_signature(
        "oneprime-funding-eth-mock", // or your NEAR key identifier
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

    let signature = Signature::ED25519(ED25519Signature::try_from_slice(&signature_array).unwrap());

    Some(SignedDelegateAction {
        delegate_action: delegated_action,
        signature: signature
    })

}

pub async fn mock_transfer_usdc() {

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
                near_crypto::PublicKey::ED25519(near_crypto::ED25519PublicKey(signer_public_key_bytes))
            )
            .fetch_from_testnet()
            .await.unwrap();

    let mut nonce = U64(nonce_data.data.nonce);

    let (receiver_id, public_key_str) = get_additional_mock_details().await;
    // /let receiver_id = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
    let transfer_action = Action::Delegate(Box::new(
        generate_near_mock_usdc_transfer_delegate_action().await
            .expect("Failed to generate delegate action")
    ));
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
    let transaction_hash = hash::hash(&encoded_tx);
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

