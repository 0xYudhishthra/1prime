import { Hono } from "hono";
import { createAuth } from "../auth";
import { createAccount, sendTransaction } from "./zerodev";
import { smartWallet } from "./db/schema";
import { createDb } from "./db";
import { eq } from "drizzle-orm";
import {
  createFundedTestnetAccountNear,
  sendNearTransaction,
} from "./nearwallet";
import { KeyPairString } from "@near-js/crypto";
import { cors } from "hono/cors";

const app = new Hono<{
  Bindings: CloudflareBindings;
}>();

// Add CORS middleware
app.use("*", cors({
  origin: "*", // For development - restrict this in production
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.on(["GET", "POST"], "/api/**", c => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

app.post("/sign-up/email", async c => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env);
  const { email, password } = await c.req.json();
  const data = await auth.api.signUpEmail({
    body: {
      name: "John Doe",
      email: email,
      password: password,
      image: "https://example.com/image.png",
    },
  });

  const nameToNearAccountId = data.user.id.toLowerCase();

  const { signerPrivateKey, smartAccountAddress, chainId, kernelVersion } =
    await createAccount(c.env.ZERODEV_RPC);

  if (!signerPrivateKey || !smartAccountAddress || !chainId || !kernelVersion) {
    return c.json({ error: "Failed to create evm account" }, 500);
  }

  const nearAccount = await createFundedTestnetAccountNear(
    `${nameToNearAccountId}.testnet`
  );

  if (!nearAccount) {
    return c.json({ error: "Failed to create near account" }, 500);
  }

  await db.insert(smartWallet).values({
    userId: data.user.id,
    evm_signerPrivateKey: signerPrivateKey,
    evm_smartAccountAddress: smartAccountAddress,
    evm_chainId: chainId,
    evm_kernelVersion: kernelVersion,
    near_accountId: nearAccount.accountId,
    near_keypair: nearAccount.keyPair.toString(),
  });

  console.log(data);
  return c.json(data.token);
});

app.post("/api/send-transaction", async c => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  console.log(session);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  const txnHash = await sendTransaction(
    c.env.ZERODEV_RPC,
    wallet[0].evm_signerPrivateKey
  );

  console.log("signerPrivateKey", wallet[0].evm_signerPrivateKey);
  console.log("smartAccountAddress", wallet[0].evm_smartAccountAddress);
  console.log("chainId", wallet[0].evm_chainId);
  console.log("kernelVersion", wallet[0].evm_kernelVersion);
  console.log("txnHash", txnHash);
  return c.json({ txnHash });
});

app.get("/api/random-number", async c => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  console.log(c.req.raw.headers);
  console.log(session);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const number = Math.floor(Math.random() * 100);
  return c.json({ number });
});

app.get("/create-near-account", async c => {
  const userId = "4ErVTktFNUW7KWXaERVHeolyggRdhCXo";

  const nameToNearAccountId = userId.toLowerCase();
  const nearAccount = await createFundedTestnetAccountNear(
    `${nameToNearAccountId}.testnet`
  );

  if (!nearAccount) {
    return c.json({ error: "Failed to create near account" }, 500);
  }

  return c.json({ nearAccount });
});

app.post("/api/send-near-transaction", async c => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  console.log(session);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  if (!wallet[0].near_accountId || !wallet[0].near_keypair) {
    return c.json({ error: "No near account found" }, 500);
  }

  const result = await sendNearTransaction(
    wallet[0].near_accountId,
    wallet[0].near_keypair as KeyPairString
  );

  console.log("result", result);

  return c.json({ result });
});

export default app;
