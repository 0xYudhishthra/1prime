use std::{env, str::FromStr, sync::LazyLock};
use k256::elliptic_curve::rand_core::le;
use near_api::{Account, AccountId, Chain};
use near_crypto::ED25519PublicKey;
use omni_transaction::{near::{types::{Action, BlockHash, FunctionCallAction, GlobalContractIdentifier, NonDelegateAction, UseGlobalContractAction, U128, U64}, utils::PublicKeyStrExt}, TransactionBuilder, TxBuilder, NEAR};
use progenitor::generate_api;
use serde::Serialize;
use serde_json::json;

use crate::{agent::{self, agent_account_id, request_signature}, routes::{eth::get_address::get_funding_eth_address, near::{get_address::{get_funding_near_address, get_funding_near_public_key, setup_funding_near_address}}}};

generate_api!("openapi.yaml");

pub static SEPOLIA_RPC_URL: LazyLock<String> = LazyLock::new(|| env::var("ALCHEMY_ETH_SEPOLIA_RPC_URL").unwrap());
pub static NEAR_RESOLVER_WASM: &[u8] = include_bytes!("../near_resolver.wasm");

pub async fn get_testnet_mpc_signer_account_id() -> AccountId {
    AccountId::from_str("v1.signer-prod.testnet").unwrap()
}

pub async fn get_tee_account() -> String {
    let agent_account_id_result = agent_account_id(&agent::AgentConfig::from_env()).await.unwrap();
    agent_account_id_result["accountId"].to_string().trim_matches('"').to_string()
}

pub fn json_bytes<T>(structure: T) -> Vec<u8> where T: Serialize {
    let mut bytes: Vec<u8> = Vec::new();
    serde_json::to_writer(&mut bytes, &structure).unwrap();
    bytes
}

fn get_client() -> Client{
    Client::new("https://1prime-relayer.up.railway.app/api/v1")
}

pub async fn read_order() {
    println!("{:?}", get_client().get_active_orders().await);
}