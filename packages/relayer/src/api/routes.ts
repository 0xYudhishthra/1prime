import { Router, Request, Response, NextFunction } from "express";
import Joi from "joi";
import type { Logger } from "winston";
import { RelayerService } from "../services/relayer";
import {
  ApiResponse,
  CreateOrderRequest,
  ResolverBidRequest,
  SecretRevealRequest,
  RelayerStatus,
  SDKCrossChainOrder,
} from "../types";
import { SDKOrderMapper } from "../utils/sdk-mapper";

// Validation schemas
const createOrderSchema = Joi.object({
  sourceChain: Joi.string().required(),
  destinationChain: Joi.string().required(),
  sourceToken: Joi.string().required(),
  destinationToken: Joi.string().required(),
  sourceAmount: Joi.string().required(),
  destinationAmount: Joi.string().required(),
  timeout: Joi.number().integer().min(Date.now()).required(),
  auctionDuration: Joi.number().integer().min(30000).max(300000).optional(),
  initialRateBump: Joi.number().integer().min(0).max(10000).optional(),
  signature: Joi.string().required(),
  nonce: Joi.string().required(),
});

// SDK CrossChainOrder validation schema
const sdkCrossChainOrderSchema = Joi.object({
  inner: Joi.object({
    settlementExtensionContract: Joi.object({
      val: Joi.string().required(),
    }).required(),
    inner: Joi.object({
      extension: Joi.any(),
      makerAsset: Joi.object({ val: Joi.string().required() }).required(),
      takerAsset: Joi.object({ val: Joi.string().required() }).required(),
      makingAmount: Joi.alternatives()
        .try(Joi.string(), Joi.number())
        .required(),
      takingAmount: Joi.alternatives()
        .try(Joi.string(), Joi.number())
        .required(),
      _salt: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      maker: Joi.object({ val: Joi.string().required() }).required(),
      receiver: Joi.object({ val: Joi.string().required() }).required(),
      makerTraits: Joi.any(),
    }).required(),
    fusionExtension: Joi.object({
      address: Joi.object({ val: Joi.string().required() }),
      auctionDetails: Joi.object({
        initialRateBump: Joi.number().required(),
        points: Joi.array().default([]),
        duration: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        startTime: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
      }).required(),
      postInteractionData: Joi.any(),
      makerPermit: Joi.any().optional(),
      builder: Joi.any(),
      hashLockInfo: Joi.any().required(),
      dstChainId: Joi.number().required(),
      dstToken: Joi.object({ val: Joi.string().required() }).required(),
      srcSafetyDeposit: Joi.alternatives()
        .try(Joi.string(), Joi.number())
        .required(),
      dstSafetyDeposit: Joi.alternatives()
        .try(Joi.string(), Joi.number())
        .required(),
      timeLocks: Joi.object({
        srcWithdrawal: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
        srcPublicWithdrawal: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
        srcCancellation: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
        srcPublicCancellation: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
        dstWithdrawal: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
        dstPublicWithdrawal: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
        dstCancellation: Joi.alternatives()
          .try(Joi.string(), Joi.number())
          .required(),
      }).required(),
    }).required(),
    escrowExtension: Joi.object().optional(), // Same as fusionExtension, marked optional
  }).required(),
});

const resolverBidSchema = Joi.object({
  orderHash: Joi.string().hex().length(64).required(),
  resolver: Joi.string().required(),
  estimatedGas: Joi.number().integer().min(0).required(),
  signature: Joi.string().required(),
});

const secretRevealSchema = Joi.object({
  orderHash: Joi.string().hex().length(64).required(),
  secret: Joi.string().required(),
  proof: Joi.string().required(),
  signature: Joi.string().required(),
});

const resolverRegistrationSchema = Joi.object({
  address: Joi.string().required(),
  isKyc: Joi.boolean().required(),
  reputation: Joi.number().min(0).max(100).required(),
  completedOrders: Joi.number().integer().min(0).required(),
  lastActivity: Joi.number().integer().required(),
});

export function createRelayerRoutes(
  relayerService: RelayerService,
  logger: Logger
): Router {
  const router = Router();

  // Helper function to create API responses
  const createResponse = <T>(
    success: boolean,
    data?: T,
    error?: string
  ): ApiResponse<T> => {
    const response: ApiResponse<T> = {
      success,
      timestamp: Date.now(),
    };
    if (data !== undefined) {
      response.data = data;
    }
    if (error !== undefined) {
      response.error = error;
    }
    return response;
  };

  // Helper function to handle async route errors
  const asyncHandler =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
    (req: Request, res: Response, next: NextFunction) => {
      return Promise.resolve(fn(req, res, next)).catch(next);
    };

  // Helper function to validate request body
  const validateBody =
    (schema: Joi.Schema) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const { error, value } = schema.validate(req.body);
      if (error) {
        res
          .status(400)
          .json(createResponse(false, undefined, error.details[0].message));
        return;
      }
      req.body = value;
      next();
    };

  // Root endpoint with comprehensive API documentation
  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const apiDocumentation = {
        service: "1Prime Relayer Service",
        version: "1.0.0",
        description:
          "1inch Fusion+ compatible relayer for EVM ↔ NEAR cross-chain atomic swaps",
        documentation: "https://github.com/your-org/1prime",
        whitepaper: "https://1inch.io/assets/1inch-fusion-plus.pdf",
        timestamp: Date.now(),
        status: "active",

        // WebSocket support
        websocket: {
          enabled: true,
          endpoint: "/ws",
          events: [
            "order_updates",
            "auction_progress",
            "partial_fills",
            "gas_adjustments",
          ],
        },

        // Complete API endpoints
        endpoints: {
          // Health & Status
          "GET /health": {
            description: "Get relayer health status and chain connectivity",
            body: null,
            response: "System health information",
          },

          "GET /": {
            description: "Get API documentation and available endpoints",
            body: null,
            response: "This documentation",
          },

          // Order Management
          "POST /orders": {
            description:
              "Create new cross-chain swap order (supports legacy and SDK formats)",
            headers: {
              "Content-Type": "application/json",
              "x-maker-address": "0x... (for legacy format)",
            },
            body: {
              legacy: {
                sourceChain: "ethereum | base | bsc | polygon | arbitrum",
                destinationChain:
                  "near | ethereum | base | bsc | polygon | arbitrum",
                sourceToken: "Token symbol or address",
                destinationToken: "Token symbol or address",
                sourceAmount: "Amount in wei/smallest unit",
                destinationAmount: "Amount in wei/smallest unit",
                timeout: "Unix timestamp",
                signature: "0x...",
                nonce: "Unique nonce",
              },
              sdk: {
                sdkOrder: "SDK CrossChainOrder object with nested structure",
                signature: "0x...",
              },
            },
            response: "Order status with orderHash",
          },

          "GET /orders/{orderHash}": {
            description: "Get order status and details",
            body: null,
            response: "Complete order information and current phase",
          },

          // Resolver Operations
          "POST /resolvers": {
            description: "Register new resolver for order execution",
            body: {
              address: "0x...",
              isKyc: "boolean",
              bondAmount: "Amount in wei",
              tier: "1-5 (resolver tier)",
              reputation: "0-100 (reputation score)",
            },
            response: "Registration confirmation",
          },

          "POST /bids": {
            description: "Submit resolver bid for order execution",
            body: {
              orderHash: "0x...",
              resolver: "0x...",
              estimatedGas: "Gas estimate for execution",
              signature: "0x...",
            },
            response: "Bid acceptance status",
          },

          // Secret Management
          "POST /secrets/reveal": {
            description: "Request secret revelation for order completion",
            body: {
              orderHash: "0x...",
              secret: "Secret value for HTLC unlock",
              proof: "Proof of escrow creation",
              signature: "0x...",
            },
            response: "Secret revelation status",
          },

          // Partial Fills (Whitepaper Section 2.5)
          "POST /partial-fills": {
            description: "Submit partial fill for order (Merkle tree based)",
            body: {
              orderHash: "0x...",
              resolver: "0x...",
              fillAmount: "Amount to fill in wei",
              proposedSecretIndex: "Secret index for this fill",
              signature: "0x...",
            },
            response: "Partial fill status and secret index",
          },

          "GET /partial-fills/{orderHash}": {
            description: "Get partial fill status and remaining capacity",
            body: null,
            response: "Complete partial fill state and history",
          },

          // Gas & Auction Monitoring
          "GET /gas-summary": {
            description: "Get current gas conditions and adjustment statistics",
            body: null,
            response: "Gas price data and adjustment history",
          },

          "GET /auction-stats": {
            description: "Get Dutch auction performance metrics",
            body: null,
            response: "Auction statistics and curve performance",
          },

          "GET /resolver-stats": {
            description: "Get resolver performance and competition data",
            body: null,
            response: "Resolver metrics and success rates",
          },
        },

        // Feature capabilities
        features: {
          "Dutch Auctions":
            "Competitive bidding with gas-adjusted custom curves (Section 2.3.4)",
          "Partial Fills": "N+1 Merkle tree secret management (Section 2.5)",
          "Gas Adjustments":
            "Dynamic rate modifications based on network conditions",
          "Per-Swap HTLCs": "Dynamic contract deployment for each swap",
          "Cross-Chain": "EVM ↔ NEAR bidirectional atomic swaps",
          "SDK Integration": "Native support for 1inch Fusion+ SDK orders",
          "Real-time Updates": "WebSocket support for live order tracking",
        },

        // Supported chains
        supportedChains: {
          evm: ["ethereum", "base", "bsc", "polygon", "arbitrum"],
          near: ["near", "near-testnet"],
        },

        // Examples
        examples: {
          "Create Simple Order": {
            method: "POST",
            url: "/orders",
            headers: {
              "x-maker-address": "0x742d35Cc6634C0532925a3b8D2269055Ea10b4e6",
            },
            body: {
              sourceChain: "ethereum",
              destinationChain: "near",
              sourceToken: "USDC",
              destinationToken: "NEAR",
              sourceAmount: "1000000",
              destinationAmount: "100000000000000000000000000",
              timeout: Date.now() + 3600000,
              signature: "0x...",
              nonce: "unique-12345",
            },
          },

          "Create SDK Order with Partial Fills": {
            method: "POST",
            url: "/orders",
            body: {
              sdkOrder: {
                orderInfo: { srcChainId: "1", dstChainId: "near" },
                auctionDetails: {
                  points: [
                    { delay: 0, coefficient: 1.0 },
                    { delay: 60, coefficient: 0.5 },
                  ],
                },
                settlementInfo: {
                  hashLock: {
                    merkleRoot: "0x...",
                    merkleLeaves: ["0x...", "0x...", "0x..."],
                  },
                },
              },
              signature: "0x...",
            },
          },

          "Submit Partial Fill": {
            method: "POST",
            url: "/partial-fills",
            body: {
              orderHash: "0x...",
              resolver: "0x...",
              fillAmount: "250000",
              proposedSecretIndex: 1,
              signature: "0x...",
            },
          },
        },
      };

      return res.json(createResponse(true, apiDocumentation));
    })
  );

  // Health check endpoint
  router.get(
    "/health",
    asyncHandler(async (req: Request, res: Response) => {
      const health = await relayerService.getHealthStatus();
      const statusCode = health.status === "healthy" ? 200 : 503;
      res
        .status(statusCode)
        .json(createResponse(health.status === "healthy", health));
    })
  );

  // Create a new fusion order (supports both legacy and SDK formats)
  router.post(
    "/orders",
    asyncHandler(async (req: Request, res: Response) => {
      // Determine if this is a legacy request or SDK format
      const isSDKFormat = req.body.sdkOrder && req.body.signature;

      // Validate based on format
      if (isSDKFormat) {
        const { error, value } = Joi.object({
          sdkOrder: sdkCrossChainOrderSchema.required(),
          signature: Joi.string().required(),
          sourceChain: Joi.string().required(),
          destinationChain: Joi.string().required(),
          orderHash: Joi.string().optional(), // Generated if not provided
        }).validate(req.body);

        if (error) {
          return res
            .status(400)
            .json(
              createResponse(
                false,
                undefined,
                `SDK validation error: ${error.details[0].message}`
              )
            );
        }
        req.body = value;
      } else {
        // Legacy validation
        const { error, value } = createOrderSchema.validate(req.body);
        if (error) {
          return res
            .status(400)
            .json(
              createResponse(
                false,
                undefined,
                `Legacy validation error: ${error.details[0].message}`
              )
            );
        }
        req.body = value;
      }

      const maker = req.headers["x-maker-address"] as string;
      if (!maker) {
        return res
          .status(400)
          .json(
            createResponse(false, undefined, "Missing x-maker-address header")
          );
      }

      try {
        if (isSDKFormat) {
          // Handle SDK CrossChainOrder format
          const {
            sdkOrder,
            signature,
            sourceChain,
            destinationChain,
            orderHash,
          } = req.body;

          // Generate order hash if not provided
          const finalOrderHash =
            orderHash ||
            `0x${Math.random().toString(16).substring(2).padStart(64, "0")}`;

          // Map SDK order to our FusionOrderExtended format
          const fusionOrder = SDKOrderMapper.mapSDKOrderToFusionOrder(
            sdkOrder as SDKCrossChainOrder,
            signature,
            finalOrderHash,
            sourceChain,
            destinationChain
          );

          logger.info("SDK order mapped successfully", {
            orderHash: finalOrderHash,
            maker: fusionOrder.maker,
            sourceChain,
            destinationChain,
            srcSafetyDeposit: fusionOrder.srcSafetyDeposit,
            dstSafetyDeposit: fusionOrder.dstSafetyDeposit,
            timeLocks: fusionOrder.detailedTimeLocks,
          });

          // Create order using the mapped data
          const orderStatus = await relayerService.createOrderFromSDK(
            fusionOrder
          );

          logger.info("SDK Order created via API", {
            orderHash: orderStatus.orderHash,
            maker: fusionOrder.maker,
            sourceChain: fusionOrder.sourceChain,
            destinationChain: fusionOrder.destinationChain,
          });

          return res.status(201).json(createResponse(true, orderStatus));
        } else {
          // Handle legacy format
          const createOrderRequest: CreateOrderRequest = req.body;

          const orderStatus = await relayerService.createOrder(
            createOrderRequest,
            maker
          );

          logger.info("Legacy Order created via API", {
            orderHash: orderStatus.orderHash,
            maker,
            sourceChain: createOrderRequest.sourceChain,
            destinationChain: createOrderRequest.destinationChain,
          });

          return res.status(201).json(createResponse(true, orderStatus));
        }
      } catch (error) {
        logger.error("API: Failed to create order", {
          error: (error as Error).message,
          maker,
          isSDKFormat,
          request: req.body,
        });
        return res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Get order status
  router.get(
    "/orders/:orderHash",
    asyncHandler(async (req: Request, res: Response) => {
      const { orderHash } = req.params;

      if (!orderHash || !/^[a-fA-F0-9]{64}$/.test(orderHash)) {
        return res
          .status(400)
          .json(createResponse(false, undefined, "Invalid order hash format"));
      }

      try {
        const orderStatus = await relayerService.getOrderStatus(orderHash);

        if (!orderStatus) {
          return res
            .status(404)
            .json(createResponse(false, undefined, "Order not found"));
        }

        return res.json(createResponse(true, orderStatus));
      } catch (error) {
        logger.error("API: Failed to get order status", {
          error: (error as Error).message,
          orderHash,
        });
        return res
          .status(500)
          .json(createResponse(false, undefined, "Internal server error"));
      }
    })
  );

  // Get all active orders
  router.get(
    "/orders",
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const activeOrders = await relayerService.getActiveOrders();
        res.json(createResponse(true, activeOrders));
      } catch (error) {
        logger.error("API: Failed to get active orders", {
          error: (error as Error).message,
        });
        res
          .status(500)
          .json(createResponse(false, undefined, "Internal server error"));
      }
    })
  );

  // Submit resolver bid
  router.post(
    "/bids",
    validateBody(resolverBidSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bid: ResolverBidRequest = req.body;

      try {
        const bidAccepted = await relayerService.submitResolverBid(bid);

        logger.info("Resolver bid submitted via API", {
          orderHash: bid.orderHash,
          resolver: bid.resolver,
          accepted: bidAccepted,
        });

        res.json(createResponse(true, { accepted: bidAccepted }));
      } catch (error) {
        logger.error("API: Failed to submit resolver bid", {
          error: (error as Error).message,
          bid,
        });
        res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Request secret reveal
  router.post(
    "/secrets/reveal",
    validateBody(secretRevealSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const request: SecretRevealRequest = req.body;

      try {
        const secret = await relayerService.requestSecretReveal(request);

        if (secret) {
          logger.info("Secret revealed via API", {
            orderHash: request.orderHash,
          });
          res.json(createResponse(true, { secret }));
        } else {
          res
            .status(403)
            .json(
              createResponse(
                false,
                undefined,
                "Secret reveal conditions not met"
              )
            );
        }
      } catch (error) {
        logger.error("API: Failed to reveal secret", {
          error: (error as Error).message,
          orderHash: request.orderHash,
        });
        res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Register resolver
  router.post(
    "/resolvers",
    validateBody(resolverRegistrationSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const resolver: RelayerStatus = req.body;

      try {
        await relayerService.registerResolver(resolver);

        logger.info("Resolver registered via API", {
          address: resolver.address,
          reputation: resolver.reputation,
        });

        res.status(201).json(
          createResponse(true, {
            message: "Resolver registered successfully",
          })
        );
      } catch (error) {
        logger.error("API: Failed to register resolver", {
          error: (error as Error).message,
          resolver: resolver.address,
        });
        res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Get auction information
  router.get(
    "/auctions/:orderHash",
    asyncHandler(async (req: Request, res: Response) => {
      const { orderHash } = req.params;

      if (!orderHash || !/^[a-fA-F0-9]{64}$/.test(orderHash)) {
        return res
          .status(400)
          .json(createResponse(false, undefined, "Invalid order hash format"));
      }

      try {
        const orderStatus = await relayerService.getOrderStatus(orderHash);

        if (!orderStatus || !orderStatus.auction) {
          return res
            .status(404)
            .json(createResponse(false, undefined, "Auction not found"));
        }

        return res.json(createResponse(true, orderStatus.auction));
      } catch (error) {
        logger.error("API: Failed to get auction info", {
          error: (error as Error).message,
          orderHash,
        });
        return res
          .status(500)
          .json(createResponse(false, undefined, "Internal server error"));
      }
    })
  );

  // Get system statistics
  router.get(
    "/stats",
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const health = await relayerService.getHealthStatus();
        const activeOrders = await relayerService.getActiveOrders();

        const stats = {
          activeOrders: activeOrders.length,
          completedOrders: health.completedOrders,
          errorRate: health.errorRate,
          uptime: Date.now() - health.timestamp,
          chainStatus: health.chains,
          version: health.version,
        };

        res.json(createResponse(true, stats));
      } catch (error) {
        logger.error("API: Failed to get stats", {
          error: (error as Error).message,
        });
        res
          .status(500)
          .json(createResponse(false, undefined, "Internal server error"));
      }
    })
  );

  // Partial fill endpoints
  router.post(
    "/partial-fills",
    asyncHandler(async (req: Request, res: Response) => {
      // This would integrate with PartialFillManager
      return res.json(
        createResponse(
          false,
          undefined,
          "Partial fill endpoint not yet implemented - requires PartialFillManager integration"
        )
      );
    })
  );

  router.get(
    "/partial-fills/:orderHash",
    asyncHandler(async (req: Request, res: Response) => {
      // This would integrate with PartialFillManager
      return res.json(
        createResponse(
          false,
          undefined,
          "Partial fill status endpoint not yet implemented - requires PartialFillManager integration"
        )
      );
    })
  );

  // Gas and auction monitoring endpoints
  router.get(
    "/gas-summary",
    asyncHandler(async (req: Request, res: Response) => {
      // This would integrate with CustomCurveManager
      return res.json(
        createResponse(
          false,
          undefined,
          "Gas summary endpoint not yet implemented - requires CustomCurveManager integration"
        )
      );
    })
  );

  router.get(
    "/auction-stats",
    asyncHandler(async (req: Request, res: Response) => {
      // This would integrate with OrderManager auction statistics
      return res.json(
        createResponse(
          false,
          undefined,
          "Auction stats endpoint not yet implemented - requires OrderManager statistics integration"
        )
      );
    })
  );

  // WebSocket endpoint info (enhanced)
  router.get("/ws-info", (req: Request, res: Response) => {
    res.json(
      createResponse(true, {
        websocket: {
          enabled: true,
          endpoint: "/ws",
          port: process.env.WS_PORT || 3001,
          reconnectInterval: 5000,
        },
        supportedEvents: [
          "order_created",
          "auction_started",
          "auction_progress",
          "gas_adjustment",
          "partial_fill",
          "auction_won",
          "secret_revealed",
          "order_completed",
          "order_cancelled",
          "phase_transition",
        ],
        usage: {
          connection: "ws://localhost:3001/ws",
          authentication: "No authentication required",
          messageFormat: "JSON with event type and data",
        },
      })
    );
  });

  // Error handling middleware
  router.use((error: Error, req: Request, res: Response, next: Function) => {
    logger.error("API Error", {
      error: error.message,
      path: req.path,
      method: req.method,
      body: req.body,
    });

    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json(createResponse(false, undefined, error.message));
    }

    return res
      .status(500)
      .json(createResponse(false, undefined, "Internal server error"));
  });

  return router;
}
