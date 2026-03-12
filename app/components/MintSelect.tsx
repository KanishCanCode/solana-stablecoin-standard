"use client";
import { Select, Flex, Text, Spinner } from "@radix-ui/themes";
import { useCoins } from "../lib/hooks";

const TIER_LABEL = ["Tier-1", "Tier-2", "Tier-3"];

interface MintSelectProps { value: string | null; onChange: (v: string | null) => void; }

export function MintSelect({ value, onChange }: MintSelectProps) {
  const { coins, isLoading } = useCoins();

  return (
    <Flex align="center" gap="3">
      <Text size="2" color="gray" style={{ whiteSpace: "nowrap" }}>Active Mint:</Text>
      {isLoading ? (
        <Spinner size="2" />
      ) : (
        <Select.Root value={value ?? ""} onValueChange={v => onChange(v || null)}>
          <Select.Trigger placeholder="Select a stablecoin…" style={{ minWidth: 320 }} />
          <Select.Content>
            {coins.length === 0 ? (
              <Select.Item value="" disabled>No stablecoins indexed yet</Select.Item>
            ) : (
              coins.map(c => (
                <Select.Item key={c.mint} value={c.mint}>
                  {c.symbol} — {c.mint.slice(0, 12)}… ({TIER_LABEL[c.tier] ?? `Tier-${c.tier}`})
                  {c.halted ? " ⏸" : ""}
                </Select.Item>
              ))
            )}
          </Select.Content>
        </Select.Root>
      )}
    </Flex>
  );
}
