import { getApiBaseUrl, readAccessToken } from "@/lib/auth";

export type NegotiationProduct = {
  sku_id_default: string;
  title: string;
  sale_price: number;
  mock_urgency_status: string;
  mock_inventory: number;
  mock_min_floor_price?: number | null;
};

export type NegotiationTurn = {
  round_index: number;
  buyer_offer?: number | null;
  seller_decision: "accept" | "counter" | "reject" | "need_offer" | "closed";
  seller_counter_price?: number | null;
  seller_message: string;
  current_target_price: number;
  min_expected_price: number;
  llm_price_verified: boolean;
  llm_verification_note?: string | null;
  final_confirmation?: Record<string, string | number | boolean> | null;
  created_at: string;
};

export type NegotiationSession = {
  session_id: string;
  user_id: string;
  product: NegotiationProduct;
  max_rounds: number;
  closed: boolean;
  accepted_price?: number | null;
  pricing_params: Record<string, string | number>;
  turns: NegotiationTurn[];
  created_at: string;
  updated_at: string;
};

function buildAuthHeaders(): Record<string, string> {
  const token = readAccessToken();
  if (!token) {
    throw new Error("Missing access token.");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    if (payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string") {
      throw new Error(payload.detail);
    }
    throw new Error(fallbackMessage);
  }

  if (!payload) {
    throw new Error(fallbackMessage);
  }

  return payload as T;
}

export async function createNegotiationSession(payload: {
  skuIdDefault: string;
  buyerNote?: string;
  maxRounds?: number;
}): Promise<NegotiationSession> {
  const response = await fetch(`${getApiBaseUrl()}/negotiation/sessions`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sku_id_default: payload.skuIdDefault,
      buyer_note: payload.buyerNote,
      max_rounds: payload.maxRounds ?? 5,
    }),
  });

  return parseJsonResponse<NegotiationSession>(response, "Could not create negotiation session.");
}

export async function submitNegotiationOffer(payload: {
  sessionId: string;
  buyerOffer?: number | null;
  buyerMessage?: string;
}): Promise<NegotiationTurn> {
  const response = await fetch(
    `${getApiBaseUrl()}/negotiation/sessions/${payload.sessionId}/offer`,
    {
      method: "POST",
      headers: {
        ...buildAuthHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        buyer_offer: payload.buyerOffer ?? null,
        buyer_message: payload.buyerMessage,
      }),
    },
  );

  return parseJsonResponse<NegotiationTurn>(response, "Could not submit negotiation offer.");
}

export async function fetchNegotiationSession(sessionId: string): Promise<NegotiationSession> {
  const response = await fetch(`${getApiBaseUrl()}/negotiation/sessions/${sessionId}`, {
    headers: buildAuthHeaders(),
  });

  return parseJsonResponse<NegotiationSession>(response, "Could not load negotiation session.");
}
