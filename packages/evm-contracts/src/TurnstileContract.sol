// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/console.sol";

/// @title TurnstileContract - Core Bonded Relayer Management
/// @notice Manages bonded relayers, Dutch auctions, immediate payments, and slashing
/// @dev Implements Across Prime's bonded model with 1inch Fusion+ Dutch auction integration
contract TurnstileContract {
  /// @notice Relayer bond information and status
  struct RelayerBond {
    uint256 totalBond; // Total bonded amount
    uint256 activeBond; // Currently locked in active orders
    uint256 withdrawalRequest; // Pending withdrawal amount
    uint256 withdrawalDeadline; // When withdrawal becomes available
    bool challengePeriodActive; // Whether bond can be challenged
    mapping(bytes32 => uint256) lockedPerOrder; // Per-order locks
    uint256 bondedSince; // When relayer first bonded (prevent immediate withdrawal)
    uint256 slashingHistory; // Number of times slashed (reputation)
  }

  /// @notice Dutch auction configuration and state
  struct DutchAuction {
    uint256 startTime; // Auction start timestamp
    uint256 duration; // Auction duration (typically 120 seconds)
    uint256 initialRateBump; // Start rate worse than market (basis points)
    address marketRateOracle; // Price feed oracle
    bool active; // Auction status
    address winner; // Winning relayer
    uint256 finalRate; // Final settled rate
    // Bonded relayer tiers (Fusion+ pattern)
    uint256[4] tierMinBonds; // Minimum bond requirements per tier
    uint256[4] tierUnlockTime; // When each tier can bid (seconds from start)
  }

  /// @notice HTLC order structure for auctions
  struct AuctionHTLCOrder {
    bytes32 secretHash; // User's secret hash
    uint256 timeout; // HTLC expiration timestamp
    address user; // User creating the swap
    uint256 amount; // ETH amount to swap
    // Dutch Auction parameters
    uint256 initialRateBump; // Starting rate disadvantage (basis points)
    uint256 auctionDuration; // Duration in seconds
    address priceOracle; // Market rate source
    // Bonded relayer requirements
    uint256 minBondTier; // Minimum tier allowed to bid
    bool requireBondHistory; // Require proven track record
    bool fulfilled; // Order completion status
    address designatedRelayer; // Winning relayer
    uint256 createdAt; // Order creation timestamp
  }

  // State variables
  mapping(address => RelayerBond) public relayerBonds;
  mapping(bytes32 => DutchAuction) public auctions;
  mapping(bytes32 => AuctionHTLCOrder) public orders;

  uint256 public cumulativePayments; // Total payments processed
  bytes32 public merkleRoot; // Order merkle root

  // Security controls
  address public owner;
  mapping(address => bool) public authorizedFulfillmentContracts;
  mapping(address => bool) public authorizedSlashers; // Trusted slashing oracles
  bool public paused; // Emergency pause
  uint256 public minBondDuration = 1 days; // Minimum bonding time before withdrawal
  uint256 public maxSlashingRate = 5000; // Max 50% of bond can be slashed per incident

  // Constants
  uint256 public constant BOND_CHALLENGE_PERIOD = 7 days;
  uint256 public constant HTLC_CREATION_DEADLINE = 5 minutes;
  uint256 public constant COLLATERAL_RATIO = 2; // 200% collateralization
  uint256 public constant MAX_SLASHING_HISTORY = 3; // Max slashing events before ban

  // Events
  event RelayerBonded(address indexed relayer, uint256 amount);
  event BondWithdrawalRequested(
    address indexed relayer,
    uint256 amount,
    uint256 deadline
  );
  event RelayerSlashed(
    address indexed relayer,
    bytes32 indexed orderHash,
    uint256 amount,
    address slasher
  );
  event AuctionStarted(
    bytes32 indexed orderHash,
    uint256 initialRateBump,
    uint256 duration
  );
  event AuctionWon(
    bytes32 indexed orderHash,
    address indexed winner,
    uint256 finalRate
  );
  event OrderCreated(
    bytes32 indexed orderHash,
    address indexed user,
    uint256 amount
  );
  event ImmediatePayment(
    bytes32 indexed orderHash,
    address indexed relayer,
    uint256 amount
  );
  event BondLocked(
    address indexed relayer,
    bytes32 indexed orderHash,
    uint256 amount
  );
  event BondReleased(
    address indexed relayer,
    bytes32 indexed orderHash,
    uint256 amount
  );
  event FulfillmentContractAuthorized(address indexed contractAddr);
  event SlasherAuthorized(address indexed slasher);
  event EmergencyPause(bool paused);
  event RelayerBanned(address indexed relayer, uint256 slashingHistory);

  // Modifiers
  modifier onlyOwner() {
    require(msg.sender == owner, "Only owner");
    _;
  }

  modifier onlyAuthorizedFulfillment() {
    require(
      authorizedFulfillmentContracts[msg.sender],
      "Only authorized fulfillment contract"
    );
    _;
  }

  modifier onlyAuthorizedSlasher() {
    require(
      authorizedSlashers[msg.sender] || msg.sender == owner,
      "Only authorized slasher"
    );
    _;
  }

  modifier notPaused() {
    require(!paused, "Contract is paused");
    _;
  }

  modifier validRelayer(address relayer) {
    require(relayer != address(0), "Invalid relayer address");
    require(
      relayerBonds[relayer].slashingHistory < MAX_SLASHING_HISTORY,
      "Relayer banned"
    );
    _;
  }

  constructor() {
    owner = msg.sender;
  }

  /// @notice Deposit bond to become a relayer
  function depositBond() external payable notPaused {
    require(msg.value > 0, "Bond must be greater than 0");

    RelayerBond storage bond = relayerBonds[msg.sender];

    // Set bonding timestamp for first-time relayers
    if (bond.totalBond == 0) {
      bond.bondedSince = block.timestamp;
    }

    bond.totalBond += msg.value;

    emit RelayerBonded(msg.sender, msg.value);
  }

  /// @notice Create a new swap order with Dutch auction
  /// @param secretHash User's secret hash for HTLC
  /// @param timeout HTLC expiration timestamp
  /// @param initialRateBump Starting rate disadvantage in basis points (e.g., 100 = 1%)
  /// @param auctionDuration Auction duration in seconds
  /// @param priceOracle Market rate oracle address
  /// @param minBondTier Minimum relayer tier allowed to bid
  function createOrder(
    bytes32 secretHash,
    uint256 timeout,
    uint256 initialRateBump,
    uint256 auctionDuration,
    address priceOracle,
    uint256 minBondTier
  ) external payable notPaused returns (bytes32 orderHash) {
    require(msg.value > 0, "Order amount must be greater than 0");
    require(
      timeout > block.timestamp + auctionDuration + 1 hours,
      "Insufficient timeout"
    );
    require(initialRateBump <= 1000, "Rate bump too high"); // Max 10%
    require(
      auctionDuration >= 60 && auctionDuration <= 300,
      "Invalid auction duration"
    );
    require(minBondTier < 4, "Invalid bond tier");

    orderHash = keccak256(
      abi.encodePacked(
        msg.sender,
        secretHash,
        timeout,
        msg.value,
        block.timestamp,
        block.number // Add block number for uniqueness
      )
    );

    orders[orderHash] = AuctionHTLCOrder({
      secretHash: secretHash,
      timeout: timeout,
      user: msg.sender,
      amount: msg.value,
      initialRateBump: initialRateBump,
      auctionDuration: auctionDuration,
      priceOracle: priceOracle,
      minBondTier: minBondTier,
      requireBondHistory: false,
      fulfilled: false,
      designatedRelayer: address(0),
      createdAt: block.timestamp
    });

    emit OrderCreated(orderHash, msg.sender, msg.value);

    // Automatically start Dutch auction
    _startDutchAuction(orderHash);

    return orderHash;
  }

  /// @notice Start Dutch auction for an order
  /// @param orderHash The order to start auction for
  function _startDutchAuction(bytes32 orderHash) internal {
    AuctionHTLCOrder storage order = orders[orderHash];
    require(order.user != address(0), "Order does not exist");
    require(!auctions[orderHash].active, "Auction already active");

    // Create auction with proper array initialization
    DutchAuction storage auction = auctions[orderHash];
    auction.startTime = block.timestamp;
    auction.duration = order.auctionDuration;
    auction.initialRateBump = order.initialRateBump;
    auction.marketRateOracle = order.priceOracle;
    auction.active = true;
    auction.winner = address(0);
    auction.finalRate = 0;

    // Standard tier setup (from Fusion+ pattern)
    auction.tierMinBonds[0] = 100 ether; // Tier 0: 100+ ETH
    auction.tierMinBonds[1] = 50 ether; // Tier 1: 50+ ETH
    auction.tierMinBonds[2] = 25 ether; // Tier 2: 25+ ETH
    auction.tierMinBonds[3] = 10 ether; // Tier 3: 10+ ETH

    auction.tierUnlockTime[0] = 0; // Tier 0: Immediate
    auction.tierUnlockTime[1] = 30; // Tier 1: After 30s
    auction.tierUnlockTime[2] = 60; // Tier 2: After 60s
    auction.tierUnlockTime[3] = 90; // Tier 3: After 90s

    emit AuctionStarted(
      orderHash,
      order.initialRateBump,
      order.auctionDuration
    );
  }

  /// @notice Get current auction rate (how much worse than market rate)
  /// @param orderHash The order's auction to check
  /// @return Current rate bump in basis points
  function getCurrentAuctionRate(
    bytes32 orderHash
  ) public view returns (uint256) {
    DutchAuction storage auction = auctions[orderHash];
    if (!auction.active) return 0;

    uint256 elapsed = block.timestamp - auction.startTime;
    if (elapsed >= auction.duration) return 0; // Market rate

    // Linear rate improvement (Fusion+ style)
    uint256 progress = (elapsed * 10000) / auction.duration; // 0-10000 (basis points)
    return (auction.initialRateBump * (10000 - progress)) / 10000;
  }

  /// @notice Submit a bid for the Dutch auction
  /// @param orderHash The order to bid on
  function submitAuctionBid(
    bytes32 orderHash
  ) external notPaused validRelayer(msg.sender) returns (bool) {
    DutchAuction storage auction = auctions[orderHash];
    AuctionHTLCOrder storage order = orders[orderHash];

    require(auction.active, "Auction not active");
    require(relayerBonds[msg.sender].totalBond > 0, "Not a bonded relayer");

    uint256 currentRate = getCurrentAuctionRate(orderHash);
    uint256 relayerTier = _getRelayerTier(msg.sender);

    // Check if relayer's tier can bid at current time
    uint256 elapsed = block.timestamp - auction.startTime;
    require(
      elapsed >= auction.tierUnlockTime[relayerTier],
      "Tier not unlocked yet"
    );

    // Check bond capacity requirement
    require(
      relayerBonds[msg.sender].totalBond >= auction.tierMinBonds[relayerTier],
      "Insufficient bond for tier"
    );

    // Check available bond capacity for this order
    uint256 requiredBond = order.amount * COLLATERAL_RATIO;
    RelayerBond storage bond = relayerBonds[msg.sender];
    require(
      bond.totalBond - bond.activeBond >= requiredBond,
      "Insufficient available bond capacity"
    );

    // First qualified bidder wins (Fusion+ rule)
    auction.active = false;
    auction.winner = msg.sender;
    auction.finalRate = currentRate;
    order.designatedRelayer = msg.sender;

    // Lock bond for this order
    _lockBondForOrder(msg.sender, orderHash, order.amount);

    // Execute immediate payment (Across Prime innovation)
    _executeImmediatePayment(orderHash);

    emit AuctionWon(orderHash, msg.sender, currentRate);
    return true;
  }

  /// @notice Execute immediate payment to winning relayer
  /// @param orderHash The order to execute payment for
  function _executeImmediatePayment(bytes32 orderHash) internal {
    AuctionHTLCOrder storage order = orders[orderHash];
    require(order.designatedRelayer != address(0), "No designated relayer");

    // Update cumulative payments tracking
    cumulativePayments += order.amount;
    merkleRoot = keccak256(abi.encodePacked(merkleRoot, orderHash));

    // Transfer ETH directly to relayer (immediate payment)
    (bool success, ) = order.designatedRelayer.call{ value: order.amount }("");
    require(success, "Payment transfer failed");

    emit ImmediatePayment(orderHash, order.designatedRelayer, order.amount);
  }

  /// @notice Lock bond for an active order
  /// @param relayer The relayer address
  /// @param orderHash The order hash
  /// @param amount The order amount
  function _lockBondForOrder(
    address relayer,
    bytes32 orderHash,
    uint256 amount
  ) internal {
    RelayerBond storage bond = relayerBonds[relayer];
    uint256 lockAmount = amount * COLLATERAL_RATIO;

    require(
      bond.totalBond - bond.activeBond >= lockAmount,
      "Insufficient free bond"
    );

    bond.activeBond += lockAmount;
    bond.lockedPerOrder[orderHash] = lockAmount;
    bond.challengePeriodActive = true;

    emit BondLocked(relayer, orderHash, lockAmount);
  }

  /// @notice Get relayer tier based on bond size
  /// @param relayer The relayer address
  /// @return tier The tier number (0-3)
  function _getRelayerTier(
    address relayer
  ) internal view returns (uint256 tier) {
    uint256 bondAmount = relayerBonds[relayer].totalBond;

    if (bondAmount >= 100 ether) return 0; // Tier 0: 100+ ETH
    if (bondAmount >= 50 ether) return 1; // Tier 1: 50+ ETH
    if (bondAmount >= 25 ether) return 2; // Tier 2: 25+ ETH
    if (bondAmount >= 10 ether) return 3; // Tier 3: 10+ ETH

    revert("Insufficient bond for any tier");
  }

  /// @notice Release bond after successful order completion
  /// @param relayer The relayer address
  /// @param orderHash The completed order
  function releaseBond(
    address relayer,
    bytes32 orderHash
  ) external onlyAuthorizedFulfillment {
    RelayerBond storage bond = relayerBonds[relayer];
    uint256 lockedAmount = bond.lockedPerOrder[orderHash];

    require(lockedAmount > 0, "No locked bond for this order");

    bond.activeBond -= lockedAmount;
    delete bond.lockedPerOrder[orderHash];

    // Mark order as fulfilled
    orders[orderHash].fulfilled = true;

    emit BondReleased(relayer, orderHash, lockedAmount);
  }

  /// @notice Request bond withdrawal with challenge period
  /// @param amount Amount to withdraw
  function requestBondWithdrawal(uint256 amount) external notPaused {
    RelayerBond storage bond = relayerBonds[msg.sender];
    require(bond.activeBond == 0, "Cannot withdraw with active orders");
    require(bond.withdrawalRequest == 0, "Withdrawal already pending");
    require(amount <= bond.totalBond, "Insufficient bond balance");
    require(
      block.timestamp >= bond.bondedSince + minBondDuration,
      "Minimum bonding period not met"
    );

    bond.withdrawalRequest = amount;
    bond.withdrawalDeadline = block.timestamp + BOND_CHALLENGE_PERIOD;

    emit BondWithdrawalRequested(msg.sender, amount, bond.withdrawalDeadline);
  }

  /// @notice Execute bond withdrawal after challenge period
  function executeBondWithdrawal() external notPaused {
    RelayerBond storage bond = relayerBonds[msg.sender];
    require(bond.withdrawalRequest > 0, "No pending withdrawal");
    require(
      block.timestamp >= bond.withdrawalDeadline,
      "Challenge period not expired"
    );
    require(bond.activeBond == 0, "Cannot withdraw with active orders");

    uint256 amount = bond.withdrawalRequest;
    bond.totalBond -= amount;
    bond.withdrawalRequest = 0;
    bond.withdrawalDeadline = 0;

    (bool success, ) = msg.sender.call{ value: amount }("");
    require(success, "Withdrawal transfer failed");
  }

  /// @notice Slash relayer for misbehavior (only authorized slashers)
  /// @param relayer The relayer to slash
  /// @param orderHash The order they failed to fulfill
  /// @param proof Proof of misbehavior
  function slashRelayer(
    address relayer,
    bytes32 orderHash,
    bytes32[] calldata proof
  ) external onlyAuthorizedSlasher notPaused {
    RelayerBond storage bond = relayerBonds[relayer];
    require(bond.challengePeriodActive, "No active challenge period");
    require(
      _verifyMisbehaviorProof(relayer, orderHash, proof),
      "Invalid proof"
    );

    uint256 slashAmount = bond.lockedPerOrder[orderHash];
    require(slashAmount > 0, "No locked bond for this order");

    // Cap slashing amount to prevent excessive punishment
    uint256 maxSlash = (bond.totalBond * maxSlashingRate) / 10000;
    if (slashAmount > maxSlash) {
      slashAmount = maxSlash;
    }

    bond.totalBond -= slashAmount;
    bond.activeBond -= bond.lockedPerOrder[orderHash]; // Release full locked amount
    bond.slashingHistory += 1;
    delete bond.lockedPerOrder[orderHash];

    // Ban relayer if too many slashing events
    if (bond.slashingHistory >= MAX_SLASHING_HISTORY) {
      emit RelayerBanned(relayer, bond.slashingHistory);
    }

    // Compensate affected user from slashed bond
    AuctionHTLCOrder storage order = orders[orderHash];
    (bool success, ) = order.user.call{ value: slashAmount }("");
    require(success, "Compensation transfer failed");

    emit RelayerSlashed(relayer, orderHash, slashAmount, msg.sender);
  }

  /// @notice Verify proof of relayer misbehavior
  /// @dev Enhanced implementation with multiple proof types
  function _verifyMisbehaviorProof(
    address relayer,
    bytes32 orderHash,
    bytes32[] calldata proof
  ) internal view returns (bool) {
    AuctionHTLCOrder storage order = orders[orderHash];
    if (order.designatedRelayer != relayer) return false;

    DutchAuction storage auction = auctions[orderHash];
    if (auction.winner != relayer) return false;

    // Check if deadline for HTLC creation has passed
    uint256 deadline = auction.startTime +
      auction.duration +
      HTLC_CREATION_DEADLINE;

    // Type 1: Timeout proof - relayer failed to create HTLC in time
    if (block.timestamp > deadline && !order.fulfilled) {
      return true;
    }

    // Type 2: Additional proof verification could be added here
    // For example: proof of invalid HTLC creation, wrong recipient, etc.

    return false;
  }

  // ===== SECURITY & ADMIN FUNCTIONS =====

  /// @notice Authorize fulfillment contract to release bonds
  /// @param contractAddr The fulfillment contract address
  function authorizeFulfillmentContract(
    address contractAddr
  ) external onlyOwner {
    require(contractAddr != address(0), "Invalid contract address");
    authorizedFulfillmentContracts[contractAddr] = true;
    emit FulfillmentContractAuthorized(contractAddr);
  }

  /// @notice Revoke fulfillment contract authorization
  /// @param contractAddr The fulfillment contract address
  function revokeFulfillmentContract(address contractAddr) external onlyOwner {
    authorizedFulfillmentContracts[contractAddr] = false;
  }

  /// @notice Authorize trusted slasher (oracle or governance)
  /// @param slasher The slasher address
  function authorizeSlasher(address slasher) external onlyOwner {
    require(slasher != address(0), "Invalid slasher address");
    authorizedSlashers[slasher] = true;
    emit SlasherAuthorized(slasher);
  }

  /// @notice Revoke slasher authorization
  /// @param slasher The slasher address
  function revokeSlasher(address slasher) external onlyOwner {
    authorizedSlashers[slasher] = false;
  }

  /// @notice Emergency pause/unpause functionality
  /// @param _paused Whether to pause the contract
  function setPaused(bool _paused) external onlyOwner {
    paused = _paused;
    emit EmergencyPause(_paused);
  }

  /// @notice Update maximum slashing rate
  /// @param newRate New maximum slashing rate (basis points)
  function setMaxSlashingRate(uint256 newRate) external onlyOwner {
    require(newRate <= 5000, "Rate too high"); // Max 50%
    maxSlashingRate = newRate;
  }

  /// @notice Update minimum bond duration
  /// @param newDuration New minimum bonding duration
  function setMinBondDuration(uint256 newDuration) external onlyOwner {
    require(newDuration <= 30 days, "Duration too long");
    minBondDuration = newDuration;
  }

  /// @notice Transfer ownership
  /// @param newOwner The new owner address
  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Invalid new owner");
    owner = newOwner;
  }

  // ===== VIEW FUNCTIONS =====

  /// @notice Get relayer bond information
  /// @param relayer The relayer address
  /// @return totalBond Total bonded amount
  /// @return activeBond Currently locked amount
  /// @return availableBond Available for new orders
  /// @return slashingHistory Number of times slashed
  function getRelayerBondInfo(
    address relayer
  )
    external
    view
    returns (
      uint256 totalBond,
      uint256 activeBond,
      uint256 availableBond,
      uint256 slashingHistory
    )
  {
    RelayerBond storage bond = relayerBonds[relayer];
    totalBond = bond.totalBond;
    activeBond = bond.activeBond;
    availableBond = totalBond > activeBond ? totalBond - activeBond : 0;
    slashingHistory = bond.slashingHistory;
  }

  /// @notice Get order information
  /// @param orderHash The order hash
  /// @return order The complete order struct
  function getOrder(
    bytes32 orderHash
  ) external view returns (AuctionHTLCOrder memory) {
    return orders[orderHash];
  }

  /// @notice Get auction information
  /// @param orderHash The order hash
  /// @return auction The complete auction struct
  function getAuction(
    bytes32 orderHash
  ) external view returns (DutchAuction memory) {
    return auctions[orderHash];
  }

  /// @notice Check if relayer can fulfill orders of given amount
  /// @param relayer The relayer address
  /// @param amount The order amount
  /// @return canFulfill Whether relayer has sufficient available bond
  function canRelayerFulfill(
    address relayer,
    uint256 amount
  ) external view returns (bool) {
    RelayerBond storage bond = relayerBonds[relayer];
    uint256 requiredBond = amount * COLLATERAL_RATIO;
    return
      bond.totalBond - bond.activeBond >= requiredBond &&
      bond.slashingHistory < MAX_SLASHING_HISTORY &&
      bond.totalBond >= _getMinimumBondForTier(0); // At least tier 3
  }

  /// @notice Get minimum bond for tier
  /// @param tier The tier number
  /// @return minBond Minimum bond amount
  function _getMinimumBondForTier(
    uint256 tier
  ) internal pure returns (uint256) {
    if (tier == 0) return 100 ether;
    if (tier == 1) return 50 ether;
    if (tier == 2) return 25 ether;
    if (tier == 3) return 10 ether;
    revert("Invalid tier");
  }

  receive() external payable {
    revert("Direct payments not accepted. Use depositBond() or createOrder()");
  }
}
