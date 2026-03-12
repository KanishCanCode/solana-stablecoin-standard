/**
 * Centralised runtime configuration.
 * All values sourced from environment; validated at startup.
 */
import { z } from "zod";
import "dotenv/config";

const Env = z.object({
  NODE_ENV:          z.enum(["development", "production", "test"]).default("development"),
  PORT:              z.coerce.number().default(3001),
  HOST:              z.string().default("0.0.0.0"),
  CORS_ORIGINS:      z.string().optional(),   // comma-separated origin list; unset = allow all

  // Solana
  SOLANA_RPC_URL:    z.string().url().default("https://api.devnet.solana.com"),
  SSS_CORE_ID:       z.string().default("SSSTkn4G7RLuGDL1i5zKi2JoW6FpZ3wXCbQn9PmVkRzP"),
  SSS_HOOK_ID:       z.string().default("SSSHkQxWmNvEfHdTpY8cLrUaGb3xJ6nKo2Di4AlVsRqP"),

  // Database
  DATABASE_URL:      z.string().default("postgresql://sss:sss@localhost:5432/sss"),

  // Redis (optional — in-memory fallback if absent)
  REDIS_URL:         z.string().optional(),

  // Auth
  JWT_SECRET:        z.string().min(32).default("change-me-in-production-minimum-32chars!!"),

  // Webhooks
  WEBHOOK_TIMEOUT_MS: z.coerce.number().default(5_000),
  WEBHOOK_RETRIES:    z.coerce.number().default(3),

  // Indexer
  INDEXER_POLL_MS:   z.coerce.number().default(1_000),
  INDEXER_BACKFILL:  z.coerce.number().default(200),
});

function loadConfig() {
  const result = Env.safeParse(process.env);
  if (!result.success) {
    console.error("❌  Invalid environment configuration:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const cfg = loadConfig();
export type Config = typeof cfg;
