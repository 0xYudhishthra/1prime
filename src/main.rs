mod routes;
mod agent;

use routes::agentAccount::{get_agent_account};

use axum::Router;

#[tokio::main]
async fn main() {

    
    let app = Router::new()
        .route("/api/get_agent_account_rust", axum::routing::get(get_agent_account));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}


