import { getApiBaseUrl, readAccessToken } from "@/lib/auth";

export type PlazaShowcaseSummary = {
  id: string;
  user_display_masked: string;
  headline: string;
  summary: string | null;
  bundle_name: string | null;
  item_count: number;
  currency_symbol: string;
  total_original_price: number;
  total_final_price: number;
  total_saved_amount: number;
  cover_sku_id_default: string | null;
  cover_image_url: string | null;
  approved_at: string;
  created_at: string;
};

export type PlazaShowcaseItem = {
  sku_id_default: string;
  spu_id: string | null;
  title: string;
  category_name_1: string | null;
  category_name_2: string | null;
  category_name_3: string | null;
  category_name_4: string | null;
  main_image_url: string | null;
  product_url: string | null;
  quantity: number;
  original_price: number;
  sale_price: number;
  final_price_used: number;
  saved_amount: number;
  sort_order: number;
};

export type PlazaShowcaseDetail = PlazaShowcaseSummary & {
  items: PlazaShowcaseItem[];
  primary_categories: string[];
};

export type PlazaRecommendationProduct = {
  sku_id_default: string;
  spu_id: string | null;
  title: string;
  description_text: string | null;
  category_name_1: string | null;
  category_name_2: string | null;
  category_name_3: string | null;
  category_name_4: string | null;
  sale_price: number | null;
  original_price: number | null;
  stock_status_text: string | null;
  main_image_url: string | null;
  product_url: string | null;
  specs: Record<string, string> | null;
  recommendation_reason: string;
  matched_memory_tags: string[];
};

export type PlazaRecommendations = {
  onboarding_required: boolean;
  memory_summary: string;
  reason_tags: string[];
  products: PlazaRecommendationProduct[];
};

export type MartGennieFeedbackItem = {
  id: string;
  user_id: string | null;
  user_display_masked: string;
  feedback_text: string;
  context_tags: string[];
  outcome_label: string | null;
  used_negotiation: boolean;
  saved_amount: number;
  created_at: string;
};

export type MartGennieFeedbackList = {
  items: MartGennieFeedbackItem[];
};

export type MartGennieFeedbackCreateInput = {
  feedback_text: string;
};

type SeedResponse = {
  created_count: number;
  total_count: number;
};

function buildAuthHeaders() {
  const token = readAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchPlazaShowcases(limit = 20): Promise<PlazaShowcaseSummary[]> {
  const response = await fetch(`${getApiBaseUrl()}/plaza/showcase?limit=${limit}`, {
    headers: buildAuthHeaders(),
  });
  return parseJsonResponse<PlazaShowcaseSummary[]>(response, "Could not load plaza showcase.");
}

export async function fetchPlazaShowcaseDetail(showcaseId: string): Promise<PlazaShowcaseDetail> {
  const response = await fetch(`${getApiBaseUrl()}/plaza/showcase/${showcaseId}`, {
    headers: buildAuthHeaders(),
  });
  return parseJsonResponse<PlazaShowcaseDetail>(response, "Could not load showcase detail.");
}

export async function seedMockPlazaShowcases(): Promise<SeedResponse> {
  const response = await fetch(`${getApiBaseUrl()}/plaza/showcase/mock/seed`, {
    method: "POST",
    headers: buildAuthHeaders(),
  });
  return parseJsonResponse<SeedResponse>(response, "Could not seed mock showcase records.");
}

export async function fetchPlazaRecommendations(): Promise<PlazaRecommendations> {
  const response = await fetch(`${getApiBaseUrl()}/plaza/recommendations/me`, {
    headers: buildAuthHeaders(),
  });
  return parseJsonResponse<PlazaRecommendations>(response, "Could not load personalized recommendations.");
}

export async function fetchMartGennieFeedback(limit = 9): Promise<MartGennieFeedbackList> {
  const response = await fetch(`${getApiBaseUrl()}/plaza/feedback?limit=${limit}`, {
    headers: buildAuthHeaders(),
  });
  return parseJsonResponse<MartGennieFeedbackList>(response, "Could not load MartGennie feedback.");
}

export async function createMartGennieFeedback(
  payload: MartGennieFeedbackCreateInput,
): Promise<MartGennieFeedbackItem> {
  const response = await fetch(`${getApiBaseUrl()}/plaza/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<MartGennieFeedbackItem>(response, "Could not publish your feedback.");
}

export async function deleteMartGennieFeedback(feedbackId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/plaza/feedback/${feedbackId}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? ((await response.json()) as unknown) : null;
    if (payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string") {
      throw new Error(payload.detail);
    }
    throw new Error("Could not delete your feedback.");
  }
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
