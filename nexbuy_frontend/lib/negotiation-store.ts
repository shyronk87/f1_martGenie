import type { BuyerAgentRunResult, BuyerAgentTurn, NegotiationSession } from "@/lib/negotiation-api";

const DEAL_STORAGE_KEY = "nexbuy.negotiation.results";
const RUN_STORAGE_KEY = "nexbuy.negotiation.runs";

export type NegotiatedDeal = {
  sku: string;
  originalPrice: number;
  negotiatedPrice: number;
  title: string;
  planId?: string;
  planTitle?: string;
  acceptedAt: string;
};

export type StoredNegotiationRun = {
  sku: string;
  title: string;
  originalPrice: number;
  planId?: string;
  planTitle?: string;
  targetPrice: number;
  maxAcceptablePrice: number;
  status: "running" | "done";
  progressLabel: string;
  progressPercent: number;
  turns: BuyerAgentTurn[];
  sellerSession: NegotiationSession | null;
  result?: BuyerAgentRunResult | null;
  savedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readStorageMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, T] => isRecord(entry[1])),
    );
  } catch {
    return {};
  }
}

function writeStorageEntry<T extends { sku: string }>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  const current = readStorageMap<T>(key);
  current[value.sku] = value;
  window.localStorage.setItem(key, JSON.stringify(current));
}

export function readNegotiatedDeals(): Record<string, NegotiatedDeal> {
  return readStorageMap<NegotiatedDeal>(DEAL_STORAGE_KEY);
}

export function writeNegotiatedDeal(deal: NegotiatedDeal) {
  writeStorageEntry(DEAL_STORAGE_KEY, deal);
}

export function readNegotiationRuns(): Record<string, StoredNegotiationRun> {
  return readStorageMap<StoredNegotiationRun>(RUN_STORAGE_KEY);
}

export function writeNegotiationRun(run: StoredNegotiationRun) {
  writeStorageEntry(RUN_STORAGE_KEY, run);
}
