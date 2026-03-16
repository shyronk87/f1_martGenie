"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import type { PlanOption } from "@/lib/chat-api";
import type { ChatMessage, TimelineEvent } from "@/lib/chat-contract";
import { readNegotiatedDeals, readNegotiationRuns } from "@/lib/negotiation-store";
import { setOrderCheckout } from "@/lib/order-store";
import AuthModal from "@/src/components/AuthModal";
import Navbar from "@/src/components/Navbar";

type SavedWorkspaceState = {
  sessionId?: string | null;
  messages?: ChatMessage[];
  timeline?: TimelineEvent[];
  plans: PlanOption[];
  activePlanId: string | null;
  status?: string;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";
const PACKAGE_FIT_SCORES = [86, 83, 80];

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

function getSuggestedTarget(price: number) {
  return Math.max(1, Math.round(price * 0.9));
}

function getSuggestedMax(price: number) {
  return Math.max(1, Math.round(price * 0.95));
}

export default function RecommendationsPage() {
  const router = useRouter();
  const initialWorkspace = readSavedWorkspace();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [plans] = useState<PlanOption[]>(initialWorkspace?.plans ?? []);
  const [activePlanId, setActivePlanId] = useState<string | null>(
    initialWorkspace?.activePlanId ?? initialWorkspace?.plans?.[0]?.id ?? null,
  );
  const [expandedNegotiationSku, setExpandedNegotiationSku] = useState<string | null>(null);
  const [targetPriceDrafts, setTargetPriceDrafts] = useState<Record<string, string>>({});
  const [maxAcceptableDrafts, setMaxAcceptableDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      return;
    }

    void fetchCurrentUser(token)
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!initialWorkspace) {
      return;
    }

    writeSavedWorkspace({
      sessionId: initialWorkspace.sessionId ?? null,
      plans,
      activePlanId,
    });
  }, [activePlanId, initialWorkspace, plans]);

  const negotiatedDeals = readNegotiatedDeals();
  const storedNegotiationRuns = readNegotiationRuns();
  const displayedPlans = useMemo(
    () =>
      plans.map((plan) => ({
        ...plan,
        items: plan.items.map((item) => {
          const deal = negotiatedDeals[item.sku];
          return deal ? { ...item, price: deal.negotiatedPrice } : item;
        }),
      })),
    [plans, negotiatedDeals],
  );

  const activePlan =
    displayedPlans.find((plan) => plan.id === activePlanId) ?? displayedPlans[0] ?? null;

  function handleConfirmOrder() {
    if (!activePlan) {
      return;
    }

    const subtotal = activePlan.items.reduce((sum, item) => sum + item.price, 0);
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
      negotiatedSavings: 0,
    });
    router.push("/order");
  }

  function ensureNegotiationDrafts(sku: string, price: number) {
    const storedRun = storedNegotiationRuns[sku];
    setTargetPriceDrafts((current) =>
      current[sku]
        ? current
        : {
            ...current,
            [sku]: String(storedRun?.targetPrice ?? getSuggestedTarget(price)),
          },
    );
    setMaxAcceptableDrafts((current) =>
      current[sku]
        ? current
        : {
            ...current,
            [sku]: String(storedRun?.maxAcceptablePrice ?? getSuggestedMax(price)),
          },
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f9fc_0%,#eef2f7_100%)] text-[#101828]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.22),transparent_24%),radial-gradient(circle_at_85%_10%,rgba(148,163,184,0.18),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.55),transparent_40%)]" />
      <div className="relative">
        <Navbar
          isAuthenticated={isAuthenticated}
          isBlurred={authOpen}
          onOpenAuth={() => setAuthOpen(true)}
          onSignOut={() => {
            clearAccessToken();
            setIsAuthenticated(false);
            router.push("/");
          }}
        />

        <section className="mx-auto max-w-[1480px] px-6 pb-16 pt-28">
          <div className="rounded-[36px] border border-[#dde4ed] bg-white/90 p-8 shadow-[0_24px_80px_rgba(148,163,184,0.12)] backdrop-blur-xl md:p-10">
            <div className="flex flex-col gap-4 border-b border-[#e4e9f0] pb-6 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b97a8]">
                  Packages
                </p>
                <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-[#101828]">
                  Packages from your latest chat session.
                </h1>
                <p className="mt-3 max-w-3xl text-base leading-7 text-[#667085]">
                  Review the packages Nexbuy assembled, inspect item-level reasoning, and jump into negotiation when you want to push pricing further.
                </p>
              </div>
              <Link
                className="inline-flex h-[52px] items-center justify-center rounded-2xl border border-[#d3dae5] bg-[linear-gradient(180deg,#ffffff_0%,#eef2f7_100%)] px-5 text-sm font-semibold text-[#101828] transition hover:border-[#c5cfdb] hover:bg-white"
                href="/chat"
              >
                Back to chat
              </Link>
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
                  {displayedPlans.map((plan, index) => {
                    const isActive = activePlan?.id === plan.id;
                    return (
                      <button
                        className={`w-full rounded-[28px] border p-5 text-left transition ${
                          isActive
                            ? "border-[#bfdbfe] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] shadow-[0_18px_50px_rgba(59,130,246,0.12)]"
                            : "border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] hover:border-[#cfd8e4] hover:shadow-[0_14px_36px_rgba(148,163,184,0.12)]"
                        }`}
                        key={plan.id}
                        onClick={() => setActivePlanId(plan.id)}
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
                          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-[#1d4ed8]">
                            {(PACKAGE_FIT_SCORES[index] ?? Math.round(plan.confidence * 100))}% fit
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-medium leading-7 text-[#344054]">
                          {plan.explanation || plan.summary}
                        </p>
                        <p className="mt-4 text-3xl font-black text-[#101828]">
                          ${plan.totalPrice.toLocaleString()}
                        </p>
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
                            onClick={handleConfirmOrder}
                            type="button"
                          >
                            Place order
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {activePlan.items.map((item) => (
                          <article
                            className="group relative flex flex-col rounded-[24px] border border-[#dde5ef] bg-white p-4 shadow-[0_12px_32px_rgba(148,163,184,0.08)]"
                            key={`${activePlan.id}-${item.sku}`}
                          >
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
                            <h3 className="mt-4 text-lg font-bold text-[#101828]">{item.title}</h3>
                            <p className="mt-2 text-sm leading-6 text-[#667085]">{item.reason}</p>
                            <div className="mt-5 border-t border-[#e8edf4] pt-4">
                              <p className="text-2xl font-black text-[#101828]">
                                ${item.price.toLocaleString()}
                              </p>
                              <button
                                className={`mt-3 inline-flex h-11 w-full items-center justify-between rounded-2xl border px-4 text-sm font-semibold transition ${
                                  expandedNegotiationSku === item.sku
                                    ? "border-[#bfd4ec] bg-[linear-gradient(180deg,#eef4fb_0%,#e4eefb_100%)] text-[#1d4ed8]"
                                    : "border-[#d7e3f4] bg-[linear-gradient(180deg,#ffffff_0%,#f6f9fd_100%)] text-[#344054] hover:border-[#bfd4ec] hover:bg-white"
                                }`}
                                onClick={() => {
                                  ensureNegotiationDrafts(item.sku, item.price);
                                  setExpandedNegotiationSku((current) =>
                                    current === item.sku ? null : item.sku,
                                  );
                                }}
                                type="button"
                              >
                                <span>Agent negotiate</span>
                                <span
                                  className={`text-base leading-none transition ${
                                    expandedNegotiationSku === item.sku ? "rotate-180 text-[#1d4ed8]" : "text-[#98a2b3]"
                                  }`}
                                >
                                  ˅
                                </span>
                              </button>
                            </div>
                            {expandedNegotiationSku === item.sku ? (
                              <div className="mt-4 rounded-[22px] border border-[#dbe5f0] bg-[linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)] p-4">
                                <div className="grid gap-3">
                                  <label className="block">
                                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c8da5]">
                                      Target price
                                    </span>
                                    <input
                                      className="h-11 w-full rounded-2xl border border-[#d6e2f0] bg-white px-4 text-sm text-[#101828] outline-none focus:border-[#9dc1ea]"
                                      min="1"
                                      onChange={(event) =>
                                        setTargetPriceDrafts((current) => ({
                                          ...current,
                                          [item.sku]: event.target.value,
                                        }))
                                      }
                                      step="0.01"
                                      type="number"
                                      value={targetPriceDrafts[item.sku] ?? String(getSuggestedTarget(item.price))}
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c8da5]">
                                      Max acceptable
                                    </span>
                                    <input
                                      className="h-11 w-full rounded-2xl border border-[#d6e2f0] bg-white px-4 text-sm text-[#101828] outline-none focus:border-[#9dc1ea]"
                                      min="1"
                                      onChange={(event) =>
                                        setMaxAcceptableDrafts((current) => ({
                                          ...current,
                                          [item.sku]: event.target.value,
                                        }))
                                      }
                                      step="0.01"
                                      type="number"
                                      value={maxAcceptableDrafts[item.sku] ?? String(getSuggestedMax(item.price))}
                                    />
                                  </label>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-3">
                                  <Link
                                    className="inline-flex h-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,#1f2937_0%,#111827_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition hover:brightness-105"
                                    href={`/negotiation?sku=${encodeURIComponent(item.sku)}&title=${encodeURIComponent(item.title)}&price=${encodeURIComponent(String(item.price))}&planId=${encodeURIComponent(activePlan.id)}&planTitle=${encodeURIComponent(activePlan.title)}&targetPrice=${encodeURIComponent(targetPriceDrafts[item.sku] ?? String(getSuggestedTarget(item.price)))}&maxAcceptablePrice=${encodeURIComponent(maxAcceptableDrafts[item.sku] ?? String(getSuggestedMax(item.price)))}&autoStart=1`}
                                  >
                                    Start in negotiation view
                                  </Link>
                                  <Link
                                    className="inline-flex h-10 items-center justify-center rounded-full border border-[#d7e3f4] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:border-[#bfd4ec] hover:bg-[#f8fbff]"
                                    href={`/negotiation?sku=${encodeURIComponent(item.sku)}&title=${encodeURIComponent(item.title)}&price=${encodeURIComponent(String(item.price))}&planId=${encodeURIComponent(activePlan.id)}&planTitle=${encodeURIComponent(activePlan.title)}&targetPrice=${encodeURIComponent(targetPriceDrafts[item.sku] ?? String(getSuggestedTarget(item.price)))}&maxAcceptablePrice=${encodeURIComponent(maxAcceptableDrafts[item.sku] ?? String(getSuggestedMax(item.price)))}`}
                                  >
                                    View negotiation
                                  </Link>
                                </div>
                                <p className="mt-4 text-xs leading-6 text-[#667085]">
                                  The negotiation page will start the live agent bargaining flow with
                                  these price limits if you choose the primary action.
                                </p>
                                {storedNegotiationRuns[item.sku]?.result?.final_price ? (
                                  <p className="mt-3 text-sm font-medium text-[#166534]">
                                    Last accepted deal:{" "}
                                    ${storedNegotiationRuns[item.sku]?.result?.final_price?.toLocaleString()}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                            {expandedNegotiationSku !== item.sku &&
                            (item.description || item.categoryLabel || getSpecEntries(item.specs).length > 0) ? (
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
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <AuthModal
        onAuthSuccess={async () => {
          const token = readAccessToken();
          if (!token) {
            return;
          }
          await fetchCurrentUser(token);
          setIsAuthenticated(true);
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </main>
  );
}
