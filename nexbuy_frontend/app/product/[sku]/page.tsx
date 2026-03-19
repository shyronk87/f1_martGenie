"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, logoutSession, readAccessToken } from "@/lib/auth";
import { createFavoriteProduct, deleteFavoriteProduct, fetchFavoriteProducts } from "@/lib/favorites-api";
import { clearCurrentOrder, setOrderCheckout } from "@/lib/order-store";
import { fetchProductDetail, type ProductDetail } from "@/lib/product-api";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

function formatMoney(value: number | null | undefined, currencySymbol = "$") {
  if (typeof value !== "number") {
    return "--";
  }
  return `${currencySymbol}${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getPricePairs(product: ProductDetail) {
  const currentPrice = product.sale_price ?? product.final_price ?? product.activity_price ?? null;
  const originalPrice =
    product.original_price ??
    product.compare_price ??
    product.tag_price ??
    (typeof currentPrice === "number" ? currentPrice : null);
  return { currentPrice, originalPrice };
}

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams<{ sku: string }>();
  const sku = typeof params?.sku === "string" ? params.sku : "";
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [authOpen, setAuthOpen] = useState(false);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeImage, setActiveImage] = useState("");
  const [favoriteSkuSet, setFavoriteSkuSet] = useState<Set<string>>(new Set());
  const [isUpdatingFavorite, setIsUpdatingFavorite] = useState(false);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      setIsAuthenticated(false);
      setFavoriteSkuSet(new Set());
      return;
    }

    void fetchCurrentUser(token)
      .then(async () => {
        setIsAuthenticated(true);
        try {
          const favorites = await fetchFavoriteProducts();
          setFavoriteSkuSet(new Set(favorites.map((item) => item.sku_id_default)));
        } catch {
          setFavoriteSkuSet(new Set());
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
        setFavoriteSkuSet(new Set());
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProduct() {
      if (!sku) {
        setError("Product not found.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const detail = await fetchProductDetail(sku);
        if (cancelled) {
          return;
        }
        setProduct(detail);
        setActiveImage(detail.gallery_image_urls[0] ?? detail.main_image_url ?? "");
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Could not load product detail.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProduct();
    return () => {
      cancelled = true;
    };
  }, [sku]);

  const imageList = useMemo(() => {
    if (!product) {
      return [];
    }
    const list = [...product.gallery_image_urls];
    if (product.main_image_url && !list.includes(product.main_image_url)) {
      list.unshift(product.main_image_url);
    }
    return list;
  }, [product]);

  const { currentPrice, originalPrice } = product ? getPricePairs(product) : { currentPrice: null, originalPrice: null };
  const savedAmount =
    typeof currentPrice === "number" && typeof originalPrice === "number"
      ? Math.max(originalPrice - currentPrice, 0)
      : 0;

  async function handleToggleFavorite() {
    if (!product) {
      return;
    }
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }

    setIsUpdatingFavorite(true);
    try {
      if (favoriteSkuSet.has(product.sku_id_default)) {
        await deleteFavoriteProduct(product.sku_id_default);
        setFavoriteSkuSet((current) => {
          const next = new Set(current);
          next.delete(product.sku_id_default);
          return next;
        });
      } else {
        await createFavoriteProduct({
          sku_id_default: product.sku_id_default,
          title: product.title,
          category_label: product.category_path.at(-1) ?? null,
          sale_price: currentPrice,
          image_url: product.main_image_url ?? null,
          product_url: product.product_url ?? null,
          description_text: product.description_text ?? null,
          recommendation_reason: product.sub_title ?? "",
          specs: product.specs,
          source_page: "product",
        });
        setFavoriteSkuSet((current) => new Set([...current, product.sku_id_default]));
      }
    } finally {
      setIsUpdatingFavorite(false);
    }
  }

  function handlePlaceOrder() {
    if (!product || typeof currentPrice !== "number") {
      return;
    }
    clearCurrentOrder();
    setOrderCheckout({
      source: "plaza",
      packageId: product.sku_id_default,
      packageTitle: product.title,
      summary: product.sub_title ?? product.description_text ?? "",
      items: [
        {
          sku: product.sku_id_default,
          title: product.title,
          price: currentPrice,
          quantity: 1,
          imageUrl: product.main_image_url ?? null,
        },
      ],
      subtotal: currentPrice,
      negotiatedSavings: 0,
    });
    router.push("/order");
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/product"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          void logoutSession().finally(() => {
            setIsAuthenticated(false);
            router.push("/");
          });
        }}
      >
        <section className="h-full overflow-y-auto px-6 py-8">
          {loading ? (
            <div className="mx-auto max-w-[1320px] space-y-6">
              <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="h-[520px] animate-pulse rounded-[32px] bg-[#e5e7eb]" />
                <div className="space-y-4">
                  <div className="h-8 w-2/3 animate-pulse rounded bg-[#e5e7eb]" />
                  <div className="h-6 w-full animate-pulse rounded bg-[#e5e7eb]" />
                  <div className="h-32 animate-pulse rounded-[24px] bg-[#e5e7eb]" />
                </div>
              </div>
            </div>
          ) : error || !product ? (
            <div className="mx-auto max-w-[760px] rounded-[32px] border border-[#dce4ee] bg-white/92 p-10 text-center shadow-[0_24px_80px_rgba(148,163,184,0.12)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7b8798]">Product detail</p>
              <h1 className="mt-4 text-3xl font-black tracking-[-0.05em] text-[#101828]">Could not load this product.</h1>
              <p className="mt-4 text-base leading-7 text-[#667085]">{error || "This product is unavailable right now."}</p>
              <div className="mt-8">
                <Link
                  className="inline-flex h-11 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white"
                  href="/chat"
                >
                  Back
                </Link>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[1440px] space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
                <div className="space-y-4">
                  <div className="grid items-start gap-4 md:h-[460px] md:grid-cols-[108px_minmax(0,1fr)] xl:h-[520px]">
                    <div className="order-2 min-h-0 self-stretch md:order-1">
                      {imageList.length > 1 ? (
                        <div className="h-full min-h-0 overflow-hidden border border-[#dbe5ef] bg-white">
                          <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-2 md:flex-col md:overflow-y-auto md:overflow-x-hidden">
                            {imageList.map((imageUrl) => (
                              <button
                                className={`h-[92px] w-[92px] flex-none overflow-hidden border bg-white transition ${
                                  activeImage === imageUrl
                                    ? "border-[#93c5fd] shadow-[0_10px_24px_rgba(59,130,246,0.14)]"
                                    : "border-[#dde5ef] hover:border-[#c6d4e3]"
                                }`}
                                key={imageUrl}
                                onClick={() => setActiveImage(imageUrl)}
                                type="button"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img alt={product.title} className="h-full w-full object-cover" src={imageUrl} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="order-1 h-full self-start overflow-hidden border border-[#dbe5ef] bg-white shadow-[0_22px_60px_rgba(148,163,184,0.14)] md:order-2">
                      {activeImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={product.title} className="h-full w-full object-cover" src={activeImage} />
                      ) : (
                        <div className="h-full w-full bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="border-b border-[#e5ebf2] pb-7">
                    <div className="flex items-start justify-between gap-4">
                      <h1 className="text-[1.75rem] font-black tracking-[-0.04em] text-[#101828] xl:text-[1.95rem]">
                        {product.title}
                      </h1>
                      <button
                        aria-label={favoriteSkuSet.has(product.sku_id_default) ? "Remove from likes" : "Add to likes"}
                        className={`inline-flex h-10 w-10 items-center justify-center text-[28px] leading-none transition ${
                          favoriteSkuSet.has(product.sku_id_default) ? "text-[#dc2626]" : "text-[#111827]"
                        }`}
                        disabled={isUpdatingFavorite}
                        onClick={() => void handleToggleFavorite()}
                        type="button"
                      >
                        <span aria-hidden="true">{favoriteSkuSet.has(product.sku_id_default) ? "♥" : "♡"}</span>
                      </button>
                    </div>
                    
                    {product.sub_title ? (
                      <p className="mt-2 text-[15px] leading-7 text-[#475467]">{product.sub_title}</p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[#667085]">
                      {typeof product.rating_value === "number" ? <span>{product.rating_value.toFixed(1)} rating</span> : null}
                      {typeof product.review_count === "number" ? <span>{product.review_count.toLocaleString()} reviews</span> : null}
                      {product.stock_status_text ? <span>{product.stock_status_text}</span> : null}
                      {product.category_path.length > 0 ? <span>{product.category_path.at(-1)}</span> : null}
                    </div>

                    <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        {typeof originalPrice === "number" && typeof currentPrice === "number" && originalPrice > currentPrice ? (
                          <p className="text-sm font-medium text-[#98a2b3] line-through">
                            {formatMoney(originalPrice, product.currency_symbol ?? "$")}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[2.2rem] font-black tracking-[-0.05em] text-[#123b5f]">
                          {formatMoney(currentPrice, product.currency_symbol ?? "$")}
                        </p>
                        {savedAmount > 0 ? (
                          <p className="mt-2 text-sm font-semibold text-[#2563eb]">
                            Save {formatMoney(savedAmount, product.currency_symbol ?? "$")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          className="inline-flex h-11 items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#123b5f_0%,#1d4ed8_100%)] px-5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(29,78,216,0.2)] transition hover:brightness-105"
                          onClick={handlePlaceOrder}
                          type="button"
                        >
                          Place order
                        </button>
                      </div>
                    </div>

                    {product.discount_text || typeof product.discount_percent === "number" ? (
                      <p className="mt-4 text-sm font-semibold text-[#123b5f]">
                        {product.discount_text || `${product.discount_percent}% off`}
                      </p>
                    ) : null}
                    {product.activity_tip_text ? (
                      <p className="mt-3 text-sm leading-6 text-[#475467]">{product.activity_tip_text}</p>
                    ) : null}
                  </div>

                  <div className="border-b border-[#e5ebf2] pb-7">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Description</p>
                    <p className="mt-3 whitespace-pre-wrap text-base leading-8 text-[#475467]">
                      {product.description_text || product.sub_title || "No detailed description is available for this product yet."}
                    </p>
                  </div>

                </div>
              </div>

              <div className="rounded-[32px] border border-[#dde5ef] bg-white p-6 shadow-[0_22px_60px_rgba(148,163,184,0.1)]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Specifications</p>
                {Object.keys(product.specs).length === 0 ? (
                  <p className="mt-4 text-sm leading-7 text-[#667085]">No structured specifications are available for this product.</p>
                ) : (
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(product.specs).map(([label, value]) => (
                      <div className="rounded-[20px] border border-[#edf2f7] bg-[#fbfdff] px-4 py-3" key={label}>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#98a2b3]">{label}</p>
                        <p className="mt-2 text-sm leading-6 text-[#101828]">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </section>
      </WorkspaceShell>
      <AuthModal onAuthSuccess={() => setIsAuthenticated(true)} onClose={() => setAuthOpen(false)} open={authOpen} />
    </>
  );
}
