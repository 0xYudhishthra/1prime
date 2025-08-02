#!/usr/bin/env node

// NEAR to ETH Cross-Chain Swap Example
// This example demonstrates creating a source escrow on NEAR for swapping to ETH

const { execSync } = require("child_process");
const crypto = require("crypto");

// Testnet configuration
const config = {
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  walletUrl: "https://wallet.testnet.near.org",
  accounts: {
    factory: process.env.FACTORY_ACCOUNT || "escrow-factory.testnet",
    resolver: process.env.RESOLVER_ACCOUNT || "escrow-resolver.testnet",
    maker: process.env.MAKER_ACCOUNT || "maker-test.testnet",
    taker: process.env.TAKER_ACCOUNT || "taker-test.testnet",
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
      env: {
        ...process.env,
        NEAR_CLI_LOCALNET_NETWORK_ID: config.networkId,
        NEAR_NODE_URL: config.nodeUrl,
        NEAR_WALLET_URL: config.walletUrl,
      },
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

  const currentTime = Date.now();
  const orderHash = crypto.randomBytes(32).toString("hex");

  // Prepare immutables for source escrow
  const immutables = {
    order_hash: orderHash,
    hashlock: hashlock,
    maker: config.accounts.maker,
    taker: config.accounts.resolver,
    token: "near",
    amount: "2000000000000000000000000", // 2 NEAR
    safety_deposit: "100000000000000000000000", // 0.1 NEAR
    timelocks: {
      deployed_at: currentTime,
      src_withdrawal: 300,
      src_public_withdrawal: 600,
      src_cancellation: 900,
      src_public_cancellation: 1200,
      dst_withdrawal: 180,
      dst_public_withdrawal: 360,
      dst_cancellation: 720,
    },
  };

  const dstComplement = {
    safety_deposit: "100000000000000000000000",
    deployed_at: currentTime,
  };

  // Create source escrow via resolver
  log("🔄 Creating source escrow...", "yellow");
  const createSrcResult = await runNearCommand(
    `near call ${config.accounts.resolver} deploy_src '${JSON.stringify({
      order_hash: orderHash,
      immutables: immutables,
      dst_complement: dstComplement,
    })}' --accountId ${
      config.accounts.maker
    } --gas 300000000000000 --amount 2.1 --nodeUrl ${
      config.nodeUrl
    } --networkId ${config.networkId}`
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
    `near view ${config.accounts.factory} get_escrow_address '{"order_hash": "${orderHash}"}' --nodeUrl ${config.nodeUrl} --networkId ${config.networkId}`
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
    `   near call <escrow_address> withdraw '{"secret": "${secret}"}' --accountId ${config.accounts.resolver} --nodeUrl ${config.nodeUrl} --networkId ${config.networkId}`,
    "yellow"
  );

  logSection("Summary");

  log("🎉 NEAR → ETH swap simulation completed!", "green");
  log("\n📋 Swap Details:", "blue");
  log(`   • Order Hash: ${orderHash}`, "blue");
  log(`   • Amount: 2 NEAR → ETH/USDC`, "blue");
  log(`   • Secret: ${secret}`, "blue");
  log(`   • Maker: ${config.accounts.maker}`, "blue");
  log(`   • Resolver: ${config.accounts.resolver}`, "blue");

  log("\n🔗 Check the testnet explorer:", "blue");
  log("   https://explorer.testnet.near.org", "yellow");
}

main().catch(error => {
  log(`\n💥 Error: ${error.message}`, "red");
  process.exit(1);
});
