/**
 * @module factory
 * `IssuerClient` tier-aware factory methods.
 *
 * Entry point for all SDK consumers:
 *   `IssuerClient.forTier(tier, wallet, opts?)` — returns the minimal client
 *   supporting the requested tier.
 */
import { Program, Idl, Wallet } from "@coral-xyz/anchor";
import { IssuerClient }                          from "./issuer";
import { CompliantClient, InstitutionalClient }  from "./compliant";
import { Tier, IssuerClientOptions }              from "./types";

// Re-export as IssuerClient static factory (augmented below) so consumers
// can do:  `const c = IssuerClient.forTier(Tier.Institutional, wallet)`

declare module "./issuer" {
  interface IssuerClient {
    /** Alias: re-attach an IDL program after construction. */
    _attachProgram(program: Program): void;
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace IssuerClient {
    function forTier(tier: Tier, wallet: Wallet, opts?: IssuerClientOptions): IssuerClient;
    function minimal(wallet: Wallet, opts?: IssuerClientOptions): IssuerClient;
    function compliant(wallet: Wallet, opts?: IssuerClientOptions): CompliantClient;
    function institutional(wallet: Wallet, opts?: IssuerClientOptions): InstitutionalClient;
    function attachProgram(client: IssuerClient, idl: Idl): void;
  }
}

// ─── Static factory helper ───────────────────────────────────────────────────

export class IssuerClientFactory {
  /**
   * Returns the minimal client that supports the requested tier.
   *
   * | Tier          | Client               |
   * |---------------|----------------------|
   * | Minimal       | IssuerClient         |
   * | Compliant     | CompliantClient      |
   * | Institutional | InstitutionalClient  |
   */
  static forTier(tier: Tier, wallet: Wallet, opts?: IssuerClientOptions): IssuerClient {
    switch (tier) {
      case Tier.Minimal:       return new IssuerClient(wallet, opts);
      case Tier.Compliant:     return new CompliantClient(wallet, opts);
      case Tier.Institutional: return new InstitutionalClient(wallet, opts);
      default: throw new Error(`Unknown tier: ${tier}`);
    }
  }

  static minimal(w: Wallet, o?: IssuerClientOptions):       IssuerClient        { return new IssuerClient(w, o); }
  static compliant(w: Wallet, o?: IssuerClientOptions):     CompliantClient      { return new CompliantClient(w, o); }
  static institutional(w: Wallet, o?: IssuerClientOptions): InstitutionalClient  { return new InstitutionalClient(w, o); }

  /** Attach a loaded Anchor IDL program to a client before making on-chain calls. */
  static attachProgram(client: IssuerClient, idl: Idl): void {
    client._attachProgram(new Program(idl, client.provider));
  }
}
