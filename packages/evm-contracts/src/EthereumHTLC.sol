// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/console.sol";

/// @title EthereumHTLC - HTLC for NEAR → ETH Swaps
/// @notice Handles ETH locking when users want NEAR tokens (NEAR → ETH direction)
/// @dev For NEAR → ETH swaps: User locks ETH here, waits for relayer to create NEAR HTLC
contract EthereumHTLC {
  /// @notice HTLC details structure
  struct HTLCDetails {
    bytes32 secretHash; // User's secret hash
    uint256 amount; // ETH amount locked
    uint256 timeout; // Expiration timestamp
    address user; // User who created HTLC
    address designatedRelayer; // Only this relayer can claim
    bool claimed; // Whether funds were claimed
    bool refunded; // Whether funds were refunded
    uint256 createdAt; // Creation timestamp
    string nearOrderHash; // Corresponding NEAR order hash
  }

  // State variables
  mapping(bytes32 => HTLCDetails) public htlcs;
  mapping(address => uint256) public userHTLCCount; // Track user HTLCs for DoS protection

  // Security controls
  address public owner;
  bool public paused;
  uint256 public minTimeout = 1 hours; // Minimum HTLC duration
  uint256 public maxTimeout = 7 days; // Maximum HTLC duration
  uint256 public maxUserHTLCs = 10; // Max HTLCs per user to prevent DoS

  // Events
  event HTLCCreated(
    bytes32 indexed htlcId,
    address indexed user,
    address indexed designatedRelayer,
    uint256 amount,
    bytes32 secretHash,
    uint256 timeout,
    string nearOrderHash
  );
  event HTLCClaimed(
    bytes32 indexed htlcId,
    address indexed relayer,
    bytes32 secret,
    uint256 amount
  );
  event HTLCRefunded(
    bytes32 indexed htlcId,
    address indexed user,
    uint256 amount
  );
  event EmergencyPause(bool paused);

  // Modifiers
  modifier onlyOwner() {
    require(msg.sender == owner, "Only owner");
    _;
  }

  modifier notPaused() {
    require(!paused, "Contract is paused");
    _;
  }

  modifier validTimeout(uint256 timeout) {
    require(timeout >= block.timestamp + minTimeout, "Timeout too short");
    require(timeout <= block.timestamp + maxTimeout, "Timeout too long");
    _;
  }

  modifier htlcExists(bytes32 htlcId) {
    require(htlcs[htlcId].user != address(0), "HTLC does not exist");
    _;
  }

  modifier notClaimed(bytes32 htlcId) {
    require(!htlcs[htlcId].claimed, "HTLC already claimed");
    _;
  }

  modifier notRefunded(bytes32 htlcId) {
    require(!htlcs[htlcId].refunded, "HTLC already refunded");
    _;
  }

  constructor() {
    owner = msg.sender;
  }

  /// @notice Create HTLC for NEAR → ETH swap
  /// @dev User locks ETH and waits for relayer to create corresponding NEAR HTLC
  /// @param secretHash User's secret hash (same used on NEAR side)
  /// @param timeout HTLC expiration timestamp
  /// @param designatedRelayer The relayer who should fulfill this order
  /// @param nearOrderHash Corresponding order hash on NEAR chain for tracking
  /// @return htlcId The unique HTLC identifier
  function createHTLC(
    bytes32 secretHash,
    uint256 timeout,
    address designatedRelayer,
    string calldata nearOrderHash
  ) external payable notPaused validTimeout(timeout) returns (bytes32 htlcId) {
    require(msg.value > 0, "Amount must be greater than 0");
    require(secretHash != bytes32(0), "Invalid secret hash");
    require(designatedRelayer != address(0), "Invalid relayer address");
    require(bytes(nearOrderHash).length > 0, "Invalid NEAR order hash");
    require(userHTLCCount[msg.sender] < maxUserHTLCs, "Too many active HTLCs");

    // Generate unique HTLC ID
    htlcId = keccak256(
      abi.encodePacked(
        msg.sender,
        secretHash,
        timeout,
        msg.value,
        block.timestamp,
        block.number
      )
    );

    // Ensure HTLC ID is unique
    require(htlcs[htlcId].user == address(0), "HTLC ID collision");

    // Create HTLC
    htlcs[htlcId] = HTLCDetails({
      secretHash: secretHash,
      amount: msg.value,
      timeout: timeout,
      user: msg.sender,
      designatedRelayer: designatedRelayer,
      claimed: false,
      refunded: false,
      createdAt: block.timestamp,
      nearOrderHash: nearOrderHash
    });

    // Update user HTLC count
    userHTLCCount[msg.sender]++;

    emit HTLCCreated(
      htlcId,
      msg.sender,
      designatedRelayer,
      msg.value,
      secretHash,
      timeout,
      nearOrderHash
    );

    return htlcId;
  }

  /// @notice Relayer claims ETH using secret revealed on NEAR
  /// @dev Only the designated relayer can claim, using secret from NEAR claim
  /// @param htlcId The HTLC identifier
  /// @param secret The secret revealed on NEAR chain
  function claimHTLC(
    bytes32 htlcId,
    bytes32 secret
  )
    external
    notPaused
    htlcExists(htlcId)
    notClaimed(htlcId)
    notRefunded(htlcId)
  {
    HTLCDetails storage htlc = htlcs[htlcId];

    // Check timeout
    require(block.timestamp < htlc.timeout, "HTLC expired");

    // Only designated relayer can claim
    require(msg.sender == htlc.designatedRelayer, "Unauthorized relayer");

    // Verify secret
    require(
      sha256(abi.encodePacked(secret)) == htlc.secretHash,
      "Invalid secret"
    );

    // Mark as claimed
    htlc.claimed = true;

    // Decrease user HTLC count
    userHTLCCount[htlc.user]--;

    // Transfer ETH to relayer
    uint256 amount = htlc.amount;
    (bool success, ) = htlc.designatedRelayer.call{ value: amount }("");
    require(success, "ETH transfer failed");

    emit HTLCClaimed(htlcId, htlc.designatedRelayer, secret, amount);
  }

  /// @notice User refunds ETH after timeout
  /// @dev Only available after timeout and if not yet claimed
  /// @param htlcId The HTLC identifier
  function refundHTLC(
    bytes32 htlcId
  )
    external
    notPaused
    htlcExists(htlcId)
    notClaimed(htlcId)
    notRefunded(htlcId)
  {
    HTLCDetails storage htlc = htlcs[htlcId];

    // Check timeout has passed
    require(block.timestamp >= htlc.timeout, "HTLC not expired");

    // Only original user can refund
    require(msg.sender == htlc.user, "Unauthorized user");

    // Mark as refunded
    htlc.refunded = true;

    // Decrease user HTLC count
    userHTLCCount[htlc.user]--;

    // Refund ETH to user
    uint256 amount = htlc.amount;
    (bool success, ) = htlc.user.call{ value: amount }("");
    require(success, "ETH refund failed");

    emit HTLCRefunded(htlcId, htlc.user, amount);
  }

  /// @notice Check if HTLC can be claimed by relayer
  /// @param htlcId The HTLC identifier
  /// @param relayer The relayer address
  /// @return claimable Whether HTLC can be claimed
  function canClaim(
    bytes32 htlcId,
    address relayer
  ) external view returns (bool) {
    HTLCDetails storage htlc = htlcs[htlcId];

    return
      htlc.user != address(0) && // HTLC exists
      !htlc.claimed && // Not claimed
      !htlc.refunded && // Not refunded
      block.timestamp < htlc.timeout && // Not expired
      relayer == htlc.designatedRelayer; // Correct relayer
  }

  /// @notice Check if HTLC can be refunded by user
  /// @param htlcId The HTLC identifier
  /// @param user The user address
  /// @return refundable Whether HTLC can be refunded
  function canRefund(
    bytes32 htlcId,
    address user
  ) external view returns (bool) {
    HTLCDetails storage htlc = htlcs[htlcId];

    return
      htlc.user != address(0) && // HTLC exists
      !htlc.claimed && // Not claimed
      !htlc.refunded && // Not refunded
      block.timestamp >= htlc.timeout && // Expired
      user == htlc.user; // Correct user
  }

  /// @notice Get HTLC details
  /// @param htlcId The HTLC identifier
  /// @return htlc The complete HTLC details
  function getHTLC(bytes32 htlcId) external view returns (HTLCDetails memory) {
    return htlcs[htlcId];
  }

  /// @notice Get HTLCs by user (for frontend/monitoring)
  /// @param user The user address
  /// @param offset Starting index
  /// @param limit Maximum number of results
  /// @return htlcIds Array of HTLC IDs
  /// @dev This is a simplified implementation; production would use events/indexing
  function getHTLCsByUser(
    address user,
    uint256 offset,
    uint256 limit
  ) external view returns (bytes32[] memory htlcIds) {
    // Note: This is a gas-expensive operation for large datasets
    // In production, use event logs or off-chain indexing
    require(limit <= 100, "Limit too high");

    // This is a simplified implementation for demo purposes
    // Real implementation would maintain user->HTLC mappings
    bytes32[] memory results = new bytes32[](limit);
    uint256 count = 0;

    // This would be very gas expensive in practice
    // Better to emit events and use off-chain indexing
    return results;
  }

  /// @notice Get HTLC count for user
  /// @param user The user address
  /// @return count Number of active HTLCs
  function getUserHTLCCount(address user) external view returns (uint256) {
    return userHTLCCount[user];
  }

  /// @notice Verify secret against HTLC without claiming
  /// @param htlcId The HTLC identifier
  /// @param secret The secret to verify
  /// @return valid Whether secret is valid
  function verifySecret(
    bytes32 htlcId,
    bytes32 secret
  ) external view returns (bool) {
    HTLCDetails storage htlc = htlcs[htlcId];
    if (htlc.user == address(0)) return false;

    return sha256(abi.encodePacked(secret)) == htlc.secretHash;
  }

  // ===== ADMIN FUNCTIONS =====

  /// @notice Emergency pause/unpause functionality
  /// @param _paused Whether to pause the contract
  function setPaused(bool _paused) external onlyOwner {
    paused = _paused;
    emit EmergencyPause(_paused);
  }

  /// @notice Update minimum timeout
  /// @param newMinTimeout New minimum timeout duration
  function setMinTimeout(uint256 newMinTimeout) external onlyOwner {
    require(newMinTimeout >= 1 hours, "Timeout too short");
    require(newMinTimeout <= maxTimeout, "Min timeout too high");
    minTimeout = newMinTimeout;
  }

  /// @notice Update maximum timeout
  /// @param newMaxTimeout New maximum timeout duration
  function setMaxTimeout(uint256 newMaxTimeout) external onlyOwner {
    require(newMaxTimeout <= 30 days, "Timeout too long");
    require(newMaxTimeout >= minTimeout, "Max timeout too low");
    maxTimeout = newMaxTimeout;
  }

  /// @notice Update maximum HTLCs per user
  /// @param newMaxUserHTLCs New maximum HTLCs per user
  function setMaxUserHTLCs(uint256 newMaxUserHTLCs) external onlyOwner {
    require(newMaxUserHTLCs > 0 && newMaxUserHTLCs <= 100, "Invalid limit");
    maxUserHTLCs = newMaxUserHTLCs;
  }

  /// @notice Transfer ownership
  /// @param newOwner The new owner address
  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Invalid new owner");
    owner = newOwner;
  }

  /// @notice Emergency withdrawal (only owner, only if paused)
  /// @dev For emergency situations only
  function emergencyWithdraw() external onlyOwner {
    require(paused, "Contract must be paused");

    uint256 balance = address(this).balance;
    require(balance > 0, "No balance to withdraw");

    (bool success, ) = owner.call{ value: balance }("");
    require(success, "Withdrawal failed");
  }

  /// @notice Get contract statistics
  /// @return totalBalance Total ETH locked in contract
  /// @return totalHTLCs Total number of HTLCs created (would need counter)
  function getContractStats()
    external
    view
    returns (uint256 totalBalance, uint256 totalHTLCs)
  {
    totalBalance = address(this).balance;
    totalHTLCs = 0; // Would need to implement counter if needed
  }

  receive() external payable {
    revert("Direct payments not accepted. Use createHTLC()");
  }
}
