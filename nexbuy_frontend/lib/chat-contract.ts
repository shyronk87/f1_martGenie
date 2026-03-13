export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type TimelineEventType =
  | "scan_started"
  | "scan_progress"
  | "candidate_found"
  | "bundle_built"
  | "negotiation_mocked"
  | "plan_ready"
  | "done"
  | "error";

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  message: string;
  createdAt: string;
};

export type PlanItem = {
  sku: string;
  title: string;
  price: number;
  reason: string;
  imageUrl?: string | null;
  productUrl?: string | null;
  description?: string | null;
  categoryLabel?: string | null;
  specs?: Record<string, string> | null;
};

export type PlanOption = {
  id: string;
  title: string;
  summary: string;
  explanation?: string;
  totalPrice: number;
  confidence: number;
  items: PlanItem[];
};

export type StreamEvent =
  | { type: "message_delta"; delta: string }
  | { type: "message"; message: ChatMessage }
  | { type: "timeline_event"; event: TimelineEvent }
  | { type: "plan_ready"; plans: PlanOption[] }
  | { type: "done" }
  | { type: "error"; error: string };

export type OrderItemPayload = {
  sku: string;
  title: string;
  price: number;
  quantity: number;
};

export type MockOrderResponse = {
  order_id: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  currency: string;
  tracking_number: string;
  carrier: string;
  estimated_delivery_date: string;
  warehouse_note: string;
  support_contact: string;
  created_at: string;
};
