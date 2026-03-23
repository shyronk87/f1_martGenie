"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchCurrentUser, logoutSession, readAccessToken } from "@/lib/auth";
import { createFavoriteProduct, deleteFavoriteProduct, fetchFavoriteProducts } from "@/lib/favorites-api";
import { clearCurrentOrder, setOrderCheckout } from "@/lib/order-store";
import { shareProductByEmail } from "@/lib/share-api";
import {
  fetchPlazaRecommendations,
  fetchPlazaShowcaseDetail,
  fetchPlazaShowcases,
  seedMockPlazaShowcases,
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
            const [favoritesResult, recommendationResult] = await Promise.allSettled([
              fetchFavoriteProducts(),
              fetchPlazaRecommendations(),
            ]);

            if (!cancelled) {
              if (favoritesResult.status === "fulfilled") {
                setFavoriteSkuSet(new Set(favoritesResult.value.map((item) => item.sku_id_default)));
              } else {
                setFavoriteSkuSet(new Set());
              }

              if (recommendationResult.status === "fulfilled") {
                setRecommendations(recommendationResult.value);
              } else {
                setRecommendationError(
                  recommendationResult.reason instanceof Error
                    ? recommendationResult.reason.message
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

  function renderRecommendationCard(product: PlazaRecommendationProduct) {
    const currentPrice = product.sale_price ?? 0;
    const originalPrice =
      typeof product.original_price === "number" ? product.original_price : currentPrice;
    const savedAmount = Math.max(0, originalPrice - currentPrice);

    return (
      <div className="flex h-full flex-col gap-3" key={product.sku_id_default}>
        <article className="group relative z-0 flex flex-1 flex-col overflow-visible rounded-[28px] border border-[#dbe5f0] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(244,248,252,0.96)_100%)] shadow-[0_18px_45px_rgba(148,163,184,0.14)] transition duration-300 hover:-translate-y-1 hover:border-[#bfd3ea] hover:shadow-[0_24px_55px_rgba(96,165,250,0.16)]">
          <div className="flex items-center justify-between gap-3 px-5 pt-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8b97a8]">
              Click card for details
            </span>
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
          <Link className="block" href={`/product/${encodeURIComponent(product.sku_id_default)}?from=plaza`}>
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
              <div className="mt-auto pt-5">
                {savedAmount > 0 ? (
                  <p className="text-sm font-medium text-[#98a2b3] line-through">
                    {formatMoney(originalPrice)}
                  </p>
                ) : null}
                <p className="mt-1 text-2xl font-black tracking-[-0.03em] text-[#123b5f]">
                  {formatMoney(currentPrice)}
                </p>
                {savedAmount > 0 ? (
                  <p className="mt-1 text-xs font-semibold text-[#2563eb]">
                    Save {formatMoney(savedAmount)}
                  </p>
                ) : null}
              </div>
            </div>
          </Link>
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
                        {group.products.map((product) => renderRecommendationCard(product))}
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
