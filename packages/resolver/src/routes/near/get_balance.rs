use std::str::FromStr;

use crate::{agent::{agent, agent_account_id, AgentConfig}, routes::near::get_address::get_funding_near_address};
use tokio;
use near_api::{AccountId, Tokens};

pub async fn get_near_balance() -> String{

    let fund_holder_account_str = get_funding_near_address().await;
    let fund_holder_account = AccountId::from_str(&fund_holder_account_str).unwrap();
    let get_balance_result = Tokens::account(fund_holder_account.clone()).near_balance().fetch_from_testnet().await;
    match get_balance_result {
        Ok(balance) => {
            println!("Balance response: {:?}", balance);
            balance.total.to_string()
        }
        Err(e) => {
            eprintln!("Failed to get balance: {}", e);
            "0".to_string() // Return 0 if there's an error
        }
    }

}

/*pub async fn get_near_balance() -> Result<String, String> {
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
}*/
