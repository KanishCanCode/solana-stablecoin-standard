import React, { useEffect } from "react";
import { Box, Text }         from "ink";
import Spinner               from "ink-spinner";
import { Connection }        from "@solana/web3.js";
import type { AppState }     from "../app";

interface Props {
  state:    AppState;
  conn:     Connection;
  dispatch: React.Dispatch<any>;
}

const TIER_LABELS: Record<string, string> = {
  minimal:       "SSS-1 Minimal",
  compliant:     "SSS-2 Compliant",
  institutional: "SSS-3 Institutional",
};

function Row({ label, value, color = "white" }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Box width={24}><Text dimColor>{label}</Text></Box>
      <Text color={color as any}>{value}</Text>
    </Box>
  );
}

export function Overview({ state, conn, dispatch }: Props) {
  const cfg = state.config as any;

  useEffect(() => {
    if (!state.mintAddr || state.config) return;
    // In a live app: fetch IssuanceConfig from Anchor program via conn
    // dispatch({ type: "SET_LOADING", loading: true });
  }, [state.mintAddr]);

  if (!state.mintAddr) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text color="yellow">No mint address configured.</Text>
        <Text dimColor>Set SSS_MINT=&lt;pubkey&gt; environment variable.</Text>
      </Box>
    );
  }

  if (state.loading) {
    return <Box><Text color="cyan"><Spinner type="dots" />  Loading...</Text></Box>;
  }

  if (!cfg) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text dimColor>Mint: {state.mintAddr}</Text>
        <Text color="yellow">Connect to cluster to load state.</Text>
      </Box>
    );
  }

  // `tier` is an enum variant object from Anchor: { minimal: {} } | { compliant: {} } | { institutional: {} }
  const tierKey = Object.keys(cfg.tier ?? {})[0] ?? "unknown";
  const halted  = cfg.halted;  // was cfg.paused

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Stablecoin Overview</Text>
        <Text>  </Text>
        {halted
          ? <Text bold color="red">⏸  HALTED</Text>
          : <Text bold color="green">▶  ACTIVE</Text>
        }
      </Box>

      <Row label="Tier"        value={TIER_LABELS[tierKey] ?? tierKey}          color="cyan" />
      <Row label="Mint"        value={state.mintAddr}                            color="white" />
      <Row label="Authority"   value={cfg.authority?.toBase58?.()   ?? "—"} />
      <Row label="Issuer"      value={cfg.issuer?.toBase58?.()      ?? "—"} />  {/* was masterMinter */}
      <Row label="Guardian"    value={cfg.guardian?.toBase58?.()    ?? "—"} />  {/* was pauser */}
      <Row label="Compliance"  value={cfg.compliance?.toBase58?.()  ?? "—"} />  {/* was blacklister */}
      <Box marginTop={1} />
      <Row label="Total Issued"      value={cfg.totalIssued?.toString()  ?? "0"} color="green" />  {/* was totalMinted */}
      <Row label="Total Retired"     value={cfg.totalBurned?.toString()  ?? "0"} color="red"   />
      <Row label="Total Confiscated" value={cfg.totalSeized?.toString()  ?? "0"} color="yellow"/>
      <Row label="Event Seq"         value={cfg.eventSeq?.toString()     ?? "0"} />             {/* was seq */}

      {tierKey === "institutional" && (
        <>
          <Box marginTop={1} />
          <Text bold color="cyan">SSS-3 Institutional</Text>
          <Row label="Window (s)"      value={cfg.windowSecs?.toString()      ?? "0"} />  {/* was rateWindowSeconds */}
          <Row label="Window Cap"      value={cfg.windowCap?.toString()       ?? "0"} />  {/* was rateLimitPerWindow */}
          <Row label="Window Issued"   value={cfg.windowIssued?.toString()    ?? "0"} />  {/* was rateWindowMinted */}
          <Row label="Cosign Threshold" value={cfg.cosignThreshold?.toString() ?? "0"} />  {/* was multisigThreshold */}
          <Row label="Next Proposal"   value={cfg.nextProposal?.toString()    ?? "0"} />  {/* was nextProposalId */}
        </>
      )}
    </Box>
  );
}
