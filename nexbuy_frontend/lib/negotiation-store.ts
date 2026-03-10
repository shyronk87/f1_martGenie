const STORAGE_KEY = "nexbuy.negotiation.results";

export type NegotiatedDeal = {
  sku: string;
  originalPrice: number;
  negotiatedPrice: number;
  title: string;
  planId?: string;
  planTitle?: string;
  acceptedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function readNegotiatedDeals(): Record<string, NegotiatedDeal> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, NegotiatedDeal] => isRecord(entry[1])),
    );
  } catch {
    return {};
  }
}

export function writeNegotiatedDeal(deal: NegotiatedDeal) {
  if (typeof window === "undefined") {
    return;
  }

  const current = readNegotiatedDeals();
  current[deal.sku] = deal;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}
