// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/TurnstileContract.sol";
import "../src/EthereumFulfillmentContract.sol";

contract TurnstileContractTest is Test {
  TurnstileContract public turnstile;
  EthereumFulfillmentContract public fulfillment;

  address public relayer;
  address public user;
  address public oracle;

  function setUp() public {
    relayer = makeAddr("relayer");
    user = makeAddr("user");
    oracle = makeAddr("oracle");

    // Deploy contracts
    turnstile = new TurnstileContract();
    fulfillment = new EthereumFulfillmentContract(address(turnstile));

    // Setup oracle authorization
    fulfillment.authorizeOracle(oracle);
  }

  function testRelayerCanDepositBond() public {
    vm.deal(relayer, 100 ether);

    vm.startPrank(relayer);
    turnstile.depositBond{ value: 50 ether }();
    vm.stopPrank();

    (uint256 totalBond, uint256 activeBond, uint256 availableBond) = turnstile
      .getRelayerBondInfo(relayer);

    assertEq(totalBond, 50 ether);
    assertEq(activeBond, 0);
    assertEq(availableBond, 50 ether);
  }

  function testUserCanCreateOrder() public {
    vm.deal(user, 10 ether);

    bytes32 secret = keccak256("test_secret");
    bytes32 secretHash = sha256(abi.encodePacked(secret));

    vm.startPrank(user);
    bytes32 orderHash = turnstile.createOrder{ value: 1 ether }(
      secretHash,
      block.timestamp + 2 days,
      100, // 1% initial rate bump
      120, // 120 seconds auction
      address(0), // No oracle for test
      0 // Minimum tier 0
    );
    vm.stopPrank();

    assertTrue(orderHash != bytes32(0));

    TurnstileContract.AuctionHTLCOrder memory order = turnstile.getOrder(
      orderHash
    );
    assertEq(order.user, user);
    assertEq(order.amount, 1 ether);
    assertEq(order.secretHash, secretHash);
  }

  function testAuctionFlow() public {
    // Setup relayer with bond
    vm.deal(relayer, 100 ether);
    vm.startPrank(relayer);
    turnstile.depositBond{ value: 50 ether }();
    vm.stopPrank();

    // Setup user order
    vm.deal(user, 10 ether);
    bytes32 secret = keccak256("test_secret");
    bytes32 secretHash = sha256(abi.encodePacked(secret));

    vm.startPrank(user);
    bytes32 orderHash = turnstile.createOrder{ value: 1 ether }(
      secretHash,
      block.timestamp + 2 days,
      100, // 1% initial rate bump
      120, // 120 seconds auction
      address(0), // No oracle for test
      0 // Minimum tier 0
    );
    vm.stopPrank();

    // Check auction is active
    TurnstileContract.DutchAuction memory auction = turnstile.getAuction(
      orderHash
    );
    assertTrue(auction.active);

    // Relayer bids on auction
    vm.startPrank(relayer);
    bool success = turnstile.submitAuctionBid(orderHash);
    vm.stopPrank();

    assertTrue(success);

    // Check auction completed and relayer won
    auction = turnstile.getAuction(orderHash);
    assertFalse(auction.active);
    assertEq(auction.winner, relayer);

    // Check relayer received payment
    assertEq(relayer.balance, 51 ether); // Original 50 + 1 ether payment

    // Check relayer bond is locked
    (uint256 totalBond, uint256 activeBond, uint256 availableBond) = turnstile
      .getRelayerBondInfo(relayer);
    assertEq(totalBond, 50 ether);
    assertEq(activeBond, 2 ether); // 200% of order amount
    assertEq(availableBond, 48 ether);
  }

  function testFulfillmentVerification() public {
    // Setup contracts and create a fulfilled order scenario
    vm.deal(relayer, 100 ether);
    vm.startPrank(relayer);
    turnstile.depositBond{ value: 50 ether }();
    vm.stopPrank();

    vm.deal(user, 10 ether);
    bytes32 secret = keccak256("test_secret");
    bytes32 secretHash = sha256(abi.encodePacked(secret));

    vm.startPrank(user);
    bytes32 orderHash = turnstile.createOrder{ value: 1 ether }(
      secretHash,
      block.timestamp + 2 days,
      100,
      120,
      address(0),
      0
    );
    vm.stopPrank();

    vm.startPrank(relayer);
    turnstile.submitAuctionBid(orderHash);
    vm.stopPrank();

    // Simulate NEAR fulfillment verification
    bytes32 nearTxHash = keccak256("near_tx_hash");

    vm.startPrank(oracle);
    fulfillment.verifyNEARFulfillment(orderHash, secret, nearTxHash);
    vm.stopPrank();

    // Check order is marked as fulfilled
    assertTrue(fulfillment.isOrderFulfilled(orderHash));
    assertEq(fulfillment.getRevealedSecret(orderHash), secret);

    // Check bond was released
    (uint256 totalBond, uint256 activeBond, uint256 availableBond) = turnstile
      .getRelayerBondInfo(relayer);
    assertEq(activeBond, 0); // Bond should be released
    assertEq(availableBond, 50 ether);
  }

  function testGetCurrentAuctionRate() public {
    vm.deal(user, 10 ether);
    bytes32 secretHash = sha256(abi.encodePacked(keccak256("secret")));

    vm.startPrank(user);
    bytes32 orderHash = turnstile.createOrder{ value: 1 ether }(
      secretHash,
      block.timestamp + 2 days,
      100, // 1% initial rate bump
      120, // 120 seconds auction
      address(0),
      0
    );
    vm.stopPrank();

    // At start, rate should be 100 (1%)
    uint256 initialRate = turnstile.getCurrentAuctionRate(orderHash);
    assertEq(initialRate, 100);

    // Skip to middle of auction
    vm.warp(block.timestamp + 60); // 60 seconds = 50% through
    uint256 midRate = turnstile.getCurrentAuctionRate(orderHash);
    assertEq(midRate, 50); // Should be 0.5%

    // Skip to end of auction
    vm.warp(block.timestamp + 60); // Another 60 seconds = 100% through
    uint256 endRate = turnstile.getCurrentAuctionRate(orderHash);
    assertEq(endRate, 0); // Should be market rate (0%)
  }
}
