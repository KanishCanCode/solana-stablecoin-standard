/**
 * Shared test helpers — common fixtures and assertion utilities.
 *
 * Usage:
 *   import { deployMinimal, airdropMultiple, assertErrorCode } from "./helpers";
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN }  from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { SssCore } from "../target/types/sss_core";
import { configPda, allowancePda } from "../sdk/src/pda";

// ─── Airdrop helpers ──────────────────────────────────────────────────────────

export async function airdropMultiple(
  connection: Connection,
  keypairs: Keypair[],
  lamports = 2 * LAMPORTS_PER_SOL
): Promise<void> {
  for (const kp of keypairs) {
    await connection.confirmTransaction(
      await connection.requestAirdrop(kp.publicKey, lamports)
    );
  }
}

// ─── Program fixture builders ─────────────────────────────────────────────────

export interface MinimalFixture {
  program:    Program<SssCore>;
  authority:  Keypair;
  mintKp:     Keypair;
  cfgPda:     PublicKey;
}

/**
 * Deploy a Tier-1 Minimal stablecoin for testing.
 * Funds the authority keypair via airdrop.
 */
export async function deployMinimal(
  program:   Program<SssCore>,
  decimals = 6,
  extra?:    Partial<{ name: string; symbol: string }>
): Promise<MinimalFixture> {
  const provider  = program.provider as anchor.AnchorProvider;
  const authority = Keypair.generate();
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL)
  );

  const mintKp = Keypair.generate();
  const [cfgPda] = configPda(mintKp.publicKey, program.programId);

  await program.methods.initialize({
    name:            extra?.name   ?? "Test USD",
    symbol:          extra?.symbol ?? "TUSD",
    uri:             "",
    decimals,
    tier:            { minimal: {} },
    windowSecs:      new BN(0),
    windowCap:       new BN(0),
    cosignThreshold: 0,
    cosigners:       [],
  })
  .accounts({
    payer: authority.publicKey, authority: authority.publicKey,
    mint:  mintKp.publicKey,   config: cfgPda,
    hookProgram: null, tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .signers([authority, mintKp])
  .rpc();

  return { program, authority, mintKp, cfgPda };
}

// ─── Minter fixture ───────────────────────────────────────────────────────────

export interface MinterFixture {
  wallet:      Keypair;
  allowance:   PublicKey;
  cap:         bigint;
}

export async function registerMinter(
  program:   Program<SssCore>,
  issuer:    Keypair,
  mintPubkey: PublicKey,
  cfgPda:    PublicKey,
  cap = BigInt(1_000_000_000)
): Promise<MinterFixture> {
  const provider = program.provider as anchor.AnchorProvider;
  const wallet   = Keypair.generate();
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL)
  );

  const [allowance] = allowancePda(mintPubkey, wallet.publicKey, program.programId);
  await program.methods.registerMinter({ wallet: wallet.publicKey, cap: new BN(cap.toString()) })
    .accounts({
      issuer: issuer.publicKey, config: cfgPda,
      minterAllowance: allowance, mint: mintPubkey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([issuer]).rpc();

  return { wallet, allowance, cap };
}

// ─── ATA helper ───────────────────────────────────────────────────────────────

export async function ataFor(
  provider: anchor.AnchorProvider,
  mint:     PublicKey,
  owner:    Keypair
): Promise<PublicKey> {
  return (await getOrCreateAssociatedTokenAccount(
    provider.connection, owner, mint, owner.publicKey,
    false, undefined, undefined, TOKEN_2022_PROGRAM_ID
  )).address;
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

/**
 * Assert that a promise rejects with an Anchor error containing the given code string.
 */
export async function assertErrorCode(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await promise;
    assert.fail(`Expected error code ${code} but transaction succeeded`);
  } catch (e: any) {
    assert.include(
      e.message ?? e.toString(),
      code,
      `Expected error "${code}" in: ${e.message ?? e}`
    );
  }
}

/**
 * Verify that a config's event_seq counter is greater than a previous value.
 */
export async function assertSeqAdvanced(
  program: Program<SssCore>,
  cfgPda:  PublicKey,
  prevSeq: number
): Promise<void> {
  const cfg = await program.account.issuanceConfig.fetch(cfgPda);
  assert.isAbove(cfg.eventSeq.toNumber(), prevSeq, "eventSeq must advance");
}
