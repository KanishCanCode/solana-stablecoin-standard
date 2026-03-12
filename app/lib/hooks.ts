/**
 * @module hooks
 * SWR hooks for all SSS API endpoints.
 *
 * Each hook returns { data, error, isLoading } — components destructure
 * what they need and render loading/error states accordingly.
 */

"use client";

import useSWR, { SWRConfiguration } from "swr";
import {
  api,
  CoinSummary,
  CoinDetail,
  DenylistEntry,
  DenylistCheck,
  EventRecord,
  ProposalRecord,
  PaginatedResponse,
} from "./api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  dedupingInterval:  5_000,
};

// ─── Coins ────────────────────────────────────────────────────────────────────

export function useCoins() {
  const { data, error, isLoading, mutate } = useSWR<CoinSummary[]>(
    "coins",
    () => api.listCoins(),
    { ...SWR_DEFAULTS, refreshInterval: 30_000 },
  );
  return { coins: data ?? [], error, isLoading, mutate };
}

export function useCoin(mint: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CoinDetail>(
    mint ? `coin:${mint}` : null,
    () => api.getCoin(mint!),
    { ...SWR_DEFAULTS, refreshInterval: 10_000 },
  );
  return { coin: data ?? null, error, isLoading, mutate };
}

// ─── Compliance ───────────────────────────────────────────────────────────────

export function useDenylist(mint: string | null) {
  const { data, error, isLoading, mutate } = useSWR<DenylistEntry[]>(
    mint ? `denylist:${mint}` : null,
    () => api.listDenylist(mint!),
    { ...SWR_DEFAULTS, refreshInterval: 30_000 },
  );
  return { entries: data ?? [], error, isLoading, mutate };
}

export function useAddressCheck(mint: string | null, address: string) {
  const trimmed = address.trim();
  const { data, error, isLoading } = useSWR<DenylistCheck>(
    mint && trimmed.length >= 32 ? `check:${mint}:${trimmed}` : null,
    () => api.checkAddress(mint!, trimmed),
    { ...SWR_DEFAULTS },
  );
  return { result: data ?? null, error, isLoading };
}

export function useEvents(
  mint:   string | null,
  params?: { kind?: string; page?: number; limit?: number },
) {
  const key = mint
    ? `events:${mint}:${params?.kind ?? ""}:${params?.page ?? 1}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<PaginatedResponse<EventRecord>>(
    key,
    () => api.listEvents(mint!, params),
    { ...SWR_DEFAULTS, refreshInterval: 10_000 },
  );
  return { events: data?.data ?? [], meta: data?.meta, error, isLoading, mutate };
}

// ─── Proposals ────────────────────────────────────────────────────────────────

export function useProposals(
  mint:    string | null,
  status?: "pending" | "ready" | "executed" | "expired" | "all",
  page    = 1,
) {
  const key = mint
    ? `proposals:${mint}:${status ?? "all"}:${page}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<PaginatedResponse<ProposalRecord>>(
    key,
    () => api.listProposals(mint!, { status: status === "all" ? undefined : status, page }),
    { ...SWR_DEFAULTS, refreshInterval: 15_000 },
  );
  return { proposals: data?.data ?? [], meta: data?.meta, error, isLoading, mutate };
}
