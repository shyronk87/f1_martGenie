import { authenticatedFetch, getApiBaseUrl, readAccessToken } from "@/lib/auth";

export type ShareProductEmailInput = {
  sku_id_default: string;
  recipient_email: string;
};

export type ShareProductEmailOut = {
  email_id: string;
  recipient_email: string;
  product_title: string;
};

export type ShareBundleEmailItemInput = {
  title: string;
  price: number;
};

export type ShareBundleEmailInput = {
  bundle_title: string;
  summary?: string | null;
  total_price?: number | null;
  recipient_email: string;
  items: ShareBundleEmailItemInput[];
};

export type ShareBundleEmailOut = {
  email_id: string;
  recipient_email: string;
  bundle_title: string;
};

function buildAuthHeaders() {
  const token = readAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function shareProductByEmail(
  payload: ShareProductEmailInput,
): Promise<ShareProductEmailOut> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/share/product/email`, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    if (data && typeof data === "object" && "detail" in data && typeof data.detail === "string") {
      throw new Error(data.detail);
    }
    throw new Error("Could not share this product by email.");
  }

  if (!data) {
    throw new Error("Could not share this product by email.");
  }

  return data as ShareProductEmailOut;
}

export async function shareBundleByEmail(
  payload: ShareBundleEmailInput,
): Promise<ShareBundleEmailOut> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/share/bundle/email`, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    if (data && typeof data === "object" && "detail" in data && typeof data.detail === "string") {
      throw new Error(data.detail);
    }
    throw new Error("Could not share this bundle by email.");
  }

  if (!data) {
    throw new Error("Could not share this bundle by email.");
  }

  return data as ShareBundleEmailOut;
}
