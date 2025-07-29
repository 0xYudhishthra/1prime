use ethers::prelude::*;
use std::{str::FromStr};

use crate::{routes::eth::get_address::get_funding_eth_address, utils::SEPOLIA_RPC_URL};

/// <summary>
/// get the eth balance of the eth address
/// </summary>

pub async fn get_balance() -> Result<String, String>{
    let provider = Provider::<Http>::try_from(SEPOLIA_RPC_URL)
        .map_err(|e| format!("Provider error: {}", e))?;
    
    let addr_str = get_funding_eth_address().await;
    let addr = Address::from_str(&addr_str).unwrap();
    let balance_result = provider.get_balance(addr, None).await;
    if balance_result.is_err() {
        return Err("Getting balance has failed".into())
    }
    Ok(balance_result.unwrap().to_string())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_balance_success() {
        let result = get_balance().await;
        assert!(result.is_ok());
        let balance = result.unwrap();
        assert!(!balance.is_empty());
        // Balance should be a valid number string
        assert!(balance.parse::<u128>().is_ok());
    }
}
