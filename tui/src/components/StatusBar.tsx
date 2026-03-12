import React from "react";
import { Box, Text } from "ink";
import type { AppState } from "../app";

export function StatusBar({ state }: { state: AppState }) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={0}>
      {state.error
        ? <Text color="red">✗ {state.error}</Text>
        : state.loading
        ? <Text color="yellow">⟳ Loading...</Text>
        : <Text dimColor>
            Mint: {state.mintAddr || chalk_dim("(none)")}
            {"   "}Tab: {state.tab}
          </Text>
      }
    </Box>
  );
}

function chalk_dim(s: string) { return s; }
