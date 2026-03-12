"use client";
import { useState } from "react";
import {
  Card, Flex, Text, Badge, Button, Table,
  Separator, Callout, Spinner,
} from "@radix-ui/themes";
import { useProposals } from "../lib/hooks";

interface Props { mint: string | null; }

type Filter = "all" | "pending" | "ready" | "executed" | "expired";

const STATUS_COLOR: Record<string, "yellow" | "cyan" | "green" | "gray"> = {
  pending:  "yellow",
  ready:    "cyan",
  executed: "green",
  expired:  "gray",
};

export function ProposalsPanel({ mint }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  const { proposals, meta, isLoading, error } = useProposals(
    mint,
    filter === "all" ? undefined : filter,
    page,
  );

  if (!mint) return <Card><Text color="gray">Select a stablecoin above.</Text></Card>;

  return (
    <Flex direction="column" gap="4">
      {/* Header + filter */}
      <Flex justify="between" align="center">
        <Flex direction="column" gap="1">
          <Text size="3" weight="bold">Co-Sign Proposals</Text>
          <Text size="1" color="gray">Tier-3 Institutional — multi-signer issuance gate</Text>
        </Flex>
        <Flex gap="2">
          {(["all", "pending", "ready", "executed", "expired"] as const).map(f => (
            <Button
              key={f} size="1"
              variant={filter === f ? "solid" : "soft"}
              onClick={() => { setFilter(f); setPage(1); }}
            >
              {f}
            </Button>
          ))}
        </Flex>
      </Flex>

      {/* Table */}
      <Card>
        {isLoading ? (
          <Flex justify="center" p="6"><Spinner size="3" /></Flex>
        ) : error ? (
          <Callout.Root color="red" variant="soft" size="1">
            <Callout.Text>Failed to load proposals: {error.message}</Callout.Text>
          </Callout.Root>
        ) : proposals.length === 0 ? (
          <Callout.Root color="gray" variant="soft" size="1">
            <Callout.Text>No proposals found. Use the CLI or SDK to create one.</Callout.Text>
          </Callout.Root>
        ) : (
          <>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>#</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Amount</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Recipient</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Votes</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Expires</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {proposals.map(p => (
                  <Table.Row key={p.id}>
                    {/* proposalSeq — not proposalId (renamed from PR #40) */}
                    <Table.Cell><Text size="1">#{p.proposalSeq}</Text></Table.Cell>
                    <Table.Cell><Text size="1">{fmtRaw(p.amount)}</Text></Table.Cell>
                    <Table.Cell>
                      <Text size="1" style={{ fontFamily: "monospace" }}>
                        {p.recipient.slice(0,8)}…{p.recipient.slice(-4)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="1">{p.voteCount}/{p.threshold}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="1">{new Date(p.expiresAt).toLocaleDateString()}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={STATUS_COLOR[p.status] ?? "gray"} variant="soft">
                        {p.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Flex gap="1">
                        {p.status === "pending" && (
                          <Button size="1" color="cyan" variant="soft"
                            onClick={() => alert("Connect wallet to sign approve_issue transaction")}>
                            Approve
                          </Button>
                        )}
                        {p.status === "ready" && (
                          <Button size="1" color="green"
                            onClick={() => alert("Connect wallet to sign execute_issue transaction")}>
                            Execute
                          </Button>
                        )}
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            {/* Pagination */}
            {meta && meta.pages > 1 && (
              <Flex justify="between" align="center" mt="3">
                <Text size="1" color="gray">
                  Page {meta.page} of {meta.pages} ({meta.total} total)
                </Text>
                <Flex gap="2">
                  <Button size="1" variant="soft" disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}>
                    ← Prev
                  </Button>
                  <Button size="1" variant="soft" disabled={page >= meta.pages}
                    onClick={() => setPage(p => p + 1)}>
                    Next →
                  </Button>
                </Flex>
              </Flex>
            )}
          </>
        )}
      </Card>
    </Flex>
  );
}

function fmtRaw(raw: string): string {
  try { return BigInt(raw).toLocaleString(); } catch { return raw; }
}
