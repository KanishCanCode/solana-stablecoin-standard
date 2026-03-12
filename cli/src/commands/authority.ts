/**
 * sss authority handover --mint <pk> --incoming <pubkey>
 * sss authority accept   --mint <pk>
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { Connection, PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import ora   from "ora";
import { loadKeypair, resolveCluster, loadProgram } from "../util";
import { configPda } from "../../sdk/src/pda";   // renamed from findConfigPda

type AuthAction = "handover" | "accept";
interface AuthArgs {
  cluster: string; keypair: string; quiet: boolean;
  mint: string;
  action: AuthAction;
  incoming?: string;
}

export const authorityCommand: CommandModule<{}, AuthArgs> = {
  command:  "authority <action>",
  describe: "Two-step authority handover (timelocked 24h on Tier-3)",
  builder:  y => y
    .positional("action", { type: "string", choices: ["handover", "accept"] as const })
    .option("mint",     { type: "string", demandOption: true })
    .option("incoming", { type: "string", describe: "Incoming authority pubkey (handover only)" }),
  handler: async (argv: ArgumentsCamelCase<AuthArgs>) => {
    const spinner = ora({ isSilent: argv.quiet });
    const signer  = loadKeypair(argv.keypair);
    const conn    = new Connection(resolveCluster(argv.cluster), "confirmed");
    const program = await loadProgram(conn, signer);
    const mint    = new PublicKey(argv.mint);
    const [cfgPda] = configPda(mint, program.programId);  // renamed
    try {
      if (argv.action === "handover") {
        if (!argv.incoming) throw new Error("--incoming required");
        spinner.start("Initiating handover...");
        const sig = await program.methods.initHandover(new PublicKey(argv.incoming))  // `initHandover`
          .accounts({ authority: signer.publicKey, config: cfgPda })
          .signers([signer]).rpc();
        spinner.succeed(chalk.green("Handover initiated. Pending: " + argv.incoming));
        console.log(chalk.dim("  tx: " + sig));
      } else {
        spinner.start("Accepting handover...");
        const sig = await program.methods.acceptHandover()   // `acceptHandover`
          .accounts({ pending: signer.publicKey, config: cfgPda })
          .signers([signer]).rpc();
        spinner.succeed(chalk.green("Authority accepted"));
        console.log(chalk.dim("  tx: " + sig));
      }
    } catch (err: any) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  },
};
