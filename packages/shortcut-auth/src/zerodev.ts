import {
	createKernelAccount,
	createZeroDevPaymasterClient,
	createKernelAccountClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toMultiChainECDSAValidator } from "@zerodev/multi-chain-ecdsa-validator";

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
import { arbitrumSepolia, sepolia, optimismSepolia } from "viem/chains";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { EntryPointVersion } from "viem/account-abstraction";
import { GetKernelVersion, Signer } from "@zerodev/sdk/types";

export const createAccount = async (
	sepoliaRpc: string,
	arbitrumSepoliaRpc: string,
	optimismSepoliaRpc: string
) => {
	// Define all chains and their configurations
	const chains = [
		{ chain: sepolia, rpc: sepoliaRpc, name: "Sepolia" },
		{ chain: arbitrumSepolia, rpc: arbitrumSepoliaRpc, name: "Arbitrum Sepolia" },
		{ chain: optimismSepolia, rpc: optimismSepoliaRpc, name: "Optimism Sepolia" }
	];

	// Generate a single private key for all chains
	const signerPrivateKey = generatePrivateKey();
	const signer = privateKeyToAccount(signerPrivateKey);
	const entryPoint = getEntryPoint("0.7");
	const kernelVersion = KERNEL_V3_1;

	// Create public clients for all chains
	const publicClients = chains.map(({ chain, rpc }) => 
		createPublicClient({
			transport: http(rpc),
			chain,
		})
	);

	// Create multi-chain ECDSA validators for all chains
	const validators = await Promise.all(
		publicClients.map(async (publicClient, index) => 
			toMultiChainECDSAValidator(publicClient, {
				entryPoint,
				signer,
				kernelVersion,
				multiChainIds: chains.map(c => c.chain.id), // All chain IDs
			})
		)
	);

	// Create kernel accounts for all chains
	const accounts = await Promise.all(
		publicClients.map(async (publicClient, index) =>
			createKernelAccount(publicClient, {
				plugins: {
					sudo: validators[index],
				},
				entryPoint,
				kernelVersion,
			})
		)
	);

	// Verify all accounts have the same address
	const smartAccountAddress = accounts[0].address;
	const allSameAddress = accounts.every(account => account.address === smartAccountAddress);
	if (!allSameAddress) {
		throw new Error("Multi-chain accounts do not have the same address");
	}

	console.log("Multi-chain smart account address:", smartAccountAddress);

	// Create paymaster clients for all chains
	const paymasterClients = chains.map(({ chain, rpc }) =>
		createZeroDevPaymasterClient({
			chain,
			transport: http(rpc),
		})
	);

	// Create kernel clients for all chains
	const kernelClients = accounts.map((account, index) =>
		createKernelAccountClient({
			account,
			chain: chains[index].chain,
			bundlerTransport: http(chains[index].rpc),
			client: publicClients[index],
			paymaster: {
				getPaymasterData: (userOperation) => {
					return paymasterClients[index].sponsorUserOperation({
						userOperation,
					});
				},
			},
		})
	);

	// Deploy smart wallets on all chains by sending dummy transactions
	console.log("Deploying smart wallets on all chains...");
	const deploymentResults = await Promise.all(
		kernelClients.map(async (kernelClient, index) => {
			const chainName = chains[index].name;
			console.log(`Deploying on ${chainName}...`);

			const userOpHash = await kernelClient.sendUserOperation({
				callData: await kernelClient.account.encodeCalls([
					{
						to: zeroAddress,
						value: BigInt(0),
						data: "0x",
					},
				]),
			});

			console.log(`${chainName} userOp hash:`, userOpHash);

			const receipt = await kernelClient.waitForUserOperationReceipt({
				hash: userOpHash,
			});

			console.log(`${chainName} deployment txn hash:`, receipt.receipt.transactionHash);
			console.log(`${chainName} deployment completed`);

			return {
				chainId: chains[index].chain.id,
				chainName,
				userOpHash,
				transactionHash: receipt.receipt.transactionHash,
			};
		})
	);

	console.log("All smart wallets deployed successfully across all chains");

	return {
		signerPrivateKey,
		smartAccountAddress,
		chainId: arbitrumSepolia.id, // Primary chain for backward compatibility
		kernelVersion,
		deployments: deploymentResults,
		supportedChains: chains.map(c => ({ chainId: c.chain.id, name: c.name })),
	};
};

export const sendTransaction = async (
	zerodevRpc: string,
	signerPrivateKey: string,
	chain = arbitrumSepolia // Default to arbitrum sepolia for backward compatibility
) => {
	const signer = privateKeyToAccount(
		signerPrivateKey as `0x${string}`
	);
	const kernelClient = await getKernelClient(
		zerodevRpc,
		signer,
		"0.7",
		KERNEL_V3_1,
		chain
	);

	console.log("Account address:", kernelClient.account.address);
	console.log("Chain:", chain.name);

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
	kernelVersion: GetKernelVersion<entryPointVersion>,
	chain = arbitrumSepolia // Default to arbitrum sepolia for backward compatibility
) => {
	const publicClient = createPublicClient({
		transport: http(zerodevRpc),
		chain,
	});

	// Use multi-chain validator for consistency with createAccount
	const multiChainValidator = await toMultiChainECDSAValidator(publicClient, {
		signer,
		entryPoint: getEntryPoint(entryPointVersion_),
		kernelVersion,
		multiChainIds: [sepolia.id, arbitrumSepolia.id, optimismSepolia.id],
	});

	const account = await createKernelAccount(publicClient, {
		plugins: {
			sudo: multiChainValidator,
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
