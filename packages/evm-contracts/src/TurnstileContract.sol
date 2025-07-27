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
  }

  // State variables
  mapping(address => RelayerBond) public relayerBonds;
  mapping(bytes32 => DutchAuction) public auctions;
  mapping(bytes32 => AuctionHTLCOrder) public orders;

  uint256 public cumulativePayments; // Total payments processed
  bytes32 public merkleRoot; // Order merkle root

  // Constants
  uint256 public constant BOND_CHALLENGE_PERIOD = 7 days;
  uint256 public constant HTLC_CREATION_DEADLINE = 5 minutes;
  uint256 public constant COLLATERAL_RATIO = 2; // 200% collateralization

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
    uint256 amount
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

  /// @notice Deposit bond to become a relayer
  function depositBond() external payable {
    require(msg.value > 0, "Bond must be greater than 0");

    RelayerBond storage bond = relayerBonds[msg.sender];
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
  ) external payable returns (bytes32 orderHash) {
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
        block.timestamp
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
      designatedRelayer: address(0)
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
        auction.tierMinBonds[0] = 100 ether;  // Tier 0: 100+ ETH
        auction.tierMinBonds[1] = 50 ether;   // Tier 1: 50+ ETH
        auction.tierMinBonds[2] = 25 ether;   // Tier 2: 25+ ETH
        auction.tierMinBonds[3] = 10 ether;   // Tier 3: 10+ ETH
        
        auction.tierUnlockTime[0] = 0;        // Tier 0: Immediate
        auction.tierUnlockTime[1] = 30;       // Tier 1: After 30s
        auction.tierUnlockTime[2] = 60;       // Tier 2: After 60s
        auction.tierUnlockTime[3] = 90;       // Tier 3: After 90s

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
  function submitAuctionBid(bytes32 orderHash) external returns (bool) {
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
  function releaseBond(address relayer, bytes32 orderHash) external {
    // TODO: Add proper access control (only fulfillment contract)
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
  function requestBondWithdrawal(uint256 amount) external {
    RelayerBond storage bond = relayerBonds[msg.sender];
    require(bond.activeBond == 0, "Cannot withdraw with active orders");
    require(bond.withdrawalRequest == 0, "Withdrawal already pending");
    require(amount <= bond.totalBond, "Insufficient bond balance");

    bond.withdrawalRequest = amount;
    bond.withdrawalDeadline = block.timestamp + BOND_CHALLENGE_PERIOD;

    emit BondWithdrawalRequested(msg.sender, amount, bond.withdrawalDeadline);
  }

  /// @notice Execute bond withdrawal after challenge period
  function executeBondWithdrawal() external {
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

  /// @notice Slash relayer for misbehavior
  /// @param relayer The relayer to slash
  /// @param orderHash The order they failed to fulfill
  /// @param proof Proof of misbehavior
  function slashRelayer(
    address relayer,
    bytes32 orderHash,
    bytes32[] calldata proof
  ) external {
    RelayerBond storage bond = relayerBonds[relayer];
    require(bond.challengePeriodActive, "No active challenge period");
    require(
      _verifyMisbehaviorProof(relayer, orderHash, proof),
      "Invalid proof"
    );

    uint256 slashAmount = bond.lockedPerOrder[orderHash];
    require(slashAmount > 0, "No locked bond for this order");

    bond.totalBond -= slashAmount;
    bond.activeBond -= slashAmount;
    delete bond.lockedPerOrder[orderHash];

    // Compensate affected user from slashed bond
    AuctionHTLCOrder storage order = orders[orderHash];
    (bool success, ) = order.user.call{ value: slashAmount }("");
    require(success, "Compensation transfer failed");

    emit RelayerSlashed(relayer, orderHash, slashAmount);
  }

  /// @notice Verify proof of relayer misbehavior
  /// @dev Simplified implementation - in production would verify HTLC creation failure
  function _verifyMisbehaviorProof(
    address relayer,
    bytes32 orderHash,
    bytes32[] calldata proof
  ) internal view returns (bool) {
    // Simplified: check if HTLC creation deadline passed
    AuctionHTLCOrder storage order = orders[orderHash];
    if (order.designatedRelayer != relayer) return false;

    DutchAuction storage auction = auctions[orderHash];
    if (auction.winner != relayer) return false;

    // Check if deadline for HTLC creation has passed
    uint256 deadline = auction.startTime +
      auction.duration +
      HTLC_CREATION_DEADLINE;
    return block.timestamp > deadline && !order.fulfilled;
  }

  /// @notice Get relayer bond information
  /// @param relayer The relayer address
  /// @return totalBond Total bonded amount
  /// @return activeBond Currently locked amount
  /// @return availableBond Available for new orders
  function getRelayerBondInfo(
    address relayer
  )
    external
    view
    returns (uint256 totalBond, uint256 activeBond, uint256 availableBond)
  {
    RelayerBond storage bond = relayerBonds[relayer];
    totalBond = bond.totalBond;
    activeBond = bond.activeBond;
    availableBond = totalBond > activeBond ? totalBond - activeBond : 0;
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
    return bond.totalBond - bond.activeBond >= requiredBond;
  }

  receive() external payable {
    revert("Direct payments not accepted. Use depositBond() or createOrder()");
  }
}
