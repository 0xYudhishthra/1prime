
use axum::{Json, response::IntoResponse};
use serde::Serialize;
use crate::agent::{agent_account_id, agent, AgentConfig};

#[derive(Serialize)]
struct AgentAccountResponse {
    accountId: String,
    balance: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}


async fn agent_get_balance() -> Result<String, String> {
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

pub async fn get_agent_account() -> impl IntoResponse {
    match (agent_account_id(&AgentConfig::from_env()).await, agent_get_balance().await) {
        (Ok(account_id), Ok(balance)) => {
            let resp = AgentAccountResponse {
                accountId: account_id.to_string(),
                balance: balance,
            };
            Json(resp).into_response()
        }
        (Err(e), _) => {
            let err = ErrorResponse {
                error: format!("Failed to get agent account: {}", e),
            };
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(err)).into_response()
        }
        (_, Err(e)) => {
            let err = ErrorResponse {
                error: format!("Failed to get agent account: {}", e),
            };
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(err)).into_response()
        }
    }
}
