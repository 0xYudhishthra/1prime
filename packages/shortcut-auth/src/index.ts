import { Hono } from "hono";
import { createAuth } from "../auth";
import { createAccount, sendTransaction } from "./zerodev";
import { smartWallet } from "./db/schema";
import { createDb } from "./db";
import { eq } from "drizzle-orm";

const app = new Hono<{
	Bindings: CloudflareBindings;
}>();

app.on(["GET", "POST"], "/api/**", (c) => {
	const auth = createAuth(c.env);
	return auth.handler(c.req.raw);
});

app.post("/sign-up/email", async (c) => {
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
	const {
		signerPrivateKey,
		smartAccountAddress,
		chainId,
		kernelVersion,
	} = await createAccount(c.env.ZERODEV_RPC);

	await db.insert(smartWallet).values({
		userId: data.user.id,
		signerPrivateKey,
		smartAccountAddress,
		chainId,
		kernelVersion,
	});

	console.log(data);
	return c.json(data.token);
});

app.post("/api/send-transaction", async (c) => {
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
		wallet[0].signerPrivateKey
	);

	console.log("signerPrivateKey", wallet[0].signerPrivateKey);
	console.log("smartAccountAddress", wallet[0].smartAccountAddress);
	console.log("chainId", wallet[0].chainId);
	console.log("kernelVersion", wallet[0].kernelVersion);
	console.log("txnHash", txnHash);
	return c.json({ txnHash });
});

app.get("/api/random-number", async (c) => {
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

export default app;
