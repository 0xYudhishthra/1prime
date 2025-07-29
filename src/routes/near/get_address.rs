use crate::utils::get_tee_account;

pub async fn get_near_account() -> String {
    let tee_account = get_tee_account().await;
    tee_account
}

#[tokio::test]
async fn test_get_near_account_returns_expected_value() {
    let result = get_near_account().await;
    assert_eq!(result, "1af660a79008c0ce0c5a5605c6107fd7f355a41cb407d4728300a4e15b35cdbb");
}
