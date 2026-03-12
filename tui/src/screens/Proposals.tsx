import React from "react";
import { Box, Text } from "ink";
import type { AppState } from "../app";

interface Props { state: AppState; conn: any; dispatch: React.Dispatch<any>; }

export function Proposals({ state }: Props) {
  const cfg  = state.config as any;
  // `tier` is { minimal:{} } | { compliant:{} } | { institutional:{} }
  const isS3 = cfg && Object.keys(cfg.tier ?? {})[0] === "institutional";  // was cfg.preset

  if (!isS3) {
    return (
      <Box paddingTop={1}>
        <Text color="yellow">Multi-sig proposals require SSS-3 Institutional tier.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold color="cyan">Multi-Sig Proposals</Text>
      <Text dimColor>
        {"  Threshold: "}{cfg?.cosignThreshold ?? "—"}   {/* was multisigThreshold */}
        {"  |  Next Proposal: "}{cfg?.nextProposal?.toString() ?? "—"}  {/* was nextProposalId */}
      </Text>
      <Box marginTop={1} />
      <Box>
        <Box width={8}><Text bold dimColor>Seq</Text></Box>   {/* was ID */}
        <Box width={14}><Text bold dimColor>Amount</Text></Box>
        <Box width={12}><Text bold dimColor>Votes</Text></Box>  {/* was Approvals */}
        <Box width={12}><Text bold dimColor>Status</Text></Box>
        <Box width={20}><Text bold dimColor>Expires</Text></Box>
      </Box>
      <Text dimColor>{"─".repeat(66)}</Text>
      <Text color="yellow" dimColor>  No proposals — connect to cluster.</Text>
      <Box marginTop={2} />
      <Text dimColor>[N] new proposal   [A] approve   [X] execute   [Enter] details</Text>
    </Box>
  );
}
