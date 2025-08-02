#!/usr/bin/env node

// Example: ETH to NEAR Swap Flow
// This shows how to create and execute a cross-chain swap from ETH to NEAR

const { connect, keyStores, utils } = require("near-api-js");
const crypto = require("crypto");

async function main() {
  // Configuration
  const config = {
    networkId: "testnet",
    keyStore: new keyStores.InMemoryKeyStore(),
    nodeUrl: "https://rpc.testnet.near.org",
    walletUrl: "https://wallet.testnet.near.org",
  };

  // Connect to NEAR
  const near = await connect(config);
  const account = await near.account("user.testnet");

  // Contract addresses
  const RESOLVER_ACCOUNT = "resolver.testnet";
  const FACTORY_ACCOUNT = "escrow-factory.testnet";

  // Step 1: Simulate source escrow created on ETH
  console.log("📍 Simulating ETH -> NEAR swap flow...");
  console.log("1. Source escrow deployed on Ethereum (simulated)");

  const secret = crypto.randomBytes(32).toString("hex");
  const hashlock =
    "0x" +
    crypto
      .createHash("sha256")
      .update(Buffer.from(secret, "hex"))
      .digest("hex");

  // ETH order details (simulated from ETH chain)
  const ethOrderHash = "0x" + crypto.randomBytes(32).toString("hex");
  const srcCancellationTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  // Step 2: Create destination escrow on NEAR
  console.log("\n2. Creating destination escrow on NEAR...");

  const dstImmutables = {
    order_hash: ethOrderHash,
    hashlock: hashlock,
    maker: account.accountId, // User will receive NEAR
    taker: RESOLVER_ACCOUNT, // Resolver is the taker
    token: "near", // Native NEAR
    amount: utils.format.parseNearAmount("5"), // 5 NEAR
    safety_deposit: utils.format.parseNearAmount("0.01"),
    timelocks: {
      deployed_at: 0, // Will be set by factory
      src_withdrawal: 300, // 5 minutes (ETH chain)
      src_public_withdrawal: 3600, // 1 hour (ETH chain)
      src_cancellation: 3660, // ETH chain cancellation
      src_public_cancellation: 3720, // ETH chain public cancellation
      dst_withdrawal: 300, // 5 minutes (NEAR chain)
      dst_public_withdrawal: 3000, // 50 minutes (NEAR chain)
      dst_cancellation: 3060, // 51 minutes (NEAR chain)
    },
  };

  const resolver = new near.Contract(account, RESOLVER_ACCOUNT, {
    changeMethods: ["deploy_dst"],
    sender: account,
  });

  const deposit =
    BigInt(dstImmutables.amount) + BigInt(dstImmutables.safety_deposit);

  const result = await resolver.deploy_dst({
    args: {
      dst_immutables: dstImmutables,
      src_cancellation_timestamp: srcCancellationTimestamp,
    },
    gas: "100000000000000", // 100 TGas
    amount: deposit.toString(),
  });

  console.log("✅ Destination escrow deployed on NEAR!");
  console.log("Transaction:", result.transaction.hash);

  // Step 3: Get escrow address
  const factory = new near.Contract(account, FACTORY_ACCOUNT, {
    viewMethods: ["get_escrow_address"],
    sender: account,
  });

  const escrowAddress = await factory.get_escrow_address({
    order_hash: ethOrderHash,
  });
  console.log("📍 NEAR escrow address:", escrowAddress);

  console.log("\n3. Swap flow:");
  console.log("📤 User deposits ETH/USDC on Ethereum");
  console.log("🔒 Resolver deploys destination escrow on NEAR (✅ completed)");
  console.log("🔐 User reveals secret to withdraw NEAR");
  console.log("💰 Resolver withdraws ETH/USDC using the same secret");

  console.log("\n🔑 Secret for testing:", secret);
  console.log("🔐 Hashlock:", hashlock);

  // Step 4: Demonstrate withdrawal (after user shares secret)
  console.log("\n4. To complete the swap:");
  console.log("- User shares secret with resolver:", secret);
  console.log("- Resolver calls withdraw on NEAR escrow");
  console.log("- User receives 5 NEAR");
  console.log("- Resolver withdraws user's ETH/USDC on Ethereum");
}

main().catch(console.error);
