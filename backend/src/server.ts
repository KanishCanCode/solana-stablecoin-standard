/**
 * SSS Backend — Fastify application entry point.
 *
 * Production improvements over initial version:
 * - Request correlation IDs (X-Request-ID header round-trip)
 * - Centralised error handler plugin (uniform JSON error shape)
 * - Auth plugin (JWT issue + authenticate decorator)
 * - Graceful shutdown with configurable drain timeout
 * - Fastify request ID propagated through all log lines
 * - Swagger OpenAPI auto-generated and served at /docs
 */

import Fastify          from "fastify";
import cors             from "@fastify/cors";
import helmet           from "@fastify/helmet";
import jwt              from "@fastify/jwt";
import rateLimit        from "@fastify/rate-limit";
import swagger          from "@fastify/swagger";
import swaggerUi        from "@fastify/swagger-ui";
import { PrismaClient } from "@prisma/client";
import { cfg }          from "./config";
import { errorPlugin }  from "./plugins/errors";
import { requestIdPlugin } from "./plugins/requestId";
import { authPlugin }   from "./plugins/auth";
import { coinRoutes }       from "./routes/v1/coins";
import { complianceRoutes } from "./routes/v1/compliance";
import { proposalRoutes }   from "./routes/v1/proposals";
import { SssIndexer }       from "./services/indexer";
import { SssNotifier }      from "./services/notifier";

const prisma = new PrismaClient({
  log: cfg.NODE_ENV === "development"
    ? ["query", "warn", "error"]
    : ["warn", "error"],
  datasources: { db: { url: cfg.DATABASE_URL } },
});

const SHUTDOWN_DRAIN_MS = 10_000;

async function bootstrap() {
  const app = Fastify({
    genReqId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    logger: cfg.NODE_ENV !== "test"
      ? {
          level:     "info",
          transport: cfg.NODE_ENV === "development"
            ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
            : undefined,
        }
      : false,
  });

  // ── Plugins — order matters ───────────────────────────────────────────────
  await app.register(requestIdPlugin);
  await app.register(errorPlugin);

  await app.register(helmet, {
    contentSecurityPolicy: cfg.NODE_ENV === "production",
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: cfg.CORS_ORIGINS || true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max:        200,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.headers["x-real-ip"] as string || req.ip,
    errorResponseBuilder: (_req, context) => ({
      error:     "Too many requests",
      code:      "RATE_LIMITED",
      retryAfter: context.after,
    }),
  });

  await app.register(jwt, { secret: cfg.JWT_SECRET });

  // ── OpenAPI ───────────────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title:       "SSS Issuer API",
        version:     "1.0.0",
        description: "REST API for the Solana Stablecoin Standard",
      },
      servers: [{ url: `http://${cfg.HOST}:${cfg.PORT}`, description: "Local" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      tags: [
        { name: "auth",       description: "Authentication" },
        { name: "coins",      description: "Stablecoin registry" },
        { name: "compliance", description: "Denylist & audit log" },
        { name: "proposals",  description: "SSS-3 multi-sig proposals" },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  // ── Auth plugin (issues JWTs + authenticate decorator) ───────────────────
  await app.register(authPlugin, { prisma });

  // ── Health check (no auth) ────────────────────────────────────────────────
  app.get("/healthz", {
    schema: {
      response: { 200: { type: "object", properties: {
        status:  { type: "string" },
        version: { type: "string" },
        ts:      { type: "string" },
      }}},
    },
  }, async () => ({
    status:  "ok",
    version: "1.0.0",
    ts:      new Date().toISOString(),
  }));

  // ── Business routes ───────────────────────────────────────────────────────
  const opts = { prisma };
  await app.register(async (inst) => coinRoutes(inst, opts));
  await app.register(async (inst) => complianceRoutes(inst, opts));
  await app.register(async (inst) => proposalRoutes(inst, opts));

  // ── Indexer + notifier ────────────────────────────────────────────────────
  const indexer  = new SssIndexer(prisma);
  const _notifier = new SssNotifier(prisma, indexer);   // subscribes to indexer events

  indexer.start().catch(err => app.log.error({ err }, "Indexer crashed — restarting process"));

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, "Shutdown signal received — draining");
    indexer.stop();

    // Give in-flight requests time to complete.
    const drainTimer = setTimeout(() => {
      app.log.warn("Drain timeout exceeded — forcing exit");
      process.exit(1);
    }, SHUTDOWN_DRAIN_MS);

    try {
      await app.close();
      await prisma.$disconnect();
      clearTimeout(drainTimer);
      app.log.info("Clean shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Shutdown error");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    app.log.fatal({ err }, "Uncaught exception — forcing exit");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    app.log.fatal({ reason }, "Unhandled promise rejection — forcing exit");
    process.exit(1);
  });

  // ── Listen ────────────────────────────────────────────────────────────────
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  app.log.info(`✅  SSS API  →  http://${cfg.HOST}:${cfg.PORT}`);
  app.log.info(`📖  Swagger  →  http://${cfg.HOST}:${cfg.PORT}/docs`);
}

bootstrap().catch(err => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
