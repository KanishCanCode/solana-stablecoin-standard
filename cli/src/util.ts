/**
 * CLI shared utilities — keypair loading, provider, program loading.
 */
import { readFileSync } from "fs";
import { homedir }      from "os";
import { resolve }      from "path";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Wallet }                         from "@coral-xyz/anchor";

const CLUSTER_URLS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet:   "https://api.devnet.solana.com",
  mainnet:  "https://api.mainnet-beta.solana.com",
};

export function resolveCluster(c: string): string {
  if (c.startsWith("http")) return c;
  return CLUSTER_URLS[c] ?? CLUSTER_URLS.devnet;
}

export function loadKeypair(path: string): Keypair {
  const p    = path.replace("~", homedir());
  const json = JSON.parse(readFileSync(resolve(p), "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(json));
}

export async function loadProgram(conn: Connection, payer: Keypair): Promise<Program> {
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: "confirmed" });
  // In production: import the built IDL from ../../../target/idl/sss_core.json
  // For now, use dynamic fetch as fallback.
  let idl: Idl;
  try {
    idl = require("../../../target/idl/sss_core.json");
  } catch {
    throw new Error(
      "IDL not found. Run `anchor build` first to generate target/idl/sss_core.json"
    );
  }
  return new Program(idl, provider);
}

export function buildProvider(conn: Connection, payer: Keypair): AnchorProvider {
  return new AnchorProvider(conn, new Wallet(payer), { commitment: "confirmed" });
}
