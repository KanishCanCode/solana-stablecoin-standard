/**
 * Compliance routes — denylist queries + audit log.
 *
 * GET  /v1/coins/:mint/denylist           — list denied addresses
 * GET  /v1/coins/:mint/denylist/:address  — check one address
 * GET  /v1/coins/:mint/events             — paginated event log
 */

import { FastifyInstance } from "fastify";
import { z }              from "zod";
import { PrismaClient }   from "@prisma/client";

const MintParam    = z.object({ mint: z.string() });
const AddressParam = z.object({ mint: z.string(), address: z.string() });
const EventQuery   = z.object({
  kind:   z.string().optional(),
  page:   z.coerce.number().default(1),
  limit:  z.coerce.number().min(1).max(200).default(50),
  before: z.coerce.bigint().optional(),
});

export async function complianceRoutes(app: FastifyInstance, { prisma }: { prisma: PrismaClient }) {

  // ── List denied addresses ─────────────────────────────────────────────────
  app.get<{ Params: { mint: string } }>("/v1/coins/:mint/denylist", async (req, reply) => {
    const { mint } = MintParam.parse(req.params);

    const entries = await prisma.sssDenylist.findMany({   
      where:   { mint, removedAt: null },
      orderBy: { addedAt: "desc" },
    });

    return reply.send({ data: entries, count: entries.length });
  });

  // ── Check a single address ────────────────────────────────────────────────
  app.get<{ Params: { mint: string; address: string } }>(
    "/v1/coins/:mint/denylist/:address",
    async (req, reply) => {
      const { mint, address } = AddressParam.parse(req.params);

      const entry = await prisma.sssDenylist.findFirst({  // `sssDenylist`
        where: { mint, address, removedAt: null },
      });

      return reply.send({
        denied: !!entry,              
        since:  entry?.addedAt ?? null,
        by:     entry?.deniedBy ?? null,  
      });
    }
  );

  // ── Paginated event log ───────────────────────────────────────────────────
  app.get<{ Params: { mint: string }; Querystring: unknown }>(
    "/v1/coins/:mint/events",
    async (req, reply) => {
      const { mint }                      = MintParam.parse(req.params);
      const { kind, page, limit, before } = EventQuery.parse(req.query);

      const where: any = { mint };
      if (kind)   where.kind = kind;
      if (before) where.seq  = { lt: before };

      const [events, total] = await prisma.$transaction([
        prisma.sssEvent.findMany({
          where,
          orderBy: { seq: "desc" },
          skip:    (page - 1) * limit,
          take:    limit,
        }),
        prisma.sssEvent.count({ where }),
      ]);

      return reply.send({
        data: events.map(e => ({ ...e, seq: e.seq.toString(), slot: e.slot.toString() })),
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }
  );
}
