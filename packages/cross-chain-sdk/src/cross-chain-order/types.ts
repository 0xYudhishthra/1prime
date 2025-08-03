import {Address, AuctionDetails, IntegratorFee} from '@1inch/fusion-sdk'
import {HashLock} from './hash-lock'
import {TimeLocks} from './time-locks'
import {SupportedChain} from '../chains'

/**
 * EVM address type (from 1inch fusion-sdk)
 */
export type EvmAddress = Address

/**
 * NEAR address type - can be account names, implicit accounts, or sub-accounts
 * Examples: "user.near", "account.testnet", "sub.account.near", "0123456789abcdef..."
 */
export type NearAddress = string

/**
 * Cross-chain address that supports both EVM and NEAR address formats
 */
export type CrossChainAddress = EvmAddress | NearAddress

/**
 * Utility type guard to check if an address is a NEAR address
 */
export function isNearAddress(
    address: CrossChainAddress
): address is NearAddress {
    if (typeof address === 'string') {
        // NEAR account names typically end with .near, .testnet, or are 64-char hex strings
        return (
            address.includes('.') ||
            (address.length === 64 && /^[0-9a-fA-F]+$/.test(address))
        )
    }
    return false
}

/**
 * Utility type guard to check if an address is an EVM address
 */
export function isEvmAddress(address: Address): address is EvmAddress {
    return !isNearAddress(address)
}

export type CrossChainOrderInfo = {
    /**
     * Source chain asset - supports both EVM and NEAR address formats
     */
    makerAsset: Address
    /**
     * Destination chain asset - supports both EVM and NEAR address formats
     */
    takerAsset: Address
    /**
     * Source chain amount
     */
    makingAmount: bigint
    /**
     * Destination chain min amount
     */
    takingAmount: bigint
    /**
     * Maker address - supports both EVM and NEAR address formats
     */
    maker: Address
    salt?: bigint
    /**
     * Destination chain receiver address - supports both EVM and NEAR address formats
     *
     * If not set, then `maker` used
     */
    receiver?: Address
}

export type Extra = {
    /**
     * Max size is 40bit
     */
    nonce?: bigint
    permit?: string
    /**
     * Order will expire in `orderExpirationDelay` after auction ends
     * Default 12s
     */
    orderExpirationDelay?: bigint
    enablePermit2?: boolean
    source?: string
    allowMultipleFills?: boolean
    allowPartialFills?: boolean
}

export type Details = {
    auction: AuctionDetails
    fees?: {
        integratorFee?: IntegratorFee
        bankFee?: bigint
    }
    whitelist: AuctionWhitelistItem[]
    /**
     * Time from which order can be executed
     */
    resolvingStartTime?: bigint
}

export type EscrowParams = {
    hashLock: HashLock
    srcChainId: SupportedChain
    dstChainId: SupportedChain
    srcSafetyDeposit: bigint
    dstSafetyDeposit: bigint
    timeLocks: TimeLocks
}

export type AuctionWhitelistItem = {
    address: Address
    allowFrom: bigint
}
