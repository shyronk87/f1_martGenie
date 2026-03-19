"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, logoutSession, readAccessToken } from "@/lib/auth";
import {
  clearCurrentOrder,
  clearOrderCheckout,
  readOrderState,
  setCurrentOrder,
  type OrderCheckoutContext,
  type OrderRecord,
} from "@/lib/order-store";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

const FULFILLMENT_STAGES = [
  {
    title: "Order Confirmed",
    description: "Your package has been locked in and sent to processing.",
    icon: "✓",
  },
  {
    title: "Preparing",
    description: "Items are being prepared and grouped into one shipment.",
    icon: "▣",
  },
  {
    title: "Shipped",
    description: "Your package is on the way from the supplier network.",
    icon: "▤",
  },
  {
    title: "Out for Delivery",
    description: "The courier is arranging the final handoff to your address.",
    icon: "◎",
  },
  {
    title: "Delivered",
    description: "Everything is on site and your order flow is complete.",
    icon: "⌂",
  },
];

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}

function generateOrderId() {
  return `MG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function getOrderBasePath(source: OrderCheckoutContext["source"]) {
  if (source === "negotiation") {
    return "/negotiation";
  }
  if (source === "plaza") {
    return "/plaza";
  }
  if (source === "favorites") {
    return "/favorites";
  }
  return "/chat";
}

function getBackLabel(source: OrderCheckoutContext["source"]) {
  if (source === "negotiation") {
    return "Back to Negotiation";
  }
  if (source === "plaza") {
    return "Back to Plaza";
  }
  if (source === "favorites") {
    return "Back to My Likes";
  }
  return "Back to Chat";
}

function ProgressDot(props: { done: boolean; active: boolean; icon: string }) {
  if (props.done) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#10b981] text-base font-black text-white shadow-[0_10px_24px_rgba(16,185,129,0.22)]">
        ✓
      </span>
    );
  }

  if (props.active) {
    return (
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#cfeadf] bg-[#ecfdf5] text-sm text-[#10b981] shadow-[0_8px_20px_rgba(16,185,129,0.12)]">
        <span className="pointer-events-none absolute h-5 w-5 animate-spin rounded-full border-2 border-[#10b981] border-t-transparent" />
        <span className="opacity-0">{props.icon}</span>
      </span>
    );
  }

  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d9e2ec] bg-white text-sm font-semibold text-[#b8c2d0]">
      {props.icon}
    </span>
  );
}

export default function OrderPage() {
  const router = useRouter();
  const initialOrderState = readOrderState();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [checkout] = useState<OrderCheckoutContext | null>(initialOrderState.checkout);
  const [currentOrder, setCurrentOrderState] = useState<OrderRecord | null>(initialOrderState.currentOrder);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeStage, setActiveStage] = useState(currentOrder ? 0 : -1);

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
    if (!currentOrder) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveStage((current) => {
        if (current >= FULFILLMENT_STAGES.length) {
          return current;
        }
        return current + 1;
      });
    }, 1600);

    return () => window.clearInterval(timer);
  }, [currentOrder]);

  const subtotal = checkout?.subtotal ?? 0;
  const shippingFee = 0;
  const savings = checkout?.negotiatedSavings ?? 0;
  const totalAmount = subtotal + shippingFee;
  const backHref = checkout ? getOrderBasePath(checkout.source) : "/chat";
  const backLabel = checkout ? getBackLabel(checkout.source) : "Back";
  const itemCount = useMemo(
    () => checkout?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
    [checkout],
  );

  function handlePlaceOrder() {
    if (!checkout || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    window.setTimeout(() => {
      const nextOrder: OrderRecord = {
        orderId: generateOrderId(),
        createdAt: new Date().toISOString(),
        packageTitle: checkout.packageTitle,
        totalAmount,
        savings,
        status: "confirmed",
      };
      setCurrentOrder(nextOrder);
      setCurrentOrderState(nextOrder);
      setActiveStage(0);
      setCurrentOrder(nextOrder);
      setIsSubmitting(false);
    }, 900);
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/order"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          void logoutSession().finally(() => {
            setIsAuthenticated(false);
            router.push("/");
          });
        }}
      >
        <section className="h-full overflow-y-auto px-6 py-6">
          {!checkout ? (
            <div className="mx-auto max-w-[760px] rounded-[34px] border border-[#dce4ee] bg-white/92 p-10 text-center shadow-[0_24px_80px_rgba(148,163,184,0.12)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7b8798]">Order</p>
              <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] text-[#101828]">No package selected yet.</h1>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#667085]">
                Choose a package first, then come back here to place the order.
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <Link
                  className="inline-flex h-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-6 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] transition hover:brightness-105"
                  href="/chat"
                >
                  Back to chat
                </Link>
              </div>
            </div>
          ) : currentOrder ? (
            <div className="mx-auto max-w-[680px] space-y-4">
              <div className="rounded-[24px] bg-[linear-gradient(180deg,#17b889_0%,#12a37f_100%)] px-5 py-5 text-white shadow-[0_18px_46px_rgba(16,185,129,0.2)]">
                <div className="mx-auto flex max-w-[320px] flex-col items-center text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/12">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs font-black">
                      ✓
                    </div>
                  </div>
                  <h1 className="mt-3 text-[1.35rem] font-black tracking-[-0.05em]">Order Placed Successfully!</h1>
                  <p className="mt-2 text-xs text-white/90">Order ID: {currentOrder.orderId}</p>
                  <div className="mt-3 rounded-full bg-white/14 px-3.5 py-1.5 text-[11px] font-semibold text-white">
                    Total Paid <span className="ml-2 text-lg font-black">{formatMoney(currentOrder.totalAmount)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-[#dce4ee] bg-white/96 p-5 shadow-[0_16px_40px_rgba(148,163,184,0.1)]">
                <h2 className="text-[1.45rem] font-black tracking-[-0.04em] text-[#101828]">Order Status</h2>
                <div className="mt-5 space-y-1">
                  {FULFILLMENT_STAGES.map((stage, index) => {
                    const done = index < activeStage;
                    const active = index === activeStage && activeStage < FULFILLMENT_STAGES.length;
                    return (
                      <div className="flex gap-3.5" key={stage.title}>
                        <div className="flex flex-col items-center">
                          <ProgressDot active={active} done={done} icon={stage.icon} />
                          {index < FULFILLMENT_STAGES.length - 1 ? (
                            <span className={`mt-1.5 h-12 w-px ${index < activeStage ? "bg-[#a7f3d0]" : "bg-[#e5e7eb]"}`} />
                          ) : null}
                        </div>
                        <div className="pt-0.5">
                          <p className={`text-lg font-bold ${done || active ? "text-[#111827]" : "text-[#c0cad8]"}`}>
                            {stage.title}
                          </p>
                          <p className={`mt-1 text-[13px] leading-5 ${done || active ? "text-[#667085]" : "text-[#c0cad8]"}`}>
                            {stage.description}
                          </p>
                          {active ? (
                            <span className="mt-2 inline-flex rounded-full bg-[#dcfce7] px-3 py-1 text-xs font-semibold text-[#059669]">
                              In Progress
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className="inline-flex h-12 items-center justify-center rounded-[18px] border border-[#d7e0ea] bg-white px-6 text-sm font-semibold text-[#475467] shadow-[0_10px_24px_rgba(148,163,184,0.08)] transition hover:border-[#c8d3e0] hover:bg-[#f8fbff]"
                  onClick={() => {
                    clearCurrentOrder();
                    router.push(backHref);
                  }}
                  type="button"
                >
                  {backLabel}
                </button>
                <button
                  className="inline-flex h-12 items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#0f172a_0%,#1d4ed8_100%)] px-6 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(29,78,216,0.22)] transition hover:brightness-105"
                  onClick={() => {
                    clearOrderCheckout();
                    clearCurrentOrder();
                    router.push("/chat");
                  }}
                  type="button"
                >
                  Start Another Chat
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[620px]">
              <div className="rounded-[34px] border border-[#dce4ee] bg-white/95 p-7 shadow-[0_24px_80px_rgba(148,163,184,0.12)]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7b8798]">Order Summary</p>
                <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-[#101828]">{checkout.packageTitle}</h1>
                {checkout.summary ? (
                  <p className="mt-4 text-base leading-7 text-[#667085]">{checkout.summary}</p>
                ) : null}

                <div className="mt-6 space-y-3">
                  {checkout.items.map((item) => (
                    <div className="flex items-center gap-3 rounded-[22px] border border-[#e4eaf2] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-3" key={item.sku}>
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={item.title} className="h-16 w-16 rounded-2xl object-cover" src={item.imageUrl} />
                      ) : (
                        <div className="h-16 w-16 rounded-2xl bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#101828]">{item.title}</p>
                        <p className="mt-1 text-xs text-[#667085]">Qty {item.quantity}</p>
                      </div>
                      <p className="text-sm font-bold text-[#101828]">{formatMoney(item.price * item.quantity)}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 space-y-3 rounded-[24px] border border-[#e1e8f0] bg-[#fbfdff] p-4">
                  <div className="flex items-center justify-between text-sm text-[#475467]">
                    <span>Items</span>
                    <span>{itemCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-[#475467]">
                    <span>Subtotal</span>
                    <span>{formatMoney(subtotal)}</span>
                  </div>
                  {savings > 0 ? (
                    <div className="flex items-center justify-between text-sm font-semibold text-[#059669]">
                      <span>Negotiation savings</span>
                      <span>-{formatMoney(savings)}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-[#e8eef5] pt-3 text-base font-black text-[#101828]">
                    <span>Total</span>
                    <span>{formatMoney(totalAmount)}</span>
                  </div>
                </div>

                <div className="mt-7 flex flex-wrap gap-3">
                  <button
                    className="inline-flex h-12 items-center justify-center rounded-[18px] border border-[#d7e0ea] bg-white px-6 text-sm font-semibold text-[#475467] transition hover:border-[#c8d3e0] hover:bg-[#f8fbff]"
                    onClick={() => router.push(backHref)}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="inline-flex h-12 items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-6 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSubmitting}
                    onClick={handlePlaceOrder}
                    type="button"
                  >
                    {isSubmitting ? "Placing order..." : "Place order"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </>
  );
}
