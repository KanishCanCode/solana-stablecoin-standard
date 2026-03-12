/**
 * GET  /v1/coins          — list all indexed stablecoins
 * GET  /v1/coins/:mint    — get one stablecoin (with minters + recent events)
 * POST /v1/coins/:mint/webhooks — register a webhook
 */

import { FastifyInstance } from "fastify";
import { z }              from "zod";
import { PrismaClient }   from "@prisma/client";

const MintParam   = z.object({ mint: z.string().length(44).or(z.string().length(43)) });
const WebhookBody = z.object({
  url:         z.string().url(),
  secret:      z.string().min(16),
  eventFilter: z.array(z.string()).default([]),
});

export async function coinRoutes(app: FastifyInstance, { prisma }: { prisma: PrismaClient }) {

  // ── List all stablecoins ──────────────────────────────────────────────────
  app.get("/v1/coins", async (req, reply) => {
    const coins = await prisma.sssToken.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        mint: true, authority: true, tier: true,   // `tier` (not preset)
        name: true, symbol: true, decimals: true,
        totalIssued: true, totalBurned: true, totalSeized: true,  // `totalIssued`
        halted: true, createdAt: true,              // `halted` (not paused)
        _count: { select: { minters: true } },
      },
    });
    return reply.send({ data: coins.map(serializeToken) });
  });

  // ── Get one stablecoin ────────────────────────────────────────────────────
  app.get<{ Params: { mint: string } }>("/v1/coins/:mint", async (req, reply) => {
    const { mint } = MintParam.parse(req.params);

    const coin = await prisma.sssToken.findUnique({
      where: { mint },
      include: {
        minters: { where: { enabled: true } },   
        events:  { orderBy: { seq: "desc" }, take: 50 },
      },
    });

    if (!coin) return reply.status(404).send({ error: "Stablecoin not found" });
    return reply.send({ data: serializeTokenFull(coin) });
  });

  // ── Webhook registration ──────────────────────────────────────────────────
  app.post<{ Params: { mint: string }; Body: unknown }>("/v1/coins/:mint/webhooks", {
    config: { requireAuth: true },
  }, async (req, reply) => {
    const { mint }   = MintParam.parse(req.params);
    const body       = WebhookBody.parse(req.body);

    const coin = await prisma.sssToken.findUnique({ where: { mint } });
    if (!coin) return reply.status(404).send({ error: "Stablecoin not found" });

    const hook = await prisma.sssWebhook.create({
      data: { mint, url: body.url, secret: body.secret, eventFilter: body.eventFilter },
    });

    return reply.status(201).send({ data: { id: hook.id, mint, url: hook.url } });
  });
}

// ─── Serialisers ──────────────────────────────────────────────────────────────

function serializeToken(t: any) {
  return {
    ...t,
    totalIssued: t.totalIssued.toString(),   // `totalIssued`
    totalBurned: t.totalBurned.toString(),
    totalSeized: t.totalSeized.toString(),
  };
}

function serializeTokenFull(t: any) {
  return {
    ...serializeToken(t),
    minters: t.minters.map((m: any) => ({
      ...m,
      cap:    m.cap.toString(),
      issued: m.issued.toString(),   
    })),
    events: t.events.map((e: any) => ({
      ...e,
      seq:  e.seq.toString(),
      slot: e.slot.toString(),
    })),
  };
}
