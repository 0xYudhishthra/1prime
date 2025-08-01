use serde::{Deserialize, Serialize};
use std::env;
use regex::Regex;

#[derive(Serialize, Deserialize)]
pub struct ContractArgs {
    pub methodName: String,
    pub args: serde_json::Value,
}

pub struct AgentConfig {
    pub api_port: u16,
    pub api_path: String,
}

impl AgentConfig {
    pub fn from_env() -> Self {
        let api_port = env::var("API_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3140);

        let contract_id = env::var("NEXT_PUBLIC_contractId").unwrap_or_default();
        let re = Regex::new("(?i)sandbox").unwrap(); // (?i) makes it case-insensitive
        let api_path = if re.is_match(&contract_id) {
            "shade-agent-api".to_string()
        } else {
            "localhost".to_string()
        };

        Self { api_port, api_path }
    }
}

pub async fn agent(method_name: &str, args: serde_json::Value, config: &AgentConfig) -> Result<serde_json::Value, reqwest::Error> {
    let url = format!(
        "http://{}:{}/api/agent/{}",
        config.api_path, config.api_port, method_name
    );
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .json(&args)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    Ok(res)
}

/// Retrieves the account ID of the agent.
pub async fn agent_account_id(config: &AgentConfig) -> Result<serde_json::Value, reqwest::Error> {
    agent("getAccountId", serde_json::json!({}), config).await
}

/// Retrieves the agent's record from the agent contract
pub async fn agent_info(config: &AgentConfig) -> Result<serde_json::Value, reqwest::Error> {
    let account_id_response = agent_account_id(config).await?;
    let account_id = account_id_response["accountId"].as_str().unwrap_or("");
    
    let args = serde_json::json!({
        "methodName": "get_agent",
        "args": {
            "account_id": account_id
        }
    });
    
    agent("view", args, config).await
}

/// Contract view from agent account inside the API
pub async fn agent_view(args: ContractArgs, config: &AgentConfig) -> Result<serde_json::Value, reqwest::Error> {
    agent("view", serde_json::to_value(args).unwrap(), config).await
}

/// Contract call from agent account inside the API
pub async fn agent_call(args: ContractArgs, config: &AgentConfig) -> Result<serde_json::Value, reqwest::Error> {
    println!("{}", serde_json::to_string(&args).unwrap());
    agent("call", serde_json::to_value(args).unwrap(), config).await
}

/// Requests a digital signature from the agent for a given payload and path.
pub async fn request_signature(
    path: &str,
    payload: &str,
    key_type: Option<&str>,
    config: &AgentConfig
) -> Result<serde_json::Value, reqwest::Error> {
    let args = ContractArgs {
        methodName: "request_signature".to_string(),
        args: serde_json::json!({
            "path": path,
            "payload": payload,
            "key_type": key_type.unwrap_or("Ecdsa")
        })
    };
    
    agent_call(args, config).await
}