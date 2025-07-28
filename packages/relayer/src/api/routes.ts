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
} from "../types";

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

  // Create a new fusion order
  router.post(
    "/orders",
    validateBody(createOrderSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const createOrderRequest: CreateOrderRequest = req.body;
      const maker = req.headers["x-maker-address"] as string;

      if (!maker) {
        return res
          .status(400)
          .json(
            createResponse(false, undefined, "Missing x-maker-address header")
          );
      }

      try {
        const orderStatus = await relayerService.createOrder(
          createOrderRequest,
          maker
        );
        logger.info("Order created via API", {
          orderHash: orderStatus.orderHash,
          maker,
          sourceChain: createOrderRequest.sourceChain,
          destinationChain: createOrderRequest.destinationChain,
        });

        return res.status(201).json(createResponse(true, orderStatus));
      } catch (error) {
        logger.error("API: Failed to create order", {
          error: (error as Error).message,
          maker,
          request: createOrderRequest,
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

  // WebSocket endpoint info (for future implementation)
  router.get("/ws-info", (req: Request, res: Response) => {
    res.json(
      createResponse(true, {
        websocketUrl: "/ws",
        supportedEvents: [
          "order_created",
          "auction_won",
          "secret_revealed",
          "order_completed",
          "order_cancelled",
          "phase_transition",
        ],
        reconnectInterval: 5000,
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
