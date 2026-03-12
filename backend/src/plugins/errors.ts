/**
 * Centralised error handling for Fastify.
 *
 * Maps known error types to HTTP status codes and produces a uniform
 * { error, code, requestId } response shape throughout the API.
 */

import { FastifyInstance, FastifyError } from "fastify";
import { ZodError }                      from "zod";
import { Prisma }                        from "@prisma/client";
import pino                              from "pino";

const log = pino({ name: "errors" });

export async function errorPlugin(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError & { statusCode?: number }, req, reply) => {
    const requestId = req.id;

    // ── Zod validation error ──────────────────────────────────────────────
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error:     "Validation error",
        code:      "VALIDATION_ERROR",
        issues:    err.flatten().fieldErrors,
        requestId,
      });
    }

    // ── Prisma not-found ──────────────────────────────────────────────────
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") {
        return reply.status(404).send({
          error:     "Resource not found",
          code:      "NOT_FOUND",
          requestId,
        });
      }
      if (err.code === "P2002") {
        return reply.status(409).send({
          error:     "Resource already exists",
          code:      "CONFLICT",
          requestId,
        });
      }
      log.error({ err, requestId }, "Prisma error");
      return reply.status(500).send({
        error:     "Database error",
        code:      "DB_ERROR",
        requestId,
      });
    }

    // ── JWT errors ────────────────────────────────────────────────────────
    if (err.statusCode === 401 || err.message?.includes("Unauthorized")) {
      return reply.status(401).send({
        error:     "Unauthorized",
        code:      "UNAUTHORIZED",
        requestId,
      });
    }
    if (err.statusCode === 403) {
      return reply.status(403).send({
        error:     "Forbidden",
        code:      "FORBIDDEN",
        requestId,
      });
    }

    // ── Rate limit ────────────────────────────────────────────────────────
    if (err.statusCode === 429) {
      return reply.status(429).send({
        error:     "Too many requests",
        code:      "RATE_LIMITED",
        requestId,
      });
    }

    // ── Known HTTP errors ─────────────────────────────────────────────────
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error:     err.message,
        code:      "CLIENT_ERROR",
        requestId,
      });
    }

    // ── Unexpected server error ───────────────────────────────────────────
    log.error({ err, requestId, url: req.url }, "Unhandled server error");
    return reply.status(500).send({
      error:     "Internal server error",
      code:      "INTERNAL_ERROR",
      requestId,
    });
  });

  // 404 handler
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error:     `Route ${req.method} ${req.url} not found`,
      code:      "ROUTE_NOT_FOUND",
      requestId: req.id,
    });
  });
}
