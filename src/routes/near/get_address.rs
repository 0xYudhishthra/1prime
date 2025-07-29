use crate::utils::get_tee_account;

pub async fn get_near_account() -> String {
    let tee_account = get_tee_account().await;
    tee_account
}