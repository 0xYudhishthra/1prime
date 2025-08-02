const hre = require("hardhat");

const wethByNetwork = {
  hardhat: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  mainnet: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  sepolia: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
};

async function main() {
  console.log("Starting direct deployment...");
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", await hre.getChainId());

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying from address:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");

  // Get the contract factory
  const LimitOrderProtocol = await hre.ethers.getContractFactory("LimitOrderProtocol");
  
  // Get WETH address for current network
  const wethAddress = wethByNetwork[hre.network.name];
  console.log("Using WETH address:", wethAddress);

  // Deploy the contract
  console.log("Deploying LimitOrderProtocol...");
  const limitOrderProtocol = await LimitOrderProtocol.deploy(wethAddress);
  
  console.log("Waiting for deployment transaction...");
  await limitOrderProtocol.waitForDeployment();
  
  const contractAddress = await limitOrderProtocol.getAddress();
  console.log("LimitOrderProtocol deployed to:", contractAddress);

  // Verify on Etherscan (if not local network)
  const chainId = await hre.getChainId();
  if (chainId !== "31337") {
    console.log("Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [wethAddress],
      });
      console.log("Contract verified successfully!");
    } catch (error) {
      console.log("Verification failed:", error.message);
    }
  }

  console.log("\nDeployment Summary:");
  console.log("===================");
  console.log("Contract: LimitOrderProtocol");
  console.log("Network:", hre.network.name);
  console.log("Address:", contractAddress);
  console.log("WETH Address:", wethAddress);
  console.log("Deployer:", deployer.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
