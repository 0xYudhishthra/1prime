import { Router, Request, Response, NextFunction } from "express";
import Joi from "joi";
import type { Logger } from "winston";
import { RelayerService } from "../services/relayer";
import {
  ApiResponse,
  ResolverBidRequest,
  SecretRevealRequest,
  RelayerStatus,
  SDKCrossChainOrder,
  GenerateOrderRequest,
  SubmitSignedOrderRequest,
  ClaimOrderRequest,
  EscrowDeploymentConfirmation,
} from "../types";
import { SDKOrderMapper } from "../utils/sdk-mapper";

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
  secret: Joi.string().required(),
  proof: Joi.string().required(),
  signature: Joi.string().required(),
});

const generateOrderSchema = Joi.object({
  userAddress: Joi.string().required(),
  amount: Joi.string().required(),
  fromToken: Joi.string().required(),
  toToken: Joi.string().required(),
  fromChain: Joi.string().required(),
  toChain: Joi.string().required(),
  secretHash: Joi.string().required(),
});

const submitSignedOrderSchema = Joi.object({
  orderHash: Joi.string().hex().length(64).required(),
  signedOrder: Joi.object().required(), // SDK CrossChainOrder - flexible validation
  signature: Joi.string().required(),
});

const updateOrderStateSchema = Joi.object({
  newState: Joi.string().required(),
  resolverAddress: Joi.string().required(),
});

const claimOrderSchema = Joi.object({
  resolverAddress: Joi.string().required(),
  estimatedGas: Joi.number().integer().min(0).required(),
  signature: Joi.string().required(),
});

const escrowDeploymentSchema = Joi.object({
  escrowType: Joi.string().valid("src", "dst").required(),
  escrowAddress: Joi.string().required(),
  transactionHash: Joi.string().required(),
  blockNumber: Joi.number().integer().min(0).required(),
  resolverAddress: Joi.string().required(),
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
            "order_created",
            "order_updates",
            "auction_started",
            "auction_progress",
            "phase_transition",
            "secret_revealed",
            "order_completed",
            "order_cancelled",
          ],
        },

        // Complete API endpoints
        endpoints: {
          // Health & Documentation
          "GET /": {
            description: "Get API documentation and available endpoints",
            body: null,
            response: "This documentation",
          },

          "GET /health": {
            description: "Get relayer health status and chain connectivity",
            body: null,
            response: "System health information",
          },

          // Order Management (New Flow)
          "POST /orders/prepare": {
            description:
              "Generate unsigned Fusion+ order for frontend signing (Steps 3+4+5)",
            body: {
              userAddress: "0x... (maker address)",
              amount: "Amount in wei/smallest unit",
              fromToken: "Source token address or symbol",
              toToken: "Destination token address or symbol",
              fromChain: "ethereum | base | bsc | polygon | arbitrum",
              toChain: "near | ethereum | base | bsc | polygon | arbitrum",
              secretHash: "Previously generated secret hash from frontend",
            },
            response: "Unsigned Fusion+ order and orderHash for signing",
          },

          "POST /orders/submit": {
            description: "Submit signed Fusion+ order to relayer (Step 6)",
            body: {
              orderHash: "0x... (from /orders/prepare response)",
              signedOrder: "Signed SDK CrossChainOrder from frontend",
              signature: "0x... (user wallet signature)",
            },
            response: "Order status and relayer processing confirmation",
          },

          "GET /orders": {
            description: "Get all currently active orders",
            body: null,
            response: "List of active orders with basic status information",
          },

          "GET /orders/{hash}/status": {
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

          "POST /orders/{hash}/state": {
            description: "Update order state (Step 9 - for resolvers only)",
            body: {
              newState: "waiting-for-secret | completed | failed",
              resolverAddress: "0x... (resolver address)",
            },
            response: "State update confirmation",
          },

          "POST /orders/{hash}/claim": {
            description: "Claim order for resolver processing (Step 7)",
            body: {
              resolverAddress: "0x... (resolver address)",
              estimatedGas: "Gas estimate for execution",
              signature: "0x... (resolver signature)",
            },
            response: "Order claim confirmation",
          },

          "POST /orders/{hash}/escrow-deployed": {
            description: "Confirm escrow deployment (Step 7.1 & 9.1)",
            body: {
              escrowType: "src | dst",
              escrowAddress: "0x... (deployed escrow contract address)",
              transactionHash: "0x... (deployment transaction hash)",
              blockNumber: "Block number of deployment",
              resolverAddress: "0x... (resolver address)",
              signature: "0x... (resolver signature)",
            },
            response: "Escrow deployment confirmation",
          },

          // Secret Management & Security
          "GET /orders/{hash}/verify-escrows": {
            description:
              "Verify escrows are safe for secret revelation (Pre-Step 11)",
            body: null,
            response: {
              safe: "boolean - whether it's safe to reveal secret",
              verification: "Detailed escrow verification results",
              srcEscrowVerified: "boolean - source escrow verification status",
              dstEscrowVerified:
                "boolean - destination escrow verification status",
              issues: "array - any security issues found",
            },
          },

          "POST /orders/{hash}/reveal-secret": {
            description:
              "Request secret revelation for order completion (Step 11)",
            body: {
              secret: "Secret value for HTLC unlock",
              proof: "Proof of escrow creation",
              signature: "0x...",
            },
            response: "Secret revelation status",
          },

          // System Statistics
          "GET /stats": {
            description: "Get system statistics and performance metrics",
            body: null,
            response: "System health, order counts, and performance data",
          },

          "GET /auctions/{orderHash}": {
            description: "Get auction information for specific order",
            body: null,
            response: "Detailed auction state and bidding information",
          },

          // WebSocket Support
          "GET /ws-info": {
            description:
              "Get WebSocket connection details and supported events",
            body: null,
            response: "WebSocket configuration and event types",
          },
        },

        // Feature capabilities
        features: {
          "Dutch Auctions": "Competitive bidding with resolver selection",
          "Per-Swap HTLCs": "Dynamic escrow contract deployment for each swap",
          "Cross-Chain": "EVM ↔ NEAR bidirectional atomic swaps",
          "SDK Integration": "Native support for 1inch Fusion+ SDK orders",
          "Real-time Updates": "WebSocket support for live order tracking",
          "Security Verification":
            "Independent on-chain escrow verification before secret reveal",
          "State Management":
            "Complete order lifecycle tracking with phase transitions",
        },

        // Supported chains
        supportedChains: {
          evm: ["ethereum", "base", "bsc", "polygon", "arbitrum"],
          near: ["near", "near-testnet"],
        },

        // Examples
        examples: {
          "Create SDK Order with Partial Fills": {
            method: "POST",
            url: "/orders",
            headers: {
              "x-maker-address": "0x742d35Cc6634C0532925a3b8D2269055Ea10b4e6",
            },
            body: {
              sdkOrder: {
                inner: {
                  settlementExtensionContract: { val: "0x..." },
                  inner: {
                    makerAsset: { val: "0x..." },
                    takerAsset: { val: "0x..." },
                    makingAmount: "1000000",
                    takingAmount: "100000000000000000000000000",
                    maker: {
                      val: "0x742d35Cc6634C0532925a3b8D2269055Ea10b4e6",
                    },
                    receiver: {
                      val: "0x742d35Cc6634C0532925a3b8D2269055Ea10b4e6",
                    },
                  },
                  fusionExtension: {
                    auctionDetails: {
                      initialRateBump: 1000,
                      points: [
                        { delay: 0, coefficient: 1.0 },
                        { delay: 60, coefficient: 0.5 },
                      ],
                      duration: 120000,
                      startTime: Date.now(),
                    },
                    hashLockInfo: {
                      merkleRoot: "0x...",
                      merkleLeaves: ["0x...", "0x...", "0x..."],
                    },
                    dstChainId: 397,
                    dstToken: { val: "near" },
                    srcSafetyDeposit: "50000",
                    dstSafetyDeposit: "50000",
                    timeLocks: {
                      srcWithdrawal: 300,
                      srcPublicWithdrawal: 600,
                      srcCancellation: 1800,
                      srcPublicCancellation: 3600,
                      dstWithdrawal: 300,
                      dstPublicWithdrawal: 600,
                      dstCancellation: 1800,
                    },
                  },
                },
              },
              signature: "0x...",
              sourceChain: "ethereum",
              destinationChain: "near",
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

  // Prepare unsigned order for frontend signing (Steps 3+4+5)
  router.post(
    "/orders/prepare",
    validateBody(generateOrderSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const generateOrderRequest: GenerateOrderRequest = req.body;

      try {
        // Create unsigned Fusion+ order internally
        const { orderHash, fusionOrder } =
          await relayerService.createFusionOrder(generateOrderRequest);

        logger.info("Order details generated via API", {
          orderHash,
          userAddress: generateOrderRequest.userAddress,
          fromChain: generateOrderRequest.fromChain,
          toChain: generateOrderRequest.toChain,
        });

        return res.status(200).json(
          createResponse(true, {
            orderHash,
            fusionOrder, // Unsigned SDK CrossChainOrder for frontend signing
            orderDetails: {
              amount: generateOrderRequest.amount,
              fromToken: generateOrderRequest.fromToken,
              toToken: generateOrderRequest.toToken,
              fromChain: generateOrderRequest.fromChain,
              toChain: generateOrderRequest.toChain,
              secretHash: generateOrderRequest.secretHash,
            },
          })
        );
      } catch (error) {
        logger.error("API: Failed to generate order details", {
          error: (error as Error).message,
          request: generateOrderRequest,
        });
        return res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Submit signed order (Step 6)
  router.post(
    "/orders/submit",
    validateBody(submitSignedOrderSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const submitRequest: SubmitSignedOrderRequest = req.body;

      try {
        // Validate the signed order
        const isValid = await relayerService.validateSignedOrder(
          submitRequest.orderHash,
          submitRequest.signedOrder,
          submitRequest.signature
        );

        if (!isValid) {
          return res
            .status(400)
            .json(
              createResponse(false, undefined, "Invalid signature or order")
            );
        }

        // Submit signed order and start relayer processing
        const orderStatus = await relayerService.submitSignedOrder(
          submitRequest.orderHash,
          submitRequest.signedOrder,
          submitRequest.signature
        );

        logger.info("Signed order submitted via API", {
          orderHash: submitRequest.orderHash,
          maker: submitRequest.signedOrder.inner.inner.maker.val,
        });

        return res.status(201).json(createResponse(true, orderStatus));
      } catch (error) {
        logger.error("API: Failed to submit signed order", {
          error: (error as Error).message,
          orderHash: submitRequest.orderHash,
        });
        return res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Get order status
  router.get(
    "/orders/:hash/status",
    asyncHandler(async (req: Request, res: Response) => {
      const { hash } = req.params;
      const orderHash = hash;

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

  // Verify escrows are safe for secret revelation (Pre-Step 11)
  router.get(
    "/orders/:hash/verify-escrows",
    asyncHandler(async (req: Request, res: Response) => {
      const { hash } = req.params;

      // Validate order hash format
      if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
        return res
          .status(400)
          .json(createResponse(false, undefined, "Invalid order hash format"));
      }

      try {
        const verificationResult =
          await relayerService.verifyEscrowSafety(hash);

        if (verificationResult.safe) {
          logger.info("Escrows verified safe for secret revelation", {
            orderHash: hash,
            srcEscrowVerified: verificationResult.srcEscrowVerified,
            dstEscrowVerified: verificationResult.dstEscrowVerified,
          });

          return res.json(
            createResponse(true, {
              safe: true,
              orderHash: hash,
              verification: verificationResult,
              message: "Safe to reveal secret",
            })
          );
        } else {
          return res.json(
            createResponse(false, {
              safe: false,
              orderHash: hash,
              verification: verificationResult,
              message: "NOT safe to reveal secret",
            })
          );
        }
      } catch (error) {
        logger.error("API: Failed to verify escrow safety", {
          error: (error as Error).message,
          orderHash: hash,
        });
        return res
          .status(500)
          .json(
            createResponse(false, undefined, "Failed to verify escrow safety")
          );
      }
    })
  );

  // Request secret reveal (Step 11)
  router.post(
    "/orders/:hash/reveal-secret",
    validateBody(secretRevealSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { hash } = req.params;
      const request: SecretRevealRequest = {
        orderHash: hash,
        ...req.body,
      };

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

  // Update order state (Step 9 - for resolvers)
  router.post(
    "/orders/:hash/state",
    validateBody(updateOrderStateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { hash } = req.params;
      const { newState, resolverAddress } = req.body;

      // Validate order hash format
      if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
        return res
          .status(400)
          .json(createResponse(false, undefined, "Invalid order hash format"));
      }

      try {
        const updated = await relayerService.updateOrderState(
          hash,
          newState,
          resolverAddress
        );

        logger.info("Order state updated via API", {
          orderHash: hash,
          newState,
          resolverAddress,
        });

        return res.json(createResponse(true, { updated, orderHash: hash }));
      } catch (error) {
        logger.error("API: Failed to update order state", {
          error: (error as Error).message,
          orderHash: hash,
          newState,
          resolverAddress,
        });
        return res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Claim order for resolver processing (Step 7)
  router.post(
    "/orders/:hash/claim",
    validateBody(claimOrderSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { hash } = req.params;
      const claimRequest: ClaimOrderRequest = {
        orderHash: hash,
        ...req.body,
      };

      // Validate order hash format
      if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
        return res
          .status(400)
          .json(createResponse(false, undefined, "Invalid order hash format"));
      }

      try {
        const success = await relayerService.claimOrder(claimRequest);

        if (success) {
          logger.info("Order claimed by resolver", {
            orderHash: hash,
            resolverAddress: claimRequest.resolverAddress,
          });

          return res.json(
            createResponse(true, {
              claimed: true,
              orderHash: hash,
              resolverAddress: claimRequest.resolverAddress,
            })
          );
        } else {
          return res
            .status(400)
            .json(createResponse(false, undefined, "Failed to claim order"));
        }
      } catch (error) {
        logger.error("API: Failed to claim order", {
          error: (error as Error).message,
          orderHash: hash,
          resolverAddress: claimRequest.resolverAddress,
        });
        return res
          .status(400)
          .json(createResponse(false, undefined, (error as Error).message));
      }
    })
  );

  // Confirm escrow deployment (Step 7.1 & 9.1)
  router.post(
    "/orders/:hash/escrow-deployed",
    validateBody(escrowDeploymentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { hash } = req.params;
      const confirmation: EscrowDeploymentConfirmation = {
        orderHash: hash,
        ...req.body,
      };

      // Validate order hash format
      if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
        return res
          .status(400)
          .json(createResponse(false, undefined, "Invalid order hash format"));
      }

      try {
        const success =
          await relayerService.confirmEscrowDeployment(confirmation);

        if (success) {
          logger.info("Escrow deployment confirmed", {
            orderHash: hash,
            escrowType: confirmation.escrowType,
            escrowAddress: confirmation.escrowAddress,
            transactionHash: confirmation.transactionHash,
            resolverAddress: confirmation.resolverAddress,
          });

          return res.json(
            createResponse(true, {
              confirmed: true,
              orderHash: hash,
              escrowType: confirmation.escrowType,
              escrowAddress: confirmation.escrowAddress,
            })
          );
        } else {
          return res
            .status(400)
            .json(
              createResponse(
                false,
                undefined,
                "Failed to confirm escrow deployment"
              )
            );
        }
      } catch (error) {
        logger.error("API: Failed to confirm escrow deployment", {
          error: (error as Error).message,
          orderHash: hash,
          escrowType: req.body.escrowType,
          resolverAddress: req.body.resolverAddress,
        });
        return res
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
          "order_updates",
          "auction_started",
          "auction_progress",
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
