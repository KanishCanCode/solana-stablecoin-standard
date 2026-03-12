import React from "react";
import { Box, Text } from "ink";
import type { AppState } from "../app";

interface Props { state: AppState; conn: any; dispatch: React.Dispatch<any>; }

export function MintersPane({ state }: Props) {
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold color="cyan">Active Minters</Text>
      <Box marginTop={1} />
      <Box>
        <Box width={46}><Text bold dimColor>Minter Address</Text></Box>
        <Box width={18}><Text bold dimColor>Quota</Text></Box>
        <Box width={18}><Text bold dimColor>Minted</Text></Box>
        <Box width={10}><Text bold dimColor>Status</Text></Box>
      </Box>
      <Text dimColor>{"─".repeat(92)}</Text>
      {/* In live app: fetched from program accounts filtered by mint */}
      <Text color="yellow" dimColor>  No minter data — connect to cluster.</Text>
      <Box marginTop={2} />
      <Text dimColor>[↑ ↓] navigate rows   [Enter] configure   [D] deactivate</Text>
    </Box>
  );
}
