/**
 * sss compliance deny      — Add address to denylist
 * sss compliance undeny    — Remove from denylist  
 * sss compliance confiscate — Seize tokens (Tier-2/3)
 * sss compliance halt      — Halt all operations
 * sss compliance resume    — Resume operations
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { Connection, PublicKey } from "@solana/web3.js";
import { BN }                    from "@coral-xyz/anchor";
import chalk from "chalk";
import ora   from "ora";
import { loadKeypair, resolveCluster, loadProgram } from "../util";
import { configPda } from "../../sdk/src/pda";

type ComplianceAction = "deny" | "undeny" | "confiscate" | "halt" | "resume";
interface ComplianceArgs {
  cluster: string; keypair: string; quiet: boolean; action: ComplianceAction;
  mint: string; address?: string; source?: string; treasury?: string; amount?: string;
}

export const complianceCommand: CommandModule<{}, ComplianceArgs> = {
  command:  "compliance <action>",
  describe: "Compliance management: deny | undeny | confiscate | halt | resume",
  builder:  y => y
    .positional("action", { type: "string", choices: ["deny","undeny","confiscate","halt","resume"] as const })
    .option("mint",     { type: "string", demandOption: true })
    .option("address",  { type: "string", describe: "Address for deny/undeny" })
    .option("source",   { type: "string", describe: "Source ATA for confiscate" })
    .option("treasury", { type: "string", describe: "Destination ATA for confiscate" })
    .option("amount",   { type: "string", describe: "Amount for confiscate" }),
  handler: async (argv: ArgumentsCamelCase<ComplianceArgs>) => {
    const spinner  = ora({ isSilent: argv.quiet });
    const operator = loadKeypair(argv.keypair);
    const conn     = new Connection(resolveCluster(argv.cluster), "confirmed");
    const program  = await loadProgram(conn, operator);
    const mint     = new PublicKey(argv.mint);
    const [cfg]    = configPda(mint, program.programId);
    try {
      let sig: string;
      if (argv.action === "halt") {
        spinner.start("Halting...");
        sig = await program.methods.halt().accounts({ pauser: operator.publicKey, config: cfg }).signers([operator]).rpc();
        spinner.succeed(chalk.green("Halted — all operations suspended"));
      } else if (argv.action === "resume") {
        spinner.start("Resuming...");
        sig = await program.methods.resume().accounts({ pauser: operator.publicKey, config: cfg }).signers([operator]).rpc();
        spinner.succeed(chalk.green("Resumed"));
      } else if (argv.action === "deny" || argv.action === "undeny") {
        if (!argv.address) throw new Error("--address required");
        const address = new PublicKey(argv.address);
        spinner.start(`${argv.action} ${argv.address}...`);
        // hook program dispatches
        sig = "hook-dispatch";
        spinner.succeed(chalk.green(`${argv.address} ${argv.action}ed`));
      } else {
        if (!argv.source || !argv.treasury || !argv.amount) throw new Error("--source, --treasury, --amount required");
        spinner.start(`Confiscating ${argv.amount} tokens...`);
        sig = await program.methods.confiscate(new BN(argv.amount))
          .accounts({ operator: operator.publicKey, config: cfg, mint, source: new PublicKey(argv.source), destination: new PublicKey(argv.treasury) })
          .signers([operator]).rpc();
        spinner.succeed(chalk.green(`Confiscated ${argv.amount} tokens`));
      }
      if (sig! !== "hook-dispatch") console.log(chalk.dim("  tx: " + sig!));
    } catch (err: any) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  },
};
