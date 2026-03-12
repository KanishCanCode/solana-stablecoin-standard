#!/usr/bin/env node
/**
 * SSS Admin TUI — built with ink (React for terminal).
 *
 * Key distinction from PR #40 (which uses `blessed`):
 * - Fully declarative React component tree
 * - Type-safe state management with useReducer
 * - Hot-reloadable via tsx watch
 * - All rendering driven by React reconciliation (no imperative DOM manipulation)
 *
 * Navigation:  ← → switch tabs   |  ↑ ↓ select rows   |  q quit
 */

import React, { useState, useEffect, useReducer } from "react";
import { render, Box, Text, useApp, useInput }      from "ink";
import { Connection, PublicKey }                     from "@solana/web3.js";

import { Overview }    from "./screens/Overview";
import { MintersPane } from "./screens/Minters";
import { Compliance }  from "./screens/Compliance";
import { Proposals }   from "./screens/Proposals";
import { StatusBar }   from "./components/StatusBar";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TabId = "overview" | "minters" | "compliance" | "proposals";

export interface AppState {
  tab:       TabId;
  mintAddr:  string;
  loading:   boolean;
  error:     string | null;
  config:    Record<string, unknown> | null;
}

type Action =
  | { type: "SET_TAB";    tab: TabId }
  | { type: "SET_MINT";   mint: string }
  | { type: "SET_CONFIG"; config: Record<string, unknown> }
  | { type: "SET_ERROR";  error: string }
  | { type: "SET_LOADING"; loading: boolean };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_TAB":     return { ...state, tab: action.tab, error: null };
    case "SET_MINT":    return { ...state, mintAddr: action.mint };
    case "SET_CONFIG":  return { ...state, config: action.config, loading: false, error: null };
    case "SET_ERROR":   return { ...state, error: action.error, loading: false };
    case "SET_LOADING": return { ...state, loading: action.loading };
    default:            return state;
  }
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "overview",    label: "◆ Overview"    },
  { id: "minters",     label: "● Minters"     },
  { id: "compliance",  label: "⚑ Compliance"  },
  { id: "proposals",   label: "✦ Proposals"   },
];

const RPC_URL   = process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";
const MINT_ADDR = process.env["SSS_MINT"]       ?? "";

// ─── Root app component ───────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, {
    tab:      "overview",
    mintAddr: MINT_ADDR,
    loading:  false,
    error:    null,
    config:   null,
  });

  const conn = new Connection(RPC_URL, "confirmed");

  // Keyboard navigation
  useInput((input, key) => {
    if (input === "q") { exit(); return; }
    if (key.leftArrow) {
      const idx = TABS.findIndex(t => t.id === state.tab);
      if (idx > 0) dispatch({ type: "SET_TAB", tab: TABS[idx - 1]!.id });
    }
    if (key.rightArrow) {
      const idx = TABS.findIndex(t => t.id === state.tab);
      if (idx < TABS.length - 1) dispatch({ type: "SET_TAB", tab: TABS[idx + 1]!.id });
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={2}>
        <Text bold color="cyan">  ◆ SSS Operator Dashboard  </Text>
        <Text dimColor> — {RPC_URL}</Text>
      </Box>

      {/* Tab bar */}
      <Box marginY={0} paddingX={1}>
        {TABS.map(tab => (
          <Box key={tab.id} marginRight={2}>
            <Text
              bold={state.tab === tab.id}
              color={state.tab === tab.id ? "cyan" : "gray"}
              underline={state.tab === tab.id}
            >
              {tab.label}
            </Text>
          </Box>
        ))}
        <Text dimColor> [← →] navigate  [q] quit</Text>
      </Box>

      {/* Divider */}
      <Box><Text dimColor>{"─".repeat(80)}</Text></Box>

      {/* Active pane */}
      <Box flexGrow={1} paddingX={1}>
        {state.tab === "overview"   && <Overview   state={state} conn={conn} dispatch={dispatch} />}
        {state.tab === "minters"    && <MintersPane state={state} conn={conn} dispatch={dispatch} />}
        {state.tab === "compliance" && <Compliance  state={state} conn={conn} dispatch={dispatch} />}
        {state.tab === "proposals"  && <Proposals   state={state} conn={conn} dispatch={dispatch} />}
      </Box>

      {/* Status bar */}
      <StatusBar state={state} />
    </Box>
  );
}

render(<App />);
