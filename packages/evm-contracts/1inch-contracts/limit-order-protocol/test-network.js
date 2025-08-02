const hre = require("hardhat");

async function main() {
  console.log("Testing network connection...");
  console.log("Network name:", hre.network.name);
  console.log("Chain ID:", await hre.getChainId());
  
  const [signer] = await hre.ethers.getSigners();
  console.log("Deployer address:", signer.address);
  
  const balance = await hre.ethers.provider.getBalance(signer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
