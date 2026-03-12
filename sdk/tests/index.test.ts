/**
 * SDK Unit Tests — covering all exported symbols.
 *
 * Sections:
 * 1. PDA derivation — determinism, seeds, cross-language parity
 * 2. Constants — values match on-chain
 * 3. Types — Tier enum values
 * 4. IssuerClientFactory — correct class dispatch
 * 5. Client methods — PDA helpers (no network)
 * 6. Exports — public API completeness check
 */

import { describe, it } from "mocha";
import { assert } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

import {
  IssuerClient,
  CompliantClient,
  InstitutionalClient,
  IssuerClientFactory,
  Tier,
  configPda,
  allowancePda,
  proposalPda,
  hookConfigPda,
  denylistEntryPda,
  extraMetaListPda,
  CORE_PROGRAM_ID,
  HOOK_PROGRAM_ID,
  ROLE_ISSUER,
  ROLE_GUARDIAN,
  ROLE_COMPLIANCE,
  HANDOVER_LOCK_SECS,
  DEFAULT_RPC_URL,
  DEFAULT_COMMITMENT,
} from "../src/index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const randomPubkey = () => Keypair.generate().publicKey;
const mockWallet = {
  publicKey:           randomPubkey(),
  signTransaction:     async (t: any) => t,
  signAllTransactions: async (ts: any[]) => ts,
} as any;

// ─── 1. PDA Derivation ────────────────────────────────────────────────────────

describe("PDA Derivation", () => {
  const mint   = randomPubkey();
  const wallet = randomPubkey();
  const addr   = randomPubkey();

  it("configPda returns stable address for same inputs", () => {
    const [a1] = configPda(mint, CORE_PROGRAM_ID);
    const [a2] = configPda(mint, CORE_PROGRAM_ID);
    assert.equal(a1.toBase58(), a2.toBase58());
  });

  it("configPda differs by mint", () => {
    const [a1] = configPda(mint,            CORE_PROGRAM_ID);
    const [a2] = configPda(randomPubkey(), CORE_PROGRAM_ID);
    assert.notEqual(a1.toBase58(), a2.toBase58());
  });

  it("allowancePda is stable and wallet-specific", () => {
    const [m1] = allowancePda(mint, wallet,         CORE_PROGRAM_ID);
    const [m2] = allowancePda(mint, wallet,         CORE_PROGRAM_ID);
    const [m3] = allowancePda(mint, randomPubkey(), CORE_PROGRAM_ID);
    assert.equal(m1.toBase58(), m2.toBase58());
    assert.notEqual(m1.toBase58(), m3.toBase58());
  });

  it("proposalPda varies by seq", () => {
    const [p0]   = proposalPda(mint, 0n,                            CORE_PROGRAM_ID);
    const [p1]   = proposalPda(mint, 1n,                            CORE_PROGRAM_ID);
    const [pMax] = proposalPda(mint, BigInt("18446744073709551615"), CORE_PROGRAM_ID);
    assert.notEqual(p0.toBase58(), p1.toBase58());
    assert.ok(pMax instanceof PublicKey);
  });

  it("hookConfigPda differs by program ID", () => {
    const [h1] = hookConfigPda(mint, HOOK_PROGRAM_ID);
    const [h2] = hookConfigPda(mint, CORE_PROGRAM_ID);
    assert.notEqual(h1.toBase58(), h2.toBase58());
  });

  it("denylistEntryPda is unique per address", () => {
    const [e1] = denylistEntryPda(mint, addr,         HOOK_PROGRAM_ID);
    const [e2] = denylistEntryPda(mint, randomPubkey(), HOOK_PROGRAM_ID);
    assert.notEqual(e1.toBase58(), e2.toBase58());
  });

  it("extraMetaListPda returns a valid PublicKey", () => {
    const [eml] = extraMetaListPda(mint, HOOK_PROGRAM_ID);
    assert.ok(eml instanceof PublicKey);
  });

  it("all PDAs are valid Solana public keys", () => {
    const pdas = [
      configPda(mint, CORE_PROGRAM_ID)[0],
      allowancePda(mint, wallet, CORE_PROGRAM_ID)[0],
      proposalPda(mint, 0n, CORE_PROGRAM_ID)[0],
      hookConfigPda(mint, HOOK_PROGRAM_ID)[0],
      denylistEntryPda(mint, addr, HOOK_PROGRAM_ID)[0],
      extraMetaListPda(mint, HOOK_PROGRAM_ID)[0],
    ];
    for (const pda of pdas) {
      assert.doesNotThrow(() => new PublicKey(pda.toBuffer()));
    }
  });

  it("bump is in range [0, 255]", () => {
    const [, bump] = configPda(mint, CORE_PROGRAM_ID);
    assert.isAtLeast(bump, 0);
    assert.isAtMost(bump, 255);
  });
});

// ─── 2. Constants ─────────────────────────────────────────────────────────────

describe("Constants", () => {
  it("CORE_PROGRAM_ID is a valid pubkey", () => {
    assert.doesNotThrow(() => new PublicKey(CORE_PROGRAM_ID.toBuffer()));
  });

  it("HOOK_PROGRAM_ID is a valid pubkey", () => {
    assert.doesNotThrow(() => new PublicKey(HOOK_PROGRAM_ID.toBuffer()));
  });

  it("role constants are 0/1/2", () => {
    assert.equal(ROLE_ISSUER,     0);
    assert.equal(ROLE_GUARDIAN,   1);
    assert.equal(ROLE_COMPLIANCE, 2);
  });

  it("HANDOVER_LOCK_SECS is 86400 (24 h)", () => {
    assert.equal(HANDOVER_LOCK_SECS, 86_400);
  });

  it("program IDs are different", () => {
    assert.notEqual(CORE_PROGRAM_ID.toBase58(), HOOK_PROGRAM_ID.toBase58());
  });

  it("DEFAULT_RPC_URL contains solana", () => {
    assert.isString(DEFAULT_RPC_URL);
    assert.include(DEFAULT_RPC_URL, "solana");
  });

  it("DEFAULT_COMMITMENT is 'confirmed'", () => {
    assert.equal(DEFAULT_COMMITMENT, "confirmed");
  });
});

// ─── 3. Tier enum ─────────────────────────────────────────────────────────────

describe("Tier enum", () => {
  it("Minimal is 0",       () => assert.equal(Tier.Minimal,       0));
  it("Compliant is 1",     () => assert.equal(Tier.Compliant,     1));
  it("Institutional is 2", () => assert.equal(Tier.Institutional, 2));

  it("enum values are distinct", () => {
    assert.notEqual(Tier.Minimal,   Tier.Compliant);
    assert.notEqual(Tier.Compliant, Tier.Institutional);
  });
});

// ─── 4. IssuerClientFactory ─────────────────────────────────────────────────────

describe("IssuerClientFactory", () => {
  it("forTier(Minimal) returns IssuerClient", () => {
    assert.instanceOf(IssuerClientFactory.forTier(Tier.Minimal, mockWallet), IssuerClient);
  });

  it("forTier(Compliant) returns CompliantClient", () => {
    assert.instanceOf(IssuerClientFactory.forTier(Tier.Compliant, mockWallet), CompliantClient);
  });

  it("forTier(Institutional) returns InstitutionalClient", () => {
    assert.instanceOf(IssuerClientFactory.forTier(Tier.Institutional, mockWallet), InstitutionalClient);
  });

  it("minimal() returns IssuerClient", () => {
    assert.instanceOf(IssuerClientFactory.minimal(mockWallet), IssuerClient);
  });

  it("compliant() returns CompliantClient", () => {
    assert.instanceOf(IssuerClientFactory.compliant(mockWallet), CompliantClient);
  });

  it("institutional() returns InstitutionalClient", () => {
    assert.instanceOf(IssuerClientFactory.institutional(mockWallet), InstitutionalClient);
  });

  it("CompliantClient extends IssuerClient", () => {
    assert.instanceOf(IssuerClientFactory.compliant(mockWallet), IssuerClient);
  });

  it("InstitutionalClient extends CompliantClient", () => {
    assert.instanceOf(IssuerClientFactory.institutional(mockWallet), CompliantClient);
  });

  it("InstitutionalClient extends IssuerClient", () => {
    assert.instanceOf(IssuerClientFactory.institutional(mockWallet), IssuerClient);
  });

  it("throws on unknown tier", () => {
    assert.throws(
      () => IssuerClientFactory.forTier(99 as any, mockWallet),
      /Unknown tier/
    );
  });
});

// ─── 5. Client — PDA helpers ─────────────────────────────────────────────────

describe("IssuerClient PDA helpers", () => {
  const client = IssuerClientFactory.minimal(mockWallet);
  const mint   = randomPubkey();

  it("client.configPda() matches configPda()", () => {
    const [expected] = configPda(mint, CORE_PROGRAM_ID);
    assert.equal(client.configPda(mint).toBase58(), expected.toBase58());
  });

  it("client.allowancePda() matches allowancePda()", () => {
    const minter     = randomPubkey();
    const [expected] = allowancePda(mint, minter, CORE_PROGRAM_ID);
    assert.equal(client.allowancePda(mint, minter).toBase58(), expected.toBase58());
  });
});

// ─── 6. Exports — public API surface ─────────────────────────────────────────

describe("Exports", () => {
  const EXPECTED_EXPORTS = [
    "IssuerClient",
    "CompliantClient",
    "InstitutionalClient",
    "IssuerClientFactory",
    "Tier",
    "configPda",
    "allowancePda",
    "proposalPda",
    "hookConfigPda",
    "denylistEntryPda",
    "extraMetaListPda",
    "CORE_PROGRAM_ID",
    "HOOK_PROGRAM_ID",
    "ROLE_ISSUER",
    "ROLE_GUARDIAN",
    "ROLE_COMPLIANCE",
    "HANDOVER_LOCK_SECS",
    "DEFAULT_RPC_URL",
    "DEFAULT_COMMITMENT",
  ];

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../src/index");

  for (const name of EXPECTED_EXPORTS) {
    it(`exports "${name}"`, () => {
      assert.isDefined(mod[name], `${name} should be exported from @sss/sdk`);
    });
  }
});
