/**
 * @module compliant
 * `CompliantClient` — Tier-2 denylist + confiscation.
 * `InstitutionalClient` — Tier-3 co-sign gate + window management.
 */

import { PublicKey, Keypair, AccountMeta, SystemProgram } from "@solana/web3.js";
import { BN, Program, Wallet }             from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID }            from "@solana/spl-token";

import { IssuerClient }                                      from "./issuer";
import { configPda, allowancePda, proposalPda, hookConfigPda, denylistEntryPda, extraMetaListPda } from "./pda";
import { IssuerClientOptions, ProposeResult, TxResult }      from "./types";

// ─── CompliantClient (Tier-2) ─────────────────────────────────────────────────

export class CompliantClient extends IssuerClient {
  /** sss-hook Anchor program — attach after construction via `IssuerClientFactory.attachProgram()` */
  hookProgram!: Program;

  constructor(wallet: Wallet, opts: IssuerClientOptions = {}) { super(wallet, opts); }

  // ─── Denylist (blacklist) ─────────────────────────────────────────────────

  async deny(mint: PublicKey, officer: Keypair, address: PublicKey): Promise<TxResult> {
    const [entry] = denylistEntryPda(mint, address, this.opts.hookProgramId);
    const sig = await this.hookProgram.methods.addToDenylist()
      .accounts({
        payer: officer.publicKey, compliance: officer.publicKey,
        address, mint, denylistEntry: entry,
        systemProgram: SystemProgram.programId,
      })
      .signers([officer]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async undeny(mint: PublicKey, officer: Keypair, address: PublicKey): Promise<TxResult> {
    const [entry] = denylistEntryPda(mint, address, this.opts.hookProgramId);
    const sig = await this.hookProgram.methods.removeFromDenylist()
      .accounts({ compliance: officer.publicKey, mint, address, denylistEntry: entry })
      .signers([officer]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async isDenied(mint: PublicKey, address: PublicKey): Promise<boolean> {
    const [pda] = denylistEntryPda(mint, address, this.opts.hookProgramId);
    const info  = await this.connection.getAccountInfo(pda);
    return info !== null && info.data.length > 0;
  }

  // ─── Confiscate (seize) ───────────────────────────────────────────────────

  async confiscate(mint: PublicKey, officer: Keypair, source: PublicKey, treasury: PublicKey, amount: bigint): Promise<TxResult> {
    const [cfg]     = configPda(mint, this.opts.coreProgramId);
    const remaining = await this._buildHookAccounts(mint, source, treasury);
    const sig = await this.program.methods.confiscate(new BN(amount.toString()))
      .accounts({ operator: officer.publicKey, config: cfg, mint, source, destination: treasury,
                  tokenProgram: TOKEN_2022_PROGRAM_ID })
      .remainingAccounts(remaining)
      .signers([officer]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  protected async _buildHookAccounts(mint: PublicKey, source: PublicKey, dest: PublicKey): Promise<AccountMeta[]> {
    const pid = this.opts.hookProgramId;
    return [
      { pubkey: extraMetaListPda(mint, pid)[0], isSigner: false, isWritable: false },
      { pubkey: hookConfigPda(mint, pid)[0],    isSigner: false, isWritable: false },
      { pubkey: denylistEntryPda(mint, source, pid)[0], isSigner: false, isWritable: false },
      { pubkey: denylistEntryPda(mint, dest,   pid)[0], isSigner: false, isWritable: false },
    ];
  }
}

// ─── InstitutionalClient (Tier-3) ─────────────────────────────────────────────

export class InstitutionalClient extends CompliantClient {
  constructor(wallet: Wallet, opts: IssuerClientOptions = {}) { super(wallet, opts); }

  // ─── Window management ────────────────────────────────────────────────────

  async setWindow(mint: PublicKey, authority: Keypair, windowSecs: number, windowCap: bigint): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.setWindow({ windowSecs: new BN(windowSecs), windowCap: new BN(windowCap.toString()) })
      .accounts({ authority: authority.publicKey, config: cfg })
      .signers([authority]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  // ─── Co-sign gate ─────────────────────────────────────────────────────────

  async proposeIssue(mint: PublicKey, proposer: Keypair, recipient: PublicKey, amount: bigint): Promise<ProposeResult> {
    const cfg      = await this.fetchConfig(mint);
    const seq      = BigInt(cfg.nextProposal.toString());
    const [cfgPda] = configPda(mint, this.opts.coreProgramId);
    const [allow]  = allowancePda(mint, proposer.publicKey, this.opts.coreProgramId);
    const [prop]   = proposalPda(mint, seq, this.opts.coreProgramId);

    const sig = await this.program.methods.proposeIssue(new BN(amount.toString()))
      .accounts({ proposer: proposer.publicKey, config: cfgPda, minterAllowance: allow, proposal: prop,
                  destination: recipient,          // Rust struct field is `destination`
                  systemProgram: SystemProgram.programId })
      .signers([proposer]).rpc();

    return { signature: sig, slot: await this.connection.getSlot(), seq: cfg.nextProposal, proposalPda: prop };
  }

  async approveIssue(mint: PublicKey, cosigner: Keypair, seq: bigint): Promise<TxResult> {
    const [cfg]  = configPda(mint, this.opts.coreProgramId);
    const [prop] = proposalPda(mint, seq, this.opts.coreProgramId);
    const sig = await this.program.methods.approveIssue()
      .accounts({ cosigner: cosigner.publicKey, config: cfg, proposal: prop })
      .signers([cosigner]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async executeIssue(mint: PublicKey, executor: Keypair, seq: bigint): Promise<TxResult> {
    const [cfg]   = configPda(mint, this.opts.coreProgramId);
    const [prop]  = proposalPda(mint, seq, this.opts.coreProgramId);
    const pending = await this.program.account["mintProposal"].fetch(prop) as any;
    const [allow] = allowancePda(mint, pending.proposer, this.opts.coreProgramId);

    const sig = await this.program.methods.executeIssue()
      .accounts({ executor: executor.publicKey, config: cfg, mint, proposal: prop,
                  minterAllowance: allow, destination: pending.recipient,
                  tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([executor]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }
}
