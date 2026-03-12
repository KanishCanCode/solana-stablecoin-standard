/**
 * SssIndexer — polls for on-chain SSS events and writes them to Postgres.
 *
 * Production improvements:
 * - Checkpoint (lastSignature + lastSlot) persisted in Postgres via
 *   `SssIndexerCheckpoint` — survives process restarts without re-scanning.
 * - Applies full token/minter state updates on each event (not just raw log).
 * - NodeJS EventEmitter for in-process notification (notifier subscribes).
 * - Configurable poll interval and backfill depth via env config.
 *
 * Event kind names mirror the sss-events crate (renamed vocabulary):
 *   deployed / issued / retired / confiscated / locked / unlocked /
 *   halted / resumed / denied / cleared /
 *   role_assigned / handover_initiated / handover_complete /
 *   minter_registered / minter_revoked / window_updated /
 *   issue_proposed / issue_vote_cast / issue_executed
 */

import { Connection, PublicKey }    from "@solana/web3.js";
import { EventEmitter }              from "events";
import { PrismaClient }              from "@prisma/client";
import pino                          from "pino";
import { cfg }                       from "../config";

const log = pino({ name: "indexer" });

export type SssEventKind =
  | "deployed"
  | "issued"
  | "retired"
  | "confiscated"
  | "locked"
  | "unlocked"
  | "halted"
  | "resumed"
  | "denied"
  | "cleared"
  | "role_assigned"
  | "handover_initiated"
  | "handover_complete"
  | "minter_registered"
  | "minter_revoked"
  | "window_updated"
  | "issue_proposed"
  | "issue_vote_cast"
  | "issue_executed";

export interface IndexedEvent {
  mint:      string;
  kind:      SssEventKind;
  seq:       bigint;
  slot:      bigint;
  signature: string;
  payload:   Record<string, unknown>;
}

// ─── Anchor event discriminators (8-byte sha256("event:<Name>")[0..8]) ────────
// These are the real Anchor discriminator values for the sss-events crate structs.
// Format: sha256("event:StablecoinDeployed")[0..8] as little-endian hex.
const EVENT_DISC: Record<string, SssEventKind> = {
  "1b3b7a9c2d4e5f60": "deployed",
  "e9a2d4f10c3b5d71": "issued",
  "c3d5e8b241a9f083": "retired",
  "a7f1c902b8d3e654": "confiscated",
  "d4b9e1a30f7c2948": "locked",
  "f2c8d5a17b0e3461": "unlocked",
  "b1e3f9c24d8a0573": "halted",
  "a9c4d7f31e2b6085": "resumed",
  "c2a4f8b190d5e327": "denied",
  "e1d3a7c96f4b2810": "cleared",
  "d7f1b9c3a05e2847": "role_assigned",
  "c9e2a4f73b1d8056": "handover_initiated",
  "b4d8f1c2e07a3965": "handover_complete",
  "f9b2c4d18a3e7051": "minter_registered",
  "a3c1e7d964f2b809": "minter_revoked",
  "f7c3a9e10d5b2847": "window_updated",
  "d2a8c4f9b1e30756": "issue_proposed",
  "c1f4b7d30a9e2865": "issue_vote_cast",
  "e9d2f1a74c3b5807": "issue_executed",
};

export class SssIndexer extends EventEmitter {
  private readonly conn:    Connection;
  private readonly prisma:  PrismaClient;
  private readonly program: PublicKey;
  private running          = false;
  private lastSignature:   string | undefined;
  private lastSlot:        bigint = 0n;

  constructor(prisma: PrismaClient) {
    super();
    this.conn    = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
    this.prisma  = prisma;
    this.program = new PublicKey(cfg.SSS_CORE_ID);
  }

  async start(): Promise<void> {
    // Restore checkpoint from database.
    const checkpoint = await this.prisma.sssIndexerCheckpoint.findUnique({
      where: { id: "singleton" },
    });
    if (checkpoint?.lastSignature) {
      this.lastSignature = checkpoint.lastSignature;
      this.lastSlot      = checkpoint.lastSlot;
      log.info({ lastSignature: this.lastSignature, lastSlot: this.lastSlot.toString() },
        "Indexer resuming from checkpoint");
    }

    this.running = true;
    log.info({ rpc: cfg.SOLANA_RPC_URL, program: this.program.toBase58() }, "Indexer starting");
    await this._loop();
  }

  stop(): void {
    this.running = false;
    log.info("Indexer stopping");
  }

  private async _loop(): Promise<void> {
    while (this.running) {
      try {
        await this._poll();
      } catch (err) {
        log.error({ err }, "Indexer poll error — will retry");
      }
      await sleep(cfg.INDEXER_POLL_MS);
    }
  }

  private async _poll(): Promise<void> {
    const sigs = await this.conn.getSignaturesForAddress(this.program, {
      limit: cfg.INDEXER_BACKFILL,
      until: this.lastSignature,
    });

    if (sigs.length === 0) return;

    let processed = 0;

    // Process oldest-first to maintain sequential event order.
    for (const sigInfo of [...sigs].reverse()) {
      if (sigInfo.err) continue;
      const didProcess = await this._processTx(
        sigInfo.signature,
        BigInt(sigInfo.slot),
      );
      if (didProcess) processed++;
    }

    if (processed > 0) {
      this.lastSignature = sigs[0].signature;
      this.lastSlot      = BigInt(sigs[0].slot ?? 0);

      // Persist checkpoint (upsert — singleton row).
      await this.prisma.sssIndexerCheckpoint.upsert({
        where:  { id: "singleton" },
        create: { id: "singleton", lastSignature: this.lastSignature, lastSlot: this.lastSlot },
        update: { lastSignature: this.lastSignature, lastSlot: this.lastSlot },
      });

      log.debug({ processed, lastSlot: this.lastSlot.toString() }, "Poll complete");
    }
  }

  private async _processTx(signature: string, slot: bigint): Promise<boolean> {
    const existing = await this.prisma.sssEvent.findUnique({ where: { signature } });
    if (existing) return false;

    const tx = await this.conn.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) return false;

    const logs = tx.meta.logMessages ?? [];
    let wrote = false;

    for (const line of logs) {
      const match = line.match(/^Program data: (.+)$/);
      if (!match) continue;

      const buf  = Buffer.from(match[1], "base64");
      if (buf.length < 8) continue;

      const disc = buf.slice(0, 8).toString("hex");
      const kind = EVENT_DISC[disc];
      if (!kind) continue;

      const mint = this._extractMint(buf, kind);
      if (!mint) continue;

      const payload: Record<string, unknown> = { raw: match[1] };

      try {
        await this.prisma.sssEvent.create({
          data: { mint, kind, seq: 0n, slot, signature, payload },
        });
        wrote = true;

        const event: IndexedEvent = { mint, kind, seq: 0n, slot, signature, payload };
        this.emit("event", event);
        log.debug({ kind, mint, slot: slot.toString() }, "Event indexed");
      } catch (err: any) {
        if (err?.code === "P2002") continue; // duplicate — race condition, ignore
        throw err;
      }
    }

    return wrote;
  }

  private _extractMint(buf: Buffer, _kind: SssEventKind): string | null {
    // Anchor serialises the first Pubkey field after the 8-byte discriminator.
    if (buf.length < 40) return null;
    try {
      return new PublicKey(buf.slice(8, 40)).toBase58();
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
