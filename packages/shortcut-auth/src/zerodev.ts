import {
	createKernelAccount,
	createZeroDevPaymasterClient,
	createKernelAccountClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
	http,
	Hex,
	createPublicClient,
	zeroAddress,
	parseEther,
} from "viem";
import {
	generatePrivateKey,
	privateKeyToAccount,
} from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { EntryPointVersion } from "viem/account-abstraction";
import { GetKernelVersion, Signer } from "@zerodev/sdk/types";

export const createAccount = async (zerodevRpc: string) => {
	const chain = arbitrumSepolia;
	const publicClient = createPublicClient({
		// Use your own RPC for public client in production
		transport: http(zerodevRpc),
		chain,
	});

	const signerPrivateKey = generatePrivateKey();
	const signer = privateKeyToAccount(signerPrivateKey);
	const entryPoint = getEntryPoint("0.7");
	const kernelVersion = KERNEL_V3_1;
	const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
		signer,
		entryPoint,
		kernelVersion,
	});

	const account = await createKernelAccount(publicClient, {
		plugins: {
			sudo: ecdsaValidator,
		},
		entryPoint,
		kernelVersion,
	});
	console.log("My account:", account.address);

	const paymasterClient = createZeroDevPaymasterClient({
		chain,
		transport: http(zerodevRpc),
	});

	const kernelClient = createKernelAccountClient({
		account,
		chain,
		bundlerTransport: http(zerodevRpc),
		client: publicClient,
		paymaster: {
			getPaymasterData: (userOperation) => {
				return paymasterClient.sponsorUserOperation({
					userOperation,
				});
			},
		},
	});

	const userOpHash = await kernelClient.sendUserOperation({
		callData: await account.encodeCalls([
			{
				to: zeroAddress,
				value: BigInt(0),
				data: "0x",
			},
		]),
	});

	console.log("userOp hash:", userOpHash);

	const _receipt = await kernelClient.waitForUserOperationReceipt({
		hash: userOpHash,
	});
	console.log("bundle txn hash: ", _receipt.receipt.transactionHash);

	console.log("userOp completed");

	return {
		signerPrivateKey,
		smartAccountAddress: account.address,
		chainId: chain.id,
		kernelVersion,
	};
};

export const sendTransaction = async (
	zerodevRpc: string,
	signerPrivateKey: string
) => {
	const signer = privateKeyToAccount(
		signerPrivateKey as `0x${string}`
	);
	const kernelClient = await getKernelClient(
		zerodevRpc,
		signer,
		"0.7",
		KERNEL_V3_1
	);

	console.log("Account address:", kernelClient.account.address);

	const txnHash = await kernelClient.sendTransaction({
		to: "0x67E7B18CB3e6f6f80492A4345EFC510233836D86",
		value: parseEther("0.001"),
		data: "0x",
	});

	console.log("Txn hash:", txnHash);
	return txnHash;
};

export const getKernelClient = async <
	entryPointVersion extends EntryPointVersion
>(
	zerodevRpc: string,
	signer: Signer,
	entryPointVersion_: entryPointVersion,
	kernelVersion: GetKernelVersion<entryPointVersion>
) => {
	const chain = arbitrumSepolia;
	const publicClient = createPublicClient({
		transport: http(zerodevRpc),
		chain,
	});

	const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
		signer,
		entryPoint: getEntryPoint(entryPointVersion_),
		kernelVersion,
	});

	const account = await createKernelAccount(publicClient, {
		plugins: {
			sudo: ecdsaValidator,
		},
		entryPoint: getEntryPoint(entryPointVersion_),
		kernelVersion,
	});
	console.log("My account:", account.address);
	const paymasterClient = createZeroDevPaymasterClient({
		chain,
		transport: http(zerodevRpc),
	});
	return createKernelAccountClient({
		account,
		chain,
		bundlerTransport: http(zerodevRpc),
		paymaster: {
			getPaymasterData: (userOperation) => {
				return paymasterClient.sponsorUserOperation({
					userOperation,
				});
			},
		},
		client: publicClient,
	});
};
