/**
 * sss proposal create  --mint <pk> --to <ata> --amount <n>
 * sss proposal approve --mint <pk> --proposal-seq <n>
 * sss proposal execute --mint <pk> --proposal-seq <n>
 * sss proposal list    --mint <pk>
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { Connection, PublicKey } from "@solana/web3.js";
import { BN }                    from "@coral-xyz/anchor";
import { table }                  from "table";
import chalk from "chalk";
import ora   from "ora";
import { loadKeypair, resolveCluster, loadProgram } from "../util";
import { configPda, allowancePda, proposalPda } from "../../sdk/src/pda";  // new names

type ProposalAction = "create" | "approve" | "execute" | "list";

interface ProposalArgs {
  cluster: string; keypair: string; quiet: boolean;
  action: ProposalAction;
  mint: string;
  to?: string;
  amount?: string;
  proposalSeq?: number;
}

export const proposalCommand: CommandModule<{}, ProposalArgs> = {
  command:  "proposal <action>",
  describe: "Tier-3 co-sign issue proposals: create | approve | execute | list",
  builder: y => y
    .positional("action", { type: "string", choices: ["create", "approve", "execute", "list"] as const })
    .option("mint",        { type: "string", demandOption: true })
    .option("to",          { type: "string", describe: "Destination ATA (create)" })
    .option("amount",      { type: "string", describe: "Token amount (create)" })
    .option("proposal-seq", { type: "number", describe: "Proposal seq (approve/execute)" }),

  handler: async (argv: ArgumentsCamelCase<ProposalArgs>) => {
    const spinner  = ora({ isSilent: argv.quiet });
    const signer   = loadKeypair(argv.keypair);
    const conn     = new Connection(resolveCluster(argv.cluster), "confirmed");
    const program  = await loadProgram(conn, signer);
    const mint     = new PublicKey(argv.mint);
    const [cfgPda] = configPda(mint, program.programId);   

    try {
      if (argv.action === "list") {
        spinner.start("Fetching proposals...");
        
        const cfg = await program.account.issuanceConfig.fetch(cfgPda) as any;
        const rows = [["Seq", "Proposer", "Amount", "Votes", "Status"]];
        for (let i = 0; i < Number(cfg.nextProposal); i++) {  
          const [pda] = proposalPda(mint, BigInt(i), program.programId);
          try {
            const p = await program.account.mintProposal.fetch(pda) as any;
            const status = p.executed ? chalk.green("✓ executed")
              : new Date() > new Date(p.expiresTs.toNumber() * 1000) ? chalk.red("expired")
              : chalk.yellow("pending");
            rows.push([
              i.toString(),
              p.proposer.toBase58().slice(0, 8) + "…",
              p.amount.toString(),
              `${p.voteCount}/${cfg.cosignThreshold}`,  
              status,
            ]);
          } catch { /* proposal may not exist yet */ }
        }
        spinner.stop();
        if (rows.length > 1) console.log(table(rows));
        else console.log(chalk.dim("  No proposals found."));
        return;
      }

      if (argv.action === "create") {
        if (!argv.to || !argv.amount) throw new Error("--to and --amount required");
        const cfg        = await program.account.issuanceConfig.fetch(cfgPda) as any;
        const seq        = BigInt(cfg.nextProposal.toString());  
        const [allow]    = allowancePda(mint, signer.publicKey, program.programId);  
        const [proposal] = proposalPda(mint, seq, program.programId);
        spinner.start("Creating proposal...");
        const sig = await program.methods.proposeIssue(new BN(argv.amount))  
          .accounts({
            proposer:        signer.publicKey,
            config:          cfgPda,
            minterAllowance: allow,              
            proposal,
            destination:     new PublicKey(argv.to),
          })
          .signers([signer]).rpc();
        spinner.succeed(chalk.green(`Proposal #${seq} created`));
        console.log(chalk.dim("  tx: " + sig));
        return;
      }

      const proposalSeq = argv.proposalSeq;
      if (proposalSeq === undefined) throw new Error("--proposal-seq required");
      const [proposal] = proposalPda(mint, BigInt(proposalSeq), program.programId);

      if (argv.action === "approve") {
        spinner.start(`Approving proposal #${proposalSeq}...`);
        const sig = await program.methods.approveIssue()   
          .accounts({ cosigner: signer.publicKey, config: cfgPda, proposal })
          .signers([signer]).rpc();
        spinner.succeed(chalk.green(`Proposal #${proposalSeq} approved`));
        console.log(chalk.dim("  tx: " + sig));
      } else {
        spinner.start(`Executing proposal #${proposalSeq}...`);
        const p = await program.account.mintProposal.fetch(proposal) as any;
        const [allow] = allowancePda(mint, p.proposer, program.programId);
        const sig = await program.methods.executeIssue()   
          .accounts({
            executor:        signer.publicKey,
            config:          cfgPda,
            mint,
            proposal,
            minterAllowance: allow,              
            destination:     p.recipient,
          })
          .signers([signer]).rpc();
        spinner.succeed(chalk.green(`Proposal #${proposalSeq} executed`));
        console.log(chalk.dim("  tx: " + sig));
      }

    } catch (err: any) { spinner.fail(chalk.red(err.message)); process.exit(1); }
  },
};
