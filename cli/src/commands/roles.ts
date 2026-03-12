/**
 * sss roles set --mint <pk> --role issuer|guardian|compliance --new-address <pubkey>
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { Connection, PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import ora   from "ora";
import { loadKeypair, resolveCluster, loadProgram } from "../util";
import { configPda } from "../../sdk/src/pda";   // renamed from findConfigPda

// Role indices mirror ROLE_ISSUER / ROLE_GUARDIAN / ROLE_COMPLIANCE in state.rs
const ROLE_INDICES: Record<string, number> = {
  issuer:     0,   
  guardian:   1,   
  compliance: 2,   
};

interface RolesArgs {
  cluster: string; keypair: string; quiet: boolean;
  mint: string;
  role: string;
  newAddress: string;
}

export const rolesCommand: CommandModule<{}, RolesArgs> = {
  command: "roles", describe: "Manage functional role addresses",
  builder: y => y
    .option("mint",        { type: "string", demandOption: true })
    .option("role", {
      type:         "string",
      demandOption: true,
      choices:      ["issuer", "guardian", "compliance"],  // new role names
      describe:     "Role to update: issuer | guardian | compliance",
    })
    .option("new-address", { type: "string", demandOption: true }),
  handler: async (argv: ArgumentsCamelCase<RolesArgs>) => {
    const spinner   = ora({ isSilent: argv.quiet });
    const authority = loadKeypair(argv.keypair);
    const conn      = new Connection(resolveCluster(argv.cluster), "confirmed");
    const program   = await loadProgram(conn, authority);
    const mint      = new PublicKey(argv.mint);
    const [cfgPda]  = configPda(mint, program.programId);  // renamed
    try {
      spinner.start(`Updating ${argv.role}...`);
      const sig = await program.methods
        .assignRole({ role: ROLE_INDICES[argv.role], newAddress: new PublicKey(argv.newAddress) })  // `assignRole`
        .accounts({ authority: authority.publicKey, config: cfgPda })
        .signers([authority]).rpc();
      spinner.succeed(chalk.green(`${argv.role} → ${argv.newAddress}`));
      console.log(chalk.dim("  tx: " + sig));
    } catch (err: any) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  },
};
