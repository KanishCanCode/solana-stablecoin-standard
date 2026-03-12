"use client";
import { useState } from "react";
import {
  Card, Flex, Text, Badge, Button, Table,
  TextField, Dialog, Separator, Callout, Spinner,
} from "@radix-ui/themes";
import { useCoin } from "../lib/hooks";

interface Props { mint: string | null; }

export function MintersPanel({ mint }: Props) {
  const { coin, isLoading, error, mutate } = useCoin(mint);
  const [open,   setOpen]   = useState(false);
  const [wallet, setWallet] = useState("");
  const [cap,    setCap]    = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  if (!mint) return <Card><Text color="gray">Select a stablecoin above.</Text></Card>;

  if (isLoading) return <Card><Flex justify="center" p="6"><Spinner size="3" /></Flex></Card>;

  if (error || !coin) {
    return (
      <Callout.Root color="red" variant="soft">
        <Callout.Text>Failed to load minters: {error?.message ?? "Unknown error"}</Callout.Text>
      </Callout.Root>
    );
  }

  const minters = coin.minters ?? [];

  const handleRegister = async () => {
    if (!wallet.trim() || !cap.trim()) return;
    setSaving(true);
    setSaveErr(null);
    try {
      // In a full integration this would construct + sign the Anchor transaction
      // via the IssuerClient SDK and submit it on-chain.  The indexer then
      // picks up the MinterRegistered event and updates the DB automatically.
      throw new Error("Connect wallet to sign on-chain transaction");
    } catch (err: any) {
      setSaveErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Flex direction="column" gap="1">
          <Text size="3" weight="bold">Active Minters</Text>
          <Text size="1" color="gray">{minters.filter(m => m.enabled).length} enabled</Text>
        </Flex>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger>
            <Button variant="solid" color="cyan" size="2">+ Register Minter</Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="480px">
            <Dialog.Title>Register Minter</Dialog.Title>
            <Dialog.Description color="gray" size="2">
              Add a minter wallet and set its lifetime issuance cap. Requires issuer role.
            </Dialog.Description>
            <Separator mt="3" mb="4" />
            <Flex direction="column" gap="3">
              <Flex direction="column" gap="1">
                <Text size="1" weight="bold">Wallet Address</Text>
                <TextField.Root
                  placeholder="Base58 public key"
                  value={wallet}
                  onChange={e => setWallet(e.target.value)}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="1" weight="bold">Lifetime Cap (raw units, {coin.decimals} decimals)</Text>
                <TextField.Root
                  placeholder={`e.g. ${10 ** coin.decimals * 1_000_000}`}
                  value={cap}
                  onChange={e => setCap(e.target.value)}
                />
              </Flex>
              {saveErr && (
                <Callout.Root color="red" variant="soft" size="1">
                  <Callout.Text>{saveErr}</Callout.Text>
                </Callout.Root>
              )}
            </Flex>
            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">Cancel</Button>
              </Dialog.Close>
              <Button color="cyan" onClick={handleRegister} disabled={saving}>
                {saving ? <Spinner size="1" /> : "Register"}
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>

      <Card>
        {minters.length === 0 ? (
          <Callout.Root color="gray" variant="soft" size="1">
            <Callout.Text>No minters registered yet.</Callout.Text>
          </Callout.Root>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Wallet</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Cap</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Issued</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Remaining</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {minters.map(m => {
                const remaining = BigInt(m.cap) - BigInt(m.issued);
                return (
                  <Table.Row key={m.wallet}>
                    <Table.Cell>
                      <Text size="1" style={{ fontFamily: "monospace" }}>
                        {m.wallet.slice(0, 8)}…{m.wallet.slice(-4)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell><Text size="1">{fmtRaw(m.cap)}</Text></Table.Cell>
                    <Table.Cell><Text size="1">{fmtRaw(m.issued)}</Text></Table.Cell>
                    <Table.Cell>
                      <Text size="1" color={remaining <= 0n ? "red" : "green"}>
                        {remaining <= 0n ? "0" : fmtRaw(remaining.toString())}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={m.enabled ? "green" : "red"} variant="soft">
                        {m.enabled ? "Active" : "Revoked"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {m.enabled && (
                        <Button size="1" variant="ghost" color="red"
                          onClick={() => alert("Connect wallet to sign revoke_minter transaction")}>
                          Revoke
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </Flex>
  );
}

function fmtRaw(raw: string): string {
  try {
    return BigInt(raw).toLocaleString();
  } catch {
    return raw;
  }
}
