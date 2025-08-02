#!/usr/bin/env node

// NEAR to ETH Cross-Chain Swap Example
// This example demonstrates creating a source escrow on NEAR for swapping to ETH

const { execSync } = require("child_process");
const crypto = require("crypto");

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

  // Check if testnet is accessible
  try {
    const response = await fetch("https://rpc.testnet.near.org/status");
    if (!response.ok) {
      throw new Error("Testnet not responding");
    }
    log("✅ NEAR testnet is accessible", "green");
  } catch (error) {
    log("❌ Cannot connect to NEAR testnet:", "red");
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
  const orderSalt = crypto.randomBytes(32).toString("hex");
  const makingAmount = "1000000000000000000000"; // 1 NEAR (smaller test amount)
  const takingAmount = "1000000"; // 1 USDC (6 decimals, smaller test amount)
  const safetyDeposit = "100000000000000000000"; // 0.1 NEAR (smaller test amount)

  // Prepare order according to the ABI - FIELD ORDER MATTERS!
  const order = {
    maker: config.accounts.maker, // 1st
    taker: config.accounts.resolver, // 2nd
    making_amount: makingAmount, // 3rd
    taking_amount: takingAmount, // 4th
    maker_asset: "near", // 5th - Native NEAR token
    taker_asset: "USDC", // 6th - ETH asset identifier
    salt: orderSalt, // 7th
    extension: {
      // 8th - OrderExtension field order
      hashlock: hashlock, // 1st
      src_chain_id: "397", // 2nd - NEAR (u64 as string)
      dst_chain_id: "1", // 3rd - Ethereum (u64 as string)
      src_safety_deposit: safetyDeposit, // 4th - 0.1 NEAR
      dst_safety_deposit: safetyDeposit, // 5th - 0.1 NEAR equivalent on ETH
      timelocks: {
        // 6th - Timelocks field order
        deployed_at: currentTime.toString(), // 1st - u64 as string
        src_withdrawal: 300, // 2nd - u32 as number
        src_public_withdrawal: 600, // 3rd - u32 as number
        src_cancellation: 900, // 4th - u32 as number
        src_public_cancellation: 1200, // 5th - u32 as number
        dst_withdrawal: 180, // 6th - u32 as number
        dst_public_withdrawal: 360, // 7th - u32 as number
        dst_cancellation: 720, // 8th - u32 as number
      },
    },
  };

  const orderSignature = "mock_signature_" + orderSalt.slice(0, 16);

  // Create source escrow via resolver
  log("🔄 Creating source escrow...", "yellow");

  const deployArgs = {
    order: order,
    order_signature: orderSignature,
    amount: makingAmount,
  };

  // Debug: Log the JSON being sent
  log(`📋 Deploy args: ${JSON.stringify(deployArgs, null, 2)}`, "blue");

  const createSrcResult = await runNearCommand(
    `near call ${config.accounts.resolver} deploy_src '${JSON.stringify(
      deployArgs
    )}' --accountId ${
      config.accounts.owner
    } --gas 300000000000000 --amount 1.1 --networkId ${config.networkId}`
  );

  if (createSrcResult.success) {
    log("✅ Source escrow created successfully!", "green");
    log(
      `   Transaction: ${
        createSrcResult.output.match(/Transaction hash: (\w+)/)?.[1] || "N/A"
      }`,
      "blue"
    );
  } else {
    log("❌ Failed to create source escrow:", "red");
    log(`   Error: ${createSrcResult.error}`, "red");
    process.exit(1);
  }

  logSection("Step 3: Check Escrow Address");

  // Get escrow address from factory
  const getAddressResult = await runNearCommand(
    `near view ${config.accounts.factory} get_escrow_address '{"order_hash": "${orderSalt}"}' --networkId ${config.networkId}`
  );

  if (getAddressResult.success) {
    const escrowAddress = getAddressResult.output.match(/"([^"]+)"/)?.[1];
    log(`✅ Source escrow deployed at: ${escrowAddress}`, "green");
  } else {
    log("⚠️  Could not retrieve escrow address", "yellow");
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
  log(`   • Amount: 1 NEAR → 1 USDC`, "blue");
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
