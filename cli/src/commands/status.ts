/**
 * sss status --mint <pubkey>
 *
 * Fetches and pretty-prints the full on-chain state of a stablecoin.
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { Connection, PublicKey } from "@solana/web3.js";
import { table }                  from "table";
import chalk from "chalk";
import ora   from "ora";
import { loadKeypair, resolveCluster, loadProgram } from "../util";
import { configPda }                                 from "../../sdk/src/pda";

const TIER_LABELS = ["Tier-1 Minimal", "Tier-2 Compliant", "Tier-3 Institutional"];

interface StatusArgs { cluster: string; keypair: string; quiet: boolean; mint: string; }

export const statusCommand: CommandModule<{}, StatusArgs> = {
  command:  "status",
  describe: "Display the full on-chain state of a stablecoin",
  builder: y => y.option("mint", { type: "string", demandOption: true }),

  handler: async (argv: ArgumentsCamelCase<StatusArgs>) => {
    const spinner = ora({ isSilent: argv.quiet });
    try {
      const payer    = loadKeypair(argv.keypair);
      const conn     = new Connection(resolveCluster(argv.cluster), "confirmed");
      const program  = await loadProgram(conn, payer);
      const mint     = new PublicKey(argv.mint);
      const [cfgPda] = configPda(mint, program.programId);  // renamed helper

      spinner.start("Fetching state...");
      
      const cfg = await program.account.issuanceConfig.fetch(cfgPda) as any;
      spinner.stop();

      
      const tierIdx  = cfg.tier.minimal ? 0 : cfg.tier.compliant ? 1 : 2;
      const tierLabel = chalk.bold(TIER_LABELS[tierIdx]);
      
      const haltLabel = cfg.halted ? chalk.red("⏸  HALTED") : chalk.green("▶  ACTIVE");

      console.log("\n" + chalk.bold.cyan("  ◆ Stablecoin Status\n"));
      console.log(table([
        ["Field", "Value"],
        ["Mint",        mint.toBase58()],
        ["Config PDA",  cfgPda.toBase58()],
        ["Tier",        tierLabel],        // label is "Tier"
        ["Status",      haltLabel],
        ["Authority",   cfg.authority.toBase58()],
        ["Issuer",      cfg.issuer.toBase58()],      
        ["Guardian",    cfg.guardian.toBase58()],    
        ["Compliance",  cfg.compliance.toBase58()],  
        ["Total Issued", cfg.totalIssued.toString()], 
        ["Total Burned", cfg.totalBurned.toString()],
        ["Total Seized", cfg.totalSeized.toString()],
        ["Event Seq",    cfg.eventSeq.toString()],   
      ], {
        header: { alignment: "left", content: chalk.bold("  Config") },
      }));

      if (tierIdx === 2) {
        console.log(table([
          ["Tier-3 Field", "Value"],
          ["Window (secs)",       cfg.windowSecs.toString()],       
          ["Window Cap",          cfg.windowCap.toString()],        
          ["Window Issued",       cfg.windowIssued.toString()],     
          ["CoSign Threshold",    cfg.cosignThreshold.toString()],  
          ["Next Proposal Seq",   cfg.nextProposal.toString()],     
          ["Pending Authority",
            cfg.pendingAuthority.equals(PublicKey.default) ? "—" : cfg.pendingAuthority.toBase58()],
        ]));
      }

    } catch (err: any) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  },
};
