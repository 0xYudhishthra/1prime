use crate::eth::utils::deploy_eth_resolver_contract;

pub async fn deploy_resolver() {
    deploy_eth_resolver_contract().await;
}