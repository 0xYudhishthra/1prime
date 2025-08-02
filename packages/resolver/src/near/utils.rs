use std::{env, str::FromStr, sync::LazyLock};
use borsh::BorshDeserialize;
use k256::{elliptic_curve::rand_core::le, sha2::Sha256};
use near_api::{Account, AccountId, Chain};
use near_crypto::ED25519PublicKey;
use omni_transaction::{near::{types::{Action, BlockHash, ED25519Signature, FunctionCallAction, GlobalContractIdentifier, NonDelegateAction, Signature, UseGlobalContractAction, U128, U64}, utils::PublicKeyStrExt}, TransactionBuilder, TxBuilder, NEAR};
use serde_json::json;
use sha3::Digest;
use near_primitives::action::base64;

use crate::{routes::near::get_address::{get_funding_near_address, get_funding_near_public_key}, utils::json_bytes};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Order {
    pub maker: AccountId,
    pub taker: AccountId,
    pub making_amount: u128,
    pub taking_amount: u128,
    pub maker_asset: AccountId, // "near" for native NEAR
    pub taker_asset: String,    // ETH address of token on destination
    pub salt: String,
    pub extension: OrderExtension,
}

#[derive(Serialize, Deserialize)]
pub struct OrderExtension {
    pub hashlock: String,
    pub src_chain_id: u64,
    pub dst_chain_id: u64,
    pub src_safety_deposit: u128,
    pub dst_safety_deposit: u128,
    pub timelocks: Timelocks,
}

#[derive(Serialize, Deserialize)]
pub struct Timelocks {
    pub deployed_at: u64, // Deployment timestamp (MUST match factory)
    pub src_withdrawal: u32,
    pub src_public_withdrawal: u32,
    pub src_cancellation: u32,
    pub src_public_cancellation: u32,
    pub dst_withdrawal: u32,
    pub dst_public_withdrawal: u32,
    pub dst_cancellation: u32,
}

#[derive(Serialize, Deserialize)]
pub struct Immutables {
    pub order_hash: String,
    pub hashlock: String,
    pub maker: AccountId,
    pub taker: AccountId,
    pub token: AccountId,
    pub amount: u128,
    pub safety_deposit: u128,
    pub timelocks: Timelocks,
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

/// deploy resolver contract if it doesn't exist
pub async fn deploy_near_resolver_contract() {
    /// Deploy Resolver Contract
    /// The contract that needs to have the resolver code deployed
    let signer_id = get_funding_near_address().await;

    let block_hash = Chain::block_hash().fetch_from_testnet().await.unwrap();
    
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

    /// deploy resolver contract by referencing the global contract code
    let global_contract_deploy_action = Action::UseGlobalContract(Box::new(
        UseGlobalContractAction {
            contract_identifier: GlobalContractIdentifier::AccountId(
                AccountId::from_str("1prime-global-resolver-contract.testnet").unwrap()
            ),
        }
    ));

    let contract_init_action = Action::FunctionCall(Box::new(
        FunctionCallAction {
            method_name: "new".to_string(),
            args: json_bytes(json!(
                {
                    "owner": signer_id.clone(),
                    "escrow_factory": "1prime-global-factory.testnet",
                    "dst_chain_resolver": "test"
                }
            )),
            gas: U64(300000000000000), // 30 TGas
            deposit: U128(0)
        }
    ));

    let actions = vec![global_contract_deploy_action, contract_init_action];

    let near_tx = omni_transaction::TransactionBuilder::new::<NEAR>()
        .signer_id(signer_id.clone())
        .receiver_id(signer_id.clone())
        .nonce(nonce.0 + 1)
        .actions(actions)
        .block_hash(BlockHash(block_hash.0))
        .signer_public_key(signer_public_key.to_public_key().unwrap())
        .build();

    let encoded_tx = near_tx.build_for_signing();
    let signature = get_signature(encoded_tx).await.expect("Failed to get signature");
    let signed_tx = near_tx.build_with_signature(signature);
    send_transaction(signed_tx, signer_id).await;
}

pub async fn deploy_near_src_contract(order: Order, order_signature: String, amount: u128) {
        /// The contract that needs to have the resolver code deployed
    let signer_id = get_funding_near_address().await;

    let block_hash = Chain::block_hash().fetch_from_testnet().await.unwrap();
    
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

    let deploy_src_contract_action = Action::FunctionCall(Box::new(
        FunctionCallAction {
            method_name: "deploy_src".to_string(),
            args: json_bytes(json!(
                {
                    "order": order,
                    "order_signature": order_signature,
                    "amount": amount,
                }
            )),
            gas: U64(300000000000000), // 30 TGas
            deposit: U128(0)
        }
    ));

    let actions = vec![deploy_src_contract_action];

    let near_tx = omni_transaction::TransactionBuilder::new::<NEAR>()
        .signer_id(signer_id.clone())
        .receiver_id(signer_id.clone())
        .nonce(nonce.0 + 1)
        .actions(actions)
        .block_hash(BlockHash(block_hash.0))
        .signer_public_key(signer_public_key.to_public_key().unwrap())
        .build();

    let encoded_tx = near_tx.build_for_signing();
    let signature = get_signature(encoded_tx).await.expect("Failed to get signature");
    let signed_tx = near_tx.build_with_signature(signature);
    send_transaction(signed_tx, signer_id).await;
}

pub async fn deploy_near_dst_contract(
    dst_immutables: Immutables,
    src_cancellation_timestamp: u64
) {
            /// The contract that needs to have the resolver code deployed
    let signer_id = get_funding_near_address().await;

    let block_hash = Chain::block_hash().fetch_from_testnet().await.unwrap();
    
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

    let deploy_src_contract_action = Action::FunctionCall(Box::new(
        FunctionCallAction {
            method_name: "deploy_dst".to_string(),
            args: json_bytes(json!(
                {
                    "dst_immutables": dst_immutables,
                    "src_cancellation_timestamp": src_cancellation_timestamp,
                }
            )),
            gas: U64(300000000000000), // 30 TGas
            deposit: U128(0)
        }
    ));

    let actions = vec![deploy_src_contract_action];

    let near_tx = omni_transaction::TransactionBuilder::new::<NEAR>()
        .signer_id(signer_id.clone())
        .receiver_id(signer_id.clone())
        .nonce(nonce.0 + 1)
        .actions(actions)
        .block_hash(BlockHash(block_hash.0))
        .signer_public_key(signer_public_key.to_public_key().unwrap())
        .build();

    let encoded_tx = near_tx.build_for_signing();
    let signature = get_signature(encoded_tx).await.expect("Failed to get signature");
    let signed_tx = near_tx.build_with_signature(signature);
    send_transaction(signed_tx, signer_id).await;
}
