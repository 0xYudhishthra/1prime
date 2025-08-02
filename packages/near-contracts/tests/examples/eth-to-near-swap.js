#!/usr/bin/env node

// ETH to NEAR Cross-Chain Swap Example
// This example demonstrates creating a destination escrow on NEAR for receiving from ETH

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
  log("🌉 ETH → NEAR Cross-Chain Swap Example (Testnet)", "bold");
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

  logSection("Step 1: Simulate ETH Source Escrow");

  // Generate secret and hashlock (would come from ETH side)
  const secret = crypto.randomBytes(32).toString("hex");
  const hashlock = crypto
    .createHash("sha256")
    .update(Buffer.from(secret, "hex"))
    .digest("hex");

  // Simulate ETH order details
  const ethOrderHash = crypto.randomBytes(32).toString("hex");
  const ethTxHash = "0x" + crypto.randomBytes(32).toString("hex");

  log("🔐 ETH source escrow details (simulated):", "blue");
  log(`   • Order Hash: ${ethOrderHash}`, "yellow");
  log(`   • ETH Tx Hash: ${ethTxHash}`, "yellow");
  log(`   • Secret: ${secret}`, "yellow");
  log(`   • Hashlock: ${hashlock}`, "yellow");
  log(`   • Amount: 1000 USDC → 5 NEAR`, "yellow");

  logSection("Step 2: Create Destination Escrow on NEAR");

  const currentTime = Date.now();

  // Prepare immutables for destination escrow
  const immutables = {
    order_hash: ethOrderHash,
    hashlock: hashlock,
    maker: config.accounts.maker, // Will receive NEAR
    taker: config.accounts.resolver, // Resolver is the taker
    token: "near", // Native NEAR
    amount: "5000000000000000000000000", // 5 NEAR
    safety_deposit: "100000000000000000000000", // 0.1 NEAR
    timelocks: {
      deployed_at: currentTime,
      src_withdrawal: 300, // ETH chain timelock
      src_public_withdrawal: 600,
      src_cancellation: 900,
      src_public_cancellation: 1200,
      dst_withdrawal: 180, // NEAR chain timelock
      dst_public_withdrawal: 360,
      dst_cancellation: 720,
    },
  };

  const dstComplement = {
    safety_deposit: "100000000000000000000000",
    deployed_at: currentTime,
  };

  // Create destination escrow via resolver
  log("🔄 Creating destination escrow on NEAR...", "yellow");
  const createDstResult = await runNearCommand(
    `near call ${config.accounts.resolver} deploy_dst '${JSON.stringify({
      dst_immutables: immutables,
      src_cancellation_timestamp: Math.floor(Date.now() / 1000) + 3600,
    })}' --accountId ${
      config.accounts.resolver
    } --gas 300000000000000 --amount 5.1 --nodeUrl ${
      config.nodeUrl
    } --networkId ${config.networkId}`
  );

  if (createDstResult.success) {
    log("✅ Destination escrow created successfully!", "green");
    log(
      `   Transaction: ${
        createDstResult.output.match(/Transaction hash: (\w+)/)?.[1] || "N/A"
      }`,
      "blue"
    );
  } else {
    log("❌ Failed to create destination escrow:", "red");
    log(`   Error: ${createDstResult.error}`, "red");
    process.exit(1);
  }

  logSection("Step 3: Check Escrow Address");

  // Get escrow address from factory
  const getAddressResult = await runNearCommand(
    `near view ${config.accounts.factory} get_escrow_address '{"order_hash": "${ethOrderHash}"}' --nodeUrl ${config.nodeUrl} --networkId ${config.networkId}`
  );

  let escrowAddress;
  if (getAddressResult.success) {
    escrowAddress = getAddressResult.output.match(/"([^"]+)"/)?.[1];
    log(`✅ Destination escrow deployed at: ${escrowAddress}`, "green");
  } else {
    log("⚠️  Could not retrieve escrow address", "yellow");
  }

  logSection("Step 4: Check Escrow Status");

  // Check escrow info
  if (escrowAddress) {
    const escrowInfoResult = await runNearCommand(
      `near view ${escrowAddress} get_escrow_info --nodeUrl ${config.nodeUrl} --networkId ${config.networkId}`
    );

    if (escrowInfoResult.success) {
      log("📊 Escrow Information:", "blue");
      try {
        const info = JSON.parse(escrowInfoResult.output);
        log(`   • Current Phase: ${info.current_phase}`, "yellow");
        log(`   • Amount: ${parseInt(info.amount) / 1e24} NEAR`, "yellow");
        log(
          `   • Safety Deposit: ${parseInt(info.safety_deposit) / 1e24} NEAR`,
          "yellow"
        );
        log(`   • Is Funded: ${info.state.is_funded}`, "yellow");
      } catch (e) {
        log(`   Raw output: ${escrowInfoResult.output}`, "yellow");
      }
    }
  }

  logSection("Step 5: Simulate Cross-Chain Flow");

  log("🔄 Cross-chain swap flow:", "blue");
  log("📤 1. User deposits USDC on Ethereum (✅ simulated)", "green");
  log(
    "🔒 2. NEAR destination escrow created and funded (✅ completed)",
    "green"
  );
  log("⏳ 3. Waiting for finality lock period...", "yellow");

  // Simulate waiting for finality
  await new Promise(resolve => setTimeout(resolve, 1000));

  log("✅ 4. Finality lock expired - withdrawal now possible!", "green");

  logSection("Step 6: Execute Withdrawal");

  log("🔐 The withdrawal process:", "blue");
  log("   1. User/resolver reveals secret to withdraw NEAR", "yellow");
  log("   2. Same secret unlocks USDC on Ethereum", "yellow");

  // Demonstrate the withdrawal command
  log("\n💡 To withdraw NEAR using the secret:", "blue");
  if (escrowAddress) {
    log(
      `   near call ${escrowAddress} withdraw '{"secret": "${secret}"}' --accountId ${config.accounts.resolver} --gas 100000000000000 --nodeUrl ${config.nodeUrl} --networkId ${config.networkId}`,
      "yellow"
    );
  }

  log("\n📝 Alternative public withdrawal (after public period):", "blue");
  if (escrowAddress) {
    log(
      `   near call ${escrowAddress} public_withdraw '{"secret": "${secret}"}' --accountId ${config.accounts.maker} --gas 100000000000000 --nodeUrl ${config.nodeUrl} --networkId ${config.networkId}`,
      "yellow"
    );
  }

  logSection("Step 7: Cancellation (if needed)");

  log("⚠️  If swap fails, cancellation is possible after timeout:", "yellow");
  if (escrowAddress) {
    log(
      `   near call ${escrowAddress} cancel --accountId ${config.accounts.resolver} --gas 100000000000000 --nodeUrl ${config.nodeUrl} --networkId ${config.networkId}`,
      "yellow"
    );
  }

  logSection("Summary");

  log("🎉 ETH → NEAR swap simulation completed!", "green");
  log("\n📋 Swap Details:", "blue");
  log(`   • Order Hash: ${ethOrderHash}`, "blue");
  log(`   • Amount: 1000 USDC → 5 NEAR`, "blue");
  log(`   • Secret: ${secret}`, "blue");
  log(`   • Hashlock: ${hashlock}`, "blue");
  log(`   • Maker: ${config.accounts.maker}`, "blue");
  log(`   • Resolver: ${config.accounts.resolver}`, "blue");
  if (escrowAddress) {
    log(`   • Escrow Address: ${escrowAddress}`, "blue");
  }

  log("\n🔗 Check the testnet explorer:", "blue");
  log("   https://explorer.testnet.near.org", "yellow");

  log("\n🧪 Test different scenarios:", "blue");
  log("   • Try withdrawing with the secret above", "yellow");
  log("   • Wait for timeout and try cancellation", "yellow");
  log("   • Check escrow phases over time", "yellow");
}

main().catch(error => {
  log(`\n💥 Error: ${error.message}`, "red");
  process.exit(1);
});
