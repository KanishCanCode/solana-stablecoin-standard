/**
 * sss retire — Retire (burn) tokens from a source ATA.
 *
 * Example:
 *   sss retire --mint <pk> --from <ata> --amount 1000000
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { Connection, PublicKey } from "@solana/web3.js";
import { BN }                    from "@coral-xyz/anchor";
import chalk from "chalk";
import ora   from "ora";
import { loadKeypair, resolveCluster, loadProgram } from "../util";
import { configPda }                                 from "../../sdk/src/pda";

interface RetireArgs { cluster: string; keypair: string; quiet: boolean; mint: string; from: string; amount: string; }

export const retireCommand: CommandModule<{}, RetireArgs> = {
  command: "retire", describe: "Retire (burn) tokens from a source ATA",
  builder: y => y
    .option("mint",   { type: "string", demandOption: true })
    .option("from",   { type: "string", demandOption: true, describe: "Source ATA" })
    .option("amount", { type: "string", demandOption: true }),
  handler: async (argv: ArgumentsCamelCase<RetireArgs>) => {
    const spinner = ora({ isSilent: argv.quiet });
    try {
      const holder  = loadKeypair(argv.keypair);
      const conn    = new Connection(resolveCluster(argv.cluster), "confirmed");
      const program = await loadProgram(conn, holder);
      const mint    = new PublicKey(argv.mint);
      const [cfg]   = configPda(mint, program.programId);
      spinner.start(`Retiring ${argv.amount} tokens...`);
      const sig = await program.methods.retire(new BN(argv.amount))
        .accounts({ burner: holder.publicKey, config: cfg, mint, source: new PublicKey(argv.from) })
        .signers([holder]).rpc();
      spinner.succeed(chalk.green(`Retired ${argv.amount} tokens`));
      console.log(chalk.dim("  tx: " + sig));
    } catch (err: any) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  },
};
