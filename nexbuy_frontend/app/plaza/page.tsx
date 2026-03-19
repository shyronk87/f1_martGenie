"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchCurrentUser, logoutSession, readAccessToken } from "@/lib/auth";
import { readAuthUserId } from "@/lib/auth";
import { createFavoriteProduct, deleteFavoriteProduct, fetchFavoriteProducts } from "@/lib/favorites-api";
import { clearCurrentOrder, setOrderCheckout } from "@/lib/order-store";
import { shareProductByEmail } from "@/lib/share-api";
import {
  createMartGennieFeedback,
  deleteMartGennieFeedback,
  fetchPlazaRecommendations,
  fetchMartGennieFeedback,
  fetchPlazaShowcaseDetail,
  fetchPlazaShowcases,
  seedMockPlazaShowcases,
  type MartGennieFeedbackItem,
  toggleMartGennieFeedbackLike,
  type PlazaRecommendationProduct,
  type PlazaRecommendations,
  type PlazaShowcaseDetail,
  type PlazaShowcaseSummary,
} from "@/lib/plaza-api";
import AuthModal from "@/src/components/AuthModal";
import ProductShareModal from "@/src/components/ProductShareModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

function formatMoney(value: number, currencySymbol = "$") {
  return `${currencySymbol}${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatRelativeTime(value: string) {
  const now = Date.now();
  const target = new Date(value).getTime();
  const minutes = Math.max(1, Math.round((now - target) / 60000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function buildAgentLabel(showcase: PlazaShowcaseSummary) {
  const shopper = showcase.user_display_masked || "Shopper";
  return shopper.endsWith("s") ? `${shopper}' Agent` : `${shopper}'s Agent`;
}

function buildBadge(showcase: PlazaShowcaseSummary) {
  if (showcase.total_saved_amount >= 300) {
    return { label: "Deal Found", className: "bg-[#fff1c7] text-[#9e6b00]" };
  }
  if (showcase.item_count >= 3) {
    return { label: "Package Done", className: "bg-[#ece6ff] text-[#6a55d8]" };
  }
  return { label: "Savings", className: "bg-[#ddf9e8] text-[#1d8f57]" };
}

function buildCollectionLabel(showcase: PlazaShowcaseSummary) {
  return showcase.bundle_name ?? "Featured Collection";
}

function buildCollectionTone(detail: PlazaShowcaseDetail | null) {
  const category = detail?.primary_categories[0]?.toLowerCase() ?? "";
  if (category.includes("modern")) {
    return "Modern Minimalist";
  }
  if (category.includes("glam")) {
    return "Glam";
  }
  if (category.includes("scandinav")) {
    return "Scandinavian";
  }
  if (category.includes("mid")) {
    return "Mid-Century";
  }
  return "Curated";
}

function buildRecommendationGroupLabel(product: PlazaRecommendationProduct) {
  return product.category_name_2 || product.category_name_1 || "Recommended";
}

function buildRecommendationCategoryLabel(product: PlazaRecommendationProduct) {
  return [product.category_name_2, product.category_name_3].filter(Boolean).join(" / ");
}

function getSpecEntries(specs: Record<string, string> | null | undefined) {
  if (!specs) {
    return [];
  }

  return Object.entries(specs)
    .map(([label, value]) => [label.trim(), String(value ?? "").trim()] as const)
    .filter(([, value]) => value.length > 0)
    .slice(0, 8);
}

function getDescriptionPreview(description: string | null | undefined) {
  if (!description) {
    return "";
  }

  const normalized = description.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217)}...`;
}

export default function PlazaPage() {
  const router = useRouter();
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [error, setError] = useState("");
  const [showcases, setShowcases] = useState<PlazaShowcaseSummary[]>([]);
  const [selectedShowcase, setSelectedShowcase] = useState<PlazaShowcaseDetail | null>(null);
  const [recommendations, setRecommendations] = useState<PlazaRecommendations | null>(null);
  const [recommendationError, setRecommendationError] = useState("");
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<MartGennieFeedbackItem[]>([]);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackImages, setFeedbackImages] = useState<string[]>([]);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isDeletingFeedbackId, setIsDeletingFeedbackId] = useState<string | null>(null);
  const [isLikingFeedbackId, setIsLikingFeedbackId] = useState<string | null>(null);
  const [likePulseId, setLikePulseId] = useState<string | null>(null);
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackTotalPages, setFeedbackTotalPages] = useState(1);
  const [favoriteSkuSet, setFavoriteSkuSet] = useState<Set<string>>(new Set());
  const [isUpdatingFavoriteSku, setIsUpdatingFavoriteSku] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<Pick<PlazaRecommendationProduct, "sku_id_default" | "title"> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsBootstrapping(true);
      setError("");
      setIsLoadingRecommendations(true);
      setRecommendationError("");
      setFeedbackError("");

      try {
        let list = await fetchPlazaShowcases();
        if (list.length === 0) {
          await seedMockPlazaShowcases();
          list = await fetchPlazaShowcases();
        }
        if (cancelled) {
          return;
        }
        setShowcases(list);
        if (list[0]) {
          const detail = await fetchPlazaShowcaseDetail(list[0].id);
          if (!cancelled) {
            setSelectedShowcase(detail);
          }
        }

        const token = readAccessToken();
        if (token) {
          try {
            await fetchCurrentUser(token);
            if (!cancelled) {
              setIsAuthenticated(true);
            }
            try {
              const favorites = await fetchFavoriteProducts();
              if (!cancelled) {
                setFavoriteSkuSet(new Set(favorites.map((item) => item.sku_id_default)));
              }
            } catch {
              if (!cancelled) {
                setFavoriteSkuSet(new Set());
              }
            }
            try {
              const recommendationPayload = await fetchPlazaRecommendations();
              if (!cancelled) {
                setRecommendations(recommendationPayload);
              }
            } catch (recommendationLoadError) {
              if (!cancelled) {
                setRecommendationError(
                  recommendationLoadError instanceof Error
                    ? recommendationLoadError.message
                    : "Could not load personalized recommendations.",
                );
              }
            }
          } catch {
            if (!cancelled) {
              setIsAuthenticated(false);
              setRecommendations(null);
              setFavoriteSkuSet(new Set());
            }
          }
        } else {
          if (!cancelled) {
            setIsAuthenticated(false);
            setRecommendations(null);
            setFavoriteSkuSet(new Set());
          }
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : "Could not load agent wins.");
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
          setIsLoadingRecommendations(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFeedbackPage() {
      try {
        setFeedbackError("");
        const payload = await fetchMartGennieFeedback(feedbackPage, 5);
        if (cancelled) {
          return;
        }
        setFeedbackItems(payload.items);
        setFeedbackTotalPages(payload.total_pages);
      } catch (feedbackLoadError) {
        if (cancelled) {
          return;
        }
        setFeedbackError(
          feedbackLoadError instanceof Error
            ? feedbackLoadError.message
            : "Could not load user feedback.",
        );
      }
    }

    void loadFeedbackPage();
    return () => {
      cancelled = true;
    };
  }, [feedbackPage, isAuthenticated]);

  async function handleSelectShowcase(showcaseId: string) {
    try {
      setError("");
      const detail = await fetchPlazaShowcaseDetail(showcaseId);
      setSelectedShowcase(detail);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Could not load showcase detail.");
    }
  }

  const recommendationProducts = recommendations?.products ?? [];
  const recommendationGroups = recommendationProducts.reduce<Array<{ label: string; products: PlazaRecommendationProduct[] }>>(
    (groups, product) => {
      const label = buildRecommendationGroupLabel(product);
      const existing = groups.find((group) => group.label === label);
      if (existing) {
        existing.products.push(product);
      } else {
        groups.push({ label, products: [product] });
      }
      return groups;
    },
    [],
  );

  function handlePlaceProductOrder(product: PlazaRecommendationProduct) {
    const price = product.sale_price ?? 0;
    setOrderCheckout({
      source: "plaza",
      packageId: product.sku_id_default,
      packageTitle: product.title,
      summary: product.recommendation_reason,
      items: [
        {
          sku: product.sku_id_default,
          title: product.title,
          price,
          quantity: 1,
          imageUrl: product.main_image_url ?? null,
        },
      ],
      subtotal: price,
      negotiatedSavings: 0,
    });
    clearCurrentOrder();
    router.push("/order");
  }

  function handleOpenShare(product: PlazaRecommendationProduct) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setShareTarget({
      sku_id_default: product.sku_id_default,
      title: product.title,
    });
  }

  async function handleSubmitShare(recipientEmail: string) {
    if (!shareTarget) {
      return;
    }
    await shareProductByEmail({
      sku_id_default: shareTarget.sku_id_default,
      recipient_email: recipientEmail,
    });
  }

  async function handleToggleFavorite(product: PlazaRecommendationProduct) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }

    setIsUpdatingFavoriteSku(product.sku_id_default);
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
          category_label: buildRecommendationCategoryLabel(product) || buildRecommendationGroupLabel(product),
          sale_price: product.sale_price,
          image_url: product.main_image_url,
          product_url: product.product_url,
          description_text: product.description_text,
          recommendation_reason: product.recommendation_reason,
          specs: product.specs ?? {},
          source_page: "plaza",
        });
        setFavoriteSkuSet((current) => new Set([...current, product.sku_id_default]));
      }
    } finally {
      setIsUpdatingFavoriteSku(null);
    }
  }

  async function handleSubmitFeedback() {
    if (!feedbackDraft.trim()) {
      setFeedbackError("Write a short note before publishing your feedback.");
      return;
    }

    try {
      setIsSubmittingFeedback(true);
      setFeedbackError("");
      const created = await createMartGennieFeedback({
        feedback_text: feedbackDraft.trim(),
        rating: feedbackRating,
        image_urls: feedbackImages,
      });
      setFeedbackPage(1);
      setFeedbackItems((current) => [created, ...current].slice(0, 5));
      setFeedbackTotalPages((current) => Math.max(current, 1));
      setFeedbackDraft("");
      setFeedbackRating(5);
      setFeedbackImages([]);
    } catch (submitError) {
      setFeedbackError(
        submitError instanceof Error ? submitError.message : "Could not publish your feedback.",
      );
    } finally {
      setIsSubmittingFeedback(false);
    }
  }

  async function handleDeleteFeedback(feedbackId: string) {
    try {
      setIsDeletingFeedbackId(feedbackId);
      setFeedbackError("");
      await deleteMartGennieFeedback(feedbackId);
      setFeedbackItems((current) => current.filter((item) => item.id !== feedbackId));
    } catch (deleteError) {
      setFeedbackError(
        deleteError instanceof Error ? deleteError.message : "Could not delete your feedback.",
      );
    } finally {
      setIsDeletingFeedbackId(null);
    }
  }

  async function handleToggleLike(feedbackId: string) {
    try {
      setIsLikingFeedbackId(feedbackId);
      setFeedbackError("");
      setLikePulseId(feedbackId);
      const updated = await toggleMartGennieFeedbackLike(feedbackId);
      setFeedbackItems((current) =>
        current.map((item) =>
          item.id === feedbackId
            ? {
                ...item,
                likes_count: updated.likes_count,
                current_user_liked: updated.current_user_liked,
              }
            : item,
        ),
      );
    } catch (likeError) {
      setFeedbackError(
        likeError instanceof Error ? likeError.message : "Could not update feedback like.",
      );
    } finally {
      setIsLikingFeedbackId(null);
      window.setTimeout(() => {
        setLikePulseId((current) => (current === feedbackId ? null : current));
      }, 380);
    }
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

  async function handleFeedbackImagesChange(files: FileList | null) {
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
              reader.onerror = () => reject(new Error("Could not read feedback image."));
              reader.readAsDataURL(file);
            }),
        ),
    );

    setFeedbackImages(nextImages.filter(Boolean));
  }

  function renderRecommendationCard(product: PlazaRecommendationProduct, index: number) {
    const categoryLabel = buildRecommendationCategoryLabel(product);
    const specEntries = getSpecEntries(product.specs);
    const hoverPanelPositionClass =
      index % 4 === 3 ? "right-[calc(100%+16px)]" : "left-[calc(100%+16px)]";
    return (
      <div className="flex h-full flex-col gap-3" key={product.sku_id_default}>
        <article className="group relative z-0 flex flex-1 flex-col overflow-visible rounded-[28px] border border-[#dbe5f0] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(244,248,252,0.96)_100%)] shadow-[0_18px_45px_rgba(148,163,184,0.14)] transition duration-300 hover:z-30 hover:-translate-y-1 hover:border-[#bfd3ea] hover:shadow-[0_24px_55px_rgba(96,165,250,0.16)]">
          <div className="flex items-center justify-end gap-2 px-5 pt-5">
            <div className="flex items-center gap-2">
              <button
                aria-label="Share by email"
                className="inline-flex h-8 w-8 items-center justify-center text-[24px] leading-none text-[#344054] transition hover:-translate-y-0.5 hover:text-[#101828]"
                onClick={() => handleOpenShare(product)}
                type="button"
              >
                ✉
              </button>
              <button
                aria-label={favoriteSkuSet.has(product.sku_id_default) ? "Remove from likes" : "Add to likes"}
                className={`inline-flex h-8 w-8 items-center justify-center text-[26px] leading-none transition hover:-translate-y-0.5 ${
                  favoriteSkuSet.has(product.sku_id_default)
                    ? "text-[#dc2626]"
                    : "text-[#111827] hover:text-[#111827]"
                }`}
                disabled={isUpdatingFavoriteSku === product.sku_id_default}
                onClick={() => void handleToggleFavorite(product)}
                type="button"
              >
                <span aria-hidden="true">{favoriteSkuSet.has(product.sku_id_default) ? "♥" : "♡"}</span>
              </button>
            </div>
          </div>
          <div className="relative h-56 overflow-hidden bg-[linear-gradient(180deg,#edf3f9_0%,#e2e8f0_100%)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(191,219,254,0.45),transparent_40%),linear-gradient(180deg,transparent_35%,rgba(15,23,42,0.03)_100%)]" />
            {product.main_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={product.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" src={product.main_image_url} />
            ) : null}
          </div>
          <div className="flex flex-1 flex-col p-5">
            <h3 className="line-clamp-2 min-h-[3.5rem] text-[17px] font-black leading-7 tracking-[-0.03em] text-[#0f172a]">
              {product.title}
            </h3>
            <p className="mt-3 line-clamp-3 min-h-[5.25rem] text-sm leading-7 text-[#475467]">
              {product.recommendation_reason}
            </p>
            <p className="mt-auto pt-5 text-xl font-black tracking-[-0.03em] text-[#0f172a]">
              {formatMoney(product.sale_price ?? 0)}
            </p>
          </div>
          <div className={`pointer-events-none absolute top-0 z-40 hidden w-[320px] -translate-y-[84px] rounded-[24px] border border-[#dbe5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-4 shadow-[0_20px_48px_rgba(15,23,42,0.14)] xl:group-hover:block ${hoverPanelPositionClass}`}>
            <div className="flex items-start gap-3">
              {product.main_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={product.title}
                  className="h-16 w-16 shrink-0 rounded-2xl object-cover"
                  src={product.main_image_url}
                />
              ) : (
                <div className="h-16 w-16 shrink-0 rounded-2xl bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                  Product detail
                </p>
                <h3 className="mt-1 text-sm font-bold leading-5 text-[#101828]">{product.title}</h3>
                {categoryLabel ? (
                  <p className="mt-1 text-xs font-medium text-[#475467]">{categoryLabel}</p>
                ) : null}
              </div>
            </div>
            <p className="mt-4 text-xs leading-6 text-[#344054]">{product.recommendation_reason}</p>
            {product.description_text ? (
              <p className="mt-4 text-xs leading-5 text-[#344054]">
                {getDescriptionPreview(product.description_text)}
              </p>
            ) : null}
            {product.matched_memory_tags.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {product.matched_memory_tags.slice(0, 4).map((tag) => (
                  <span
                    className="rounded-full border border-[#dbe5ef] bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-[#3f5f87]"
                    key={`${product.sku_id_default}-${tag}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            {specEntries.length > 0 ? (
              <div className="mt-4 space-y-2">
                {specEntries.map(([label, value]) => (
                  <div
                    className="flex items-start justify-between gap-4 rounded-2xl border border-[#e8eef6] bg-white/80 px-3 py-2"
                    key={`${product.sku_id_default}-${label}`}
                  >
                    <span className="text-xs font-semibold text-[#475467]">{label}</span>
                    <span className="max-w-[62%] text-right text-xs leading-5 text-[#101828]">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </article>
        <div className="grid grid-cols-[1fr] gap-3">
          <button
            className="group/order relative inline-flex h-11 items-center justify-center rounded-[16px] bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition duration-200 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_16px_38px_rgba(15,23,42,0.22)]"
            onClick={() => handlePlaceProductOrder(product)}
            type="button"
          >
            <span className="absolute inset-0 rounded-[16px] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent)] opacity-0 transition duration-300 group-hover/order:opacity-100" />
            <span className="relative">Place order</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/plaza"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          void logoutSession().finally(() => {
            setIsAuthenticated(false);
            setRecommendations(null);
            setFavoriteSkuSet(new Set());
          });
        }}
      >
        <section className="mx-auto max-w-[1380px] px-6 py-10">
          <div className="md:px-2">
            {error ? (
              <div className="rounded-[24px] border border-[#fecaca] bg-[#fff1f2] px-5 py-4 text-sm font-medium text-[#b42318]">
                {error}
              </div>
            ) : null}

            <div className={error ? "mt-10 border-b border-[#e3e9f1] pb-10 md:pb-12" : "border-b border-[#e3e9f1] pb-10 md:pb-12"}>
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.38em] text-[#7c8da5]">Personalized picks</p>
                  <h2
                    className="mt-3 text-5xl font-normal tracking-[-0.05em] text-[#123b5f] md:text-6xl"
                    style={{ fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif" }}
                  >
                    Recommended For You
                  </h2>
                </div>
              </div>

              {recommendationError ? (
                <div className="mt-6 rounded-[24px] border border-[#fecaca] bg-[#fff1f2] px-5 py-4 text-sm font-medium text-[#b42318]">
                  {recommendationError}
                </div>
              ) : null}

              {isLoadingRecommendations ? (
                <div className="mt-8 space-y-8">
                  {Array.from({ length: 4 }).map((_, groupIndex) => (
                    <section key={groupIndex}>
                      <div className="h-6 w-40 animate-pulse rounded bg-[#e2e8f0]" />
                      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {Array.from({ length: 4 }).map((__, cardIndex) => (
                          <div className="overflow-hidden rounded-[24px] border border-[#dce5ef] bg-white/90" key={`${groupIndex}-${cardIndex}`}>
                            <div className="h-56 animate-pulse bg-[#e2e8f0]" />
                            <div className="space-y-3 p-4">
                              <div className="h-3 w-24 animate-pulse rounded bg-[#e2e8f0]" />
                              <div className="h-6 w-full animate-pulse rounded bg-[#e2e8f0]" />
                              <div className="h-4 w-full animate-pulse rounded bg-[#e2e8f0]" />
                              <div className="h-4 w-2/3 animate-pulse rounded bg-[#e2e8f0]" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}

              {!isLoadingRecommendations && isAuthenticated && recommendations?.onboarding_required ? (
                <div className="mt-8 rounded-[28px] border border-dashed border-[#c9d5e3] bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] px-6 py-10 text-center text-sm text-[#667085]">
                  Your account is signed in, but the memory profile is still empty. Complete onboarding to get tailored product picks here.
                </div>
              ) : null}

              {!isLoadingRecommendations && !isAuthenticated ? (
                <div className="mt-8 rounded-[28px] border border-dashed border-[#c9d5e3] bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] px-6 py-10 text-center text-sm text-[#667085]">
                  Sign in to load recommendations based on your saved style, room, household, and budget preferences.
                </div>
              ) : null}

              {!isLoadingRecommendations && isAuthenticated && !recommendations?.onboarding_required && recommendationProducts.length > 0 ? (
                <div className="mt-8 space-y-10">
                  {recommendationGroups.map((group) => (
                    <section key={group.label}>
                      <div>
                        <h3 className="text-2xl font-black tracking-[-0.04em] text-[#0f172a]">{group.label}</h3>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {group.products.map((product, index) => renderRecommendationCard(product, index))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-10">
              <div className="inline-flex items-center gap-3 px-1 py-1 text-sm font-bold text-[#3f5f87]">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(180deg,#bfdbfe_0%,#60a5fa_100%)] text-white">↗</span>
                Agent Wins
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {showcases.map((showcase, index) => {
                  const badge = buildBadge(showcase);
                  const isActive = selectedShowcase?.id === showcase.id;
                  const shopperInitial = (showcase.user_display_masked || "A").slice(0, 1).toUpperCase();
                  return (
                    <button
                      className={`group rounded-[30px] border p-5 text-left shadow-[0_18px_45px_rgba(148,163,184,0.12)] transition duration-300 ${
                        isActive
                          ? "border-[#bfd3ea] bg-[linear-gradient(180deg,#f8fbff_0%,#edf4fb_100%)]"
                          : "border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] hover:-translate-y-1 hover:border-[#bfd3ea] hover:shadow-[0_24px_55px_rgba(96,165,250,0.14)]"
                      }`}
                      key={showcase.id}
                      onClick={() => void handleSelectShowcase(showcase.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#ede9fe] text-sm font-black text-[#6d5efc]">
                            {shopperInitial}
                          </div>
                          <div>
                            <p className="text-base font-bold text-[#0f172a]">{buildAgentLabel(showcase)}</p>
                            <p className="text-sm text-[#667085]">{formatRelativeTime(showcase.approved_at)}</p>
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
                      </div>

                      <p className="mt-5 text-base leading-7 text-[#475467]">
                        {showcase.summary ?? `${buildAgentLabel(showcase)} closed a lower-price package.`}
                      </p>
                      <p className="mt-2 text-lg font-black tracking-[-0.03em] text-[#2563eb]">
                        saved {formatMoney(showcase.total_saved_amount, showcase.currency_symbol)}
                      </p>

                      <div className="mt-5 rounded-[24px] border border-[#dce5ef] bg-[linear-gradient(180deg,#f9fbfd_0%,#eef3f8_100%)] p-4">
                        <div className="flex items-center gap-3">
                          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#dce5ef] bg-white text-[#4b6b92]">
                            ✣
                          </div>
                          <div>
                            <p className="font-bold text-[#0f172a]">{buildCollectionLabel(showcase)}</p>
                            <p className="text-sm text-[#667085]">
                              {selectedShowcase?.id === showcase.id
                                ? buildCollectionTone(selectedShowcase)
                                : `Curated set ${index + 1}`}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 inline-flex w-full items-center justify-center rounded-2xl border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#eef3f8_100%)] px-4 py-3 text-sm font-bold text-[#3f5f87] transition group-hover:border-[#bfd3ea] group-hover:bg-[linear-gradient(180deg,#f8fbff_0%,#eaf1f8_100%)]">
                        View Package Story →
                      </div>
                    </button>
                  );
                })}
              </div>

              {!isBootstrapping && selectedShowcase ? (
                <div className="mt-10 border-t border-[#e3e9f1] pt-8 md:pt-10">
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.34em] text-[#7c8da5]">Selected package</p>
                      <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[#0f172a]">
                        {selectedShowcase.bundle_name}
                      </h2>
                      <p className="mt-4 text-base leading-8 text-[#475467]">{selectedShowcase.summary}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-[24px] border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] px-4 py-3">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7c8da5]">Original</p>
                        <p className="mt-2 text-xl font-black text-[#0f172a]">{formatMoney(selectedShowcase.total_original_price)}</p>
                      </div>
                      <div className="rounded-[24px] border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] px-4 py-3">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7c8da5]">Final</p>
                        <p className="mt-2 text-xl font-black text-[#0f172a]">{formatMoney(selectedShowcase.total_final_price)}</p>
                      </div>
                      <div className="rounded-[24px] border border-[#bfdbfe] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] px-4 py-3">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#2563eb]">Saved</p>
                        <p className="mt-2 text-xl font-black text-[#1d4ed8]">
                          {formatMoney(selectedShowcase.total_saved_amount)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 grid gap-4 md:grid-cols-3">
                    {selectedShowcase.items.map((item) => (
                      <article className="overflow-hidden rounded-[28px] border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] shadow-[0_16px_40px_rgba(148,163,184,0.12)]" key={item.sku_id_default}>
                        <div className="h-52 bg-[linear-gradient(180deg,#edf3f9_0%,#e2e8f0_100%)]">
                          {item.main_image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt={item.title} className="h-full w-full object-cover" src={item.main_image_url} />
                          ) : null}
                        </div>
                        <div className="p-5">
                          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-[#7c8da5]">
                            {[item.category_name_2, item.category_name_3].filter(Boolean).join(" / ") || item.category_name_1 || "Product"}
                          </p>
                          <h3 className="mt-3 text-base font-bold leading-7 text-[#0f172a]">{item.title}</h3>
                          <div className="mt-4 flex items-center justify-between text-sm">
                            <span className="text-[#667085]">Final</span>
                            <span className="font-bold text-[#0f172a]">{formatMoney(item.final_price_used)}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-[#667085]">Saved</span>
                            <span className="font-bold text-[#2563eb]">{formatMoney(item.saved_amount)}</span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-12 border-t border-[#e3e9f1] pt-8 md:pt-10">
                <div className="max-w-3xl">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.34em] text-[#7c8da5]">
                    User feedback
                  </p>
                  <h2
                    className="mt-3 text-3xl font-normal tracking-[-0.04em] text-[#123b5f] md:text-4xl"
                    style={{ fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif" }}
                  >
                    What users said about MartGennie
                  </h2>
                  <p className="mt-3 text-base leading-7 text-[#667085]">
                    Recent feedback from shoppers who used MartGennie to compare packages, negotiate pricing, and make faster purchase decisions.
                  </p>
                </div>

                <div className="mt-8 space-y-4">
                  {feedbackItems.map((entry) => (
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
                      <p className="mt-5 text-[15px] leading-8 text-[#344054]">&ldquo;{entry.feedback_text}&rdquo;</p>
                      {entry.image_urls.length > 0 ? (
                        <div className="mt-5 flex flex-wrap gap-3">
                          {entry.image_urls.map((imageUrl, index) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={`Feedback upload ${index + 1}`}
                              className="h-20 w-20 rounded-[16px] object-cover"
                              key={`${entry.id}-${index}`}
                              src={imageUrl}
                            />
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-5 flex items-center justify-between gap-3 text-xs font-medium text-[#667085]">
                        <div className="flex items-center gap-3">
                          {entry.can_delete && entry.user_id === readAuthUserId() ? (
                            <button
                              className="text-[#b42318] transition hover:text-[#912018] disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isDeletingFeedbackId === entry.id}
                              onClick={() => void handleDeleteFeedback(entry.id)}
                              type="button"
                            >
                              {isDeletingFeedbackId === entry.id ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
                        </div>
                        <button
                          className={`relative inline-flex items-center gap-2 text-sm transition ${
                            entry.current_user_liked ? "text-[#1d4ed8]" : "text-[#667085]"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                          disabled={!isAuthenticated || isLikingFeedbackId === entry.id}
                          onClick={() => void handleToggleLike(entry.id)}
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
                      disabled={feedbackPage <= 1}
                      onClick={() => setFeedbackPage((current) => Math.max(current - 1, 1))}
                      type="button"
                    >
                      ←
                    </button>
                    <div className="flex items-center gap-1.5 px-1">
                      {Array.from({ length: feedbackTotalPages }).map((_, index) => {
                        const pageNumber = index + 1;
                        const isActive = pageNumber === feedbackPage;
                        return (
                          <button
                            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-semibold transition ${
                              isActive
                                ? "bg-[#111827] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]"
                                : "text-[#486480] hover:bg-[#eef4fb]"
                            }`}
                            key={pageNumber}
                            onClick={() => setFeedbackPage(pageNumber)}
                            type="button"
                          >
                            {pageNumber}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-base text-[#486480] transition hover:bg-[#eef4fb] disabled:cursor-not-allowed disabled:text-[#c0c9d5]"
                      disabled={feedbackPage >= feedbackTotalPages}
                      onClick={() => setFeedbackPage((current) => Math.min(current + 1, feedbackTotalPages))}
                      type="button"
                    >
                      →
                    </button>
                  </div>
                </div>

                {isAuthenticated ? (
                  <div className="mt-8 rounded-[28px] border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.12)]">
                    <p className="text-sm font-semibold text-[#0f172a]">Share your experience</p>
                    <div className="mt-3">{renderStars(feedbackRating, true, setFeedbackRating)}</div>
                    <textarea
                      className="mt-4 h-28 w-full resize-none rounded-[20px] border border-[#dbe5ef] bg-white px-4 py-3 text-sm leading-7 text-[#101828] outline-none transition focus:border-[#93c5fd] focus:ring-4 focus:ring-[#dbeafe]"
                      onChange={(event) => setFeedbackDraft(event.target.value)}
                      placeholder="Tell other shoppers how MartGennie helped you choose, compare, or negotiate."
                      value={feedbackDraft}
                    />
                    <div className="mt-4 flex items-center gap-4">
                      <label className="inline-flex h-11 items-center justify-center rounded-[16px] border border-[#dce5ef] bg-white px-4 text-sm font-semibold text-[#3f5f87]">
                        Upload image
                        <input
                          accept="image/*"
                          className="hidden"
                          multiple
                          onChange={(event) => void handleFeedbackImagesChange(event.target.files)}
                          type="file"
                        />
                      </label>
                      <p className="text-sm text-[#667085]">Add up to 4 images if you want to attach a setup photo.</p>
                    </div>
                    {feedbackImages.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-3">
                        {feedbackImages.map((imageUrl, index) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={`Selected upload ${index + 1}`}
                            className="h-20 w-20 rounded-[16px] object-cover"
                            key={`draft-${index}`}
                            src={imageUrl}
                          />
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 flex items-center justify-between gap-4">
                      <p className="text-sm text-[#667085]">Leave a clear review about the recommendation experience.</p>
                      <button
                        className="inline-flex h-11 shrink-0 items-center justify-center rounded-[16px] bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSubmittingFeedback}
                        onClick={() => void handleSubmitFeedback()}
                        type="button"
                      >
                        {isSubmittingFeedback ? "Publishing..." : "Publish feedback"}
                      </button>
                    </div>
                    {feedbackError ? (
                      <p className="mt-4 text-sm font-medium text-[#b42318]">{feedbackError}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-8 rounded-[24px] border border-dashed border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] px-5 py-6 text-sm text-[#667085]">
                    Sign in to leave feedback about your MartGennie shopping experience.
                  </div>
                )}

                {feedbackError && !isAuthenticated ? (
                  <p className="mt-4 text-sm font-medium text-[#b42318]">{feedbackError}</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </WorkspaceShell>

      <AuthModal
        onAuthSuccess={async () => {
          const token = readAccessToken();
          if (!token) {
            return;
          }
          await fetchCurrentUser(token);
          setIsAuthenticated(true);
          try {
            const recommendationPayload = await fetchPlazaRecommendations();
            setRecommendations(recommendationPayload);
            setRecommendationError("");
          } catch (recommendationLoadError) {
            setRecommendationError(
              recommendationLoadError instanceof Error
                ? recommendationLoadError.message
                : "Could not load personalized recommendations.",
            );
          }
          try {
            const feedbackPayload = await fetchMartGennieFeedback(1, 5);
            setFeedbackItems(feedbackPayload.items);
            setFeedbackError("");
            setFeedbackPage(feedbackPayload.page);
            setFeedbackTotalPages(feedbackPayload.total_pages);
          } catch (feedbackLoadError) {
            setFeedbackError(
              feedbackLoadError instanceof Error
                ? feedbackLoadError.message
                : "Could not load user feedback.",
            );
          }
          try {
            const favorites = await fetchFavoriteProducts();
            setFavoriteSkuSet(new Set(favorites.map((item) => item.sku_id_default)));
          } catch {
            setFavoriteSkuSet(new Set());
          }
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
      <ProductShareModal
        onClose={() => setShareTarget(null)}
        onSubmit={handleSubmitShare}
        open={Boolean(shareTarget)}
        shareLabel="product"
        title={shareTarget?.title ?? ""}
      />
    </>
  );
}
