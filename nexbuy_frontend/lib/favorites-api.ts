import { authenticatedFetch, getApiBaseUrl, readAccessToken } from "@/lib/auth";

export type FavoriteProductItem = {
  id: string;
  sku_id_default: string;
  title: string;
  category_label: string | null;
  sale_price: number | null;
  image_url: string | null;
  product_url: string | null;
  description_text: string | null;
  recommendation_reason: string | null;
  specs: Record<string, string>;
  source_page: string | null;
  created_at: string;
};

export type FavoriteProductCreateInput = {
  sku_id_default: string;
  title: string;
  category_label?: string | null;
  sale_price?: number | null;
  image_url?: string | null;
  product_url?: string | null;
  description_text?: string | null;
  recommendation_reason?: string | null;
  specs?: Record<string, string>;
  source_page?: string | null;
};

export type FavoriteBundleProduct = {
  sku: string;
  title: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  categoryLabel?: string | null;
};

export type FavoriteBundleItem = {
  id: string;
  bundle_id: string;
  title: string;
  summary: string | null;
  total_price: number | null;
  source_session_id: string | null;
  source_page: string | null;
  items: FavoriteBundleProduct[];
  created_at: string;
};

export type FavoriteBundleCreateInput = {
  bundle_id: string;
  title: string;
  summary?: string | null;
  total_price?: number | null;
  source_session_id?: string | null;
  source_page?: string | null;
  items: FavoriteBundleProduct[];
};

function buildAuthHeaders() {
  const token = readAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchFavoriteProducts(): Promise<FavoriteProductItem[]> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/favorites/products`, {
    headers: buildAuthHeaders(),
  });
  const payload = await parseJsonResponse<{ items: FavoriteProductItem[] }>(
    response,
    "Could not load your favorite products.",
  );
  return payload.items;
}

export async function createFavoriteProduct(
  payload: FavoriteProductCreateInput,
): Promise<FavoriteProductItem> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/favorites/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<FavoriteProductItem>(response, "Could not save this product to favorites.");
}

export async function deleteFavoriteProduct(skuIdDefault: string): Promise<void> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/favorites/products/${encodeURIComponent(skuIdDefault)}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });
  await ensureOk(response, "Could not remove this favorite product.");
}

export async function fetchFavoriteBundles(): Promise<FavoriteBundleItem[]> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/favorites/bundles`, {
    headers: buildAuthHeaders(),
  });
  const payload = await parseJsonResponse<{ items: FavoriteBundleItem[] }>(
    response,
    "Could not load your favorite bundles.",
  );
  return payload.items;
}

export async function createFavoriteBundle(
  payload: FavoriteBundleCreateInput,
): Promise<FavoriteBundleItem> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/favorites/bundles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<FavoriteBundleItem>(response, "Could not save this bundle to favorites.");
}

export async function deleteFavoriteBundle(bundleId: string): Promise<void> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/favorites/bundles/${encodeURIComponent(bundleId)}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });
  await ensureOk(response, "Could not remove this favorite bundle.");
}

async function ensureOk(response: Response, fallbackMessage: string): Promise<void> {
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? ((await response.json()) as unknown) : null;
    throw new Error(readErrorMessage(payload, fallbackMessage));
  }
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
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

  if (!("detail" in payload)) {
    return fallbackMessage;
  }

  const detail = payload.detail;
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    const message = detail
      .map((issue) => {
        if (!issue || typeof issue !== "object") {
          return null;
        }
        const path =
          "loc" in issue && Array.isArray(issue.loc)
            ? issue.loc.filter((part: unknown): part is string => typeof part === "string").join(" / ")
            : "";
        const issueMessage = "msg" in issue && typeof issue.msg === "string" ? issue.msg : fallbackMessage;
        return path ? `${path}: ${issueMessage}` : issueMessage;
      })
      .filter((item): item is string => Boolean(item))
      .join(" · ");

    if (message) {
      return message;
    }
  }

  return fallbackMessage;
}
