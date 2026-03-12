/**
 * Auth plugin + routes.
 *
 * POST /v1/auth/token  — issue a JWT for an API key
 * Decorator `app.authenticate` — guard any route handler
 *
 * API keys are stored as bcrypt hashes in the `SssApiKey` table.
 * A key looks like:  `sss_live_<base58(32 random bytes)>`
 */

import { FastifyInstance }  from "fastify";
import { z }                from "zod";
import { PrismaClient }     from "@prisma/client";
import { createHash }       from "crypto";
import pino                 from "pino";

const log = pino({ name: "auth" });

const TokenBody = z.object({
  apiKey: z.string().min(10),
});

export async function authPlugin(app: FastifyInstance, { prisma }: { prisma: PrismaClient }) {

  // ── Authenticate decorator ────────────────────────────────────────────────
  app.decorate("authenticate", async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }
  });

  // ── POST /v1/auth/token ───────────────────────────────────────────────────
  app.post<{ Body: unknown }>("/v1/auth/token", async (req, reply) => {
    const { apiKey } = TokenBody.parse(req.body);

    // Constant-time key lookup via SHA-256 hash (not bcrypt — keys are random
    // enough that hashing is sufficient and avoids async bcrypt latency).
    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const record  = await prisma.sssApiKey.findUnique({ where: { keyHash } });

    if (!record || !record.active) {
      // Uniform 401 — don't reveal whether key exists.
      log.warn({ keyHash: keyHash.slice(0, 8) + "…" }, "Failed auth attempt");
      return reply.status(401).send({ error: "Invalid API key", code: "UNAUTHORIZED" });
    }

    // Update last-used timestamp (fire and forget — don't block the response).
    prisma.sssApiKey.update({
      where: { id: record.id },
      data:  { lastUsedAt: new Date() },
    }).catch(err => log.error({ err }, "Failed to update lastUsedAt"));

    const token = app.jwt.sign(
      { sub: record.id, name: record.name, scope: record.scope },
      { expiresIn: "24h" }
    );

    log.info({ keyName: record.name }, "JWT issued");

    return reply.send({
      token,
      expiresIn: 86_400,
      tokenType: "Bearer",
    });
  });
}
