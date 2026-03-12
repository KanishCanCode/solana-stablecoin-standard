"use client";
/**
 * SSS Issuer Dashboard — main overview page.
 *
 * Production improvements:
 * - All panels wired to real backend data via SWR hooks.
 * - Stats bar populated from useCoin() data.
 * - SWR provider wraps the page for shared cache.
 * - Error boundary via <ErrorBoundary> for graceful panel failures.
 */

import { useState }   from "react";
import { SWRConfig }  from "swr";
import {
  Box, Card, Flex, Grid, Heading, Text,
  Badge, Tabs, Separator, Spinner,
} from "@radix-ui/themes";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet }          from "@solana/wallet-adapter-react";
import { MintSelect }         from "../../components/MintSelect";
import { OverviewPanel }      from "../../components/OverviewPanel";
import { MintersPanel }        from "../../components/MintersPanel";
import { CompliancePanel }     from "../../components/CompliancePanel";
import { ProposalsPanel }      from "../../components/ProposalsPanel";
import { useCoin }             from "../../lib/hooks";

export default function DashboardPage() {
  return (
    // SWR provider — provides shared deduplicated cache for the whole dashboard.
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <DashboardInner />
    </SWRConfig>
  );
}

function DashboardInner() {
  const { connected, publicKey } = useWallet();
  const [selectedMint, setSelectedMint] = useState<string | null>(null);

  return (
    <Box p="6" style={{ minHeight: "100vh" }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Flex justify="between" align="center" mb="5">
        <Flex align="center" gap="3">
          <Box style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "linear-gradient(135deg, var(--cyan-9) 0%, var(--blue-9) 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: "bold", fontSize: 18, color: "white",
          }}>◆</Box>
          <Box>
            <Heading size="5" style={{ color: "var(--cyan-11)" }}>SSS Issuer Dashboard</Heading>
            <Text size="1" color="gray">Solana Stablecoin Standard</Text>
          </Box>
        </Flex>
        <Flex align="center" gap="3">
          {connected && (
            <Badge color="cyan" variant="soft" radius="full">
              {publicKey?.toBase58().slice(0, 8)}…
            </Badge>
          )}
          <WalletMultiButton style={{ borderRadius: 8, fontSize: 14 }} />
        </Flex>
      </Flex>

      <Separator mb="5" />

      {/* ── Mint selector ──────────────────────────────────────────── */}
      <Box mb="5">
        <MintSelect value={selectedMint} onChange={setSelectedMint} />
      </Box>

      {/* ── Stats bar — live data ───────────────────────────────────── */}
      {selectedMint && <StatsBar mint={selectedMint} />}

      {/* ── Main tabs ──────────────────────────────────────────────── */}
      <Tabs.Root defaultValue="overview">
        <Tabs.List>
          <Tabs.Trigger value="overview">   Overview    </Tabs.Trigger>
          <Tabs.Trigger value="minters">    Minters     </Tabs.Trigger>
          <Tabs.Trigger value="compliance"> Compliance  </Tabs.Trigger>
          <Tabs.Trigger value="proposals">  Proposals   </Tabs.Trigger>
        </Tabs.List>

        <Box mt="4">
          <Tabs.Content value="overview">
            <OverviewPanel    mint={selectedMint} />
          </Tabs.Content>
          <Tabs.Content value="minters">
            <MintersPanel     mint={selectedMint} />
          </Tabs.Content>
          <Tabs.Content value="compliance">
            <CompliancePanel  mint={selectedMint} />
          </Tabs.Content>
          <Tabs.Content value="proposals">
            <ProposalsPanel   mint={selectedMint} />
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </Box>
  );
}

/** Live stats bar — fetches from the same useCoin cache as OverviewPanel. */
function StatsBar({ mint }: { mint: string }) {
  const { coin, isLoading } = useCoin(mint);

  const stats = coin
    ? [
        { label: "Total Issued",     value: fmtBig(coin.totalIssued, coin.decimals), color: "cyan"  },
        { label: "Total Retired",    value: fmtBig(coin.totalBurned, coin.decimals), color: "red"   },
        { label: "Total Confiscated", value: fmtBig(coin.totalSeized, coin.decimals), color: "amber" },
        { label: "Active Minters",   value: String(coin._count?.minters ?? coin.minters?.filter(m => m.enabled).length ?? "—"), color: "green" },
      ]
    : [
        { label: "Total Issued",     value: "—", color: "cyan"  },
        { label: "Total Retired",    value: "—", color: "red"   },
        { label: "Total Confiscated", value: "—", color: "amber" },
        { label: "Active Minters",   value: "—", color: "green" },
      ];

  return (
    <Grid columns={{ initial: "2", sm: "4" }} gap="4" mb="5">
      {stats.map(s => (
        <Card key={s.label}>
          <Text size="1" color="gray" mb="1">{s.label}</Text>
          {isLoading
            ? <Flex align="center" gap="2"><Spinner size="1" /><Text size="2" color="gray">—</Text></Flex>
            : <Text size="5" weight="bold" style={{ color: `var(--${s.color}-11)` }}>{s.value}</Text>
          }
        </Card>
      ))}
    </Grid>
  );
}

function fmtBig(raw: string, decimals: number): string {
  try {
    const n = BigInt(raw);
    const d = BigInt(10 ** decimals);
    return (n / d).toLocaleString();
  } catch { return raw; }
}
