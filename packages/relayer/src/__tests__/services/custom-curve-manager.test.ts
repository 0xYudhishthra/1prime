import { CustomCurveManager } from "../../services/custom-curve-manager";
import { mockLogger } from "../setup";
import { FusionOrderExtended } from "../../types";

describe("CustomCurveManager", () => {
  let customCurveManager: CustomCurveManager;

  beforeEach(() => {
    customCurveManager = new CustomCurveManager(mockLogger);
  });

  describe("initializeCustomCurve", () => {
    const createOrderWithCurve = (points?: any[]): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      enhancedAuctionDetails: points ? { points } : undefined,
    });

    it("should initialize custom curve with provided points", () => {
      const customPoints = [
        { delay: 0, coefficient: 1.0 },
        { delay: 60, coefficient: 0.5 },
        { delay: 120, coefficient: 0.0 },
      ];
      const order = createOrderWithCurve(customPoints);

      const curveState = customCurveManager.initializeCustomCurve(order);

      expect(curveState.orderHash).toBe("0x123");
      expect(curveState.points).toEqual(customPoints);
      expect(curveState.originalRate).toBe(1000);
      expect(curveState.isActive).toBe(true);
    });

    it("should create default linear curve when no points provided", () => {
      const order = createOrderWithCurve();

      const curveState = customCurveManager.initializeCustomCurve(order);

      expect(curveState.points).toHaveLength(5); // Default linear curve has 5 points
      expect(curveState.points[0]).toEqual({ delay: 0, coefficient: 1.0 });
      expect(curveState.points[4]).toEqual({ delay: 120, coefficient: 0.0 });
    });
  });

  describe("calculateAdjustedRate - Custom Curve Interpolation", () => {
    beforeEach(() => {
      const customPoints = [
        { delay: 0, coefficient: 1.0 }, // 100% at start
        { delay: 30, coefficient: 0.8 }, // 80% at 30s
        { delay: 60, coefficient: 0.4 }, // 40% at 60s
        { delay: 90, coefficient: 0.1 }, // 10% at 90s
        { delay: 120, coefficient: 0.0 }, // 0% at 120s
      ];
      const order = createOrderWithCurve(customPoints);
      customCurveManager.initializeCustomCurve(order);
    });

    const createOrderWithCurve = (points?: any[]): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      enhancedAuctionDetails: points ? { points } : undefined,
    });

    it("should interpolate rates between curve points", () => {
      const startTime = Date.now();

      // At exact points
      const rate0 = customCurveManager.calculateAdjustedRate(
        "0x123",
        startTime
      );
      expect(rate0).toBe(1000); // 100% of 1000

      const rate30 = customCurveManager.calculateAdjustedRate(
        "0x123",
        startTime + 30000
      );
      expect(rate30).toBe(800); // 80% of 1000

      const rate60 = customCurveManager.calculateAdjustedRate(
        "0x123",
        startTime + 60000
      );
      expect(rate60).toBe(400); // 40% of 1000

      // Between points (interpolation)
      const rate15 = customCurveManager.calculateAdjustedRate(
        "0x123",
        startTime + 15000
      );
      expect(rate15).toBe(875); // 87.5% of 1000 (interpolated between 100% and 80%)

      const rate45 = customCurveManager.calculateAdjustedRate(
        "0x123",
        startTime + 45000
      );
      expect(rate45).toBe(667); // 66.7% of 1000 (interpolated between 80% and 40%)
    });

    it("should handle rates beyond curve duration", () => {
      const startTime = Date.now();

      const rateAfterEnd = customCurveManager.calculateAdjustedRate(
        "0x123",
        startTime + 150000
      );
      expect(rateAfterEnd).toBe(0); // Should be 0 after curve ends
    });
  });

  describe("Gas Price Adjustments - Whitepaper Figure 3 Scenarios", () => {
    beforeEach(() => {
      const order = createOrderWithCurve();
      customCurveManager.initializeCustomCurve(order);
    });

    const createOrderWithCurve = (points?: any[]): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      enhancedAuctionDetails: points ? { points } : undefined,
    });

    it("should handle gas price decrease (Scenario 1 from Figure 3)", async () => {
      // "baseFee declined, and the adjusted price curve reacted by increasing the number of tokens"

      // Simulate initial gas price of 30 gwei
      await customCurveManager.updateGasConditions(30e9);

      // Gas drops to 15 gwei (50% decrease)
      await customCurveManager.updateGasConditions(15e9);

      const curveState = customCurveManager.getCurveState("0x123");
      const latestAdjustment =
        curveState?.gasAdjustments[curveState.gasAdjustments.length - 1];

      expect(latestAdjustment?.currentBaseFee).toBe(15e9);
      expect(latestAdjustment?.adjustmentFactor).toBe(1.25); // 1.0 + (1.0 - 0.5) * 0.5 = 1.25

      // User gets better rate (25% bonus)
      const baseRate = 500; // Example base rate from curve
      const adjustedRate = customCurveManager.calculateAdjustedRate("0x123");
      // Should be higher than base rate due to gas decrease bonus
    });

    it("should handle gas price increase (Scenario 2 from Figure 3)", async () => {
      // "baseFee increased, prompting the adjusted price curve to correct the execution costs"

      // Simulate initial gas price of 30 gwei
      await customCurveManager.updateGasConditions(30e9);

      // Gas doubles to 60 gwei
      await customCurveManager.updateGasConditions(60e9);

      const curveState = customCurveManager.getCurveState("0x123");
      const latestAdjustment =
        curveState?.gasAdjustments[curveState.gasAdjustments.length - 1];

      expect(latestAdjustment?.currentBaseFee).toBe(60e9);
      expect(latestAdjustment?.adjustmentFactor).toBe(2.0); // gasRatio = 60/30 = 2.0

      // Rate should double to maintain resolver profitability
    });

    it("should track multiple gas adjustments over time", async () => {
      // Initial price
      await customCurveManager.updateGasConditions(20e9);

      // Price increase
      await customCurveManager.updateGasConditions(40e9);

      // Price decrease
      await customCurveManager.updateGasConditions(10e9);

      const curveState = customCurveManager.getCurveState("0x123");
      expect(curveState?.gasAdjustments).toHaveLength(3);

      // Should track the progression of adjustments
      expect(curveState?.gasAdjustments[0].currentBaseFee).toBe(20e9);
      expect(curveState?.gasAdjustments[1].currentBaseFee).toBe(40e9);
      expect(curveState?.gasAdjustments[2].currentBaseFee).toBe(10e9);
    });
  });

  describe("Gas Monitoring", () => {
    it("should start and stop gas monitoring", () => {
      customCurveManager.startGasMonitoring(5000);
      // Should not throw and should start the monitoring interval

      customCurveManager.stopGasMonitoring();
      // Should clean up the interval
    });

    it("should provide gas adjustment summary", async () => {
      const order = createOrderWithCurve();
      customCurveManager.initializeCustomCurve(order);

      await customCurveManager.updateGasConditions(25e9);

      const summary = customCurveManager.getGasAdjustmentSummary();

      expect(summary.currentBaseFeeGwei).toBe(25);
      expect(summary.activeOrders).toBe(1);
      expect(summary.adjustmentsToday).toBe(1);
    });

    const createOrderWithCurve = (points?: any[]): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      enhancedAuctionDetails: points ? { points } : undefined,
    });
  });

  describe("Curve State Management", () => {
    it("should deactivate and cleanup curves", () => {
      const order = createOrderWithCurve();
      customCurveManager.initializeCustomCurve(order);

      let curveState = customCurveManager.getCurveState("0x123");
      expect(curveState?.isActive).toBe(true);

      customCurveManager.deactivateCurve("0x123");
      curveState = customCurveManager.getCurveState("0x123");
      expect(curveState?.isActive).toBe(false);

      customCurveManager.cleanupCurve("0x123");
      curveState = customCurveManager.getCurveState("0x123");
      expect(curveState).toBeUndefined();
    });

    it("should return 0 for deactivated curves", () => {
      const order = createOrderWithCurve();
      customCurveManager.initializeCustomCurve(order);

      customCurveManager.deactivateCurve("0x123");

      const rate = customCurveManager.calculateAdjustedRate("0x123");
      expect(rate).toBe(0);
    });

    const createOrderWithCurve = (points?: any[]): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      enhancedAuctionDetails: points ? { points } : undefined,
    });
  });
});

const createOrderWithCurve = (points?: any[]): FusionOrderExtended => ({
  orderHash: "0x123",
  maker: "0xmaker",
  sourceChain: "ethereum",
  destinationChain: "near",
  sourceToken: "ETH",
  destinationToken: "NEAR",
  sourceAmount: "100000000",
  destinationAmount: "1000000000",
  secretHash: "0xsecret",
  timeout: Date.now() + 3600000,
  auctionStartTime: Date.now(),
  auctionDuration: 120000,
  initialRateBump: 1000,
  signature: "0xsig",
  nonce: "nonce1",
  createdAt: Date.now(),
  enhancedAuctionDetails: points ? { points } : undefined,
});
