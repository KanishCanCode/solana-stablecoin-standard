/**
 * Request correlation — attaches a unique `requestId` to every request.
 *
 * The ID is taken from the `X-Request-ID` header if provided by a load
 * balancer, or generated as a compact timestamp+random string.
 *
 * All downstream logs will include `req.id` automatically via Fastify's
 * built-in Pino integration.
 */

import { FastifyInstance } from "fastify";
import { randomBytes }     from "crypto";

export async function requestIdPlugin(app: FastifyInstance) {
  app.addHook("onRequest", (req, _reply, done) => {
    const existing = req.headers["x-request-id"];
    if (existing && typeof existing === "string") {
      // Sanitise — only allow alphanumeric + hyphens, max 64 chars.
      req.id = existing.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || generateId();
    } else {
      req.id = generateId();
    }
    done();
  });

  // Echo the request ID in every response so clients can correlate.
  app.addHook("onSend", (_req, reply, _payload, done) => {
    reply.header("X-Request-ID", _req.id);
    done();
  });
}

function generateId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}
