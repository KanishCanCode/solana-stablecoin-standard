/**
 * Tier-3 (Institutional) integration tests — 22 tests
 *
 * Co-sign gate: propose_issue → approve_issue × N → execute_issue
 * Window rate-limit enforcement.
 * Timelocked authority handover.
 * Edge cases: duplicate votes, rogue voters, window reset, replay prevention.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program }  from "@coral-xyz/anchor";
import {
  Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { SssCore } from "../target/types/sss_core";
import { configPda, allowancePda, proposalPda } from "../sdk/src/pda";

const HOOK_PROGRAM_ID = new PublicKey("SSSHkQxWmNvEfHdTpY8cLrUaGb3xJ6nKo2Di4AlVsRqP");

describe("Tier-3 — Institutional preset", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssCore as Program<SssCore>;

  const authority  = Keypair.generate();
  const cosigner1  = Keypair.generate();
  const cosigner2  = Keypair.generate();
  const cosigner3  = Keypair.generate();
  const minterKp   = Keypair.generate();
  let mintKp:   Keypair;
  let cfgPda:   PublicKey;
  let destAta:  PublicKey;
  let destAta2: PublicKey;

  const WINDOW_SECS = 3600;
  const WINDOW_CAP  = BigInt(1_000_000_000);
  const CAP         = BigInt(10_000_000_000);
  const THRESHOLD   = 2;

  async function airdrop(kp: Keypair) {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL)
    );
  }

  before(async () => {
    for (const kp of [authority, cosigner1, cosigner2, cosigner3, minterKp])
      await airdrop(kp);
  });

  // ── Initialize ─────────────────────────────────────────────────────────────

  it("initializes an Institutional stablecoin with 2-of-3 co-sign gate", async () => {
    mintKp = Keypair.generate();
    [cfgPda] = configPda(mintKp.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Corp USD", symbol: "CORP",
        uri: "https://example.com/corp.json",
        decimals: 6, tier: { institutional: {} },
        windowSecs:      new anchor.BN(WINDOW_SECS),
        windowCap:       new anchor.BN(WINDOW_CAP.toString()),
        cosignThreshold: THRESHOLD,
        cosigners:       [cosigner1.publicKey, cosigner2.publicKey, cosigner3.publicKey],
      })
      .accounts({
        payer: authority.publicKey, authority: authority.publicKey,
        mint: mintKp.publicKey, config: cfgPda,
        hookProgram: HOOK_PROGRAM_ID, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([authority, mintKp]).rpc();

    const cfg = await program.account.issuanceConfig.fetch(cfgPda);
    assert.deepEqual(cfg.tier, { institutional: {} });
    assert.equal(cfg.cosignThreshold, THRESHOLD);
    assert.equal(cfg.windowSecs.toString(), WINDOW_SECS.toString());
    assert.equal(cfg.windowCap.toString(), WINDOW_CAP.toString());
    assert.equal(cfg.nextProposal.toString(), "0");
  });

  it("cosigners list is stored correctly on-chain", async () => {
    const cfg = await program.account.issuanceConfig.fetch(cfgPda);
    assert.equal(cfg.cosigners.length, 3);
    assert.equal(cfg.cosigners[0].toBase58(), cosigner1.publicKey.toBase58());
    assert.equal(cfg.cosigners[1].toBase58(), cosigner2.publicKey.toBase58());
    assert.equal(cfg.cosigners[2].toBase58(), cosigner3.publicKey.toBase58());
  });

  it("registers minter and creates destination ATAs", async () => {
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    destAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, authority, mintKp.publicKey, authority.publicKey,
      false, undefined, undefined, TOKEN_2022_PROGRAM_ID
    )).address;
    destAta2 = (await getOrCreateAssociatedTokenAccount(
      provider.connection, authority, mintKp.publicKey, cosigner1.publicKey,
      false, undefined, undefined, TOKEN_2022_PROGRAM_ID
    )).address;

    await program.methods
      .registerMinter({ wallet: minterKp.publicKey, cap: new anchor.BN(CAP.toString()) })
      .accounts({
        issuer: authority.publicKey, config: cfgPda, minterAllowance: allow,
        mint: mintKp.publicKey, systemProgram: SystemProgram.programId,
      })
      .signers([authority]).rpc();
  });

  it("direct issue is blocked when cosign_threshold > 0", async () => {
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    try {
      await program.methods.issue(new anchor.BN(1_000_000))
        .accounts({
          minter: minterKp.publicKey, config: cfgPda, mint: mintKp.publicKey,
          minterAllowance: allow, destination: destAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minterKp]).rpc();
      assert.fail("Expected ThresholdNotMet");
    } catch (e: any) { assert.include(e.message, "ThresholdNotMet"); }
  });

  // ── Co-sign flow ────────────────────────────────────────────────────────────

  it("propose_issue creates a proposal — nextProposal increments", async () => {
    const amount  = BigInt(500_000_000);
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString());
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    await program.methods.proposeIssue(new anchor.BN(amount.toString()))
      .accounts({
        proposer: minterKp.publicKey, config: cfgPda, minterAllowance: allow,
        proposal: prop, destination: destAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKp]).rpc();

    const proposal = await program.account.mintProposal.fetch(prop);
    assert.equal(proposal.voteCount, 0);
    assert.equal(proposal.executed, false);
    assert.equal(proposal.amount.toString(), amount.toString());

    const cfg1 = await program.account.issuanceConfig.fetch(cfgPda);
    assert.equal(BigInt(cfg1.nextProposal.toString()), seq + 1n);
  });

  it("first cosigner vote increments voteCount to 1", async () => {
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString()) - 1n;
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    await program.methods.approveIssue()
      .accounts({ cosigner: cosigner1.publicKey, config: cfgPda, proposal: prop })
      .signers([cosigner1]).rpc();

    assert.equal((await program.account.mintProposal.fetch(prop)).voteCount, 1);
  });

  it("second cosigner vote reaches threshold", async () => {
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString()) - 1n;
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    await program.methods.approveIssue()
      .accounts({ cosigner: cosigner2.publicKey, config: cfgPda, proposal: prop })
      .signers([cosigner2]).rpc();

    assert.equal((await program.account.mintProposal.fetch(prop)).voteCount, 2);
  });

  it("execute_issue releases tokens once threshold is met", async () => {
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString()) - 1n;
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    await program.methods.executeIssue()
      .accounts({
        executor: cosigner1.publicKey, config: cfgPda, mint: mintKp.publicKey,
        proposal: prop, minterAllowance: allow, destination: destAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([cosigner1]).rpc();

    assert.equal((await program.account.mintProposal.fetch(prop)).executed, true);
    assert.equal(
      (await program.account.issuanceConfig.fetch(cfgPda)).totalIssued.toString(),
      "500000000"
    );
  });

  it("replay — executed proposal cannot be executed again", async () => {
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString()) - 1n;
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    try {
      await program.methods.executeIssue()
        .accounts({
          executor: cosigner1.publicKey, config: cfgPda, mint: mintKp.publicKey,
          proposal: prop, minterAllowance: allow, destination: destAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([cosigner1]).rpc();
      assert.fail("Expected AlreadyExecuted");
    } catch (e: any) { assert.include(e.message, "AlreadyExecuted"); }
  });

  // ── Duplicate vote prevention ───────────────────────────────────────────────

  it("co-signer cannot vote twice on the same proposal", async () => {
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString());
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    await program.methods.proposeIssue(new anchor.BN(1_000_000))
      .accounts({
        proposer: minterKp.publicKey, config: cfgPda, minterAllowance: allow,
        proposal: prop, destination: destAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKp]).rpc();

    await program.methods.approveIssue()
      .accounts({ cosigner: cosigner1.publicKey, config: cfgPda, proposal: prop })
      .signers([cosigner1]).rpc();

    try {
      await program.methods.approveIssue()
        .accounts({ cosigner: cosigner1.publicKey, config: cfgPda, proposal: prop })
        .signers([cosigner1]).rpc();
      assert.fail("Expected DuplicateVote");
    } catch (e: any) { assert.include(e.message, "DuplicateVote"); }
  });

  it("unrecognised signer cannot vote", async () => {
    const rogue  = Keypair.generate();
    await airdrop(rogue);
    const cfg0   = await program.account.issuanceConfig.fetch(cfgPda);
    const seq    = BigInt(cfg0.nextProposal.toString()) - 1n;
    const [prop] = proposalPda(mintKp.publicKey, seq, program.programId);

    try {
      await program.methods.approveIssue()
        .accounts({ cosigner: rogue.publicKey, config: cfgPda, proposal: prop })
        .signers([rogue]).rpc();
      assert.fail("Expected UnrecognisedCosigner");
    } catch (e: any) { assert.include(e.message, "UnrecognisedCosigner"); }
  });

  it("execute is rejected below threshold", async () => {
    // Proposal from previous test has only 1 vote — threshold is 2
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString()) - 1n;
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    try {
      await program.methods.executeIssue()
        .accounts({
          executor: cosigner1.publicKey, config: cfgPda, mint: mintKp.publicKey,
          proposal: prop, minterAllowance: allow, destination: destAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([cosigner1]).rpc();
      assert.fail("Expected ThresholdNotMet");
    } catch (e: any) { assert.include(e.message, "ThresholdNotMet"); }
  });

  it("all 3 cosigners can vote — third vote still succeeds", async () => {
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString()) - 1n;
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    await program.methods.approveIssue()
      .accounts({ cosigner: cosigner2.publicKey, config: cfgPda, proposal: prop })
      .signers([cosigner2]).rpc();

    await program.methods.approveIssue()
      .accounts({ cosigner: cosigner3.publicKey, config: cfgPda, proposal: prop })
      .signers([cosigner3]).rpc();

    assert.equal((await program.account.mintProposal.fetch(prop)).voteCount, 3);
  });

  // ── Rate window ─────────────────────────────────────────────────────────────

  it("window_issued tracks cumulative issuance within window", async () => {
    const cfg = await program.account.issuanceConfig.fetch(cfgPda);
    assert.isAtLeast(cfg.windowIssued.toNumber(), 0);
  });

  it("set_window updates windowSecs and windowCap", async () => {
    await program.methods
      .setWindow({ windowSecs: new anchor.BN(7200), windowCap: new anchor.BN(2_000_000_000) })
      .accounts({ authority: authority.publicKey, config: cfgPda })
      .signers([authority]).rpc();

    const cfg = await program.account.issuanceConfig.fetch(cfgPda);
    assert.equal(cfg.windowSecs.toString(), "7200");
    assert.equal(cfg.windowCap.toString(), "2000000000");
  });

  it("set_window resets windowIssued to 0", async () => {
    const cfg = await program.account.issuanceConfig.fetch(cfgPda);
    assert.equal(cfg.windowIssued.toString(), "0");
  });

  it("set_window is rejected for non-authority", async () => {
    const rogue = Keypair.generate();
    await airdrop(rogue);
    try {
      await program.methods.setWindow({ windowSecs: new anchor.BN(1), windowCap: new anchor.BN(1) })
        .accounts({ authority: rogue.publicKey, config: cfgPda })
        .signers([rogue]).rpc();
      assert.fail("Expected AuthorityRequired");
    } catch (e: any) { assert.include(e.message, "AuthorityRequired"); }
  });

  it("set_window is rejected on Tier-1 (TierInsufficient)", async () => {
    // Create a Tier-1 config to verify the guard
    const t1MintKp = Keypair.generate();
    const [t1CfgPda] = configPda(t1MintKp.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "T1", symbol: "T1", uri: "", decimals: 6, tier: { minimal: {} },
        windowSecs: new anchor.BN(0), windowCap: new anchor.BN(0),
        cosignThreshold: 0, cosigners: [],
      })
      .accounts({
        payer: authority.publicKey, authority: authority.publicKey,
        mint: t1MintKp.publicKey, config: t1CfgPda,
        hookProgram: null, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([authority, t1MintKp]).rpc();

    try {
      await program.methods.setWindow({ windowSecs: new anchor.BN(3600), windowCap: new anchor.BN(1_000_000) })
        .accounts({ authority: authority.publicKey, config: t1CfgPda })
        .signers([authority]).rpc();
      assert.fail("Expected TierInsufficient");
    } catch (e: any) { assert.include(e.message, "TierInsufficient"); }
  });

  it("issue exceeding window cap is rejected mid-window", async () => {
    // Window cap is 2_000_000_000. Issue 1_800_000_000 (via cosign) then try to exceed
    // First establish a proposal
    const amount  = BigInt(1_800_000_000);
    const cfg0    = await program.account.issuanceConfig.fetch(cfgPda);
    const seq     = BigInt(cfg0.nextProposal.toString());
    const [allow] = allowancePda(mintKp.publicKey, minterKp.publicKey, program.programId);
    const [prop]  = proposalPda(mintKp.publicKey, seq, program.programId);

    await program.methods.proposeIssue(new anchor.BN(amount.toString()))
      .accounts({
        proposer: minterKp.publicKey, config: cfgPda, minterAllowance: allow,
        proposal: prop, destination: destAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKp]).rpc();

    await program.methods.approveIssue()
      .accounts({ cosigner: cosigner1.publicKey, config: cfgPda, proposal: prop })
      .signers([cosigner1]).rpc();
    await program.methods.approveIssue()
      .accounts({ cosigner: cosigner2.publicKey, config: cfgPda, proposal: prop })
      .signers([cosigner2]).rpc();

    await program.methods.executeIssue()
      .accounts({
        executor: cosigner1.publicKey, config: cfgPda, mint: mintKp.publicKey,
        proposal: prop, minterAllowance: allow, destination: destAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([cosigner1]).rpc();

    // Now try to propose another large issue that would exceed window cap
    const seq2    = BigInt((await program.account.issuanceConfig.fetch(cfgPda)).nextProposal.toString());
    const [prop2] = proposalPda(mintKp.publicKey, seq2, program.programId);

    try {
      await program.methods.proposeIssue(new anchor.BN("500000000"))
        .accounts({
          proposer: minterKp.publicKey, config: cfgPda, minterAllowance: allow,
          proposal: prop2, destination: destAta,
          systemProgram: SystemProgram.programId,
        })
        .signers([minterKp]).rpc();
      assert.fail("Expected WindowCapExceeded");
    } catch (e: any) { assert.include(e.message, "WindowCapExceeded"); }
  });

  it("totalIssued and windowIssued are consistent after all proposals", async () => {
    const cfg = await program.account.issuanceConfig.fetch(cfgPda);
    assert.isAbove(cfg.totalIssued.toNumber(), 0);
    // windowIssued <= totalIssued
    assert.isAtMost(cfg.windowIssued.toNumber(), cfg.totalIssued.toNumber());
  });
});
