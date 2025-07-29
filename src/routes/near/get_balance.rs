use crate::agent::{agent_account_id, agent, AgentConfig};
use tokio;

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
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_near_balance_success() {
        let result = get_near_balance().await;
        assert!(result.is_ok());
        let balance = result.unwrap();
        assert!(!balance.is_empty());
    }
}
