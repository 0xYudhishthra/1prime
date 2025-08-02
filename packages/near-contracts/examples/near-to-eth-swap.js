#!/usr/bin/env node

// Example: NEAR to ETH Swap Flow
// This shows how to create and execute a cross-chain swap from NEAR to ETH

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

  // Step 1: Create order
  const secret = crypto.randomBytes(32).toString("hex");
  const hashlock =
    "0x" +
    crypto
      .createHash("sha256")
      .update(Buffer.from(secret, "hex"))
      .digest("hex");

  const order = {
    maker: account.accountId,
    taker: RESOLVER_ACCOUNT, // Resolver will be the taker
    making_amount: utils.format.parseNearAmount("10"), // 10 NEAR
    taking_amount: "1000000", // 1 USDC on ETH (6 decimals)
    maker_asset: "near", // Native NEAR
    taker_asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum
    salt: "0x" + crypto.randomBytes(32).toString("hex"),
    extension: {
      hashlock: hashlock,
      src_chain_id: 1313161555, // NEAR testnet
      dst_chain_id: 1, // Ethereum mainnet
      src_safety_deposit: utils.format.parseNearAmount("0.01"),
      dst_safety_deposit: utils.format.parseNearAmount("0.01"),
      timelocks: {
        deployed_at: 0, // Will be set by factory during deployment
        src_withdrawal: 300, // 5 minutes
        src_public_withdrawal: 3600, // 1 hour
        src_cancellation: 3660, // 1 hour + 1 minute
        src_public_cancellation: 3720, // 1 hour + 2 minutes
        dst_withdrawal: 300,
        dst_public_withdrawal: 3000,
        dst_cancellation: 3060,
      },
    },
  };

  // Step 2: Sign order (off-chain)
  // In production, this would use EIP-712 style signing
  const orderHash = computeOrderHash(order);
  const signature = await signOrder(account, orderHash);

  console.log("Order created:");
  console.log("- Order Hash:", orderHash);
  console.log("- Secret:", secret);
  console.log("- Hashlock:", hashlock);

  // Step 3: Deploy source escrow on NEAR
  console.log("\nDeploying source escrow on NEAR...");

  const resolver = new near.Contract(account, RESOLVER_ACCOUNT, {
    changeMethods: ["deploy_src"],
    sender: account,
  });

  const fillAmount = order.making_amount; // Fill full amount
  const deposit =
    BigInt(fillAmount) + BigInt(order.extension.src_safety_deposit);

  const result = await resolver.deploy_src({
    args: {
      order: order,
      order_signature: signature,
      amount: fillAmount.toString(),
    },
    gas: "100000000000000", // 100 TGas
    amount: deposit.toString(),
  });

  console.log("Source escrow deployed!");
  console.log("Transaction:", result.transaction.hash);

  // Step 4: Get escrow address
  const factory = new near.Contract(account, FACTORY_ACCOUNT, {
    viewMethods: ["get_escrow_address"],
    sender: account,
  });

  const escrowAddress = await factory.get_escrow_address({
    order_hash: orderHash,
  });
  console.log("Escrow address:", escrowAddress);

  // Step 5: Wait for resolver to deploy destination escrow on ETH
  console.log(
    "\nWaiting for resolver to deploy destination escrow on Ethereum..."
  );
  console.log("The resolver will:");
  console.log("1. Monitor NEAR for SrcEscrowCreated event");
  console.log("2. Deploy destination escrow on Ethereum");
  console.log("3. Wait for user to share secret");

  // Step 6: After destination escrow is deployed and verified, share secret
  console.log("\nTo complete swap, share secret with resolver:", secret);

  // The resolver will then:
  // 1. Withdraw from destination escrow on ETH using secret
  // 2. Send ETH/USDC to user's ETH address
  // 3. Withdraw from source escrow on NEAR using secret
  // 4. Keep the NEAR tokens as payment
}

function computeOrderHash(order) {
  // Simplified - should match the exact algorithm in contracts
  const data = `${order.maker}:${order.making_amount}:${order.taking_amount}:${order.maker_asset}:${order.taker_asset}:${order.salt}:${order.extension.hashlock}`;
  return "0x" + crypto.createHash("sha256").update(data).digest("hex");
}

async function signOrder(account, orderHash) {
  // In production, implement proper order signing
  // This is a placeholder
  return "0x" + crypto.randomBytes(65).toString("hex");
}

main().catch(console.error);
