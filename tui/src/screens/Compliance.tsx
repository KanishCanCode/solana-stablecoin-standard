import React from "react";
import { Box, Text } from "ink";
import type { AppState } from "../app";

interface Props { state: AppState; conn: any; dispatch: React.Dispatch<any>; }

export function Compliance({ state }: Props) {
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold color="cyan">Compliance — Blacklist</Text>
      <Box marginTop={1} />
      <Box>
        <Box width={46}><Text bold dimColor>Address</Text></Box>
        <Box width={20}><Text bold dimColor>Added By</Text></Box>
        <Box width={22}><Text bold dimColor>Since</Text></Box>
      </Box>
      <Text dimColor>{"─".repeat(88)}</Text>
      <Text color="green" dimColor>  No blacklisted addresses.</Text>
      <Box marginTop={2} />
      <Text dimColor>[B] blacklist address   [U] unblacklist   [S] seize tokens</Text>
    </Box>
  );
}
