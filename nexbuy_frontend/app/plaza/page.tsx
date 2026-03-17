"use client";

import { useEffect, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
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

export default function PlazaPage() {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [error, setError] = useState("");
  const [showcases, setShowcases] = useState<PlazaShowcaseSummary[]>([]);
  const [selectedShowcase, setSelectedShowcase] = useState<PlazaShowcaseDetail | null>(null);
  const [recommendations, setRecommendations] = useState<PlazaRecommendations | null>(null);
  const [recommendationError, setRecommendationError] = useState("");
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

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

function renderRecommendationCard(product: PlazaRecommendationProduct) {
    return (
      <article
        className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-[#dbe5f0] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(244,248,252,0.96)_100%)] shadow-[0_18px_45px_rgba(148,163,184,0.14)] transition duration-300 hover:-translate-y-1 hover:border-[#bfd3ea] hover:shadow-[0_24px_55px_rgba(96,165,250,0.16)]"
        key={product.sku_id_default}
      >
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
      </article>
    );
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/plaza"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          clearAccessToken();
          setIsAuthenticated(false);
          setRecommendations(null);
        }}
      >
        <section className="mx-auto max-w-[1380px] px-6 py-10">
          <div className="rounded-[40px] border border-[#dce5ef] bg-[linear-gradient(180deg,rgba(255,255,255,0.9)_0%,rgba(245,249,253,0.9)_100%)] p-8 shadow-[0_32px_90px_rgba(148,163,184,0.16)] backdrop-blur-xl md:p-10">
            {error ? (
              <div className="rounded-[24px] border border-[#fecaca] bg-[#fff1f2] px-5 py-4 text-sm font-medium text-[#b42318]">
                {error}
              </div>
            ) : null}

            <div className={error ? "mt-10 rounded-[34px] border border-[#dbe5ef] bg-[linear-gradient(180deg,rgba(255,255,255,0.88)_0%,rgba(243,247,251,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] md:p-8" : "rounded-[34px] border border-[#dbe5ef] bg-[linear-gradient(180deg,rgba(255,255,255,0.88)_0%,rgba(243,247,251,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] md:p-8"}>
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
              <div className="inline-flex items-center gap-3 rounded-full border border-[#dce5ef] bg-[linear-gradient(180deg,#ffffff_0%,#edf3f8_100%)] px-4 py-2 text-sm font-bold text-[#3f5f87] shadow-[0_12px_26px_rgba(148,163,184,0.1)]">
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
                <div className="mt-10 rounded-[34px] border border-[#dbe5ef] bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(243,247,251,0.92)_100%)] p-6 shadow-[0_24px_60px_rgba(148,163,184,0.14)] md:p-8">
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
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </>
  );
}
