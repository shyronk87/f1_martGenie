"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import {
  clearCurrentOrder,
  clearOrderCheckout,
  getDefaultOrderForm,
  readOrderState,
  setCurrentOrder,
  setOrderForm,
  type OrderCheckoutContext,
  type OrderFormData,
  type OrderRecord,
} from "@/lib/order-store";
import AuthModal from "@/src/components/AuthModal";
import Navbar from "@/src/components/Navbar";

const FULFILLMENT_STAGES = [
  "Order confirmed",
  "Supplier coordination",
  "Warehouse packing",
  "Ready for shipment",
];

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}

function generateOrderId() {
  return `NB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function getOrderBasePath(source: OrderCheckoutContext["source"]) {
  return source === "negotiation" ? "/negotiation" : "/recommendations";
}

function FormInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7b8798]">
        {props.label}
      </span>
      <input
        className="h-13 w-full rounded-[20px] border border-[#dce4ee] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 text-sm text-[#101828] outline-none transition focus:border-[#93b8e6] focus:shadow-[0_0_0_4px_rgba(147,184,230,0.14)]"
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        required={props.required}
        type={props.type ?? "text"}
        value={props.value}
      />
    </label>
  );
}

export default function OrderPage() {
  const router = useRouter();
  const initialOrderState = readOrderState();
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAccessToken()));
  const [checkout] = useState<OrderCheckoutContext | null>(initialOrderState.checkout);
  const [form, setForm] = useState<OrderFormData>(initialOrderState.form ?? getDefaultOrderForm());
  const [currentOrder, setCurrentOrderState] = useState<OrderRecord | null>(initialOrderState.currentOrder);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    if (!currentOrder) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveStage((current) => Math.min(current + 1, FULFILLMENT_STAGES.length - 1));
    }, 1600);

    return () => window.clearInterval(timer);
  }, [currentOrder]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      return;
    }

    void fetchCurrentUser(token)
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false));
  }, []);

  const subtotal = checkout?.subtotal ?? 0;
  const shippingFee = subtotal > 0 ? 0 : 0;
  const savings = checkout?.negotiatedSavings ?? 0;
  const totalAmount = subtotal + shippingFee;
  const backHref = checkout ? getOrderBasePath(checkout.source) : "/recommendations";

  const filledItemCount = useMemo(
    () => checkout?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
    [checkout],
  );

  function updateFormField<K extends keyof OrderFormData>(key: K, value: OrderFormData[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      setOrderForm(next);
      return next;
    });
  }

  async function handlePlaceOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setIsSubmitting(false);
    }, 1500);
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f5f8fc_0%,#eef3f9_100%)] text-[#101828]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.24),transparent_24%),radial-gradient(circle_at_82%_8%,rgba(148,163,184,0.18),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.6),transparent_42%)]" />
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
          {!checkout ? (
            <div className="rounded-[36px] border border-[#dce4ee] bg-white/90 p-10 text-center shadow-[0_24px_80px_rgba(148,163,184,0.12)] backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7b8798]">Order</p>
              <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] text-[#101828]">No order package selected yet.</h1>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#667085]">
                Choose a package from the recommendations page or accept a negotiated deal first.
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <Link
                  className="inline-flex h-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-6 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] transition hover:brightness-105"
                  href="/recommendations"
                >
                  Back to packages
                </Link>
                <Link
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#d3dce7] bg-white px-6 text-sm font-semibold text-[#344054] transition hover:border-[#c2cfdd] hover:bg-[#f8fbff]"
                  href="/negotiation"
                >
                  Open negotiation
                </Link>
              </div>
            </div>
          ) : currentOrder ? (
            <div className="space-y-6">
              <div className="rounded-[36px] border border-[#d7e2ec] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-8 shadow-[0_24px_80px_rgba(148,163,184,0.14)]">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(180deg,#22c55e_0%,#16a34a_100%)] text-2xl font-black text-white shadow-[0_18px_40px_rgba(34,197,94,0.25)]">
                  ✓
                </div>
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-[#16a34a]">Order confirmed</p>
                <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-[#101828]">
                  Your order is now locked in.
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-[#667085]">
                  We have captured your shipping details and packaged the selected items into a mock order flow. This is still a front-end simulation, but the experience is designed to mirror a real checkout handoff.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="rounded-full bg-[#ecfdf3] px-4 py-2 text-sm font-semibold text-[#15803d]">
                    Order ID {currentOrder.orderId}
                  </span>
                  <span className="rounded-full bg-[#eff6ff] px-4 py-2 text-sm font-semibold text-[#1d4ed8]">
                    {formatMoney(currentOrder.totalAmount)}
                  </span>
                  {currentOrder.savings > 0 ? (
                    <span className="rounded-full bg-[#f0fdf4] px-4 py-2 text-sm font-semibold text-[#166534]">
                      Saved {formatMoney(currentOrder.savings)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-[32px] border border-[#dce4ee] bg-white/92 p-6 shadow-[0_18px_48px_rgba(148,163,184,0.12)]">
                  <div className="flex items-end justify-between gap-4 border-b border-[#e6edf4] pb-5">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7b8798]">Fulfillment</p>
                      <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[#101828]">Delivery progress</h2>
                    </div>
                    <p className="text-sm text-[#667085]">{FULFILLMENT_STAGES[activeStage]}</p>
                  </div>

                  <div className="mt-6 space-y-5">
                    {FULFILLMENT_STAGES.map((stage, index) => {
                      const isDone = index < activeStage;
                      const isActive = index === activeStage;
                      return (
                        <div className="flex gap-4" key={stage}>
                          <div className="flex flex-col items-center">
                            <span
                              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-black ${
                                isDone
                                  ? "bg-[#dcfce7] text-[#15803d]"
                                  : isActive
                                    ? "bg-[#dbeafe] text-[#1d4ed8]"
                                    : "bg-[#eef2f7] text-[#98a2b3]"
                              }`}
                            >
                              {isDone ? "✓" : index + 1}
                            </span>
                            {index < FULFILLMENT_STAGES.length - 1 ? (
                              <span
                                className={`mt-2 h-16 w-[2px] rounded-full ${
                                  index < activeStage ? "bg-[#bfdbfe]" : "bg-[#e5e7eb]"
                                }`}
                              />
                            ) : null}
                          </div>
                          <div className="pt-1">
                            <p className={`text-sm font-semibold ${isActive ? "text-[#101828]" : "text-[#475467]"}`}>
                              {stage}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-[#667085]">
                              {index === 0
                                ? "Order details validated and ready for supplier handoff."
                                : index === 1
                                  ? "Suppliers are aligning inventory and packaging across the package."
                                  : index === 2
                                    ? "Warehouse packing is being staged to keep the bundle together."
                                    : "The package is waiting for the final shipping trigger."}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[32px] border border-[#dce4ee] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-6 shadow-[0_18px_48px_rgba(148,163,184,0.12)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7b8798]">Summary</p>
                  <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[#101828]">{checkout.packageTitle}</h2>
                  <div className="mt-5 space-y-3">
                    {checkout.items.map((item) => (
                      <div className="flex items-center gap-3 rounded-[22px] border border-[#e4eaf2] bg-white/90 p-3" key={item.sku}>
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
                  <div className="mt-6 space-y-3 rounded-[24px] border border-[#e1e8f0] bg-white p-4">
                    <div className="flex items-center justify-between text-sm text-[#475467]">
                      <span>Items</span>
                      <span>{filledItemCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-[#475467]">
                      <span>Subtotal</span>
                      <span>{formatMoney(subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-[#475467]">
                      <span>Shipping</span>
                      <span>{shippingFee === 0 ? "Free" : formatMoney(shippingFee)}</span>
                    </div>
                    {savings > 0 ? (
                      <div className="flex items-center justify-between text-sm font-semibold text-[#15803d]">
                        <span>Negotiation savings</span>
                        <span>-{formatMoney(savings)}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between border-t border-[#edf2f7] pt-3 text-base font-black text-[#101828]">
                      <span>Total</span>
                      <span>{formatMoney(totalAmount)}</span>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      className="inline-flex h-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-6 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.16)] transition hover:brightness-105"
                      onClick={() => {
                        clearCurrentOrder();
                        router.push(backHref);
                      }}
                      type="button"
                    >
                      Back to continue shopping
                    </button>
                    <button
                      className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#d4dde8] bg-white px-6 text-sm font-semibold text-[#344054] transition hover:border-[#c3cfdd] hover:bg-[#f8fbff]"
                      onClick={() => {
                        clearOrderCheckout();
                        router.push("/recommendations");
                      }}
                      type="button"
                    >
                      Start a new order
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <div className="rounded-[36px] border border-[#dce4ee] bg-white/92 p-8 shadow-[0_24px_80px_rgba(148,163,184,0.12)]">
                  <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e6edf4] pb-6">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7b8798]">Checkout</p>
                      <h1 className="mt-3 text-5xl font-black tracking-[-0.06em] text-[#101828]">Confirm Order</h1>
                      <p className="mt-3 max-w-2xl text-base leading-7 text-[#667085]">
                        Finalize shipping information for this package. This page is currently a front-end mock checkout and does not submit to the backend yet.
                      </p>
                    </div>
                    <Link
                      className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#d3dce7] bg-white px-5 text-sm font-semibold text-[#344054] transition hover:border-[#c3cfdd] hover:bg-[#f8fbff]"
                      href={backHref}
                    >
                      Back
                    </Link>
                  </div>

                  <form className="mt-8 space-y-7" onSubmit={handlePlaceOrder}>
                    <div>
                      <p className="text-sm font-bold text-[#101828]">Shipping Information</p>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <FormInput label="Full Name" onChange={(value) => updateFormField("fullName", value)} placeholder="Your recipient name" required value={form.fullName} />
                        <FormInput label="Email" onChange={(value) => updateFormField("email", value)} placeholder="you@example.com" required type="email" value={form.email} />
                        <FormInput label="Phone" onChange={(value) => updateFormField("phone", value)} placeholder="+86 138 0000 0000" required value={form.phone} />
                        <FormInput label="Country / Region" onChange={(value) => updateFormField("country", value)} placeholder="China" required value={form.country} />
                        <FormInput label="Province / State" onChange={(value) => updateFormField("province", value)} placeholder="Shanghai" required value={form.province} />
                        <FormInput label="City" onChange={(value) => updateFormField("city", value)} placeholder="Shanghai" required value={form.city} />
                        <FormInput label="District" onChange={(value) => updateFormField("district", value)} placeholder="Pudong" value={form.district} />
                        <FormInput label="Postal Code" onChange={(value) => updateFormField("postalCode", value)} placeholder="200000" required value={form.postalCode} />
                      </div>
                      <div className="mt-4 grid gap-4">
                        <FormInput label="Address Line 1" onChange={(value) => updateFormField("addressLine1", value)} placeholder="Building, street, room number" required value={form.addressLine1} />
                        <FormInput label="Address Line 2" onChange={(value) => updateFormField("addressLine2", value)} placeholder="Optional floor, apartment, landmark" value={form.addressLine2} />
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7b8798]">Delivery Note</span>
                          <textarea
                            className="min-h-[120px] w-full rounded-[20px] border border-[#dce4ee] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 py-3 text-sm text-[#101828] outline-none transition focus:border-[#93b8e6] focus:shadow-[0_0_0_4px_rgba(147,184,230,0.14)]"
                            onChange={(event) => updateFormField("deliveryNote", event.target.value)}
                            placeholder="Optional delivery or access instructions"
                            value={form.deliveryNote}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6edf4] pt-6">
                      <p className="text-sm text-[#667085]">
                        Shipping details are kept in local mock state for now and can be wired to the backend later.
                      </p>
                      <button
                        className="inline-flex h-13 items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,#111827_0%,#1d4ed8_55%,#38bdf8_100%)] px-8 text-sm font-semibold text-white shadow-[0_20px_42px_rgba(29,78,216,0.22)] transition hover:translate-y-[-1px] hover:shadow-[0_24px_48px_rgba(29,78,216,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSubmitting}
                        type="submit"
                      >
                        {isSubmitting ? "Placing order..." : "Place Order"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              <aside className="rounded-[36px] border border-[#dce4ee] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-6 shadow-[0_24px_80px_rgba(148,163,184,0.12)]">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7b8798]">Order Summary</p>
                <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[#101828]">{checkout.packageTitle}</h2>
                {checkout.summary ? (
                  <p className="mt-3 text-sm leading-7 text-[#667085]">{checkout.summary}</p>
                ) : null}
                <div className="mt-5 rounded-[24px] border border-[#dfe6ef] bg-white p-4">
                  <div className="space-y-3">
                    {checkout.items.map((item) => (
                      <div className="flex items-center justify-between gap-3" key={item.sku}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#101828]">{item.title}</p>
                          <p className="text-xs text-[#667085]">Qty {item.quantity}</p>
                        </div>
                        <p className="text-sm font-bold text-[#101828]">{formatMoney(item.price * item.quantity)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-5 space-y-3 rounded-[24px] border border-[#dfe6ef] bg-white p-4">
                  <div className="flex items-center justify-between text-sm text-[#475467]">
                    <span>Subtotal</span>
                    <span>{formatMoney(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-[#475467]">
                    <span>Shipping</span>
                    <span>{shippingFee === 0 ? "Free" : formatMoney(shippingFee)}</span>
                  </div>
                  {savings > 0 ? (
                    <div className="flex items-center justify-between text-sm font-semibold text-[#15803d]">
                      <span>Saved via negotiation</span>
                      <span>-{formatMoney(savings)}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-[#edf2f7] pt-3 text-lg font-black text-[#101828]">
                    <span>Total</span>
                    <span>{formatMoney(totalAmount)}</span>
                  </div>
                </div>
              </aside>
            </div>
          )}
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
