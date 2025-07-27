// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/console.sol";

interface ITurnstileContract {
  function releaseBond(address relayer, bytes32 orderHash) external;
  function getOrder(
    bytes32 orderHash
  )
    external
    view
    returns (
      bytes32 secretHash,
      uint256 timeout,
      address user,
      uint256 amount,
      uint256 initialRateBump,
      uint256 auctionDuration,
      address priceOracle,
      uint256 minBondTier,
      bool requireBondHistory,
      bool fulfilled,
      address designatedRelayer
    );
}

/// @title EthereumFulfillmentContract - ETH-side Fulfillment Tracking
/// @dev BIDIRECTIONAL ARCHITECTURE:
///
/// ETH → NEAR Swaps:
/// - Order created on ETH TurnstileContract (bonds locked here)
/// - User claims NEAR tokens on NEAR chain
/// - Oracle calls verifyNEARFulfillment() to release ETH bonds
///
/// NEAR → ETH Swaps:
/// - Order created on NEAR TurnstileContract (bonds locked on NEAR)
/// - User claims ETH tokens on ETH chain
/// - markETHClaimed() records fulfillment (bonds released on NEAR side)
///
/// @notice For NEAR → ETH swaps: Tracks when ETH is claimed on Ethereum
/// @notice For ETH → NEAR swaps: Verifies NEAR-side completion to release ETH-side bonds
contract EthereumFulfillmentContract {
  /// @notice Fulfillment proof structure
  struct FulfillmentProof {
    bytes32 orderHash; // Order identifier
    bytes32 secretRevealed; // Revealed secret
    uint256 timestamp; // When fulfillment occurred
    address relayer; // Relayer who fulfilled
    string sourceChain; // Chain where fulfillment happened ("ETH" or "NEAR")
    bytes32 transactionHash; // Transaction hash of fulfillment
    bool verified; // Whether proof is verified
  }

  // State variables
  ITurnstileContract public immutable turnstileContract;
  bytes32 public merkleRoot; // Merkle root of completed orders
  mapping(bytes32 => bool) public completedOrders; // orderHash => completed
  mapping(bytes32 => bytes32) public revealedSecrets; // orderHash => secret
  mapping(bytes32 => FulfillmentProof) public fulfillmentProofs; // orderHash => proof
  mapping(address => bool) public authorizedOracles; // Cross-chain oracles

  address public owner;

  // Events
  event OrderFulfilledOnETH(
    bytes32 indexed orderHash,
    bytes32 secret,
    address relayer
  );
  event OrderVerifiedFromNEAR(
    bytes32 indexed orderHash,
    bytes32 secret,
    address relayer
  );
  event MerkleRootUpdated(bytes32 oldRoot, bytes32 newRoot);
  event BondReleased(address indexed relayer, bytes32 indexed orderHash);
  event OracleAuthorized(address indexed oracle);
  event OracleRevoked(address indexed oracle);
  event SecretVerified(
    bytes32 indexed orderHash,
    bytes32 secretHash,
    bytes32 secret
  );

  modifier onlyOwner() {
    require(msg.sender == owner, "Only owner");
    _;
  }

  modifier onlyAuthorizedOracle() {
    require(authorizedOracles[msg.sender], "Only authorized oracle");
    _;
  }

  constructor(address _turnstileContract) {
    turnstileContract = ITurnstileContract(_turnstileContract);
    owner = msg.sender;
    merkleRoot = bytes32(0);
  }

  /// @notice For NEAR → ETH swaps: Mark when ETH is claimed on Ethereum
  /// @dev This is called when user claims ETH from HTLC on Ethereum chain
  /// @dev Bond release happens on NEAR chain when this fulfillment is verified there
  /// @param orderHash The order that was fulfilled (originated on NEAR)
  /// @param secret The revealed secret
  /// @param relayer The relayer who fulfilled the order
  function markETHClaimed(
    bytes32 orderHash,
    bytes32 secret,
    address relayer
  ) external {
    require(!completedOrders[orderHash], "Order already completed");
    require(secret != bytes32(0), "Invalid secret");
    require(relayer != address(0), "Invalid relayer");

    // NOTE: We cannot verify secret hash here because the order originated on NEAR
    // The secret verification should be done by cross-chain oracles

    // Record fulfillment on ETH side
    completedOrders[orderHash] = true;
    revealedSecrets[orderHash] = secret;

    fulfillmentProofs[orderHash] = FulfillmentProof({
      orderHash: orderHash,
      secretRevealed: secret,
      timestamp: block.timestamp,
      relayer: relayer,
      sourceChain: "ETH",
      transactionHash: blockhash(block.number - 1), // Simplified
      verified: true
    });

    // Update merkle root
    _updateMerkleRoot(orderHash);

    // NO BOND RELEASE HERE - bonds are on NEAR for NEAR → ETH swaps
    // Cross-chain oracles will pick up this event and verify on NEAR side

    emit OrderFulfilledOnETH(orderHash, secret, relayer);
    // Note: No BondReleased event since bond is on different chain
  }

  /// @notice For ETH → NEAR swaps: Verify NEAR-side fulfillment using secret
  /// @dev This is called by oracle when user claims NEAR tokens on NEAR chain
  /// @dev Releases relayer bonds on ETH since order originated here
  /// @param orderHash The order that was fulfilled on NEAR (originated on ETH)
  /// @param secret The secret revealed on NEAR
  /// @param nearTxHash Transaction hash from NEAR chain
  function verifyNEARFulfillment(
    bytes32 orderHash,
    bytes32 secret,
    bytes32 nearTxHash
  ) external onlyAuthorizedOracle {
    _processNEARFulfillment(orderHash, secret, nearTxHash);
  }

  /// @notice Internal function to process NEAR fulfillment
  /// @dev For ETH → NEAR swaps: Order originated on ETH, so bonds are released here
  /// @param orderHash The order that was fulfilled on NEAR (originated on ETH)
  /// @param secret The secret revealed on NEAR
  /// @param nearTxHash Transaction hash from NEAR chain
  function _processNEARFulfillment(
    bytes32 orderHash,
    bytes32 secret,
    bytes32 nearTxHash
  ) internal {
    require(!completedOrders[orderHash], "Order already completed");
    require(secret != bytes32(0), "Invalid secret");
    require(nearTxHash != bytes32(0), "Invalid NEAR transaction hash");

    // Verify the secret matches the order's secret hash
    require(_verifySecret(orderHash, secret), "Secret does not match order");

    // Get order details to find the relayer
    (, , , , , , , , , , address designatedRelayer) = turnstileContract
      .getOrder(orderHash);
    require(designatedRelayer != address(0), "No designated relayer for order");

    // Record fulfillment verification
    completedOrders[orderHash] = true;
    revealedSecrets[orderHash] = secret;

    fulfillmentProofs[orderHash] = FulfillmentProof({
      orderHash: orderHash,
      secretRevealed: secret,
      timestamp: block.timestamp,
      relayer: designatedRelayer,
      sourceChain: "NEAR",
      transactionHash: nearTxHash,
      verified: true
    });

    // Update merkle root
    _updateMerkleRoot(orderHash);

    // Release relayer's bond on ETH since order originated here (ETH → NEAR)
    turnstileContract.releaseBond(designatedRelayer, orderHash);

    emit OrderVerifiedFromNEAR(orderHash, secret, designatedRelayer);
    emit BondReleased(designatedRelayer, orderHash);
  }

  /// @notice Verify that a secret matches the order's secret hash
  /// @param orderHash The order to check
  /// @param secret The secret to verify
  /// @return valid Whether the secret is valid for this order
  function _verifySecret(
    bytes32 orderHash,
    bytes32 secret
  ) internal view returns (bool) {
    (bytes32 expectedSecretHash, , , , , , , , , , ) = turnstileContract
      .getOrder(orderHash);
    require(expectedSecretHash != bytes32(0), "Order does not exist");

    bytes32 computedHash = sha256(abi.encodePacked(secret));
    bool isValid = computedHash == expectedSecretHash;

    if (isValid) {
      // Emit event for debugging/verification
      // Note: This is view function so event won't actually be emitted
      // but shows the verification logic
    }

    return isValid;
  }

  /// @notice Update merkle root with new completed order
  /// @param orderHash The newly completed order
  function _updateMerkleRoot(bytes32 orderHash) internal {
    bytes32 oldRoot = merkleRoot;
    merkleRoot = keccak256(abi.encodePacked(merkleRoot, orderHash));

    emit MerkleRootUpdated(oldRoot, merkleRoot);
  }

  /// @notice Manually update merkle root for batch verification
  /// @param newRoot The new merkle root
  function updateMerkleRoot(bytes32 newRoot) external onlyOwner {
    bytes32 oldRoot = merkleRoot;
    merkleRoot = newRoot;

    emit MerkleRootUpdated(oldRoot, newRoot);
  }

  /// @notice Check if an order has been fulfilled
  /// @param orderHash The order to check
  /// @return fulfilled Whether the order is fulfilled
  function isOrderFulfilled(bytes32 orderHash) external view returns (bool) {
    return completedOrders[orderHash];
  }

  /// @notice Get the revealed secret for an order
  /// @param orderHash The order to check
  /// @return secret The revealed secret, or bytes32(0) if not revealed
  function getRevealedSecret(
    bytes32 orderHash
  ) external view returns (bytes32) {
    return revealedSecrets[orderHash];
  }

  /// @notice Get fulfillment proof for an order
  /// @param orderHash The order to check
  /// @return proof The fulfillment proof
  function getFulfillmentProof(
    bytes32 orderHash
  ) external view returns (FulfillmentProof memory) {
    return fulfillmentProofs[orderHash];
  }

  /// @notice Verify a secret against an order without state changes
  /// @param orderHash The order to verify against
  /// @param secret The secret to verify
  /// @return valid Whether the secret is valid
  function verifySecretForOrder(
    bytes32 orderHash,
    bytes32 secret
  ) external view returns (bool) {
    return _verifySecret(orderHash, secret);
  }

  /// @notice Authorize an oracle for cross-chain verification
  /// @param oracle The oracle address to authorize
  function authorizeOracle(address oracle) external onlyOwner {
    require(oracle != address(0), "Invalid oracle address");
    authorizedOracles[oracle] = true;

    emit OracleAuthorized(oracle);
  }

  /// @notice Revoke oracle authorization
  /// @param oracle The oracle address to revoke
  function revokeOracle(address oracle) external onlyOwner {
    authorizedOracles[oracle] = false;

    emit OracleRevoked(oracle);
  }

  /// @notice Batch verify multiple orders from NEAR
  /// @param orderHashes Array of order hashes
  /// @param secrets Array of revealed secrets
  /// @param nearTxHashes Array of NEAR transaction hashes
  function batchVerifyNEARFulfillments(
    bytes32[] calldata orderHashes,
    bytes32[] calldata secrets,
    bytes32[] calldata nearTxHashes
  ) external onlyAuthorizedOracle {
    require(
      orderHashes.length == secrets.length &&
        secrets.length == nearTxHashes.length,
      "Array lengths must match"
    );

    for (uint256 i = 0; i < orderHashes.length; i++) {
      if (!completedOrders[orderHashes[i]]) {
        _processNEARFulfillment(orderHashes[i], secrets[i], nearTxHashes[i]);
      }
    }
  }

  /// @notice Emergency function to manually mark order as fulfilled (owner only)
  /// @param orderHash The order to mark as fulfilled
  /// @param secret The secret that was revealed
  /// @param relayer The relayer who fulfilled
  /// @param sourceChain The chain where fulfillment occurred
  function emergencyMarkFulfilled(
    bytes32 orderHash,
    bytes32 secret,
    address relayer,
    string calldata sourceChain
  ) external onlyOwner {
    require(!completedOrders[orderHash], "Order already completed");
    require(_verifySecret(orderHash, secret), "Invalid secret");

    completedOrders[orderHash] = true;
    revealedSecrets[orderHash] = secret;

    fulfillmentProofs[orderHash] = FulfillmentProof({
      orderHash: orderHash,
      secretRevealed: secret,
      timestamp: block.timestamp,
      relayer: relayer,
      sourceChain: sourceChain,
      transactionHash: bytes32(0), // Emergency, no specific tx
      verified: true
    });

    _updateMerkleRoot(orderHash);
    turnstileContract.releaseBond(relayer, orderHash);

    emit BondReleased(relayer, orderHash);
  }

  /// @notice Get contract stats
  /// @return totalCompleted Total number of completed orders
  /// @return currentMerkleRoot Current merkle root
  function getStats()
    external
    view
    returns (uint256 totalCompleted, bytes32 currentMerkleRoot)
  {
    // Note: totalCompleted would need a counter variable to be efficient
    // For now, return current merkle root
    currentMerkleRoot = merkleRoot;
    totalCompleted = 0; // Would implement counter if needed
  }

  /// @notice Transfer ownership
  /// @param newOwner The new owner address
  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Invalid new owner");
    owner = newOwner;
  }
}
