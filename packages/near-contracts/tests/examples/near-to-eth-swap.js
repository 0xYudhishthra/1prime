#!/usr/bin/env node

// NEAR to ETH Cross-Chain Swap Example
// This example demonstrates creating a source escrow on NEAR for swapping to ETH

const { execSync } = require("child_process");
const crypto = require("crypto");
const { JsonRpcProvider } = require("@near-js/providers");
const { Account } = require("@near-js/accounts");
const { KeyPairSigner } = require("@near-js/signers");
require("dotenv").config();

// Testnet configuration - using deployed contracts
const config = {
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  walletUrl: "https://wallet.testnet.near.org",
  accounts: {
    factory:
      process.env.FACTORY_ACCOUNT || "1prime-global-factory-contract.testnet",
    resolver:
      process.env.RESOLVER_ACCOUNT || "1prime-global-resolver-contract.testnet",
    escrowSrcTemplate:
      process.env.ESCROW_SRC_TEMPLATE ||
      "1prime-global-escrow-src-template.testnet",
    escrowDstTemplate:
      process.env.ESCROW_DST_TEMPLATE ||
      "1prime-global-escrow-dst-template.testnet",
    owner: process.env.OWNER || "1prime-global-owner.testnet",
    // Test accounts for making transactions
    maker: process.env.MAKER_ACCOUNT || "1prime-global-maker.testnet",
    taker: process.env.TAKER_ACCOUNT || "1prime-global-taker.testnet",
  },
};

// ANSI colors for output
const colors = {
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  log(`\n${colors.bold}${title}${colors.reset}`, "blue");
  log("─".repeat(title.length), "blue");
}

async function setupNearConnection() {
  // Create provider
  const provider = new JsonRpcProvider({ url: config.nodeUrl });

  // Get credentials from environment variables
  const privateKey = process.env.PRIVATE_KEY;
  const accountId = process.env.ACCOUNT_ID || config.accounts.owner;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  try {
    // Create signer from private key string
    const signer = KeyPairSigner.fromSecretKey(privateKey); // ed25519:xxxxx...

    // Create account instance
    const account = new Account(accountId, provider, signer);

    return { provider, account };
  } catch (error) {
    throw new Error(`Failed to setup NEAR connection: ${error.message}`);
  }
}

async function runNearCommand(command) {
  try {
    const output = execSync(command, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      output: error.stdout ? error.stdout.toString() : "",
    };
  }
}

async function main() {
  log("🌉 NEAR → ETH Cross-Chain Swap Example (Testnet)", "bold");
  log("═══════════════════════════════════════════════", "blue");

  // Setup NEAR connection
  let nearConnection;
  try {
    nearConnection = await setupNearConnection();
    log("✅ NEAR connection established", "green");
  } catch (error) {
    log("❌ Cannot connect to NEAR:", "red");
    log(`   Error: ${error.message}`, "yellow");
    process.exit(1);
  }

  logSection("Step 1: Generate Swap Secrets");

  // Generate secret and hashlock
  const secret = crypto.randomBytes(32).toString("hex");
  const hashlock = crypto
    .createHash("sha256")
    .update(Buffer.from(secret, "hex"))
    .digest("hex");

  log(`🔑 Secret: ${secret}`, "yellow");
  log(`🔐 Hashlock: ${hashlock}`, "yellow");

  logSection("Step 2: Create Source Escrow on NEAR");

  const currentTime = Math.floor(Date.now() / 1000); // Convert to seconds
  const orderSalt = "example-salt";
  const makingAmount = "1000000000000000000"; // 1 NEAR (smaller test amount)
  const takingAmount = "1000000000000000000"; // 1 USDC (6 decimals, smaller test amount)
  const safetyDeposit = "100000000000000000000"; // 0.1 NEAR (smaller test amount)

  // Prepare order according to the ABI - FIELD ORDER MATTERS!
  // Force exact field order by creating objects with precise property order
  const timelocks = {};
  timelocks.deployed_at = currentTime.toString(); // 1st - u64 as string
  timelocks.src_withdrawal = 300; // 2nd - u32 as number
  timelocks.src_public_withdrawal = 600; // 3rd - u32 as number
  timelocks.src_cancellation = 900; // 4th - u32 as number
  timelocks.src_public_cancellation = 1200; // 5th - u32 as number
  timelocks.dst_withdrawal = 180; // 6th - u32 as number
  timelocks.dst_public_withdrawal = 360; // 7th - u32 as number
  timelocks.dst_cancellation = 720; // 8th - u32 as number

  const extension = {};
  extension.hashlock = hashlock; // 1st
  extension.src_chain_id = "397"; // 2nd - NEAR (u64 as string)
  extension.dst_chain_id = "1"; // 3rd - Ethereum (u64 as string)
  extension.src_safety_deposit = safetyDeposit; // 4th - 0.1 NEAR
  extension.dst_safety_deposit = safetyDeposit; // 5th - 0.1 NEAR equivalent on ETH
  extension.timelocks = timelocks; // 6th - Timelocks

  // Create Order object with EXACT field order matching Rust struct
  const order = {};
  order.maker = config.accounts.maker; // 1st - AccountId
  order.taker = config.accounts.resolver; // 2nd - AccountId
  order.making_amount = makingAmount; // 3rd - U128
  order.taking_amount = takingAmount; // 4th - U128
  order.maker_asset = "near"; // 5th - AccountId
  order.taker_asset =
    "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"; // 6th - String
  order.salt = orderSalt; // 7th - String
  order.extension = extension; // 8th - OrderExtension

  const orderSignature = orderSalt.slice(0, 32).toString();

  // Create source escrow via resolver
  log("🔄 Creating source escrow...", "yellow");

  const deployArgs = {
    order: order,
    order_signature: orderSignature,
    amount: makingAmount,
  };

  // Debug: Log the JSON being sent
  log(`📋 Deploy args: ${JSON.stringify(deployArgs, null, 2)}`, "blue");

  // Debug: Check what's at column 352
  const jsonString = JSON.stringify(deployArgs);
  log(`📏 JSON length: ${jsonString.length}`, "blue");
  if (jsonString.length >= 352) {
    log(
      `🔍 Character at column 352: "${jsonString.charAt(351)}" (${jsonString.charCodeAt(351)})`,
      "blue"
    );
    log(
      `🔍 Substring around column 352: "${jsonString.substring(346, 358)}"`,
      "blue"
    );
  }

  // Call deploy_src using NEAR API with properly ordered arguments
  try {
    log("🔄 Calling deploy_src via NEAR API...", "yellow");

    // Use the clean account.callFunction method
    console.log(deployArgs);
    const result = await nearConnection.account.callFunction({
      contractId: config.accounts.resolver,
      methodName: "deploy_src",
      args: deployArgs, // Direct object with correct field ordering
      gas: "300000000000000",
      attachedDeposit: "1100000000000000000000000",
    });

    log("✅ Source escrow created successfully!", "green");
    log(`   Transaction: ${result.transaction?.hash || "N/A"}`, "blue");
  } catch (error) {
    log("❌ Failed to create source escrow:", "red");
    log(`   Error: ${error.message}`, "red");

    // If there's more detail in the error, log it
    if (error.kind?.ExecutionError) {
      log(`   Execution Error: ${error.kind.ExecutionError}`, "red");
    }
    process.exit(1);
  }

  logSection("Step 3: Check Escrow Address");

  // Get escrow address from factory using NEAR API
  try {
    const escrowAddressResult = await nearConnection.provider.callFunction(
      config.accounts.factory,
      "get_escrow_address",
      { order_hash: orderSalt }
    );

    // The result comes as bytes array, decode it
    const escrowAddress = JSON.parse(
      Buffer.from(escrowAddressResult.result).toString()
    );
    log(`✅ Source escrow deployed at: ${escrowAddress}`, "green");
  } catch (error) {
    log("⚠️  Could not retrieve escrow address", "yellow");
    log(`   Error: ${error.message}`, "yellow");
  }

  logSection("Step 4: Simulate Cross-Chain Flow");

  log("📤 1. NEAR escrow created and funded (✅ completed)", "green");
  log("🔄 2. Resolver detects escrow creation...", "yellow");
  log("🚀 3. Resolver deploys destination escrow on ETH...", "yellow");
  log("⏳ 4. Waiting for both escrows to be funded...", "yellow");

  // Simulate some delay
  await new Promise(resolve => setTimeout(resolve, 2000));

  log("✅ 5. Both escrows are now active!", "green");

  logSection("Step 5: Execute Withdrawal (Simulation)");

  log("🔐 To complete the swap, the maker would:", "blue");
  log(`   1. Share secret with resolver: ${secret}`, "yellow");
  log("   2. Resolver withdraws from ETH escrow using secret", "yellow");
  log("   3. Resolver sends ETH/USDC to maker's ETH address", "yellow");
  log("   4. Resolver withdraws from NEAR escrow using secret", "yellow");

  // In a real scenario, you would wait for the resolver to execute these steps
  log("\n💡 For testing, you can manually trigger the withdrawal:", "blue");
  log(
    `   near call <escrow_address> withdraw '{"secret": "${secret}"}' --accountId ${config.accounts.resolver} --networkId ${config.networkId}`,
    "yellow"
  );

  logSection("Summary");

  log("🎉 NEAR → ETH swap simulation completed!", "green");
  log("\n📋 Swap Details:", "blue");
  log(`   • Order Salt: ${orderSalt}`, "blue");
  log(`   • Amount: 1 NEAR → 1 Token`, "blue");
  log(`   • Secret: ${secret}`, "blue");
  log(`   • Hashlock: ${hashlock}`, "blue");
  log(`   • Maker: ${config.accounts.maker}`, "blue");
  log(`   • Resolver: ${config.accounts.resolver}`, "blue");

  log("\n🔗 Check the testnet explorer:", "blue");
  log("   https://explorer.testnet.near.org", "yellow");
}

main().catch(error => {
  log(`\n💥 Error: ${error.message}`, "red");
  process.exit(1);
});
