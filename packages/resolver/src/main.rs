mod routes;
mod agent;
mod utils;

use routes::agentAccount::{get_agent_account};

use axum::Router;

use crate::{agent::agent_account_id, routes::{eth::get_address::setup_funding_eth_address, near::get_address::setup_funding_near_address}};

#[tokio::main]
async fn main() {

    println!("Running Setup...");
    setup_funding_eth_address().await;
    setup_funding_near_address().await;

    println!("Running on Port 3001...");
    let app = Router::new()
        .route("/api/eth/get_address", axum::routing::get(routes::eth::get_address::get_funding_eth_address))
        .route("/api/near/get_address", axum::routing::get(routes::near::get_address::get_funding_near_address))
        .route("/api/eth/get_balance", axum::routing::get(routes::eth::get_balance::get_balance))
        .route("/api/near/get_balance", axum::routing::get(routes::near::get_balance::get_near_balance))
        .route("/api/eth/mock_transfer", axum::routing::get(routes::eth::mock_transfer_funds::mock_transfer_funds))
        .route("/api/near/mock_transfer", axum::routing::get(routes::near::mock_transfer_funds::mock_transfer_funds))
        .route("/api/near/get_mock_transfer_address", axum::routing::get(routes::near::mock_transfer_funds_with_gas_sponsorship::get_additional_mock_address))
        .route("/api/near/mock_transfer_usdc_with_gas_sponsorship", axum::routing::get(routes::near::mock_transfer_funds_with_gas_sponsorship::mock_transfer_usdc));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}


