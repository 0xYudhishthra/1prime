use crate::agent::{agent_account_id, agent, AgentConfig};

pub async fn get_near_balance() -> Result<String, String> {
    // Simulate fetching balance
    let get_balance_result = agent("getBalance", serde_json::json!({}), &AgentConfig::from_env()).await;
    match get_balance_result {
        Ok(balance) => {
            println!("Balance response: {:?}", balance);
            let balance_value = balance["balance"].as_str().unwrap_or("0");
            Ok(balance_value.to_string())
        }
        Err(e) => Err(format!("Failed to get balance: {}", e)),
    }
}