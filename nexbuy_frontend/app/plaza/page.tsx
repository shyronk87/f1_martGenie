"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, readAccessToken } from "@/lib/auth";
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
import Navbar from "@/src/components/Navbar";

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

export default function PlazaPage() {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [error, setError] = useState("");
  const [showcases, setShowcases] = useState<PlazaShowcaseSummary[]>([]);
  const [selectedShowcase, setSelectedShowcase] = useState<PlazaShowcaseDetail | null>(null);
  const [recommendations, setRecommendations] = useState<PlazaRecommendations | null>(null);
  const [recommendationError, setRecommendationError] = useState("");
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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
            }
          }
        } else if (!cancelled) {
          setIsAuthenticated(false);
          setRecommendations(null);
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

  const topSaving = useMemo(() => {
    if (showcases.length === 0) {
      return 0;
    }
    return Math.max(...showcases.map((item) => item.total_saved_amount));
  }, [showcases]);

  const recommendationProducts = recommendations?.products ?? [];

  function renderRecommendationCard(product: PlazaRecommendationProduct) {
    return (
      <article
        className="overflow-hidden rounded-[24px] border border-[#ece7df] bg-white shadow-[0_10px_24px_rgba(24,24,27,0.04)]"
        key={product.sku_id_default}
      >
        <div className="h-56 bg-[#f4f4f5]">
          {product.main_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={product.title} className="h-full w-full object-cover" src={product.main_image_url} />
          ) : null}
        </div>
        <div className="p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8b8177]">
            {[product.category_name_2, product.category_name_3].filter(Boolean).join(" / ") || product.category_name_1 || "Product"}
          </p>
          <h3 className="mt-2 text-base font-bold leading-6 text-[#27272a]">{product.title}</h3>
          <p className="mt-3 text-sm leading-6 text-[#5f564d]">{product.recommendation_reason}</p>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8b8177]">Price</p>
              <p className="mt-1 text-lg font-black text-[#18181b]">{formatMoney(product.sale_price ?? 0)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8b8177]">Status</p>
              <p className="mt-1 text-sm font-semibold text-[#22a06b]">{product.stock_status_text ?? "Available"}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {product.matched_memory_tags.map((tag) => (
              <span className="rounded-full bg-[#eef2ff] px-3 py-1 text-xs font-bold text-[#5b53d8]" key={`${product.sku_id_default}-${tag}`}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </article>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f4] text-[#18181b]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(216,180,254,0.12),transparent_24%),radial-gradient(circle_at_85%_10%,rgba(187,247,208,0.16),transparent_18%),linear-gradient(180deg,#fbfbfb_0%,#f3f4f6_100%)]" />
      <div className="relative">
        <Navbar isAuthenticated={false} onOpenAuth={() => undefined} onSignOut={() => undefined} />

        <section className="mx-auto max-w-[1380px] px-6 pb-16 pt-28">
          <div className="rounded-[36px] border border-[#e8e5df] bg-white/92 p-8 shadow-[0_24px_80px_rgba(24,24,27,0.06)] md:p-10">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-3 rounded-full bg-[#fff5e8] px-4 py-2 text-sm font-bold text-[#8f5b18]">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#ffb84d] text-white">↗</span>
                Agent Wins
              </div>
              <h1 className="mt-6 text-4xl font-black tracking-[-0.05em] text-[#18110a] md:text-6xl">
                Public victories from agents who assembled stronger packages and lower prices.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[#5f564d]">
                Browse recent showcase cards from across the plaza. The feed is public, seeded from your catalog, and
                designed to feel like an active marketplace instead of a system dashboard.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold text-[#5f564d]">
              <div className="rounded-full border border-[#e8e5df] bg-[#fafaf9] px-4 py-2">{showcases.length} public wins</div>
              <div className="rounded-full border border-[#e8e5df] bg-[#fafaf9] px-4 py-2">
                Top saving {formatMoney(topSaving)}
              </div>
              <div className="rounded-full border border-[#e8e5df] bg-[#fafaf9] px-4 py-2">
                {isBootstrapping ? "Refreshing feed..." : "Open to all visitors"}
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-[24px] border border-[#fecaca] bg-[#fff1f2] px-5 py-4 text-sm font-medium text-[#b42318]">
                {error}
              </div>
            ) : null}

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {showcases.map((showcase, index) => {
                const badge = buildBadge(showcase);
                const isActive = selectedShowcase?.id === showcase.id;
                const shopperInitial = (showcase.user_display_masked || "A").slice(0, 1).toUpperCase();
                return (
                  <button
                    className={`group rounded-[28px] border p-5 text-left shadow-[0_12px_30px_rgba(24,24,27,0.04)] transition ${
                      isActive
                        ? "border-[#d6ccff] bg-[#fcfbff]"
                        : "border-[#ece7df] bg-white hover:-translate-y-1 hover:border-[#ddd6fe]"
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
                          <p className="text-base font-bold text-[#27272a]">{buildAgentLabel(showcase)}</p>
                          <p className="text-sm text-[#71717a]">{formatRelativeTime(showcase.approved_at)}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
                    </div>

                    <p className="mt-5 text-base leading-7 text-[#3f3f46]">
                      {showcase.summary ?? `${buildAgentLabel(showcase)} closed a lower-price package.`}
                    </p>
                    <p className="mt-1 text-base font-black text-[#22a06b]">
                      saved {formatMoney(showcase.total_saved_amount, showcase.currency_symbol)}
                    </p>

                    <div className="mt-5 rounded-[22px] bg-[#f8fafc] p-4">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ede9fe] text-[#7c6df9]">
                          ✣
                        </div>
                        <div>
                          <p className="font-bold text-[#27272a]">{buildCollectionLabel(showcase)}</p>
                          <p className="text-sm text-[#71717a]">
                            {selectedShowcase?.id === showcase.id
                              ? buildCollectionTone(selectedShowcase)
                              : `Curated set ${index + 1}`}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-[#eef2ff] px-4 py-3 text-sm font-bold text-[#5b53d8] transition group-hover:bg-[#e4e7ff]">
                      View Package Story →
                    </div>
                  </button>
                );
              })}
            </div>

            {!isBootstrapping && selectedShowcase ? (
              <div className="mt-10 rounded-[30px] border border-[#ebe7df] bg-[#fcfcfb] p-6 md:p-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8f5b18]">Selected Package</p>
                    <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[#18110a]">
                      {selectedShowcase.bundle_name}
                    </h2>
                    <p className="mt-4 text-base leading-7 text-[#5f564d]">{selectedShowcase.summary}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-[22px] border border-[#ebe7df] bg-white px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8b8177]">Original</p>
                      <p className="mt-2 text-xl font-black">{formatMoney(selectedShowcase.total_original_price)}</p>
                    </div>
                    <div className="rounded-[22px] border border-[#ebe7df] bg-white px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8b8177]">Final</p>
                      <p className="mt-2 text-xl font-black">{formatMoney(selectedShowcase.total_final_price)}</p>
                    </div>
                    <div className="rounded-[22px] border border-[#d4f5df] bg-[#f2fff6] px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#1d8f57]">Saved</p>
                      <p className="mt-2 text-xl font-black text-[#17995b]">
                        {formatMoney(selectedShowcase.total_saved_amount)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  {selectedShowcase.items.map((item) => (
                    <article className="overflow-hidden rounded-[24px] border border-[#ece7df] bg-white" key={item.sku_id_default}>
                      <div className="h-52 bg-[#f4f4f5]">
                        {item.main_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={item.title} className="h-full w-full object-cover" src={item.main_image_url} />
                        ) : null}
                      </div>
                      <div className="p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8b8177]">
                          {[item.category_name_2, item.category_name_3].filter(Boolean).join(" / ") || item.category_name_1 || "Product"}
                        </p>
                        <h3 className="mt-2 text-base font-bold leading-6 text-[#27272a]">{item.title}</h3>
                        <div className="mt-4 flex items-center justify-between text-sm">
                          <span className="text-[#71717a]">Final</span>
                          <span className="font-bold text-[#27272a]">{formatMoney(item.final_price_used)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="text-[#71717a]">Saved</span>
                          <span className="font-bold text-[#22a06b]">{formatMoney(item.saved_amount)}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-10 rounded-[30px] border border-[#ebe7df] bg-[#fcfcfb] p-6 md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8f5b18]">Recommended For You</p>
                  <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[#18110a]">
                    Picks shaped by your saved memory profile
                  </h2>
                  <p className="mt-3 max-w-2xl text-base leading-7 text-[#5f564d]">
                    {recommendations?.memory_summary ??
                      "Sign in and complete your profile to unlock fast, memory-based product recommendations."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(recommendations?.reason_tags ?? []).map((tag) => (
                    <span className="rounded-full border border-[#e4ddff] bg-[#f7f5ff] px-3 py-2 text-xs font-bold text-[#5b53d8]" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {recommendationError ? (
                <div className="mt-6 rounded-[22px] border border-[#fecaca] bg-[#fff1f2] px-5 py-4 text-sm font-medium text-[#b42318]">
                  {recommendationError}
                </div>
              ) : null}

              {isLoadingRecommendations ? (
                <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div className="overflow-hidden rounded-[24px] border border-[#ece7df] bg-white" key={index}>
                      <div className="h-56 animate-pulse bg-[#f4f4f5]" />
                      <div className="space-y-3 p-4">
                        <div className="h-3 w-24 animate-pulse rounded bg-[#f1f0eb]" />
                        <div className="h-6 w-full animate-pulse rounded bg-[#f1f0eb]" />
                        <div className="h-4 w-full animate-pulse rounded bg-[#f1f0eb]" />
                        <div className="h-4 w-2/3 animate-pulse rounded bg-[#f1f0eb]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {!isLoadingRecommendations && isAuthenticated && recommendations?.onboarding_required ? (
                <div className="mt-8 rounded-[24px] border border-dashed border-[#d8d1c8] bg-white px-6 py-10 text-center text-sm text-[#6b645c]">
                  Your account is signed in, but the memory profile is still empty. Complete onboarding to get tailored product picks here.
                </div>
              ) : null}

              {!isLoadingRecommendations && !isAuthenticated ? (
                <div className="mt-8 rounded-[24px] border border-dashed border-[#d8d1c8] bg-white px-6 py-10 text-center text-sm text-[#6b645c]">
                  Sign in to load recommendations based on your saved style, room, household, and budget preferences.
                </div>
              ) : null}

              {!isLoadingRecommendations && isAuthenticated && !recommendations?.onboarding_required && recommendationProducts.length > 0 ? (
                <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {recommendationProducts.map((product) => renderRecommendationCard(product))}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
