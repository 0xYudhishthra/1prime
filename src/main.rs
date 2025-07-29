mod routes;
mod agent;
mod utils;

use routes::agentAccount::{get_agent_account};

use axum::Router;

use crate::agent::agent_account_id;

#[tokio::main]
async fn main() {

    let app = Router::new()
        .route("/api/get_agent_account_rust", axum::routing::get(get_agent_account))
        .route("/api/eth/get_address", axum::routing::get(routes::eth::get_address::get_funding_eth_address))
        .route("/api/near/get_address", axum::routing::get(routes::near::get_address::get_near_account));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}


