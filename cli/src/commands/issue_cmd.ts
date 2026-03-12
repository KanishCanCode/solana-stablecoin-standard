/**
 * sss issue-tokens — Issue (mint) tokens to a destination ATA.
 *
 * Example:
 *   sss issue-tokens --mint <pk> --to <ata> --amount 1000000
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { Connection, PublicKey } from "@solana/web3.js";
import { BN }                    from "@coral-xyz/anchor";
import chalk from "chalk";
import ora   from "ora";
import { loadKeypair, resolveCluster, loadProgram } from "../util";
import { configPda, allowancePda }                  from "../../sdk/src/pda";

interface IssueTokenArgs { cluster: string; keypair: string; quiet: boolean; mint: string; to: string; amount: string; }

export const issueTokenCommand: CommandModule<{}, IssueTokenArgs> = {
  command:  "issue-tokens",
  describe: "Issue (mint) tokens to a destination ATA",
  builder: y => y
    .option("mint",   { type: "string", demandOption: true, describe: "Mint address" })
    .option("to",     { type: "string", demandOption: true, describe: "Destination ATA" })
    .option("amount", { type: "string", demandOption: true, describe: "Raw amount (integer)" }),
  handler: async (argv: ArgumentsCamelCase<IssueTokenArgs>) => {
    const spinner = ora({ isSilent: argv.quiet });
    try {
      const minter   = loadKeypair(argv.keypair);
      const conn     = new Connection(resolveCluster(argv.cluster), "confirmed");
      const program  = await loadProgram(conn, minter);
      const mint     = new PublicKey(argv.mint);
      const [cfg]    = configPda(mint, program.programId);
      const [allow]  = allowancePda(mint, minter.publicKey, program.programId);
      spinner.start(`Issuing ${chalk.bold(argv.amount)} tokens...`);
      const sig = await program.methods.issue(new BN(argv.amount))
        .accounts({ minter: minter.publicKey, config: cfg, mint, minterAllowance: allow, destination: new PublicKey(argv.to) })
        .signers([minter]).rpc();
      spinner.succeed(chalk.green(`Issued ${argv.amount} tokens`));
      console.log(chalk.dim("  tx: " + sig));
    } catch (err: any) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  },
};
