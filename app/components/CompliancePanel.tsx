"use client";
import { useState } from "react";
import {
  Card, Flex, Text, Badge, Button, Table,
  TextField, Separator, Callout, Spinner,
} from "@radix-ui/themes";
import { useDenylist, useAddressCheck, useEvents } from "../lib/hooks";

interface Props { mint: string | null; }

export function CompliancePanel({ mint }: Props) {
  const [denyAddr,   setDenyAddr]   = useState("");
  const [checkAddr,  setCheckAddr]  = useState("");
  const [confiscSrc, setConfiscSrc] = useState("");
  const [confiscAmt, setConfiscAmt] = useState("");

  const { entries, isLoading: loadingList, error: listErr, mutate } = useDenylist(mint);
  const { result: checkResult, isLoading: checking } = useAddressCheck(mint, checkAddr);
  const { events, isLoading: loadingEvents } = useEvents(
    mint,
    { kind: "confiscated", limit: 20 },
  );

  if (!mint) return <Card><Text color="gray">Select a stablecoin above.</Text></Card>;

  const active = entries.filter(e => !e.removedAt);

  return (
    <Flex direction="column" gap="4">

      {/* Halt / Resume */}
      <Card>
        <Flex justify="between" align="center">
          <Flex direction="column" gap="1">
            <Text size="2" weight="bold">Operations Status</Text>
            <Text size="1" color="gray">
              Halting suspends all issuance and hook-gated transfers globally.
            </Text>
          </Flex>
          <Flex gap="2">
            <Button variant="soft" color="red"   size="2"
              onClick={() => alert("Connect wallet to sign halt transaction")}>
              Halt All
            </Button>
            <Button variant="soft" color="green" size="2"
              onClick={() => alert("Connect wallet to sign resume transaction")}>
              Resume
            </Button>
          </Flex>
        </Flex>
      </Card>

      {/* Address check */}
      <Card>
        <Text size="2" weight="bold" mb="3">Check Address</Text>
        <Separator mb="3" />
        <Flex gap="2" mb="2">
          <TextField.Root
            placeholder="Paste wallet address to check…"
            value={checkAddr}
            onChange={e => setCheckAddr(e.target.value)}
            style={{ flex: 1 }}
          />
          {checking && <Spinner size="2" />}
        </Flex>
        {checkResult && (
          <Callout.Root color={checkResult.denied ? "red" : "green"} variant="soft" size="1">
            <Callout.Text>
              {checkResult.denied
                ? `⛔ Denied — by ${checkResult.by?.slice(0,8)}… on ${checkResult.since ? new Date(checkResult.since).toLocaleDateString() : "?"}`
                : "✅ Address is clear"
              }
            </Callout.Text>
          </Callout.Root>
        )}
      </Card>

      {/* Denylist management */}
      <Card>
        <Flex justify="between" align="center" mb="3">
          <Text size="2" weight="bold">Denylist</Text>
          <Badge color="red" variant="soft">{active.length} denied</Badge>
        </Flex>
        <Separator mb="3" />
        <Flex gap="2" mb="4">
          <TextField.Root
            placeholder="Wallet address to deny"
            value={denyAddr}
            onChange={e => setDenyAddr(e.target.value)}
            style={{ flex: 1 }}
          />
          <Button color="red" size="2"
            onClick={() => alert("Connect wallet to sign lock transaction")}>
            Deny
          </Button>
          <Button color="cyan" size="2" variant="soft"
            onClick={() => alert("Connect wallet to sign unlock transaction")}>
            Clear
          </Button>
        </Flex>

        {loadingList ? (
          <Flex justify="center" p="4"><Spinner size="2" /></Flex>
        ) : listErr ? (
          <Callout.Root color="red" variant="soft" size="1">
            <Callout.Text>Failed to load denylist: {listErr.message}</Callout.Text>
          </Callout.Root>
        ) : active.length === 0 ? (
          <Callout.Root color="green" variant="soft" size="1">
            <Callout.Text>No addresses on the denylist.</Callout.Text>
          </Callout.Root>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Address</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Denied By</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Since</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {active.map(d => (
                <Table.Row key={d.id}>
                  <Table.Cell>
                    <Text size="1" style={{ fontFamily: "monospace" }}>
                      {d.address.slice(0,8)}…{d.address.slice(-4)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="1" style={{ fontFamily: "monospace" }}>
                      {d.deniedBy.slice(0,8)}…
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="1">{new Date(d.addedAt).toLocaleDateString()}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Button size="1" variant="ghost" color="green"
                      onClick={() => alert("Connect wallet to sign unlock transaction")}>
                      Clear
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>

      {/* Confiscation */}
      <Card>
        <Text size="2" weight="bold" mb="3">Confiscate Tokens</Text>
        <Separator mb="3" />
        <Text size="1" color="gray" mb="3">
          Transfer tokens from a non-compliant account to the treasury (Tier-2/3 only).
        </Text>
        <Flex gap="2" mb="4">
          <TextField.Root
            placeholder="Source ATA (base58)"
            value={confiscSrc}
            onChange={e => setConfiscSrc(e.target.value)}
            style={{ flex: 1 }}
          />
          <TextField.Root
            placeholder="Amount (raw units)"
            value={confiscAmt}
            onChange={e => setConfiscAmt(e.target.value)}
            style={{ width: 160 }}
          />
          <Button color="red" size="2"
            onClick={() => alert("Connect wallet to sign confiscate transaction")}>
            Confiscate
          </Button>
        </Flex>

        {/* Recent confiscation events */}
        {events.length > 0 && (
          <>
            <Text size="1" color="gray" mb="2">Recent confiscations</Text>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Tx</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Slot</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>When</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {events.map(e => (
                  <Table.Row key={e.id}>
                    <Table.Cell>
                      <a
                        href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
                        target="_blank" rel="noreferrer"
                        style={{ fontFamily: "monospace", fontSize: 12, color: "var(--cyan-11)" }}
                      >
                        {e.signature.slice(0,8)}…
                      </a>
                    </Table.Cell>
                    <Table.Cell><Text size="1">{e.slot}</Text></Table.Cell>
                    <Table.Cell><Text size="1">{new Date(e.indexedAt).toLocaleString()}</Text></Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </>
        )}
      </Card>
    </Flex>
  );
}
