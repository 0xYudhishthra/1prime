import {
  createFundedTestnetAccount,
  generateRandomKeyPair,
} from "@near-js/client";
import { JsonRpcProvider, Provider } from "@near-js/providers";
import { Account } from "@near-js/accounts";
import { KeyPairString } from "@near-js/crypto";
import { KeyPairSigner } from "@near-js/signers";
import { NEAR } from "@near-js/tokens";

export async function createFundedTestnetAccountNear(accountId: string) {
  if (!accountId) {
    console.log("accountId is required");
    return;
  }

  // create new keypair and persist it to filesystem keystore
  const keyPair = generateRandomKeyPair("ed25519");

  console.log("keyPair", keyPair.getPublicKey().toString());

  // call funded testnet creation endpoint
  const account = await createFundedTestnetAccount({
    newAccount: accountId,
    newPublicKey: keyPair.getPublicKey().toString(),
    endpointUrl: "https://helper.testnet.near.org/account",
  });

  console.log("Created funded testnet account");
  console.log(
    `New Account | ${accountId} | ${keyPair.getPublicKey().toString()}`
  );

  return {
    accountId,
    keyPair,
    transaction: account.final_execution_status,
  };
}

export async function sendNearTransaction(
  accountId: string,
  keyPair: KeyPairString
) {
  const provider = new JsonRpcProvider({
    url: "https://test.rpc.fastnear.com",
  }) as Provider;
  const signer = KeyPairSigner.fromSecretKey(keyPair);
  const account = new Account(accountId, provider, signer);

  // transfer 0.1 NEAR tokens to receiver.testnet
  const result = await account.transfer({
    token: NEAR,
    amount: NEAR.toUnits("0.1"),
    receiverId: accountId,
  });

  return result;
}
