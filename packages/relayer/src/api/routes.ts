import { Router, Request, Response, NextFunction } from "express";
import Joi from "joi";
import type { Logger } from "winston";
import * as fs from "fs";
import * as path from "path";
import { RelayerService } from "../services/relayer";
import {
  ApiResponse,
  SecretRevealRequest,
  RelayerStatus,
  SDKCrossChainOrder,
  GenerateOrderRequest,
  SubmitSignedOrderRequest,
  ClaimOrderRequest,
  EscrowDeploymentConfirmation,
} from "../types";
import { SDKOrderMapper } from "../utils/sdk-mapper";

// Helper function to serialize BigInt values to strings for JSON
const serializeForJson = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeForJson);
  }

  if (typeof obj === "object") {
    const serialized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeForJson(value);
    }
    return serialized;
  }

  return obj;
};

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
  orderHash: Joi.string().required(),
  signature: Joi.string().required(),
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

  // Root endpoint with API overview
  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const apiOverview = {
        service: "1Prime Relayer Service",
        version: "1.0.0",
        description:
          "1inch Fusion+ compatible relayer for EVM ↔ NEAR cross-chain atomic swaps",
        timestamp: Date.now(),
        status: "active",

        // Available endpoints
        endpoints: [
          "GET /openapi",
          "POST /orders/prepare",
          "POST /orders/submit",
          "GET /orders",
          "GET /orders/{hash}/status",
          "POST /orders/{hash}/claim",
          "POST /orders/{hash}/escrow-deployed",
          "GET /orders/{hash}/verify-escrows",
          "POST /orders/{hash}/reveal-secret",
          "GET /ws-info",
        ],

        // Supported chains
        supportedChains: {
          evm: ["ethereum", "base", "bsc", "polygon", "arbitrum"],
          near: ["near", "near-testnet"],
        },
      };

      return res.json(createResponse(true, apiOverview));
    })
  );

  // OpenAPI specification endpoint
  router.get(
    "/openapi",
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const openApiPath = path.join(__dirname, "../../openapi.yaml");
        const openApiContent = fs.readFileSync(openApiPath, "utf8");

        res.setHeader("Content-Type", "application/x-yaml");
        res.send(openApiContent);
      } catch (error) {
        logger.error("Failed to serve OpenAPI specification", {
          error: (error as Error).message,
        });
        res
          .status(500)
          .json(
            createResponse(
              false,
              undefined,
              "Failed to load OpenAPI specification"
            )
          );
      }
    })
  );

  // Prepare unsigned order for frontend signing (Steps 3+4+5)
  router.post(
    "/orders/prepare",
    validateBody(generateOrderSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const generateOrderRequest: GenerateOrderRequest = req.body;

      try {
        const result =
          await relayerService.createFusionOrder(generateOrderRequest);

        logger.info("Order details generated via API", {
          orderHash: result.orderHash,
          userAddress: generateOrderRequest.userAddress,
          fromChain: generateOrderRequest.fromChain,
          toChain: generateOrderRequest.toChain,
        });

        return res.status(200).json(
          createResponse(true, {
            orderHash: result.orderHash,
            success: result.success,
            message: result.message,
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

  // Submit signed order
  router.post(
    "/orders/submit",
    validateBody(submitSignedOrderSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const submitRequest: SubmitSignedOrderRequest = req.body;

      try {
        // Submit signed order - only orderHash + signature needed
        console.log("submitRequest", submitRequest.orderHash);
        console.log("submitRequest", submitRequest.signature);
        const orderStatus = await relayerService.submitSignedOrder(
          submitRequest.orderHash,
          submitRequest.signature
        );

        logger.info("Signed order submitted via API", {
          orderHash: submitRequest.orderHash,
        });

        return res
          .status(201)
          .json(createResponse(true, serializeForJson(orderStatus)));
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

        return res.json(createResponse(true, serializeForJson(orderStatus)));
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

  router.get(
    "/orders",
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const activeOrders = await relayerService.getActiveOrders();
        res.json(createResponse(true, serializeForJson(activeOrders)));
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

  // Verify escrows safety
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

  // Request secret reveal
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

  // Claim order
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

  // Confirm escrow deployment
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
