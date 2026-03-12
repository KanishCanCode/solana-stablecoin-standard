/**
 * Prisma seed — run with `npx prisma db seed`
 *
 * Creates:
 *  - A single indexer checkpoint row (singleton pattern)
 *  - A default read-write API key for local development
 *
 * The raw API key is printed once to stdout on first run.
 * In production, provision keys via the management API or a secrets manager.
 */

import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  // ── Indexer checkpoint (idempotent upsert) ──────────────────────────────
  await prisma.sssIndexerCheckpoint.upsert({
    where:  { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  console.log("✅  Indexer checkpoint created");

  // ── Dev API key — only create if none exist ────────────────────────────
  const existing = await prisma.sssApiKey.count();
  if (existing === 0) {
    const rawKey  = `sss_dev_${randomBytes(24).toString("base58url")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    await prisma.sssApiKey.create({
      data: {
        name:    "Development key",
        keyHash,
        scope:   ["read", "write"],
        active:  true,
      },
    });

    // Print raw key once — it cannot be recovered after this point.
    console.log("\n🔑  Development API key (save this — shown only once):");
    console.log(`    ${rawKey}\n`);
  } else {
    console.log("ℹ️   API key already exists — skipping");
  }
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
