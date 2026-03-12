/**
 * sss issue — Deploy a new stablecoin.
 *
 * Examples:
 *   sss issue --name "Circle USD" --symbol CUSD --tier minimal
 *   sss issue --name "Corp USD" --symbol CORP --tier institutional \
 *             --window-secs 3600 --window-cap 1000000000 \
 *             --cosign-threshold 2 \
 *             --cosigners "key1,key2,key3"
 */

import type { ArgumentsCamelCase, CommandModule } from "yargs";
import { Connection, Keypair, PublicKey }          from "@solana/web3.js";
import chalk  from "chalk";
import ora    from "ora";
import { loadKeypair, buildProvider, loadProgram, resolveCluster } from "../util";
import { configPda } from "../../sdk/src/pda";

interface IssueArgs {
  cluster:         string;
  keypair:         string;
  quiet:           boolean;
  name:            string;
  symbol:          string;
  uri:             string;
  decimals:        number;
  tier:            "minimal" | "compliant" | "institutional";
  windowSecs:      number;
  windowCap:       string;
  cosignThreshold: number;
  cosigners:       string;
}

export const issueCommand: CommandModule<{}, IssueArgs> = {
  command:  "issue",
  describe: "Deploy a new stablecoin with the chosen compliance tier",

  builder: yargs =>
    yargs
      .option("name",     { type: "string", demandOption: true, describe: "Full name (max 32 chars)" })
      .option("symbol",   { type: "string", demandOption: true, describe: "Ticker symbol (max 10 chars)" })
      .option("uri",      { type: "string", default: "", describe: "Metadata URI" })
      .option("decimals", { type: "number", default: 6, describe: "Token decimal places" })
      .option("tier", {
        type:     "string",
        choices:  ["minimal", "compliant", "institutional"] as const,
        default:  "minimal",
        describe: "SSS compliance tier",
      })
      // Tier-3 rate window
      .option("window-secs", { type: "number", default: 0,   describe: "Rate-limit window (seconds)" })
      .option("window-cap",  { type: "string", default: "0", describe: "Max tokens issuable per window" })
      // Tier-3 co-sign gate
      .option("cosign-threshold", { type: "number", default: 0, describe: "Required approvals (0 = disabled)" })
      .option("cosigners", {
        type:    "string",
        default: "",
        describe: "Comma-separated co-signer pubkeys",
      }),

  handler: async (argv: ArgumentsCamelCase<IssueArgs>) => {
    const spinner = ora({ isSilent: argv.quiet });

    try {
      spinner.start("Loading keypair...");
      const payer   = loadKeypair(argv.keypair);
      const conn    = new Connection(resolveCluster(argv.cluster), "confirmed");
      const program = await loadProgram(conn, payer);
      spinner.succeed("Keypair loaded");

      const mintKp = Keypair.generate();
      const [cfgPda] = configPda(mintKp.publicKey, program.programId);

      const cosignerList: PublicKey[] = argv.cosigners
        ? argv.cosigners.split(",").filter(Boolean).map(s => new PublicKey(s.trim()))
        : [];

      const tierObj = { [argv.tier]: {} };

      spinner.start(`Deploying ${chalk.bold(argv.symbol)} (${argv.tier})...`);

      const sig = await program.methods
        .initialize({
          name:            argv.name,
          symbol:          argv.symbol,
          uri:             argv.uri,
          decimals:        argv.decimals,
          tier:            tierObj,          // field is `tier`
          windowSecs:      argv.windowSecs,  // field is `windowSecs`
          windowCap:       BigInt(argv.windowCap), // field is `windowCap`
          cosignThreshold: argv.cosignThreshold,   // field is `cosignThreshold`
          cosigners:       cosignerList,            // field is `cosigners`
        })
        .accounts({
          payer:        payer.publicKey,
          authority:    payer.publicKey,
          mint:         mintKp.publicKey,
          config:       cfgPda,
          hookProgram:  null,
        })
        .signers([payer, mintKp])
        .rpc();

      spinner.succeed(chalk.green("Stablecoin deployed!"));

      console.log("\n" + [
        chalk.bold("  Mint address: ") + chalk.cyan(mintKp.publicKey.toBase58()),
        chalk.bold("  Config PDA:   ") + chalk.cyan(cfgPda.toBase58()),
        chalk.bold("  Tier:         ") + chalk.yellow(argv.tier),  // label is "Tier"
        chalk.bold("  Transaction:  ") + chalk.dim(sig),
      ].join("\n") + "\n");

    } catch (err: any) {
      spinner.fail(chalk.red("Deploy failed: " + err.message));
      process.exit(1);
    }
  },
};
