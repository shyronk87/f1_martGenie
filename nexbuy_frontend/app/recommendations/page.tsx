"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import type { MockOrderResponse, PlanOption } from "@/lib/chat-contract";
import { readNegotiatedDeals } from "@/lib/negotiation-store";
import AuthModal from "@/src/components/AuthModal";
import Navbar from "@/src/components/Navbar";

type SavedWorkspaceState = {
  plans: PlanOption[];
  activePlanId: string | null;
  orderResult: MockOrderResponse | null;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";

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

export default function RecommendationsPage() {
  const router = useRouter();
  const initialWorkspace = readSavedWorkspace();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [plans] = useState<PlanOption[]>(initialWorkspace?.plans ?? []);
  const [activePlanId, setActivePlanId] = useState<string | null>(
    initialWorkspace?.activePlanId ?? initialWorkspace?.plans?.[0]?.id ?? null,
  );
  const [orderResult] = useState<MockOrderResponse | null>(initialWorkspace?.orderResult ?? null);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      return;
    }

    void fetchCurrentUser(token)
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false));
  }, []);

  const negotiatedDeals = readNegotiatedDeals();
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
                  {displayedPlans.map((plan) => {
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
                            {Math.round(plan.confidence * 100)}% fit
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-7 text-[#667085]">{plan.summary}</p>
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
                          <p className="mt-2 max-w-3xl text-sm leading-7 text-[#667085]">
                            {activePlan.explanation ?? activePlan.summary}
                          </p>
                        </div>
                        {orderResult ? (
                          <span className="rounded-full bg-[#ecfdf3] px-3 py-1 text-xs font-semibold text-[#15803d]">
                            Order placed: {orderResult.order_id}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {activePlan.items.map((item) => (
                          <article
                            className="flex flex-col rounded-[24px] border border-[#dde5ef] bg-white p-4 shadow-[0_12px_32px_rgba(148,163,184,0.08)]"
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
                            <div className="mt-4 flex items-center justify-between">
                              <p className="text-2xl font-black text-[#101828]">${item.price.toLocaleString()}</p>
                              <Link
                                className="text-sm font-semibold text-[#2563eb] hover:text-[#1d4ed8]"
                                href={`/negotiation?sku=${encodeURIComponent(item.sku)}&title=${encodeURIComponent(item.title)}&price=${encodeURIComponent(String(item.price))}&planId=${encodeURIComponent(activePlan.id)}&planTitle=${encodeURIComponent(activePlan.title)}`}
                              >
                                Open negotiation
                              </Link>
                            </div>
                            {item.productUrl ? (
                              <a
                                className="mt-3 text-sm font-medium text-[#475467] hover:text-[#101828]"
                                href={item.productUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                View product details
                              </a>
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
