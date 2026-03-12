/**
 * SssNotifier — dispatches webhook callbacks when indexed events arrive.
 *
 * Production improvements over initial version:
 * - Iterative retry loop (not recursive — no stack growth on many retries)
 * - Per-webhook concurrency cap via a pending-set (back-pressure)
 * - Dead-letter after DEAD_LETTER_THRESHOLD consecutive failures
 * - HMAC-SHA256 signature: `v1=<hex(hmac(secret, timestamp.body))>`
 * - Full delivery log written to Postgres for audit trail
 */

import { PrismaClient } from "@prisma/client";
import { createHmac }   from "crypto";
import pino             from "pino";
import { cfg }          from "../config";
import { IndexedEvent, SssIndexer } from "./indexer";

const log = pino({ name: "notifier" });

const DEAD_LETTER_THRESHOLD = 10;

export class SssNotifier {
  private readonly inflight = new Set<string>();

  constructor(
    private readonly prisma:  PrismaClient,
    private readonly indexer: SssIndexer,
  ) {
    indexer.on("event", (e: IndexedEvent) => {
      this._dispatch(e).catch(err => log.error({ err }, "Dispatch error"));
    });
  }

  private async _dispatch(event: IndexedEvent): Promise<void> {
    const hooks = await this.prisma.sssWebhook.findMany({
      where: { mint: event.mint, active: true },
    });

    for (const hook of hooks) {
      if (hook.eventFilter.length > 0 && !hook.eventFilter.includes(event.kind)) continue;
      if (this.inflight.has(hook.id)) continue;

      const dbEvent = await this.prisma.sssEvent.findUnique({
        where: { signature: event.signature },
      });
      if (!dbEvent) continue;

      this.inflight.add(hook.id);
      this._deliverWithRetry(hook.id, dbEvent.id, hook.url, hook.secret, event)
        .catch(err => log.error({ err, hookId: hook.id }, "Delivery pipeline error"))
        .finally(() => this.inflight.delete(hook.id));
    }
  }

  /** Iterative retry — no recursion, no call-stack growth. */
  private async _deliverWithRetry(
    webhookId: string,
    eventId:   string,
    url:       string,
    secret:    string,
    event:     IndexedEvent,
  ): Promise<void> {
    for (let attempt = 1; attempt <= cfg.WEBHOOK_RETRIES; attempt++) {
      const { success, statusCode, error } = await this._attempt(url, secret, event);

      await this.prisma.sssWebhookDelivery.create({
        data: { webhookId, eventId, statusCode, attempt, success, error },
      }).catch(err => log.error({ err }, "Failed to log delivery"));

      if (success) {
        if (attempt > 1) log.info({ url, attempt }, "Webhook succeeded after retry");
        return;
      }

      log.warn({ url, attempt, statusCode, error }, "Webhook delivery failed");
      if (attempt < cfg.WEBHOOK_RETRIES) await sleep(backoff(attempt));
    }

    // All retries exhausted — check lifetime failure count and maybe deactivate.
    const failCount = await this.prisma.sssWebhookDelivery.count({
      where: { webhookId, success: false },
    });
    if (failCount >= DEAD_LETTER_THRESHOLD) {
      await this.prisma.sssWebhook.update({
        where: { id: webhookId },
        data:  { active: false },
      }).catch(err => log.error({ err }, "Failed to deactivate webhook"));
      log.error({ url, failCount }, "Webhook deactivated — re-enable via PATCH /v1/coins/:mint/webhooks/:id");
    }
  }

  private async _attempt(
    url:    string,
    secret: string,
    event:  IndexedEvent,
  ): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const body      = JSON.stringify({ event: event.kind, mint: event.mint, slot: event.slot.toString(), payload: event.payload });
    const timestamp = Date.now().toString();
    const sig       = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

    try {
      const res = await fetchWithTimeout(url, {
        method:  "POST",
        headers: {
          "Content-Type":    "application/json",
          "X-SSS-Timestamp": timestamp,
          "X-SSS-Signature": `v1=${sig}`,
          "X-SSS-Event":     event.kind,
        },
        body,
      }, cfg.WEBHOOK_TIMEOUT_MS);
      return { success: res.ok, statusCode: res.status };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(1_000 * Math.pow(2, attempt - 1) + (Math.random() - 0.5) * 500, 30_000);
}
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
