/**
 * @module api
 * Typed fetch wrapper for the SSS backend REST API.
 *
 * All functions throw `ApiError` on non-2xx responses so callers
 * (and SWR's `fetcher`) can handle errors uniformly.
 */

const BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

// ─── Error type ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status:  number,
    public readonly code:    string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    let body: any = {};
    try { body = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res.status, body.code ?? "API_ERROR", body.error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

// ─── Response types ───────────────────────────────────────────────────────────

export interface CoinSummary {
  mint:        string;
  authority:   string;
  tier:        number;
  name:        string;
  symbol:      string;
  decimals:    number;
  totalIssued: string;
  totalBurned: string;
  totalSeized: string;
  halted:      boolean;
  createdAt:   string;
  _count: { minters: number };
}

export interface MinterRecord {
  id:           string;
  mint:         string;
  wallet:       string;
  cap:          string;
  issued:       string;
  enabled:      boolean;
  registeredAt: string;
}

export interface EventRecord {
  id:        string;
  mint:      string;
  kind:      string;
  seq:       string;
  slot:      string;
  signature: string;
  payload:   Record<string, unknown>;
  indexedAt: string;
}

export interface CoinDetail extends CoinSummary {
  issuer:     string;
  guardian:   string;
  compliance: string;
  eventSeq:   string;
  windowSecs:      string;
  windowCap:       string;
  windowIssued:    string;
  cosignThreshold: number;
  minters: MinterRecord[];
  events:  EventRecord[];
}

export interface DenylistEntry {
  id:        string;
  mint:      string;
  address:   string;
  deniedBy:  string;
  addedAt:   string;
  removedAt: string | null;
}

export interface DenylistCheck {
  address: string;
  denied:  boolean;
  by:      string | null;
  since:   string | null;
}

export interface ProposalRecord {
  id:          string;
  mint:        string;
  proposalSeq: string;
  proposer:    string;
  recipient:   string;
  amount:      string;
  voteCount:   number;
  threshold:   number;
  executed:    boolean;
  expiresAt:   string;
  status:      "pending" | "ready" | "executed" | "expired";
  votes: { voter: string; votedAt: string }[];
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
}

// ─── API functions ────────────────────────────────────────────────────────────

export const api = {
  // Coins
  listCoins: () =>
    apiFetch<{ data: CoinSummary[] }>("/v1/coins").then(r => r.data),

  getCoin: (mint: string) =>
    apiFetch<{ data: CoinDetail }>(`/v1/coins/${mint}`).then(r => r.data),

  // Compliance
  listDenylist: (mint: string) =>
    apiFetch<{ data: DenylistEntry[] }>(`/v1/coins/${mint}/denylist`).then(r => r.data),

  checkAddress: (mint: string, address: string) =>
    apiFetch<{ data: DenylistCheck }>(`/v1/coins/${mint}/denylist/${address}`).then(r => r.data),

  listEvents: (mint: string, params?: { kind?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.kind)  qs.set("kind",  params.kind);
    if (params?.page)  qs.set("page",  String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs}` : "";
    return apiFetch<PaginatedResponse<EventRecord>>(`/v1/coins/${mint}/events${query}`);
  },

  // Proposals
  listProposals: (mint: string, params?: { status?: string; page?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.page)   qs.set("page",   String(params.page));
    const query = qs.toString() ? `?${qs}` : "";
    return apiFetch<PaginatedResponse<ProposalRecord>>(`/v1/coins/${mint}/proposals${query}`);
  },

  getProposal: (mint: string, id: string) =>
    apiFetch<{ data: ProposalRecord }>(`/v1/coins/${mint}/proposals/${id}`).then(r => r.data),
};

// ─── SWR fetcher ──────────────────────────────────────────────────────────────

/** Use as the `fetcher` argument to useSWR. */
export async function swrFetcher<T>(key: string): Promise<T> {
  return apiFetch<T>(key);
}
