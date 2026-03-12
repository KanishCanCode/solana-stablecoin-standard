#!/usr/bin/env node
/**
 * SSS Operator CLI
 */
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";

import { issueCommand }       from "./commands/issue";
import { retireCommand }      from "./commands/retire_cmd";
import { issueTokenCommand }  from "./commands/issue_cmd";
import { lockCommand }        from "./commands/freeze";
import { complianceCommand }  from "./commands/compliance";
import { rolesCommand }       from "./commands/roles";
import { authorityCommand }   from "./commands/authority";
import { proposalCommand }    from "./commands/proposal";
import { statusCommand }      from "./commands/status";

console.log(chalk.bold.cyan("\n  ◆ SSS Operator CLI\n"));

yargs(hideBin(process.argv))
  .scriptName("sss")
  .usage("$0 <command> [options]")
  .version("0.1.0")
  .alias("v", "version")
  .alias("h", "help")
  .option("cluster", { alias: "c", type: "string", description: "localnet | devnet | mainnet", default: "devnet", global: true })
  .option("keypair", { alias: "k", type: "string", description: "Path to keypair JSON", default: "~/.config/solana/id.json", global: true })
  .option("quiet",   { alias: "q", type: "boolean", description: "Suppress spinner output", default: false, global: true })
  .command(issueCommand)
  .command(issueTokenCommand)
  .command(retireCommand)
  .command(lockCommand)
  .command(complianceCommand)
  .command(rolesCommand)
  .command(authorityCommand)
  .command(proposalCommand)
  .command(statusCommand)
  .demandCommand(1, chalk.red("Please provide a command."))
  .strict()
  .recommendCommands()
  .wrap(Math.min(120, yargs(hideBin(process.argv)).terminalWidth()))
  .epilog(chalk.dim("Docs: https://github.com/your-org/solana-stablecoin-standard"))
  .parse();
