use crate::utils::get_tee_account;
use std::sync::{Arc, RwLock};
use lazy_static::lazy_static;

lazy_static! {
    static ref FUNDING_NEAR_ADDRESS: Arc<RwLock<String>> = Arc::new(RwLock::new(String::new()));
}

pub fn update_funding_near_address(value: String) {
    let mut funding_near_address = FUNDING_NEAR_ADDRESS.write().unwrap();
    *funding_near_address = value;
}

pub async fn get_funding_near_address() -> String {
    let funding_near_address = FUNDING_NEAR_ADDRESS.read().unwrap();
    funding_near_address.clone()
}

pub async fn setup_funding_near_address() {
   let funding_near_address = get_funding_near_address().await;
   update_funding_near_address(funding_near_address);
   funding_near_address
}

#[tokio::test]
async fn test_get_near_account_returns_expected_value() {
    let result = get_near_account().await;
    assert_eq!(result, "1af660a79008c0ce0c5a5605c6107fd7f355a41cb407d4728300a4e15b35cdbb");
}
