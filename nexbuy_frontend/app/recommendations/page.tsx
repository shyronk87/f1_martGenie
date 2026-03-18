"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken, readAuthUserId } from "@/lib/auth";
import type { PlanOption } from "@/lib/chat-api";
import type { ChatMessage, TimelineEvent } from "@/lib/chat-contract";
import { createFavoriteProduct, deleteFavoriteProduct, fetchFavoriteProducts } from "@/lib/favorites-api";
import { readNegotiatedDeals, readNegotiationRuns } from "@/lib/negotiation-store";
import { clearCurrentOrder, setOrderCheckout } from "@/lib/order-store";
import { shareProductByEmail } from "@/lib/share-api";
import AuthModal from "@/src/components/AuthModal";
import ProductShareModal from "@/src/components/ProductShareModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

type SavedWorkspaceState = {
  sessionId?: string | null;
  messages?: ChatMessage[];
  timeline?: TimelineEvent[];
  plans: PlanOption[];
  packageSnapshots?: Record<string, PlanOption[]>;
  activePlanId: string | null;
  status?: string;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";
const NEGOTIATED_DEALS_STORAGE_KEY = "nexbuy.negotiation.results";
const NEGOTIATION_RUNS_STORAGE_KEY = "nexbuy.negotiation.runs";

function readSavedWorkspace(): SavedWorkspaceState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedWorkspaceState) : null;
  } catch {
    window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
    return null;
  }
}

function subscribeStorage(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("focus", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("focus", handler);
  };
}

function getWorkspaceSnapshot() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "";
}

function getWorkspaceServerSnapshot() {
  return "";
}

function getNegotiatedDealsSnapshot() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(NEGOTIATED_DEALS_STORAGE_KEY) ?? "";
}

function getNegotiatedDealsServerSnapshot() {
  return "";
}

function getNegotiationRunsSnapshot() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(NEGOTIATION_RUNS_STORAGE_KEY) ?? "";
}

function getNegotiationRunsServerSnapshot() {
  return "";
}

function writeSavedWorkspace(nextState: SavedWorkspaceState) {
  if (typeof window === "undefined") {
    return;
  }

  const current = readSavedWorkspace();
  window.sessionStorage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      ...current,
      ...nextState,
    }),
  );
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
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

export default function RecommendationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSnapshotId = searchParams.get("snapshot");
  const requestedPlanId = searchParams.get("plan");
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [favoriteSkuSet, setFavoriteSkuSet] = useState<Set<string>>(new Set());
  const [isUpdatingFavoriteSku, setIsUpdatingFavoriteSku] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<{ sku: string; title: string } | null>(null);
  const workspaceSnapshot = useSyncExternalStore(
    subscribeStorage,
    getWorkspaceSnapshot,
    getWorkspaceServerSnapshot,
  );
  const negotiatedDealsSnapshot = useSyncExternalStore(
    subscribeStorage,
    getNegotiatedDealsSnapshot,
    getNegotiatedDealsServerSnapshot,
  );
  const negotiationRunsSnapshot = useSyncExternalStore(
    subscribeStorage,
    getNegotiationRunsSnapshot,
    getNegotiationRunsServerSnapshot,
  );
  const workspaceState = useMemo(() => {
    if (!workspaceSnapshot) {
      return null;
    }
    try {
      return JSON.parse(workspaceSnapshot) as SavedWorkspaceState;
    } catch {
      return null;
    }
  }, [workspaceSnapshot]);
  const negotiationScope = useMemo(
    () => ({
      userId: readAuthUserId(),
      sessionId: workspaceState?.sessionId ?? null,
    }),
    [workspaceState?.sessionId],
  );
  const negotiatedDeals = useMemo(
    () => (negotiatedDealsSnapshot ? readNegotiatedDeals(negotiationScope) : {}),
    [negotiatedDealsSnapshot, negotiationScope],
  );
  const storedNegotiationRuns = useMemo(
    () => (negotiationRunsSnapshot ? readNegotiationRuns(negotiationScope) : {}),
    [negotiationRunsSnapshot, negotiationScope],
  );
  const plans = useMemo(() => workspaceState?.plans ?? [], [workspaceState]);
  const packageSnapshots = useMemo(
    () => workspaceState?.packageSnapshots ?? {},
    [workspaceState],
  );
  const selectedPlans = useMemo(
    () =>
      requestedSnapshotId && packageSnapshots[requestedSnapshotId]
        ? packageSnapshots[requestedSnapshotId]
        : plans,
    [packageSnapshots, plans, requestedSnapshotId],
  );
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const defaultActivePlanId = useMemo(
    () =>
      requestedPlanId ??
      (requestedSnapshotId && workspaceState?.packageSnapshots?.[requestedSnapshotId]?.[0]?.id) ??
      workspaceState?.activePlanId ??
      workspaceState?.plans?.[0]?.id ??
      null,
    [requestedPlanId, requestedSnapshotId, workspaceState],
  );
  const activePlanId = selectedPlanId ?? defaultActivePlanId;

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
        const favorites = await fetchFavoriteProducts();
        setFavoriteSkuSet(new Set(favorites.map((item) => item.sku_id_default)));
      })
      .catch(() => {
        setIsAuthenticated(false);
        setFavoriteSkuSet(new Set());
      });
  }, [requestedSnapshotId, workspaceState]);

  useEffect(() => {
    if (!workspaceState) {
      return;
    }

    writeSavedWorkspace({
      sessionId: workspaceState.sessionId ?? null,
      plans,
      packageSnapshots,
      activePlanId,
    });
  }, [activePlanId, packageSnapshots, plans, workspaceState]);

  const displayedPlans = useMemo(
    () =>
      selectedPlans.map((plan) => {
        const items = plan.items.map((item) => {
          const deal = negotiatedDeals[item.sku];
          return {
            ...item,
            price: deal ? deal.negotiatedPrice : item.price,
            originalPrice: item.price,
            negotiatedSavings: deal ? Math.max(0, item.price - deal.negotiatedPrice) : 0,
          };
        });

        return {
          ...plan,
          totalPrice: items.reduce((sum, item) => sum + item.price, 0),
          items,
        };
      }),
    [negotiatedDeals, selectedPlans],
  );

  const activePlan =
    displayedPlans.find((plan) => plan.id === activePlanId) ?? displayedPlans[0] ?? null;

  function handleBeginOrder() {
    if (!activePlan) {
      return;
    }

    const subtotal = activePlan.items.reduce((sum, item) => sum + item.price, 0);
    const negotiatedSavings = activePlan.items.reduce(
      (sum, item) => sum + (typeof item.negotiatedSavings === "number" ? item.negotiatedSavings : 0),
      0,
    );
    setOrderCheckout({
      source: "package",
      packageId: activePlan.id,
      packageTitle: activePlan.title,
      summary: activePlan.explanation || activePlan.summary,
      items: activePlan.items.map((item) => ({
          sku: item.sku,
          title: item.title,
          price: item.price,
          quantity: 1,
          imageUrl: item.imageUrl ?? null,
      })),
      subtotal,
      negotiatedSavings,
    });
    clearCurrentOrder();
    router.push("/order");
  }

  function handleOpenShare(sku: string, title: string) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setShareTarget({ sku, title });
  }

  async function handleSubmitShare(recipientEmail: string) {
    if (!shareTarget) {
      return;
    }
    await shareProductByEmail({
      sku_id_default: shareTarget.sku,
      recipient_email: recipientEmail,
    });
  }

  async function handleToggleFavorite(item: {
    sku: string;
    title: string;
    price: number;
    imageUrl?: string | null;
    productUrl?: string | null;
    description?: string | null;
    categoryLabel?: string | null;
    reason: string;
    specs?: Record<string, string> | null;
  }) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }

    setIsUpdatingFavoriteSku(item.sku);
    try {
      if (favoriteSkuSet.has(item.sku)) {
        await deleteFavoriteProduct(item.sku);
        setFavoriteSkuSet((current) => {
          const next = new Set(current);
          next.delete(item.sku);
          return next;
        });
      } else {
        await createFavoriteProduct({
          sku_id_default: item.sku,
          title: item.title,
          sale_price: item.price,
          image_url: item.imageUrl ?? null,
          product_url: item.productUrl ?? null,
          description_text: item.description ?? null,
          recommendation_reason: item.reason,
          category_label: item.categoryLabel ?? null,
          specs: item.specs ?? {},
          source_page: "packages",
        });
        setFavoriteSkuSet((current) => new Set([...current, item.sku]));
      }
    } finally {
      setIsUpdatingFavoriteSku(null);
    }
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/recommendations"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          clearAccessToken();
          setIsAuthenticated(false);
          setFavoriteSkuSet(new Set());
          router.push("/");
        }}
      >
        <section className="mx-auto max-w-[1480px] px-6 py-10">
          <div className="rounded-[36px] border border-[#dde4ed] bg-white/90 p-8 shadow-[0_24px_80px_rgba(148,163,184,0.12)] backdrop-blur-xl md:p-10">
            <div className="border-b border-[#e4e9f0] pb-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b97a8]">
                  Packages
                </p>
                <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-[#101828]">
                  Curated packages for your request.
                </h1>
                <p className="mt-3 max-w-3xl text-base leading-7 text-[#667085]">
                  Explore the bundles MartGennie assembled, compare the items inside each set, and move into negotiation when you want a better price.
                </p>
              </div>
            </div>

            {displayedPlans.length === 0 ? (
              <div className="mt-8 rounded-[28px] border border-dashed border-[#d4dce7] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-6 py-14 text-center">
                <p className="text-2xl font-black tracking-[-0.04em] text-[#101828]">
                  No packages yet
                </p>
                <p className="mt-3 text-sm leading-7 text-[#667085]">
                  Start from chat, send a request, and this page will populate with packages and product details.
                </p>
              </div>
            ) : (
              <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_1.15fr]">
                <div className="space-y-4">
                  {displayedPlans.map((plan) => {
                    const isActive = activePlan?.id === plan.id;
                    const planSavings = plan.items.reduce(
                      (sum, item) => sum + (typeof item.negotiatedSavings === "number" ? item.negotiatedSavings : 0),
                      0,
                    );
                    return (
                      <button
                        className={`w-full rounded-[28px] border p-5 text-left transition ${
                          isActive
                            ? "border-[#bfdbfe] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] shadow-[0_18px_50px_rgba(59,130,246,0.12)]"
                            : "border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] hover:border-[#cfd8e4] hover:shadow-[0_14px_36px_rgba(148,163,184,0.12)]"
                        }`}
                        key={plan.id}
                        onClick={() => setSelectedPlanId(plan.id)}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                              {isActive ? "Selected package" : "Package option"}
                            </p>
                            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[#101828]">
                              {plan.title}
                            </h2>
                          </div>
                        </div>
                        <p className="mt-3 text-sm font-medium leading-7 text-[#344054]">
                          {plan.explanation || plan.summary}
                        </p>
                        <p className="mt-4 text-3xl font-black text-[#101828]">
                          ${plan.totalPrice.toLocaleString()}
                        </p>
                        {planSavings > 0 ? (
                          <p className="mt-2 text-sm font-semibold text-emerald-600">
                            Negotiated savings: ${planSavings.toLocaleString()}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-[32px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_18px_50px_rgba(148,163,184,0.1)] md:p-6">
                  {activePlan ? (
                    <>
                      <div className="flex flex-col gap-3 border-b border-[#e4e9f0] pb-5 md:flex-row md:items-end md:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                            Package detail
                          </p>
                          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[#101828]">
                            {activePlan.title}
                          </h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            className="inline-flex h-11 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={handleBeginOrder}
                            type="button"
                          >
                            Place order
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {activePlan.items.map((item) => (
                          <div className="space-y-3" key={`${activePlan.id}-${item.sku}`}>
                            <article className="group relative flex h-full flex-col rounded-[24px] border border-[#dde5ef] bg-white p-4 shadow-[0_12px_32px_rgba(148,163,184,0.08)]">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                                  {item.categoryLabel || "Product"}
                                </p>
                                <div className="flex items-center gap-2">
                                  <button
                                    aria-label="Share by email"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#d4dce7] bg-white text-[15px] text-[#344054] shadow-[0_10px_20px_rgba(148,163,184,0.1)] transition hover:-translate-y-0.5 hover:border-[#c7d2e2] hover:bg-[#f8fafc]"
                                    onClick={() => handleOpenShare(item.sku, item.title)}
                                    type="button"
                                  >
                                    ✉
                                  </button>
                                  <button
                                    aria-label={favoriteSkuSet.has(item.sku) ? "Remove from likes" : "Add to likes"}
                                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-[15px] shadow-[0_10px_20px_rgba(148,163,184,0.1)] transition ${
                                      favoriteSkuSet.has(item.sku)
                                        ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]"
                                        : "border-[#d4dce7] bg-white text-[#344054] hover:-translate-y-0.5 hover:border-[#c7d2e2] hover:bg-[#f8fafc]"
                                    }`}
                                    disabled={isUpdatingFavoriteSku === item.sku}
                                    onClick={() => void handleToggleFavorite(item)}
                                    type="button"
                                  >
                                    ♥
                                  </button>
                                </div>
                              </div>
                              {item.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  alt={item.title}
                                  className="aspect-[4/3] w-full rounded-[20px] object-cover"
                                  src={item.imageUrl}
                                />
                              ) : (
                                <div className="aspect-[4/3] w-full rounded-[20px] bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                              )}
                              <h3 className="mt-4 line-clamp-3 min-h-[5.25rem] text-lg font-bold leading-7 text-[#101828]">
                                {item.title}
                              </h3>
                              <p className="mt-2 line-clamp-4 min-h-[6rem] text-sm leading-6 text-[#667085]">
                                {item.reason}
                              </p>
                              <div className="mt-auto border-t border-[#e8edf4] pt-4">
                                {item.negotiatedSavings > 0 ? (
                                  <div className="space-y-1">
                                    <p className="text-[13px] font-medium text-[#98a2b3] line-through">
                                      ${item.originalPrice.toLocaleString()}
                                    </p>
                                    <p className="text-2xl font-black text-[#101828]">
                                      ${item.price.toLocaleString()}
                                    </p>
                                    <p className="text-sm font-semibold text-emerald-600">
                                      Saved ${item.negotiatedSavings.toLocaleString()}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-2xl font-black text-[#101828]">
                                    ${item.price.toLocaleString()}
                                  </p>
                                )}
                              </div>
                              {(item.description || item.categoryLabel || getSpecEntries(item.specs).length > 0) ? (
                                <div className="pointer-events-none absolute left-[calc(100%+16px)] top-0 z-20 hidden w-[320px] rounded-[24px] border border-[#dbe5f0] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-4 shadow-[0_20px_48px_rgba(15,23,42,0.14)] transition duration-200 group-hover:block xl:block xl:opacity-0 xl:group-hover:opacity-100">
                                  <div className="flex items-start gap-3">
                                    {item.imageUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        alt={item.title}
                                        className="h-16 w-16 shrink-0 rounded-2xl object-cover"
                                        src={item.imageUrl}
                                      />
                                    ) : (
                                      <div className="h-16 w-16 shrink-0 rounded-2xl bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                                        Product detail
                                      </p>
                                      <h3 className="mt-1 line-clamp-2 text-sm font-bold leading-5 text-[#101828]">
                                        {item.title}
                                      </h3>
                                      {item.categoryLabel ? (
                                        <p className="mt-1 text-xs font-medium text-[#475467]">{item.categoryLabel}</p>
                                      ) : null}
                                    </div>
                                  </div>
                                  {item.description ? (
                                    <p className="mt-4 text-xs leading-5 text-[#344054]">
                                      {getDescriptionPreview(item.description)}
                                    </p>
                                  ) : null}
                                  {getSpecEntries(item.specs).length > 0 ? (
                                    <div className="mt-4 space-y-2">
                                      {getSpecEntries(item.specs).map(([label, value]) => (
                                        <div
                                          className="flex items-start justify-between gap-4 rounded-2xl border border-[#e8eef6] bg-white/80 px-3 py-2"
                                          key={`${item.sku}-${label}`}
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
                              ) : null}
                            </article>
                            <div className="grid grid-cols-[1fr] gap-3">
                              <Link
                                className="group flex items-center justify-between rounded-[18px] border border-[#cfe0f5] bg-[linear-gradient(135deg,#0f172a_0%,#172554_42%,#2563eb_100%)] px-4 py-2.5 text-white shadow-[0_16px_38px_rgba(37,99,235,0.24)] transition hover:scale-[1.01] hover:shadow-[0_20px_48px_rgba(37,99,235,0.3)]"
                                href={`/negotiation?sku=${encodeURIComponent(item.sku)}&title=${encodeURIComponent(item.title)}&price=${encodeURIComponent(String(item.price))}&imageUrl=${encodeURIComponent(item.imageUrl ?? "")}&planId=${encodeURIComponent(activePlan.id)}&planTitle=${encodeURIComponent(activePlan.title)}&sessionId=${encodeURIComponent(workspaceState?.sessionId ?? "")}`}
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold">Let the agent bargain</p>
                                </div>
                                <div className="ml-6 flex shrink-0 items-center gap-2.5">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                      storedNegotiationRuns[item.sku]?.result?.outcome === "accepted"
                                        ? "bg-white/18 text-emerald-100"
                                        : "bg-white/14 text-sky-50"
                                    }`}
                                  >
                                    {storedNegotiationRuns[item.sku]?.result?.outcome === "accepted" ? "Accepted" : "Open"}
                                  </span>
                                  <span className="text-base leading-none text-white/90 transition group-hover:translate-x-0.5">
                                    ↗
                                  </span>
                                </div>
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )}
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
          const favorites = await fetchFavoriteProducts();
          setFavoriteSkuSet(new Set(favorites.map((item) => item.sku_id_default)));
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
      <ProductShareModal
        onClose={() => setShareTarget(null)}
        onSubmit={handleSubmitShare}
        open={Boolean(shareTarget)}
        productTitle={shareTarget?.title ?? ""}
      />
    </>
  );
}
