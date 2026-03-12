/**
 * Tier-3 co-sign proposal routes.
 *
 * GET  /v1/coins/:mint/proposals          — list proposals (with filter)
 * GET  /v1/coins/:mint/proposals/:id      — get one proposal + vote log
 */

import { FastifyInstance } from "fastify";
import { z }              from "zod";
import { PrismaClient }   from "@prisma/client";

const ProposalQuery = z.object({
  status: z.enum(["pending", "ready", "executed", "expired"]).optional(),
  page:   z.coerce.number().default(1),
  limit:  z.coerce.number().min(1).max(100).default(20),
});

export async function proposalRoutes(app: FastifyInstance, { prisma }: { prisma: PrismaClient }) {

  app.get<{ Params: { mint: string }; Querystring: unknown }>(
    "/v1/coins/:mint/proposals",
    async (req, reply) => {
      const mint                    = (req.params as any).mint;
      const { status, page, limit } = ProposalQuery.parse(req.query);

      const now = new Date();
      let where: any = { mint };

      if (status === "pending")  where = { ...where, executed: false, expiresAt: { gt: now } };
      if (status === "executed") where = { ...where, executed: true };
      if (status === "expired")  where = { ...where, executed: false, expiresAt: { lte: now } };

      const [proposals, total] = await prisma.$transaction([
        prisma.sssProposal.findMany({
          where,
          orderBy: { proposalSeq: "desc" },   
          skip:    (page - 1) * limit,
          take:    limit,
          include: { votes: { select: { voter: true, votedAt: true } } },  // `votes` / `voter` / `votedAt`
        }),
        prisma.sssProposal.count({ where }),
      ]);

      return reply.send({
        data: proposals.map(serializeProposal),
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }
  );

  app.get<{ Params: { mint: string; id: string } }>(
    "/v1/coins/:mint/proposals/:id",
    async (req, reply) => {
      const { id } = req.params;

      const proposal = await prisma.sssProposal.findUnique({
        where:   { id },
        include: { votes: true },   // `votes`
      });

      if (!proposal) return reply.status(404).send({ error: "Proposal not found" });
      return reply.send({ data: serializeProposal(proposal) });
    }
  );
}

function serializeProposal(p: any) {
  const now = new Date();
  const status = p.executed ? "executed"
    : p.expiresAt < now    ? "expired"
    : p.voteCount >= p.threshold ? "ready"   
    : "pending";

  return {
    ...p,
    proposalSeq: p.proposalSeq.toString(),   // `proposalSeq`
    amount:      p.amount.toString(),
    status,
  };
}
