import { getApiBaseUrl, readAccessToken } from "@/lib/auth";
import type {
  ChatMessage,
  MockOrderResponse,
  OrderItemPayload,
  PlanOption,
  StreamEvent,
  TimelineEvent,
} from "@/lib/chat-contract";

type SessionResponse = { session_id: string };
type SendMessageResponse = { message_id: string; task_id: string; status: string };

const DEFAULT_CHAT_MODE = "mock";
const chatMode = (process.env.NEXT_PUBLIC_CHAT_MODE ?? DEFAULT_CHAT_MODE).toLowerCase();
const DEFAULT_STREAM_BACKEND_ORIGIN = "http://127.0.0.1:8000";

type StreamHandler = (event: StreamEvent) => void;

function getChatStreamBaseUrl() {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? DEFAULT_STREAM_BACKEND_ORIGIN;
  return `${configuredOrigin.replace(/\/+$/, "")}/api`;
}

export async function createChatSession(): Promise<string> {
  if (chatMode === "real") {
    const response = await fetch(`${getApiBaseUrl()}/chat/sessions`, {
      method: "POST",
      headers: buildAuthHeaders(),
    });
    const payload = await parseJsonResponse<SessionResponse>(
      response,
      "Could not create chat session.",
    );
    return payload.session_id;
  }

  return `mock-${crypto.randomUUID()}`;
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
): Promise<{ messageId: string; taskId: string }> {
  if (chatMode === "real") {
    const response = await fetch(
      `${getApiBaseUrl()}/chat/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: {
          ...buildAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );
    const payload = await parseJsonResponse<SendMessageResponse>(
      response,
      "Could not send chat message.",
    );
    return { messageId: payload.message_id, taskId: payload.task_id };
  }

  return {
    messageId: `msg-${crypto.randomUUID()}`,
    taskId: `task-${crypto.randomUUID()}`,
  };
}

export function subscribeChatStream(
  sessionId: string,
  taskId: string,
  onEvent: StreamHandler,
): () => void {
  if (chatMode === "real") {
    const token = readAccessToken();
    const path = `${getChatStreamBaseUrl()}/chat/sessions/${sessionId}/stream`;
    const url = new URL(path);
    url.searchParams.set("task_id", taskId);
    if (token) {
      url.searchParams.set("access_token", token);
    }

    const stream = new EventSource(url.toString());
    let completed = false;
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as StreamEvent;
        onEvent(payload);
        if (payload.type === "done") {
          completed = true;
          stream.close();
        }
      } catch {
        onEvent({ type: "error", error: "Invalid stream event payload." });
      }
    };
    stream.onerror = () => {
      if (completed) {
        return;
      }
      onEvent({ type: "error", error: "Real-time stream disconnected." });
      stream.close();
    };

    return () => stream.close();
  }

  return runMockStream(onEvent);
}

export async function createMockOrder(payload: {
  sessionId: string;
  planId: string;
  items: OrderItemPayload[];
  paymentMethod?: string;
  shippingAddress?: string;
}): Promise<MockOrderResponse> {
  const response = await fetch(`${getApiBaseUrl()}/chat/orders/mock`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: payload.sessionId,
      plan_id: payload.planId,
      items: payload.items,
      payment_method: payload.paymentMethod ?? "card",
      shipping_address: payload.shippingAddress ?? "N/A",
    }),
  });

  return parseJsonResponse<MockOrderResponse>(response, "Could not create order.");
}

function runMockStream(onEvent: StreamHandler): () => void {
  const timers: number[] = [];
  const now = new Date().toISOString();

  const timeline = (event: TimelineEvent) => onEvent({ type: "timeline_event", event });
  const msg = (delta: string) => onEvent({ type: "message_delta", delta });

  timers.push(
    window.setTimeout(() => {
      timeline({
        id: `t-${crypto.randomUUID()}`,
        type: "scan_started",
        message: "Scanning 4,500 sandbox products for style and budget fit...",
        createdAt: now,
      });
    }, 350),
  );

  timers.push(
    window.setTimeout(() => {
      timeline({
        id: `t-${crypto.randomUUID()}`,
        type: "scan_progress",
        message: "Filtered 3,172 mismatched SKUs. Prioritizing pet-friendly materials.",
        createdAt: new Date().toISOString(),
      });
      msg("I found several options that match your budget and style. ");
    }, 1200),
  );

  timers.push(
    window.setTimeout(() => {
      timeline({
        id: `t-${crypto.randomUUID()}`,
        type: "candidate_found",
        message: "Found 42 relevant items. Building room-level combinations.",
        createdAt: new Date().toISOString(),
      });
      msg("Now composing three room packages with trade-offs. ");
    }, 2100),
  );

  timers.push(
    window.setTimeout(() => {
      timeline({
        id: `t-${crypto.randomUUID()}`,
        type: "negotiation_mocked",
        message: "Mock negotiation complete: estimated extra 5% bundle discount.",
        createdAt: new Date().toISOString(),
      });
      onEvent({ type: "plan_ready", plans: buildMockPlans() });
    }, 3300),
  );

  timers.push(
    window.setTimeout(() => {
      msg("Review the three plans on the left panel and pick one to draft an order.");
      timeline({
        id: `t-${crypto.randomUUID()}`,
        type: "done",
        message: "Recommendation package is ready.",
        createdAt: new Date().toISOString(),
      });
      onEvent({ type: "done" });
    }, 4200),
  );

  return () => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
  };
}

function buildMockPlans(): PlanOption[] {
  return [
    {
      id: "plan-a",
      title: "Balanced Natural Set",
      summary: "Best overall value with scratch-resistant fabric and warm oak tones.",
      totalPrice: 2860,
      confidence: 0.92,
      items: [
        { sku: "JJ77311M4I", title: "Nimbus 3-Piece Sectional", price: 1299.99, reason: "Cat-friendly texture and modular shape." },
        { sku: "JJ86497L1D", title: "Extendable Oak Dining Set", price: 980, reason: "Flexible hosting size and durable frame." },
        { sku: "LGT-ARC-021", title: "Arc Floor Lamp", price: 580.01, reason: "Soft ambient lighting for living room cohesion." },
      ],
    },
    {
      id: "plan-b",
      title: "Comfort First Bundle",
      summary: "Higher comfort score with oversized seating and easy-clean finishes.",
      totalPrice: 3045,
      confidence: 0.87,
      items: [
        { sku: "SFA-CLD-110", title: "Cloud Deep Sofa", price: 1540, reason: "Deep seat for long sessions and guest use." },
        { sku: "TBL-WDN-784", title: "Rounded Walnut Coffee Table", price: 620, reason: "No sharp corners, family-safe." },
        { sku: "RUG-PP-322", title: "Washable Neutral Rug", price: 885, reason: "Pet-traffic friendly and easy maintenance." },
      ],
    },
    {
      id: "plan-c",
      title: "Cost Saver Starter",
      summary: "Lowest upfront spend while preserving style consistency.",
      totalPrice: 2410,
      confidence: 0.81,
      items: [
        { sku: "SFA-LIN-220", title: "Linen 2-Seater + Chaise", price: 1120, reason: "Budget-friendly anchor piece." },
        { sku: "TVS-ASH-083", title: "Slatted TV Stand", price: 430, reason: "Storage + natural palette continuity." },
        { sku: "ACC-CMB-118", title: "Accent Combo Set", price: 860, reason: "Completes room with minimal extra sourcing." },
      ],
    },
  ];
}

function buildAuthHeaders(): Record<string, string> {
  const token = readAccessToken();
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, fallbackMessage));
  }

  if (!payload) {
    throw new Error(fallbackMessage);
  }

  return payload as T;
}

function readErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") {
    return fallbackMessage;
  }

  if ("detail" in payload && typeof payload.detail === "string") {
    return payload.detail;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  return fallbackMessage;
}

export type {
  ChatMessage,
  MockOrderResponse,
  OrderItemPayload,
  PlanOption,
  StreamEvent,
  TimelineEvent,
};
