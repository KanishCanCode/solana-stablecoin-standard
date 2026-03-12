/**
 * @module issuer
 * `IssuerClient` — Tier-1 (Minimal) operations.
 *
 * Renamed from `StablecoinClient` to be architecturally distinct.
 * Method names mirror the Rust instruction names exactly:
 *   issue()      — mint tokens
 *   retire()     — burn tokens
 *   lock()       — freeze account
 *   unlock()     — thaw account
 *   halt()       — pause
 *   resume()     — unpause
 *   registerMinter() / revokeMinter()
 *   assignRole()
 *   initHandover() / acceptHandover()
 */

import { Connection, PublicKey, Keypair, Commitment, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program, BN, Wallet }        from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID }                       from "@solana/spl-token";

import { configPda, allowancePda }            from "./pda";
import { IssuanceConfig, IssueParams, MinterAllowance, Tier, TxResult, IssuerClientOptions } from "./types";
import { CORE_PROGRAM_ID, DEFAULT_COMMITMENT, DEFAULT_RPC_URL } from "./constants";

export class IssuerClient {
  readonly connection: Connection;
  readonly provider:   AnchorProvider;
  program!:            Program;
  protected readonly opts: Required<IssuerClientOptions>;

  constructor(wallet: Wallet, opts: IssuerClientOptions = {}) {
    const rpcUrl:     string     = opts.rpcUrl     ?? DEFAULT_RPC_URL;
    const commitment: Commitment = opts.commitment  ?? DEFAULT_COMMITMENT;

    this.connection = new Connection(rpcUrl, commitment);
    this.provider   = new AnchorProvider(this.connection, wallet, {
      commitment,
      skipPreflight: opts.skipPreflight ?? false,
    });
    this.opts = {
      rpcUrl,
      commitment,
      skipPreflight:  opts.skipPreflight  ?? false,
      coreProgramId:  opts.coreProgramId  ?? CORE_PROGRAM_ID,
      hookProgramId:  opts.hookProgramId  ?? PublicKey.default,
    };
  }

  _attachProgram(program: Program): void { this.program = program; }

  // ─── PDA convenience ────────────────────────────────────────────────────────

  configPda(mint: PublicKey): PublicKey {
    return configPda(mint, this.opts.coreProgramId)[0];
  }

  allowancePda(mint: PublicKey, wallet: PublicKey): PublicKey {
    return allowancePda(mint, wallet, this.opts.coreProgramId)[0];
  }

  // ─── Fetch helpers ───────────────────────────────────────────────────────────

  async fetchConfig(mint: PublicKey): Promise<IssuanceConfig> {
    return this.program.account["issuanceConfig"].fetch(this.configPda(mint)) as Promise<IssuanceConfig>;
  }

  async fetchAllowance(mint: PublicKey, wallet: PublicKey): Promise<MinterAllowance> {
    return this.program.account["minterAllowance"].fetch(
      this.allowancePda(mint, wallet)
    ) as Promise<MinterAllowance>;
  }

  async isHalted(mint: PublicKey): Promise<boolean> {
    return (await this.fetchConfig(mint)).halted;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(payer: Keypair, params: IssueParams): Promise<{ mint: Keypair; configPda: PublicKey; signature: string }> {
    const mintKp    = Keypair.generate();
    const [cfgPda]  = configPda(mintKp.publicKey, this.opts.coreProgramId);
    const onChain   = buildOnChainParams(params);

    const sig = await this.program.methods
      .initialize(onChain)
      .accounts({ payer: payer.publicKey, authority: payer.publicKey, mint: mintKp.publicKey, config: cfgPda,
                  hookProgram: null, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([payer, mintKp])
      .rpc();

    return { mint: mintKp, configPda: cfgPda, signature: sig };
  }

  // ─── Token supply ────────────────────────────────────────────────────────────

  async issue(mint: PublicKey, wallet: Keypair, destination: PublicKey, amount: bigint): Promise<TxResult> {
    const [cfg]       = configPda(mint, this.opts.coreProgramId);
    const [allowance] = allowancePda(mint, wallet.publicKey, this.opts.coreProgramId);
    const sig = await this.program.methods.issue(new BN(amount.toString()))
      .accounts({ minter: wallet.publicKey, config: cfg, mint, minterAllowance: allowance, destination,
                  tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([wallet]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async retire(mint: PublicKey, holder: Keypair, source: PublicKey, amount: bigint): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.retire(new BN(amount.toString()))
      .accounts({ burner: holder.publicKey, config: cfg, mint, source, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([holder]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  // ─── Account control ─────────────────────────────────────────────────────────

  async lock(mint: PublicKey, operator: Keypair, tokenAccount: PublicKey): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.lock()
      .accounts({ operator: operator.publicKey, config: cfg, mint, tokenAccount, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([operator]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async unlock(mint: PublicKey, operator: Keypair, tokenAccount: PublicKey): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.unlock()
      .accounts({ operator: operator.publicKey, config: cfg, mint, tokenAccount, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([operator]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async halt(mint: PublicKey, guardian: Keypair): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.halt()
      .accounts({ pauser: guardian.publicKey, config: cfg })
      .signers([guardian]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async resume(mint: PublicKey, guardian: Keypair): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.resume()
      .accounts({ pauser: guardian.publicKey, config: cfg })
      .signers([guardian]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  // ─── Minter management ───────────────────────────────────────────────────────

  async registerMinter(mint: PublicKey, issuer: Keypair, wallet: PublicKey, cap: bigint): Promise<TxResult> {
    const [cfg]       = configPda(mint, this.opts.coreProgramId);
    const [allowance] = allowancePda(mint, wallet, this.opts.coreProgramId);
    const sig = await this.program.methods.registerMinter({ wallet, cap: new BN(cap.toString()) })
      .accounts({ masterMinter: issuer.publicKey, config: cfg, minterAllowance: allowance, mint,
                  systemProgram: SystemProgram.programId })
      .signers([issuer]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async revokeMinter(mint: PublicKey, issuer: Keypair, wallet: PublicKey): Promise<TxResult> {
    const [cfg]       = configPda(mint, this.opts.coreProgramId);
    const [allowance] = allowancePda(mint, wallet, this.opts.coreProgramId);
    const sig = await this.program.methods.revokeMinter()
      .accounts({ masterMinter: issuer.publicKey, config: cfg, minterAllowance: allowance })
      .signers([issuer]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  // ─── Role management ─────────────────────────────────────────────────────────

  async assignRole(mint: PublicKey, authority: Keypair, roleIndex: number, newAddress: PublicKey): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.assignRole({ role: roleIndex, newAddress })
      .accounts({ authority: authority.publicKey, config: cfg })
      .signers([authority]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  // ─── Authority handover ───────────────────────────────────────────────────────

  async initHandover(mint: PublicKey, authority: Keypair, incoming: PublicKey): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.initHandover(incoming)
      .accounts({ authority: authority.publicKey, config: cfg })
      .signers([authority]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }

  async acceptHandover(mint: PublicKey, incoming: Keypair): Promise<TxResult> {
    const [cfg] = configPda(mint, this.opts.coreProgramId);
    const sig = await this.program.methods.acceptHandover()
      .accounts({ pending: incoming.publicKey, config: cfg })
      .signers([incoming]).rpc();
    return { signature: sig, slot: await this.connection.getSlot() };
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function buildOnChainParams(p: IssueParams) {
  const tierKey = Tier[p.tier].toLowerCase();
  const base: any = {
    name: p.name, symbol: p.symbol, uri: p.uri, decimals: p.decimals,
    tier: { [tierKey]: {} },
    windowSecs: new BN(0), windowCap: new BN(0),
    cosignThreshold: 0, cosigners: [],
  };
  if (p.tier === Tier.Institutional) {
    const t = p as IssueParamsTier3;
    base.windowSecs       = new BN((t.windowSecs  ?? 0).toString());
    base.windowCap        = new BN((t.windowCap   ?? 0n).toString());
    base.cosignThreshold  = t.cosignThreshold  ?? 0;
    base.cosigners        = t.cosigners        ?? [];
  }
  return base;
}

type IssueParamsTier3 = import("./types").IssueParamsTier3;
