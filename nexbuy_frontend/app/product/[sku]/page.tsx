"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, logoutSession, readAccessToken } from "@/lib/auth";
import { createFavoriteProduct, deleteFavoriteProduct, fetchFavoriteProducts } from "@/lib/favorites-api";
import { clearCurrentOrder, setOrderCheckout } from "@/lib/order-store";
import {
  createProductReview,
  deleteProductReview,
  fetchProductDetail,
  fetchProductReviews,
  toggleProductReviewLike,
  type ProductDetail,
  type ProductReviewItem,
} from "@/lib/product-api";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

export const runtime = "edge";

function formatMoney(value: number | null | undefined, currencySymbol = "$") {
  if (typeof value !== "number") {
    return "--";
  }
  return `${currencySymbol}${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getPricePairs(product: ProductDetail) {
  const currentPrice = typeof product.sale_price === "number" ? product.sale_price : null;
  const originalPrice = typeof product.original_price === "number" ? product.original_price : null;
  return { currentPrice, originalPrice };
}

function buildStarRating(value: number) {
  const safeValue = Math.max(0, Math.min(5, value));
  const filled = Math.round(safeValue);
  return Array.from({ length: 5 }, (_, index) => (index < filled ? "★" : "☆")).join("");
}

function renderStars(value: number, interactive = false, onSelect?: (next: number) => void) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: 5 }).map((_, index) => {
        const starValue = index + 1;
        return (
          <button
            className={`text-lg leading-none ${starValue <= value ? "text-amber-400" : "text-[#cbd5e1]"} ${
              interactive ? "transition hover:scale-110" : "cursor-default"
            }`}
            disabled={!interactive}
            key={starValue}
            onClick={() => onSelect?.(starValue)}
            type="button"
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

function ProductDetailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ sku: string }>();
  const sku = typeof params?.sku === "string" ? params.sku : "";
  const sourceParam = searchParams.get("from");
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [authOpen, setAuthOpen] = useState(false);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeImage, setActiveImage] = useState("");
  const [favoriteSkuSet, setFavoriteSkuSet] = useState<Set<string>>(new Set());
  const [isUpdatingFavorite, setIsUpdatingFavorite] = useState(false);
  const [reviewItems, setReviewItems] = useState<ProductReviewItem[]>([]);
  const [reviewDraft, setReviewDraft] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewTotalPages, setReviewTotalPages] = useState(1);
  const [reviewError, setReviewError] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [isDeletingReviewId, setIsDeletingReviewId] = useState<string | null>(null);
  const [isLikingReviewId, setIsLikingReviewId] = useState<string | null>(null);
  const [likePulseId, setLikePulseId] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      if (!sku) {
        return;
      }
      try {
        setReviewError("");
        const payload = await fetchProductReviews(sku, reviewPage, 5);
        if (cancelled) {
          return;
        }
        setReviewItems(payload.items);
        setReviewTotalPages(payload.total_pages);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setReviewError(loadError instanceof Error ? loadError.message : "Could not load product reviews.");
      }
    }

    void loadReviews();
    return () => {
      cancelled = true;
    };
  }, [sku, reviewPage, isAuthenticated]);

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
    const source =
      sourceParam === "favorites"
        ? "favorites"
        : sourceParam === "plaza"
          ? "plaza"
          : "package";
    clearCurrentOrder();
    setOrderCheckout({
      source,
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

  async function handleReviewImagesChange(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    const nextImages = await Promise.all(
      Array.from(files)
        .slice(0, 4)
        .map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
              reader.onerror = () => reject(new Error("Could not read review image."));
              reader.readAsDataURL(file);
            }),
        ),
    );

    setReviewImages(nextImages.filter(Boolean));
  }

  async function handleSubmitReview() {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    if (!sku || !reviewDraft.trim()) {
      setReviewError("Write a short note before publishing your review.");
      return;
    }

    try {
      setIsSubmittingReview(true);
      setReviewError("");
      const created = await createProductReview(sku, {
        review_text: reviewDraft.trim(),
        rating: reviewRating,
        image_urls: reviewImages,
      });
      setReviewPage(1);
      setReviewItems((current) => [created, ...current].slice(0, 5));
      setReviewTotalPages((current) => Math.max(current, 1));
      setReviewDraft("");
      setReviewRating(5);
      setReviewImages([]);
    } catch (submitError) {
      setReviewError(submitError instanceof Error ? submitError.message : "Could not publish your review.");
    } finally {
      setIsSubmittingReview(false);
    }
  }

  async function handleDeleteReview(reviewId: string) {
    try {
      setIsDeletingReviewId(reviewId);
      setReviewError("");
      await deleteProductReview(reviewId);
      setReviewItems((current) => current.filter((item) => item.id !== reviewId));
    } catch (deleteError) {
      setReviewError(deleteError instanceof Error ? deleteError.message : "Could not delete your review.");
    } finally {
      setIsDeletingReviewId(null);
    }
  }

  async function handleToggleReviewLike(reviewId: string) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }

    try {
      setIsLikingReviewId(reviewId);
      setReviewError("");
      setLikePulseId(reviewId);
      const updated = await toggleProductReviewLike(reviewId);
      setReviewItems((current) =>
        current.map((item) =>
          item.id === reviewId
            ? {
                ...item,
                likes_count: updated.likes_count,
                current_user_liked: updated.current_user_liked,
              }
            : item,
        ),
      );
    } catch (likeError) {
      setReviewError(likeError instanceof Error ? likeError.message : "Could not update review like.");
    } finally {
      setIsLikingReviewId(null);
      window.setTimeout(() => {
        setLikePulseId((current) => (current === reviewId ? null : current));
      }, 380);
    }
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
                      <div className="flex items-center gap-2">
                        <button
                          aria-label="Share by email"
                          className="inline-flex h-10 w-10 items-center justify-center text-[24px] leading-none text-[#111827] transition hover:-translate-y-0.5"
                          type="button"
                        >
                          ✉
                        </button>
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
                    </div>
                    
                    {product.sub_title ? (
                      <p className="mt-2 text-[15px] leading-7 text-[#475467]">{product.sub_title}</p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[#667085]">
                      {typeof product.rating_value === "number" ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-[#f59e0b]">{buildStarRating(product.rating_value)}</span>
                          <span>{product.rating_value.toFixed(1)}</span>
                        </span>
                      ) : null}
                      {product.stock_status_text ? <span>{product.stock_status_text}</span> : null}
                    </div>

                    <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-end gap-3">
                          {typeof originalPrice === "number" && typeof currentPrice === "number" && originalPrice > currentPrice ? (
                            <p className="self-end pb-1 text-lg font-medium text-[#98a2b3] line-through">
                              {formatMoney(originalPrice, product.currency_symbol ?? "$")}
                            </p>
                          ) : null}
                          <p className="self-end leading-none text-[2.2rem] font-black tracking-[-0.05em] text-[#123b5f]">
                            {formatMoney(currentPrice, product.currency_symbol ?? "$")}
                          </p>
                        </div>
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

                    {product.activity_tip_text ? (
                      <p className="mt-4 text-sm leading-6 text-[#475467]">{product.activity_tip_text}</p>
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

              <div className="border-t border-[#e5ebf2] pt-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Specifications</p>
                {Object.keys(product.specs).length === 0 ? (
                  <p className="mt-4 text-sm leading-7 text-[#667085]">No structured specifications are available for this product.</p>
                ) : (
                  <div className="mt-5 grid gap-x-10 gap-y-0 md:grid-cols-2">
                    {Object.entries(product.specs).map(([label, value]) => (
                      <div className="border-b border-[#edf2f7] py-4" key={label}>
                        <div className="flex items-start justify-between gap-6">
                          <p className="max-w-[42%] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#98a2b3]">
                            {label}
                          </p>
                          <p className="max-w-[58%] text-right text-sm leading-6 text-[#101828]">{value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-[#e5ebf2] pt-8">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Product reviews</p>
                  <h2
                    className="mt-3 text-3xl font-normal tracking-[-0.04em] text-[#123b5f] md:text-4xl"
                    style={{ fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif" }}
                  >
                    What buyers said about this item
                  </h2>
                  <p className="mt-3 text-base leading-7 text-[#667085]">
                    Read feedback from shoppers who bought this product, then add your own review if you have used it.
                  </p>
                </div>

                <div className="mt-8 space-y-4">
                  {reviewItems.map((entry) => (
                    <article
                      className="rounded-[26px] border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] p-5 shadow-[0_12px_32px_rgba(148,163,184,0.1)]"
                      key={entry.id}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3">
                            <p className="text-base font-bold text-[#0f172a]">{entry.user_display_masked}</p>
                            <span className="text-xs font-medium text-[#98a2b3]">
                              {new Date(entry.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="mt-2">{renderStars(entry.rating)}</div>
                        </div>
                      </div>
                      <p className="mt-5 text-[15px] leading-8 text-[#344054]">&ldquo;{entry.review_text}&rdquo;</p>
                      {entry.image_urls.length > 0 ? (
                        <div className="mt-5 flex flex-wrap gap-3">
                          {entry.image_urls.map((imageUrl, index) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={`Product review upload ${index + 1}`}
                              className="h-20 w-20 rounded-[16px] object-cover"
                              key={`${entry.id}-${index}`}
                              src={imageUrl}
                            />
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-5 flex items-center justify-between gap-3 text-xs font-medium text-[#667085]">
                        <div className="flex items-center gap-3">
                          {entry.can_delete ? (
                            <button
                              className="text-[#b42318] transition hover:text-[#912018] disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isDeletingReviewId === entry.id}
                              onClick={() => void handleDeleteReview(entry.id)}
                              type="button"
                            >
                              {isDeletingReviewId === entry.id ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
                        </div>
                        <button
                          className={`relative inline-flex items-center gap-2 text-sm transition ${
                            entry.current_user_liked ? "text-[#1d4ed8]" : "text-[#667085]"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                          disabled={isLikingReviewId === entry.id}
                          onClick={() => void handleToggleReviewLike(entry.id)}
                          type="button"
                        >
                          {likePulseId === entry.id ? (
                            <span className="pointer-events-none absolute left-0 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-[#bfdbfe]/70 animate-ping" />
                          ) : null}
                          <span
                            className={`relative text-xl leading-none transition duration-200 ${
                              likePulseId === entry.id ? "scale-125 -rotate-6" : "scale-100"
                            }`}
                          >
                            👍
                          </span>
                          <span
                            className={`relative transition duration-200 ${
                              likePulseId === entry.id ? "scale-110 font-bold text-[#1d4ed8]" : ""
                            }`}
                          >
                            {entry.likes_count}
                          </span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] px-2 py-2 shadow-[0_10px_26px_rgba(148,163,184,0.1)]">
                    <button
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-base text-[#486480] transition hover:bg-[#eef4fb] disabled:cursor-not-allowed disabled:text-[#c0c9d5]"
                      disabled={reviewPage <= 1}
                      onClick={() => setReviewPage((current) => Math.max(current - 1, 1))}
                      type="button"
                    >
                      ←
                    </button>
                    <div className="flex items-center gap-1.5 px-1">
                      {Array.from({ length: reviewTotalPages }).map((_, index) => {
                        const pageNumber = index + 1;
                        const isActive = pageNumber === reviewPage;
                        return (
                          <button
                            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-semibold transition ${
                              isActive
                                ? "bg-[#111827] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]"
                                : "text-[#486480] hover:bg-[#eef4fb]"
                            }`}
                            key={pageNumber}
                            onClick={() => setReviewPage(pageNumber)}
                            type="button"
                          >
                            {pageNumber}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-base text-[#486480] transition hover:bg-[#eef4fb] disabled:cursor-not-allowed disabled:text-[#c0c9d5]"
                      disabled={reviewPage >= reviewTotalPages}
                      onClick={() => setReviewPage((current) => Math.min(current + 1, reviewTotalPages))}
                      type="button"
                    >
                      →
                    </button>
                  </div>
                </div>

                {isAuthenticated ? (
                  <div className="mt-8 rounded-[28px] border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.12)]">
                    <p className="text-sm font-semibold text-[#0f172a]">Share your product review</p>
                    <div className="mt-3">{renderStars(reviewRating, true, setReviewRating)}</div>
                    <textarea
                      className="mt-4 h-28 w-full resize-none rounded-[20px] border border-[#dbe5ef] bg-white px-4 py-3 text-sm leading-7 text-[#101828] outline-none transition focus:border-[#93c5fd] focus:ring-4 focus:ring-[#dbeafe]"
                      onChange={(event) => setReviewDraft(event.target.value)}
                      placeholder="Tell other shoppers what stood out about this item."
                      value={reviewDraft}
                    />
                    <div className="mt-4 flex items-center gap-4">
                      <label className="inline-flex h-11 items-center justify-center rounded-[16px] border border-[#dce5ef] bg-white px-4 text-sm font-semibold text-[#3f5f87]">
                        Upload image
                        <input
                          accept="image/*"
                          className="hidden"
                          multiple
                          onChange={(event) => void handleReviewImagesChange(event.target.files)}
                          type="file"
                        />
                      </label>
                      <p className="text-sm text-[#667085]">Add up to 4 images if you want to attach real-world photos.</p>
                    </div>
                    {reviewImages.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-3">
                        {reviewImages.map((imageUrl, index) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={`Selected review upload ${index + 1}`}
                            className="h-20 w-20 rounded-[16px] object-cover"
                            key={`review-draft-${index}`}
                            src={imageUrl}
                          />
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 flex items-center justify-between gap-4">
                      <p className="text-sm text-[#667085]">Leave a clear review about the item itself.</p>
                      <button
                        className="inline-flex h-11 shrink-0 items-center justify-center rounded-[16px] bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSubmittingReview}
                        onClick={() => void handleSubmitReview()}
                        type="button"
                      >
                        {isSubmittingReview ? "Publishing..." : "Publish review"}
                      </button>
                    </div>
                    {reviewError ? <p className="mt-4 text-sm font-medium text-[#b42318]">{reviewError}</p> : null}
                  </div>
                ) : (
                  <div className="mt-8 rounded-[24px] border border-dashed border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] px-5 py-6 text-sm text-[#667085]">
                    Sign in to leave a review for this product.
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

export default function ProductDetailPage() {
  return (
    <Suspense fallback={null}>
      <ProductDetailPageContent />
    </Suspense>
  );
}
