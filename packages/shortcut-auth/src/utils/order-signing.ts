// Order signing utilities for cross-chain swaps

import { ethers, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { KeyPair, KeyPairString } from '@near-js/crypto';


/**
 * Sign an order hash using EVM private key
 */
export async function signOrderHashEVM(
  orderHash: string,
  privateKey: string
): Promise<string> {
  try {
    const wallet = new Wallet(privateKey);
    
    // Sign the order hash directly (simple message signing)
    const signature = await wallet.signMessage(orderHash);
    
    console.log('EVM Order hash signed successfully:', {
      orderHash,
      signerAddress: wallet.address,
      signatureLength: signature.length,
    });
    
    return signature;
  } catch (error) {
    console.error('EVM Order hash signing failed:', error);
    throw new Error(`Failed to sign EVM order hash: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Sign an order hash using NEAR keypair
 */
export async function signOrderHashNEAR(
  orderHash: string,
  nearKeypair: KeyPairString,
  accountId: string
): Promise<string> {
  try {
    const keyPair = KeyPair.fromString(nearKeypair);
    
    // Convert order hash to bytes for NEAR signing (Web API compatible)
    const hexString = orderHash.startsWith('0x') ? orderHash.slice(2) : orderHash;
    const messageBytes = ethers.getBytes('0x' + hexString);
    
    // Sign with NEAR keypair
    const signature = keyPair.sign(messageBytes);
    
    // Convert signature to hex string for compatibility with relayer (Web API compatible)
    const signatureHex = ethers.hexlify(signature.signature);
    
    console.log('NEAR Order hash signed successfully:', {
      orderHash,
      signerAccountId: accountId,
      signatureLength: signatureHex.length,
    });
    
    return signatureHex;
  } catch (error) {
    console.error('NEAR Order hash signing failed:', error);
    throw new Error(`Failed to sign NEAR order hash: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Chain-aware order signing - signs the orderHash from relayer /orders/prepare response
 */
export async function signFusionOrder(
  orderHash: string,  // Simple hash from relayer response, not complex order data
  sourceChain: string,
  evmPrivateKey?: string,
  nearKeypair?: KeyPairString,
  nearAccountId?: string
): Promise<string> {
  const chainIsNear = isNearChain(sourceChain);
  
  console.log('Signing order hash for chain:', { orderHash, sourceChain, isNearChain: chainIsNear });
  
  if (chainIsNear) {
    if (!nearKeypair || !nearAccountId) {
      throw new Error('NEAR keypair and account ID required for NEAR chain orders');
    }
    return await signOrderHashNEAR(orderHash, nearKeypair, nearAccountId);
  } else {
    if (!evmPrivateKey) {
      throw new Error('EVM private key required for EVM chain orders');
    }
    return await signOrderHashEVM(orderHash, evmPrivateKey);
  }
}

/**
 * Sign a secret reveal message using EVM private key
 */
export async function signSecretRevealEVM(
  orderHash: string,
  secret: string,
  privateKey: string
): Promise<string> {
  try {
    const wallet = new Wallet(privateKey);
    
    // Create simple message to sign for secret reveal
    const message = `Revealing secret for order ${orderHash}: ${secret}`;
    const signature = await wallet.signMessage(message);
    
    console.log('EVM Secret reveal signed successfully:', {
      orderHash,
      signerAddress: wallet.address,
    });
    
    return signature;
  } catch (error) {
    console.error('EVM Secret reveal signing failed:', error);
    throw new Error(`Failed to sign EVM secret reveal: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Sign a secret reveal message using NEAR keypair
 */
export async function signSecretRevealNEAR(
  orderHash: string,
  secret: string,
  nearKeypair: KeyPairString,
  accountId: string
): Promise<string> {
  try {
    const keyPair = KeyPair.fromString(nearKeypair);
    
    // Create simple message to sign for secret reveal (Web API compatible)
    const message = `Revealing secret for order ${orderHash}: ${secret}`;
    const messageBytes = new TextEncoder().encode(message);
    
    // Sign with NEAR keypair
    const signature = keyPair.sign(messageBytes);
    
    // Convert signature to hex string for compatibility with relayer (Web API compatible)
    const signatureHex = ethers.hexlify(signature.signature);
    
    console.log('NEAR Secret reveal signed successfully:', {
      orderHash,
      signerAccountId: accountId,
    });
    
    return signatureHex;
  } catch (error) {
    console.error('NEAR Secret reveal signing failed:', error);
    throw new Error(`Failed to sign NEAR secret reveal: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Chain-aware secret reveal signing
 */
export async function signSecretReveal(
  orderHash: string,
  secret: string,
  sourceChain: string,
  evmPrivateKey?: string,
  nearKeypair?: KeyPairString,
  nearAccountId?: string
): Promise<string> {
  const chainIsNear = isNearChain(sourceChain);
  
  console.log('Signing secret reveal for chain:', { orderHash, sourceChain, isNearChain: chainIsNear });
  
  if (chainIsNear) {
    if (!nearKeypair || !nearAccountId) {
      throw new Error('NEAR keypair and account ID required for NEAR chain secret reveal');
    }
    return await signSecretRevealNEAR(orderHash, secret, nearKeypair, nearAccountId);
  } else {
    if (!evmPrivateKey) {
      throw new Error('EVM private key required for EVM chain secret reveal');
    }
    return await signSecretRevealEVM(orderHash, secret, evmPrivateKey);
  }
}

/**
 * Generate random number and its keccak256 hash
 */
export function generateSecretAndHash(): { secret: string; secretHash: string } {
  // Generate a random 32-byte value using Web Crypto API (Cloudflare Workers compatible)
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = ethers.hexlify(randomBytes);
  
  // Hash the secret using keccak256
  const secretHash = keccak256(secret);
  
  console.log('Generated secret and hash:', {
    secretLength: secret.length,
    secretHashLength: secretHash.length,
  });
  
  return {
    secret,
    secretHash,
  };
}

/**
 * Hash random number string (for compatibility with existing endpoint)
 */
export function hashRandomNumber(number: string): string {
  return keccak256(toUtf8Bytes(number.toString()));
}

// Removed hashOrderData - no longer needed with simplified approach

/**
 * Verify a signature matches the expected signer
 */
export function verifySignature(
  message: string,
  signature: string,
  expectedAddress: string
): boolean {
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * Get the address from a private key
 */
export function getAddressFromPrivateKey(privateKey: string): string {
  try {
    const wallet = new Wallet(privateKey);
    return wallet.address;
  } catch (error) {
    console.error('Failed to derive address from private key:', error);
    throw new Error('Invalid private key');
  }
}

/**
 * Sign generic message with private key
 */
export async function signMessage(
  message: string,
  privateKey: string
): Promise<string> {
  try {
    const wallet = new Wallet(privateKey);
    return await wallet.signMessage(message);
  } catch (error) {
    console.error('Message signing failed:', error);
    throw new Error(`Failed to sign message: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the correct user address based on the source chain
 */
export function getUserAddressForChain(
  sourceChain: string,
  evmAddress: string,
  nearAccountId: string
): string {
  const chainIsNear = isNearChain(sourceChain);
  return chainIsNear ? nearAccountId : evmAddress;
}

/**
 * Check if a chain is a NEAR chain
 */
export function isNearChain(chain: string): boolean {
  return chain === '398' || chain === 'mainnet';
}

/**
 * Create a merkle proof for partial fills (placeholder implementation)
 * This would need to be implemented based on the specific Fusion+ SDK requirements
 */
export function createMerkleProof(secret: string, orderHash: string): string {
  // For now, return a placeholder proof
  // In a real implementation, this would create a proper merkle proof
  const proofData = {
    secret,
    orderHash,
    timestamp: Date.now(),
  };
  
  return keccak256(toUtf8Bytes(JSON.stringify(proofData)));
}