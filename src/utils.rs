use std::str::FromStr;
use near_api::{Account, AccountId};

use crate::agent::{self, agent_account_id, request_signature};

pub async fn get_testnet_mpc_signer_account_id() -> AccountId {
    AccountId::from_str("v1.signer-prod.testnet").unwrap()
}

pub async fn get_tee_account() -> String {
    let agent_account_id_result = agent_account_id(&agent::AgentConfig::from_env()).await.unwrap();
    agent_account_id_result["accountId"].to_string().trim_matches('"').to_string()
}