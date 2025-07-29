use ethers::prelude::*;
use std::{str::FromStr};

use crate::{routes::eth::get_address::get_funding_eth_address, utils::SEPOLIA_RPC_URL};

/// <summary>
/// get the eth balance of the eth address
/// </summary>

pub async fn get_balance() -> String{
    let provider = Provider::<Http>::try_from(SEPOLIA_RPC_URL).unwrap();
    let addr_str = get_funding_eth_address().await;
    let addr = Address::from_str(&addr_str).unwrap();
    let balance = provider.get_balance(addr, None).await.unwrap();
    balance.to_string()
}