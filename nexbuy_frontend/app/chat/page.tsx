"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import {
  createMockOrder,
  createChatSession,
  type ChatMessage,
  type MockOrderResponse,
  type PlanOption,
  sendChatMessage,
  subscribeChatStream,
  type TimelineEvent,
} from "@/lib/chat-api";
import {
  fetchMemoryProfile,
  fetchOnboardingQuestions,
  saveMemoryProfile,
  type OnboardingQuestion,
} from "@/lib/memory-api";
import { readNegotiatedDeals, type NegotiatedDeal } from "@/lib/negotiation-store";

type FriendlyEvent = {
  title: string;
  detail: string;
};

function buildFriendlyEvent(event: TimelineEvent): FriendlyEvent {
  const type = event.type.toLowerCase();
  const message = event.message.toLowerCase();

  if (type === "scan_started") {
    return {
      title: "Parsing Request",
      detail: event.message,
    };
  }

  if (type === "scan_progress") {
    if (message.includes("long-term memory")) {
      return {
        title: "Loading User Memory",
        detail: event.message,
      };
    }
    if (message.includes("structured fields extracted")) {
      return {
        title: "Extracting Structured Fields",
        detail: event.message,
      };
    }
    if (message.includes("analysis")) {
      return {
        title: "Analyzing User Intent",
        detail: event.message,
      };
    }
    if (message.includes("query") || message.includes("database") || message.includes("search")) {
      return {
        title: "Searching Product Data",
        detail: event.message,
      };
    }
    return {
      title: "Processing Pipeline Step",
      detail: event.message,
    };
  }

  if (type === "candidate_found") {
    return {
      title: "Products Matched",
      detail: event.message,
    };
  }

  if (type === "bundle_built") {
    return {
      title: "Building Recommendation Bundles",
      detail: event.message,
    };
  }

  if (type === "plan_ready") {
    return {
      title: "Recommendations Ready",
      detail: event.message,
    };
  }

  if (type === "done") {
    return {
      title: "Pipeline Complete",
      detail: event.message,
    };
  }

  if (type.includes("error")) {
    return {
      title: "Pipeline Error",
      detail: event.message,
    };
  }

  return {
    title: "Pipeline Update",
    detail: event.message,
  };
}


export default function ChatWorkspacePage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [showOrderConfirm, setShowOrderConfirm] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderResult, setOrderResult] = useState<MockOrderResponse | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingQuestions, setOnboardingQuestions] = useState<OnboardingQuestion[]>([]);
  const [onboardingAnswers, setOnboardingAnswers] = useState<Record<string, string | string[]>>({});
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [negotiatedDeals, setNegotiatedDeals] = useState<Record<string, NegotiatedDeal>>({});
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("Preparing workspace...");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [runElapsedSec, setRunElapsedSec] = useState(0);
  const [streamText, setStreamText] = useState("");
  const streamTextRef = useRef("");
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const runStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isSending) {
      setRunElapsedSec(0);
      runStartRef.current = null;
      return;
    }
    runStartRef.current = Date.now();
    setRunElapsedSec(0);
    const timer = window.setInterval(() => {
      if (!runStartRef.current) {
        return;
      }
      const seconds = Math.floor((Date.now() - runStartRef.current) / 1000);
      setRunElapsedSec(seconds);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isSending]);

  useEffect(() => {
    function syncNegotiatedDeals() {
      setNegotiatedDeals(readNegotiatedDeals());
    }

    syncNegotiatedDeals();
    window.addEventListener("focus", syncNegotiatedDeals);
    window.addEventListener("storage", syncNegotiatedDeals);

    return () => {
      window.removeEventListener("focus", syncNegotiatedDeals);
      window.removeEventListener("storage", syncNegotiatedDeals);
    };
  }, []);

  useEffect(() => {
    let unmounted = false;

    async function bootstrap() {
      const token = readAccessToken();
      if (!token) {
        setStatus("No active session. Please sign in first.");
        setError("Missing access token.");
        return;
      }

      try {
        await fetchCurrentUser(token);
        const memory = await fetchMemoryProfile();
        if (memory.onboarding_required) {
          const questions = await fetchOnboardingQuestions();
          if (unmounted) {
            return;
          }
          setOnboardingQuestions(questions);
          setShowOnboarding(true);
          setStatus("Please complete onboarding questions first.");
        } else {
          const createdSessionId = await createChatSession();
          if (unmounted) {
            return;
          }
          setSessionId(createdSessionId);
          setStatus("Workspace ready. Tell me your room, style, and budget.");
        }
      } catch (bootstrapError) {
        clearAccessToken();
        const message =
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Could not initialize workspace.";
        setError(message);
        setStatus("Session validation failed. Sign in again.");
      }
    }

    void bootstrap();

    return () => {
      unmounted = true;
      unsubscribeRef.current?.();
    };
  }, []);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || !sessionId || isSending) {
      return;
    }

    setPrompt("");
    setError("");
    setIsSending(true);
    setStreamText("");
    streamTextRef.current = "";
    setStatus("AI is analyzing your request...");
    setMessages((current) => [
      ...current,
      {
        id: `user-${crypto.randomUUID()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const { taskId } = await sendChatMessage(sessionId, content);
      setTimeline((current) => [
        {
          id: `t-${crypto.randomUUID()}`,
          type: "scan_started",
          message: "Task accepted and dispatched.",
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);

      unsubscribeRef.current?.();
      unsubscribeRef.current = subscribeChatStream(sessionId, taskId, (eventPayload) => {
        if (eventPayload.type === "timeline_event") {
          setTimeline((current) => [eventPayload.event, ...current]);
          return;
        }

        if (eventPayload.type === "message_delta") {
          setStreamText((current) => {
            const next = current + eventPayload.delta;
            streamTextRef.current = next;
            return next;
          });
          return;
        }

        if (eventPayload.type === "message") {
          setMessages((current) => [...current, eventPayload.message]);
          return;
        }

        if (eventPayload.type === "plan_ready") {
          setPlans(eventPayload.plans);
          if (eventPayload.plans.length > 0) {
            setActivePlanId(eventPayload.plans[0].id);
          }
          setStatus("Plans are ready. Review and pick one.");
          return;
        }

        if (eventPayload.type === "error") {
          setError(eventPayload.error);
          setStatus("Pipeline returned an error.");
          setIsSending(false);
          return;
        }

        if (eventPayload.type === "done") {
          const finalizedMessage = streamTextRef.current.trim();
          if (finalizedMessage) {
            setMessages((current) => [
              ...current,
              {
                id: `assistant-${crypto.randomUUID()}`,
                role: "assistant",
                content: finalizedMessage,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          setStreamText("");
          streamTextRef.current = "";
          setIsSending(false);
          setStatus("Done. You can refine requirements or ask for alternatives.");
        }
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Could not send message.";
      setError(message);
      setStatus("Request failed.");
      setIsSending(false);
    }
  }

  function handleCancel() {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setIsSending(false);
    setStreamText("");
    streamTextRef.current = "";
    setStatus("Search canceled. You can send a new request.");
    setTimeline((current) => [
      {
        id: `t-${crypto.randomUUID()}`,
        type: "error",
        message: "User canceled this run.",
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
  }

  async function handleConfirmOrder() {
    if (!sessionId || !activePlan) {
      return;
    }
    setIsPlacingOrder(true);
    setError("");
    try {
      const result = await createMockOrder({
        sessionId,
        planId: activePlan.id,
        items: activePlan.items.map((item) => ({
          sku: item.sku,
          title: item.title,
          price: item.price,
          quantity: 1,
        })),
        paymentMethod: "card",
        shippingAddress: "Mock address",
      });
      setOrderResult(result);
      setShowOrderConfirm(false);
      setStatus("Order placed (mock).");
    } catch (placeError) {
      const message = placeError instanceof Error ? placeError.message : "Failed to place order.";
      setError(message);
    } finally {
      setIsPlacingOrder(false);
    }
  }

  function handleOpenNegotiation() {
    if (!activePlan || activePlan.items.length === 0) {
      return;
    }

    const primaryItem = activePlan.items[0];
    const params = new URLSearchParams({
      sku: primaryItem.sku,
      title: primaryItem.title,
      price: String(primaryItem.price),
      planTitle: activePlan.title,
    });

    router.push(`/negotiation?${params.toString()}`);
  }

  function handleOpenItemNegotiation(plan: PlanOption, item: PlanOption["items"][number]) {
    const params = new URLSearchParams({
      sku: item.sku,
      title: item.title,
      price: String(item.price),
      planId: plan.id,
      planTitle: plan.title,
    });

    router.push(`/negotiation?${params.toString()}`);
  }

  function setOnboardingMultiValue(questionKey: string, value: string, checked: boolean) {
    setOnboardingAnswers((current) => {
      const prev = current[questionKey];
      const arr = Array.isArray(prev) ? [...prev] : [];
      const next = checked ? Array.from(new Set([...arr, value])) : arr.filter((v) => v !== value);
      return { ...current, [questionKey]: next };
    });
  }

  async function handleSubmitOnboarding() {
    setIsSavingOnboarding(true);
    setError("");
    try {
      const housingType =
        typeof onboardingAnswers.housing_type === "string"
          ? onboardingAnswers.housing_type
          : null;

      const negativeInput = onboardingAnswers.negative_constraints;
      const negativeConstraints = Array.isArray(negativeInput)
        ? negativeInput
        : typeof negativeInput === "string"
          ? negativeInput
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

      await saveMemoryProfile({
        housing_type: housingType,
        space_tier: null,
        household_members: Array.isArray(onboardingAnswers.household_members)
          ? onboardingAnswers.household_members
          : [],
        style_preferences: Array.isArray(onboardingAnswers.style_preferences)
          ? onboardingAnswers.style_preferences
          : [],
        price_philosophy:
          typeof onboardingAnswers.price_philosophy === "string"
            ? onboardingAnswers.price_philosophy
            : null,
        negative_constraints: negativeConstraints,
        raw_answers: onboardingAnswers,
      });

      const createdSessionId = await createChatSession();
      setSessionId(createdSessionId);
      setShowOnboarding(false);
      setStatus("Memory saved. Workspace ready.");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to save onboarding.";
      setError(message);
    } finally {
      setIsSavingOnboarding(false);
    }
  }

  const renderedMessages = streamText
    ? [
        ...messages,
        {
          id: "assistant-draft",
          role: "assistant" as const,
          content: streamText,
          createdAt: new Date().toISOString(),
        },
      ]
    : messages;

  const timelinePreview = timeline.slice(0, 8);
  const displayedPlans = plans.map((plan) => {
    const items = plan.items.map((item) => {
      const deal = negotiatedDeals[item.sku];
      if (!deal) {
        return item;
      }

      return {
        ...item,
        price: deal.negotiatedPrice,
      };
    });
    const totalPrice = items.reduce((sum, item) => sum + item.price, 0);

    return {
      ...plan,
      items,
      totalPrice,
    };
  });
  const activePlan =
    displayedPlans.find((plan) => plan.id === activePlanId) ??
    (displayedPlans.length > 0 ? displayedPlans[0] : null);

  return (
    <main className="min-h-screen bg-[#f8f8f6] px-4 py-5 text-[#1f2937] md:px-6">
      <div className="mx-auto grid w-full max-w-[1500px] gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="flex min-h-[86vh] flex-col rounded-[28px] border border-[#e8e6e1] bg-white p-4 shadow-sm md:p-6">
          <div className="flex items-center justify-between border-b border-[#ece9e3] pb-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">AI Shopping Assistant</h1>
              <p className="mt-1 text-sm text-slate-500">{status}</p>
            </div>
            <Link
              className="rounded-full border border-[#d8d4cc] px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[#bdb7ad] hover:bg-[#f4f2ee]"
              href="/"
            >
              Back
            </Link>
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {renderedMessages.length === 0 ? (
              <article className="max-w-[80%] rounded-2xl border border-[#d8e6f4] bg-[#eef6ff] px-4 py-3 text-sm text-[#1f4f78]">
                Try: &quot;My living room is 20m2, modern warm wood style, budget $3,000, need sofa + TV
                stand + rug.&quot;
              </article>
            ) : (
              renderedMessages.map((message) => (
                <article
                  className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-7 md:text-[15px] ${
                    message.role === "user"
                      ? "ml-auto border border-[#d7e6f5] bg-[#ecf5ff] text-[#123b5f]"
                      : "mr-auto border border-[#e4e4df] bg-[#fafaf8] text-[#2f3540]"
                  }`}
                  key={message.id}
                >
                  <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    {message.role === "user" ? "You" : "AI"}
                  </p>
                  <p>
                    {message.content}
                    {message.id === "assistant-draft" && isSending ? (
                      <span className="ml-2 text-xs text-slate-400">({runElapsedSec}s)</span>
                    ) : null}
                  </p>
                </article>
              ))
            )}
          </div>

          <form className="mt-4 flex items-end gap-2 border-t border-[#ece9e3] pt-4" onSubmit={handleSend}>
            <textarea
              className="min-h-[56px] w-full resize-none rounded-2xl border border-[#dad7d0] bg-[#fbfbf9] px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#9bb7d3]"
              disabled={!sessionId || isSending}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe your space, style, budget, and must-have items..."
              rows={2}
              value={prompt}
            />
            <button
              className="h-[56px] rounded-2xl bg-[#2f6fa3] px-5 text-sm font-semibold text-white transition hover:bg-[#285f8d] disabled:cursor-not-allowed disabled:bg-[#b7c8d8] disabled:text-slate-200"
              disabled={!sessionId || isSending || !prompt.trim()}
              type="submit"
            >
              {isSending ? "Running..." : "Send"}
            </button>
            {isSending ? (
              <button
                className="h-[56px] rounded-2xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </form>
          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        </section>

        <aside className="min-h-[86vh] rounded-[28px] border border-[#e2ddd3] bg-[#f2eee7] p-4 md:p-5">
          <div className="flex items-center justify-between border-b border-[#ddd5c8] pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#7b6a55]">AI Process</p>
              <h2 className="mt-1 text-lg font-semibold">Pipeline Log</h2>
              <p className="mt-1 text-xs text-slate-500">
                Live backend events from parsing, search, and bundle generation.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isSending
                  ? "bg-[#d7e7f5] text-[#315d82]"
                  : "bg-[#dcecdc] text-[#355f35]"
              }`}
            >
              {isSending ? "Running" : "Idle"}
            </span>
          </div>

          <div className="mt-4 flex min-h-[70vh] flex-col rounded-2xl border border-[#dfd8cb] bg-[#fbfaf7] p-3">
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {timelinePreview.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#d9d2c5] px-3 py-3 text-xs text-slate-500">
                  Backend pipeline events will appear here after you send a request.
                </p>
              ) : (
                timelinePreview.map((event) => {
                  const friendly = buildFriendlyEvent(event);
                  return (
                    <article className="rounded-xl border border-[#e5dfd3] bg-white px-3 py-3" key={event.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-[#3f5970]">{friendly.title}</p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{friendly.detail}</p>
                    </article>
                  );
                })
              )}
            </div>
          </div>

        </aside>
      </div>
      <section className="mx-auto mt-4 w-full max-w-[1500px] rounded-[28px] border border-[#dfd8cb] bg-[#f8f5ef] p-4 md:p-5">
        <div className="flex items-center justify-between gap-4 border-b border-[#ddd5c8] pb-3">
          <h3 className="text-base font-semibold text-[#6d5d49]">Search results</h3>
          {orderResult ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Order placed: {orderResult.order_id}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-3">
            {displayedPlans.length === 0 ? (
              <p className="text-sm text-slate-500">No result bundle yet.</p>
            ) : (
              <div className="space-y-4">
                {displayedPlans.map((plan) => (
                  <section className="space-y-2" key={plan.id}>
                    <article className="rounded-xl border border-[#e5dfd3] bg-white p-3">
                      <p className="text-sm font-medium text-slate-800">{plan.title}</p>
                      <p className="mt-1 text-xs text-slate-600">{plan.summary}</p>
                      {plan.explanation ? (
                        <p className="mt-2 rounded-lg border border-[#e5dfd3] bg-[#fcfbf8] p-2 text-xs text-slate-700">
                          {plan.explanation}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-[#3f5970]">
                        Total: ${plan.totalPrice.toLocaleString()} | Confidence:{" "}
                        {Math.round(plan.confidence * 100)}%
                      </p>
                      <button
                        className="mt-3 rounded-xl bg-[#2f6fa3] px-3 py-2 text-xs font-semibold text-white hover:bg-[#285f8d]"
                        onClick={() => {
                          setActivePlanId(plan.id);
                          setShowOrderConfirm(true);
                        }}
                        type="button"
                      >
                        Place order
                      </button>
                    </article>
                    <div className="grid gap-2 md:grid-cols-3">
                      {plan.items.map((item) => (
                        <article className="rounded-xl border border-[#e5dfd3] bg-white p-2" key={`${plan.id}-${item.sku}`}>
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={item.title}
                              className="h-28 w-full rounded-lg border border-slate-200 object-cover"
                              src={item.imageUrl}
                            />
                          ) : null}
                          <p className="mt-2 text-xs font-semibold text-slate-800">{item.title}</p>
                          {negotiatedDeals[item.sku] ? (
                            <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                              Bargained to ${item.price.toLocaleString()}
                            </p>
                          ) : null}
                          <div className="mt-1 flex items-center justify-between">
                            <div>
                              <p className="text-xs font-semibold text-slate-900">
                                ${item.price.toLocaleString()}
                              </p>
                              {negotiatedDeals[item.sku] ? (
                                <p className="text-[11px] text-slate-400 line-through">
                                  ${negotiatedDeals[item.sku].originalPrice.toLocaleString()}
                                </p>
                              ) : null}
                            </div>
                            {item.productUrl ? (
                              <a
                                className="text-[11px] font-medium text-[#2f6fa3] hover:underline"
                                href={item.productUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                View
                              </a>
                            ) : null}
                          </div>
                          <button
                            className="mt-2 w-full rounded-lg border border-[#cdbca7] bg-[#f6ecdd] px-3 py-2 text-[11px] font-semibold text-[#6b4f2b] hover:bg-[#f2e3cc]"
                            onClick={() => handleOpenItemNegotiation(plan, item)}
                            type="button"
                          >
                            {negotiatedDeals[item.sku] ? "Bargain again" : "Try bargain"}
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-[#e5dfd3] bg-white p-3">
            <h4 className="text-sm font-semibold text-[#6d5d49]">Action panel</h4>
            {activePlan ? (
              <div className="mt-2 rounded-xl border border-[#ece6dc] bg-[#faf7f2] p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[#8a745c]">Selected plan</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{activePlan.title}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Lead item for bargaining: {activePlan.items[0]?.title ?? "N/A"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-xl bg-[#2f6fa3] px-3 py-2 text-xs font-semibold text-white hover:bg-[#285f8d]"
                    onClick={() => setShowOrderConfirm(true)}
                    type="button"
                  >
                    Place order
                  </button>
                  <button
                    className="rounded-xl border border-[#cdbca7] bg-[#f6ecdd] px-3 py-2 text-xs font-semibold text-[#6b4f2b] hover:bg-[#f2e3cc] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={activePlan.items.length === 0}
                    onClick={handleOpenNegotiation}
                    type="button"
                  >
                    Try bargain
                  </button>
                </div>
              </div>
            ) : null}
            <h5 className="mt-4 text-sm font-semibold text-[#6d5d49]">Order status</h5>
            {orderResult ? (
              <div className="mt-2 space-y-1 text-xs text-slate-700">
                <p>Order ID: {orderResult.order_id}</p>
                <p>Tracking: {orderResult.tracking_number}</p>
                <p>Carrier: {orderResult.carrier}</p>
                <p>ETA: {orderResult.estimated_delivery_date}</p>
                <p>Total: ${orderResult.total_amount.toLocaleString()} {orderResult.currency}</p>
                <p>Status: {orderResult.order_status} / {orderResult.payment_status}</p>
                <p>{orderResult.warehouse_note}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No order placed yet.</p>
            )}
          </div>
        </div>
      </section>
      {showOrderConfirm && activePlan ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5">
            <h3 className="text-lg font-semibold text-slate-900">Confirm order</h3>
            <p className="mt-1 text-sm text-slate-600">{activePlan.title}</p>
            <div className="mt-4 space-y-2">
              {activePlan.items.map((item) => (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2" key={item.sku}>
                  <p className="text-sm text-slate-800">{item.title}</p>
                  <p className="text-sm font-semibold text-slate-900">${item.price.toLocaleString()}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-900">
              Total: ${activePlan.totalPrice.toLocaleString()}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                onClick={() => setShowOrderConfirm(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[#2f6fa3] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#9cb6cd]"
                disabled={isPlacingOrder}
                onClick={handleConfirmOrder}
                type="button"
              >
                {isPlacingOrder ? "Paying..." : "Confirm payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showOnboarding ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5">
            <h3 className="text-xl font-semibold text-slate-900">Welcome Setup</h3>
            <p className="mt-1 text-sm text-slate-600">
              Please answer these questions once. We will use them as your long-term preference memory.
            </p>
            <div className="mt-4 space-y-4">
              {onboardingQuestions.map((q, index) => (
                <section className="rounded-xl border border-slate-200 p-3" key={q.key}>
                  <p className="text-sm font-semibold text-slate-900">
                    {index + 1}. {q.question}
                  </p>
                  <div className="mt-2 space-y-2">
                    {q.type === "choice" ? (
                      q.multi_select ? (
                        q.options.map((opt) => (
                          <label className="flex items-center gap-2 text-sm text-slate-700" key={opt}>
                            <input
                              checked={
                                Array.isArray(onboardingAnswers[q.key])
                                  ? onboardingAnswers[q.key].includes(opt)
                                  : false
                              }
                              onChange={(e) => setOnboardingMultiValue(q.key, opt, e.target.checked)}
                              type="checkbox"
                            />
                            <span>{opt}</span>
                          </label>
                        ))
                      ) : (
                        q.options.map((opt) => (
                          <label className="flex items-center gap-2 text-sm text-slate-700" key={opt}>
                            <input
                              checked={onboardingAnswers[q.key] === opt}
                              name={q.key}
                              onChange={() => setOnboardingAnswers((c) => ({ ...c, [q.key]: opt }))}
                              type="radio"
                            />
                            <span>{opt}</span>
                          </label>
                        ))
                      )
                    ) : (
                      <textarea
                        className="min-h-[88px] w-full rounded-lg border border-slate-300 p-2 text-sm outline-none focus:border-[#2f6fa3]"
                        onChange={(e) => setOnboardingAnswers((c) => ({ ...c, [q.key]: e.target.value }))}
                        placeholder="One point per line..."
                        value={typeof onboardingAnswers[q.key] === "string" ? onboardingAnswers[q.key] : ""}
                      />
                    )}
                  </div>
                </section>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="rounded-xl bg-[#2f6fa3] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9cb6cd]"
                disabled={isSavingOnboarding}
                onClick={handleSubmitOnboarding}
                type="button"
              >
                {isSavingOnboarding ? "Saving..." : "Save and continue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
