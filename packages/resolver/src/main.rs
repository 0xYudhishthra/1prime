mod routes;
mod agent;
mod utils;
mod near;
mod eth;

use progenitor::generate_api;
use routes::agentAccount::{get_agent_account};

use axum::Router;

use crate::{agent::agent_account_id, eth::utils::{deploy_eth_resolver_contract, deploy_eth_src_contract}, near::utils::{construct_sample_order, create_near_funding_account, delete_near_account, deploy_near_resolver_contract, deploy_near_src_contract, setup_near_account_from_agent}, routes::{eth::get_address::setup_funding_eth_address, near::get_address::{setup_funding_near_address, setup_holding_near_address}}};

pub async fn sample_deploy_near_src_contract() {
    let order = construct_sample_order().await;
    deploy_near_src_contract(order, "1234567890".to_string(), 10).await;
}

#[tokio::main]
async fn main() {

    println!("Running Setup...");
    //setup_funding_eth_address().await;
    setup_funding_near_address().await;
    setup_holding_near_address().await;
    
    delete_near_account().await;
    create_near_funding_account().await;
    setup_near_account_from_agent().await;
    
    deploy_near_resolver_contract().await;
    //deploy_near_src_contract(construct_sample_order().await, "1234567890".to_string(), 10).await;
    //println!("{:?}", deploy_eth_resolver_contract().await);
    //deploy_eth_src_contract().await;
    println!("Setup Complete!");
    //deploy_near_resolver_contract().await;

    tokio::spawn(async {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
        loop {
            interval.tick().await;
            // Replace with your actual API call
            // Example: let response = reqwest::get("https://api.example.com/endpoint").await;
            //utils::read_order().await;
        }
    });

    println!("Running on Port 3001...");
    let app = Router::new()
        .route("/api/eth/get_address", axum::routing::get(routes::eth::get_address::get_funding_eth_address_await))
        .route("/api/near/get_address", axum::routing::get(routes::near::get_address::get_funding_near_address))
        .route("/api/eth/get_balance", axum::routing::get(routes::eth::get_balance::get_balance))
        .route("/api/near/get_balance", axum::routing::get(routes::near::get_balance::get_near_balance))
        .route("/api/eth/mock_transfer", axum::routing::get(routes::eth::mock_transfer_funds::mock_transfer_funds))
        .route("/api/near/mock_transfer", axum::routing::get(routes::near::mock_transfer_funds::mock_transfer_funds))
        .route("/api/near/get_mock_transfer_address", axum::routing::get(routes::near::mock_transfer_funds_with_gas_sponsorship::get_additional_mock_address))
        .route("/api/near/mock_transfer_usdc_with_gas_sponsorship", axum::routing::get(routes::near::mock_transfer_funds_with_gas_sponsorship::mock_transfer_usdc))
        .route("/api/eth/deploy_eth_resolver", axum::routing::get(routes::eth::deploy_resolver::deploy_resolver))
        .route("/api/eth/deploy_near_src_contract", axum::routing::get(sample_deploy_near_src_contract));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}


