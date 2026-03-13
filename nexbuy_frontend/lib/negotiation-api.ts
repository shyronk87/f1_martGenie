import { getApiBaseUrl, readAccessToken } from "@/lib/auth";

const DEFAULT_STREAM_BACKEND_ORIGIN = "http://127.0.0.1:8000";

function getNegotiationStreamBaseUrl() {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? DEFAULT_STREAM_BACKEND_ORIGIN;
  return `${configuredOrigin.replace(/\/+$/, "")}/api`;
}

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

export type BuyerAgentTurn = {
  round_index: number;
  action: "offer" | "accept_seller_price" | "walk_away";
  buyer_offer?: number | null;
  buyer_message: string;
  rationale: string;
  llm_decision_verified?: boolean;
  llm_verification_note?: string | null;
  seller_turn?: NegotiationTurn | null;
  created_at: string;
};

export type BuyerAgentRunResult = {
  run_id: string;
  user_id: string;
  sku_id_default: string;
  target_price: number;
  max_acceptable_price: number;
  max_rounds: number;
  style: "balanced";
  outcome: "accepted" | "walked_away" | "seller_closed" | "max_rounds_reached";
  final_price?: number | null;
  summary: string;
  seller_session: NegotiationSession;
  turns: BuyerAgentTurn[];
  created_at: string;
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

export async function runBuyerAgentNegotiation(payload: {
  skuIdDefault: string;
  targetPrice: number;
  maxAcceptablePrice: number;
}): Promise<BuyerAgentRunResult> {
  const response = await fetch(`${getApiBaseUrl()}/agent-negotiation/run`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sku_id_default: payload.skuIdDefault,
      target_price: payload.targetPrice,
      max_acceptable_price: payload.maxAcceptablePrice,
    }),
  });

  return parseJsonResponse<BuyerAgentRunResult>(response, "Could not run buyer agent negotiation.");
}

export type BuyerAgentStreamEvent =
  | {
      type: "session_started";
      run_id: string;
      seller_session: NegotiationSession;
      target_price: number;
      max_acceptable_price: number;
      max_rounds: number;
    }
  | { type: "thinking"; phase: "buyer_decision" | "seller_response"; round_index: number; message: string }
  | { type: "buyer_turn"; turn: BuyerAgentTurn }
  | { type: "seller_turn"; turn: NegotiationTurn }
  | { type: "done"; result: BuyerAgentRunResult }
  | { type: "error"; error: string; run_id?: string };

export async function cancelBuyerAgentNegotiation(runId: string): Promise<{
  run_id: string;
  cancelled: boolean;
  message: string;
}> {
  const response = await fetch(`${getApiBaseUrl()}/agent-negotiation/run/${runId}/cancel`, {
    method: "POST",
    headers: buildAuthHeaders(),
  });

  return parseJsonResponse(response, "Could not cancel buyer agent negotiation.");
}

export async function streamBuyerAgentNegotiation(
  payload: {
    skuIdDefault: string;
    targetPrice: number;
    maxAcceptablePrice: number;
  },
  onEvent: (event: BuyerAgentStreamEvent) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const response = await fetch(`${getNegotiationStreamBaseUrl()}/agent-negotiation/run/stream`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    signal: options?.signal,
    body: JSON.stringify({
      sku_id_default: payload.skuIdDefault,
      target_price: payload.targetPrice,
      max_acceptable_price: payload.maxAcceptablePrice,
    }),
  });

  if (!response.ok) {
    const message = await parseJsonResponse<{ detail?: string }>(
      response,
      "Could not start buyer agent negotiation stream.",
    ).catch((error: Error) => {
      throw error;
    });
    throw new Error(message.detail ?? "Could not start buyer agent negotiation stream.");
  }

  if (!response.body) {
    throw new Error("Streaming response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const chunk = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) {
          continue;
        }
        const payloadText = line.slice(6);
        const parsed = JSON.parse(payloadText) as BuyerAgentStreamEvent;
        onEvent(parsed);
      }

      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }
}
