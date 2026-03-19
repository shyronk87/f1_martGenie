import { authenticatedFetch, getApiBaseUrl } from "@/lib/auth";

export type ProductDetail = {
  sku_id_default: string;
  spu_id?: string | null;
  spu_code?: string | null;
  title: string;
  sub_title?: string | null;
  sku_code_default?: string | null;
  category_path: string[];
  rating_value?: number | null;
  review_count?: number | null;
  main_image_url?: string | null;
  gallery_image_urls: string[];
  description_text?: string | null;
  specs: Record<string, string>;
  currency_symbol?: string | null;
  sale_price?: number | null;
  original_price?: number | null;
  tag_price?: number | null;
  compare_price?: number | null;
  final_price?: number | null;
  discount_text?: string | null;
  discount_percent?: number | null;
  stock_status_text?: string | null;
  activity_price?: number | null;
  activity_tip_text?: string | null;
  product_url?: string | null;
  canonical_url?: string | null;
};

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  let payload: T | { detail?: string } | null = null;
  try {
    payload = (await response.json()) as T | { detail?: string };
  } catch {
    payload = null;
  }

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

export async function fetchProductDetail(skuIdDefault: string): Promise<ProductDetail> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/products/${encodeURIComponent(skuIdDefault)}`, {
    method: "GET",
  });

  return parseJsonResponse<ProductDetail>(response, "Could not load product detail.");
}
