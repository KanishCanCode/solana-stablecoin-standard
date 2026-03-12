"use client";
import { Card, Flex, Text, Badge, Grid, Separator, Code, Callout, Spinner } from "@radix-ui/themes";
import { useCoin } from "../lib/hooks";

const TIER_LABELS: Record<number, { label: string; color: "gray" | "cyan" | "blue" }> = {
  0: { label: "Tier-1 Minimal",      color: "gray" },
  1: { label: "Tier-2 Compliant",    color: "cyan" },
  2: { label: "Tier-3 Institutional", color: "blue" },
};

interface Props { mint: string | null; }

export function OverviewPanel({ mint }: Props) {
  const { coin, isLoading, error } = useCoin(mint);

  if (!mint) {
    return <Card><Text color="gray">Select a stablecoin above to view its configuration.</Text></Card>;
  }
  if (isLoading) {
    return <Card><Flex justify="center" p="6"><Spinner size="3" /></Flex></Card>;
  }
  if (error || !coin) {
    return (
      <Callout.Root color="red" variant="soft">
        <Callout.Text>Failed to load stablecoin data: {error?.message ?? "Not found"}</Callout.Text>
      </Callout.Root>
    );
  }

  const tierInfo = TIER_LABELS[coin.tier] ?? { label: `Tier-${coin.tier}`, color: "gray" as const };

  return (
    <Grid columns={{ initial: "1", md: "2" }} gap="4">
      {/* Identity */}
      <Card>
        <Text size="2" weight="bold" mb="3">Identity</Text>
        <Separator mb="3" />
        <Flex direction="column" gap="2">
          <Row label="Name"     value={coin.name} />
          <Row label="Symbol"   value={coin.symbol} />
          <Row label="Mint"     value={coin.mint.slice(0, 20) + "…"} mono />
          <Row label="Decimals" value={String(coin.decimals)} />
          <Row label="Tier">
            <Badge color={tierInfo.color} variant="soft">{tierInfo.label}</Badge>
          </Row>
          <Row label="Status">
            {coin.halted
              ? <Badge color="red">⏸ Halted</Badge>
              : <Badge color="green">▶ Active</Badge>
            }
          </Row>
        </Flex>
      </Card>

      {/* Roles */}
      <Card>
        <Text size="2" weight="bold" mb="3">Role Addresses</Text>
        <Separator mb="3" />
        <Flex direction="column" gap="2">
          <Row label="Authority"  value={`${coin.authority.slice(0,8)}…${coin.authority.slice(-4)}`}  mono />
          <Row label="Issuer"     value={`${coin.issuer.slice(0,8)}…${coin.issuer.slice(-4)}`}     mono />
          <Row label="Guardian"   value={`${coin.guardian.slice(0,8)}…${coin.guardian.slice(-4)}`}   mono />
          <Row label="Compliance" value={`${coin.compliance.slice(0,8)}…${coin.compliance.slice(-4)}`} mono />
        </Flex>
      </Card>

      {/* Supply stats */}
      <Card>
        <Text size="2" weight="bold" mb="3">Supply Stats</Text>
        <Separator mb="3" />
        <Flex direction="column" gap="2">
          <Row label="Total Issued"      value={fmtBig(coin.totalIssued, coin.decimals)} />
          <Row label="Total Retired"     value={fmtBig(coin.totalBurned, coin.decimals)} />
          <Row label="Total Confiscated" value={fmtBig(coin.totalSeized, coin.decimals)} />
          <Row label="Event Seq"         value={coin.eventSeq} />
        </Flex>
      </Card>

      {/* SSS-3 rate window */}
      <Card>
        <Text size="2" weight="bold" mb="3">Rate Window (Tier-3)</Text>
        <Separator mb="3" />
        {coin.tier < 2 ? (
          <Text size="1" color="gray">Not available for Tier-1/2</Text>
        ) : (
          <Flex direction="column" gap="2">
            <Row label="Window (s)"    value={coin.windowSecs} />
            <Row label="Window Cap"    value={fmtBig(coin.windowCap, coin.decimals)} />
            <Row label="Window Issued" value={fmtBig(coin.windowIssued, coin.decimals)} />
            <Row label="Co-sign Threshold" value={String(coin.cosignThreshold)} />
          </Flex>
        )}
      </Card>
    </Grid>
  );
}

function Row({ label, value, mono = false, children }: {
  label: string; value?: string; mono?: boolean; children?: React.ReactNode;
}) {
  return (
    <Flex justify="between" align="center">
      <Text size="1" color="gray">{label}</Text>
      {children ?? (mono
        ? <Code   size="1">{String(value ?? "—")}</Code>
        : <Text   size="1" weight="medium">{String(value ?? "—")}</Text>
      )}
    </Flex>
  );
}

/** Format a raw integer string as a human decimal given the token decimals. */
function fmtBig(raw: string, decimals: number): string {
  try {
    const n = BigInt(raw);
    const d = BigInt(10 ** decimals);
    const whole = n / d;
    const frac  = n % d;
    if (frac === 0n) return whole.toLocaleString();
    return `${whole.toLocaleString()}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
  } catch {
    return raw;
  }
}
