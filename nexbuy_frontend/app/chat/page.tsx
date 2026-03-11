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
import { streamBuyerAgentNegotiation, type BuyerAgentRunResult, type BuyerAgentStreamEvent } from "@/lib/negotiation-api";
import {
  readNegotiatedDeals,
  readNegotiationRuns,
  writeNegotiatedDeal,
  writeNegotiationRun,
  type NegotiatedDeal,
} from "@/lib/negotiation-store";

type FriendlyEvent = {
  title: string;
  detail: string;
};

type InlineNegotiationState = {
  sku: string;
  targetPrice: string;
  maxAcceptablePrice: string;
  isRunning: boolean;
  progressPercent: number;
  progressLabel: string;
  error: string;
  result: BuyerAgentRunResult | null;
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
  const [inlineNegotiations, setInlineNegotiations] = useState<Record<string, InlineNegotiationState>>({});
  const [expandedNegotiationSku, setExpandedNegotiationSku] = useState<string | null>(null);
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
          setStreamText("");
          streamTextRef.current = "";
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
    ensureInlineNegotiationState(activePlan, primaryItem);
  }

  function handleOpenItemNegotiation(plan: PlanOption, item: PlanOption["items"][number]) {
    ensureInlineNegotiationState(plan, item);
  }

  function handleViewNegotiation(plan: PlanOption, item: PlanOption["items"][number]) {
    router.push(`/negotiation?${buildNegotiationQuery(plan, item).toString()}`);
  }

  async function handleRunInlineNegotiation(plan: PlanOption, item: PlanOption["items"][number]) {
    const current = inlineNegotiations[item.sku];
    const parsedTarget = Number(current?.targetPrice);
    const parsedMax = Number(current?.maxAcceptablePrice);

    if (
      !Number.isFinite(parsedTarget) ||
      !Number.isFinite(parsedMax) ||
      parsedTarget <= 0 ||
      parsedMax <= 0 ||
      parsedMax < parsedTarget ||
      current?.isRunning
    ) {
      upsertInlineNegotiation(item.sku, (previous) => ({
        sku: item.sku,
        targetPrice: previous?.targetPrice ?? "",
        maxAcceptablePrice: previous?.maxAcceptablePrice ?? "",
        isRunning: false,
        progressPercent: previous?.progressPercent ?? 0,
        progressLabel: previous?.progressLabel ?? "Set your target and max acceptable prices.",
        error: "Enter valid target and max acceptable prices first.",
        result: previous?.result ?? null,
      }));
      return;
    }

    upsertInlineNegotiation(item.sku, (previous) => ({
      sku: item.sku,
      targetPrice: previous?.targetPrice ?? String(parsedTarget),
      maxAcceptablePrice: previous?.maxAcceptablePrice ?? String(parsedMax),
      isRunning: true,
      progressPercent: 4,
      progressLabel: "Connecting buyer agent to the seller session...",
      error: "",
      result: null,
    }));

    writeNegotiationRun({
      sku: item.sku,
      title: item.title,
      originalPrice: negotiatedDeals[item.sku]?.originalPrice ?? item.price,
      planId: plan.id,
      planTitle: plan.title,
      targetPrice: parsedTarget,
      maxAcceptablePrice: parsedMax,
      status: "running",
      progressLabel: "Connecting buyer agent to the seller session...",
      progressPercent: 4,
      turns: [],
      sellerSession: null,
      result: null,
      savedAt: new Date().toISOString(),
    });

    try {
      await streamBuyerAgentNegotiation(
        {
          skuIdDefault: item.sku,
          targetPrice: parsedTarget,
          maxAcceptablePrice: parsedMax,
        },
        (event) => {
          const progress = buildProgressFromEvent(event);
          const storedRun = readNegotiationRuns()[item.sku];
          if (progress) {
            upsertInlineNegotiation(item.sku, (previous) => ({
              sku: item.sku,
              targetPrice: previous?.targetPrice ?? String(parsedTarget),
              maxAcceptablePrice: previous?.maxAcceptablePrice ?? String(parsedMax),
              isRunning: event.type !== "done" && event.type !== "error",
              progressPercent: progress.percent,
              progressLabel: progress.label,
              error: event.type === "error" ? event.error : "",
              result: event.type === "done" ? event.result : previous?.result ?? null,
            }));
          }

          if (event.type === "session_started") {
            writeNegotiationRun({
              sku: item.sku,
              title: item.title,
              originalPrice: negotiatedDeals[item.sku]?.originalPrice ?? item.price,
              planId: plan.id,
              planTitle: plan.title,
              targetPrice: parsedTarget,
              maxAcceptablePrice: parsedMax,
              status: "running",
              progressLabel: progress?.label ?? "Seller session opened.",
              progressPercent: progress?.percent ?? 8,
              turns: storedRun?.turns ?? [],
              sellerSession: event.seller_session,
              result: null,
              savedAt: new Date().toISOString(),
            });
          }

          if (event.type === "buyer_turn") {
            writeNegotiationRun({
              sku: item.sku,
              title: item.title,
              originalPrice: negotiatedDeals[item.sku]?.originalPrice ?? item.price,
              planId: plan.id,
              planTitle: plan.title,
              targetPrice: parsedTarget,
              maxAcceptablePrice: parsedMax,
              status: "running",
              progressLabel: progress?.label ?? `Round ${event.turn.round_index}: buyer offer sent.`,
              progressPercent: progress?.percent ?? 0,
              turns: [...(storedRun?.turns ?? []).filter((turn) => turn.round_index !== event.turn.round_index), event.turn].sort(
                (a, b) => a.round_index - b.round_index,
              ),
              sellerSession: storedRun?.sellerSession ?? null,
              result: null,
              savedAt: new Date().toISOString(),
            });
          }

          if (event.type === "seller_turn") {
            const existingTurns = storedRun?.turns ?? [];
            const nextTurns = existingTurns.map((turn) =>
              turn.round_index === event.turn.round_index ? { ...turn, seller_turn: event.turn } : turn,
            );
            writeNegotiationRun({
              sku: item.sku,
              title: item.title,
              originalPrice: negotiatedDeals[item.sku]?.originalPrice ?? item.price,
              planId: plan.id,
              planTitle: plan.title,
              targetPrice: parsedTarget,
              maxAcceptablePrice: parsedMax,
              status: "running",
              progressLabel: progress?.label ?? `Round ${event.turn.round_index}: seller response received.`,
              progressPercent: progress?.percent ?? 0,
              turns: nextTurns,
              sellerSession: storedRun?.sellerSession ?? null,
              result: null,
              savedAt: new Date().toISOString(),
            });
          }

          if (event.type === "done") {
            writeNegotiationRun({
              sku: item.sku,
              title: item.title,
              originalPrice: negotiatedDeals[item.sku]?.originalPrice ?? item.price,
              planId: plan.id,
              planTitle: plan.title,
              targetPrice: parsedTarget,
              maxAcceptablePrice: parsedMax,
              status: "done",
              progressLabel: event.result.summary,
              progressPercent: 100,
              turns: event.result.turns,
              sellerSession: event.result.seller_session,
              result: event.result,
              savedAt: new Date().toISOString(),
            });

            if (event.result.outcome === "accepted" && typeof event.result.final_price === "number") {
              const deal = {
                sku: item.sku,
                title: item.title,
                originalPrice: negotiatedDeals[item.sku]?.originalPrice ?? item.price,
                negotiatedPrice: event.result.final_price,
                planId: plan.id,
                planTitle: plan.title,
                acceptedAt: new Date().toISOString(),
              };
              writeNegotiatedDeal(deal);
              setNegotiatedDeals((previous) => ({ ...previous, [item.sku]: deal }));
            }
          }
        },
      );
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Could not run buyer agent negotiation.";
      const previousRun = readNegotiationRuns()[item.sku];
      writeNegotiationRun({
        sku: item.sku,
        title: item.title,
        originalPrice: negotiatedDeals[item.sku]?.originalPrice ?? item.price,
        planId: plan.id,
        planTitle: plan.title,
        targetPrice: parsedTarget,
        maxAcceptablePrice: parsedMax,
        status: "running",
        progressLabel: "Negotiation failed.",
        progressPercent: previousRun?.progressPercent ?? 0,
        turns: previousRun?.turns ?? [],
        sellerSession: previousRun?.sellerSession ?? null,
        result: previousRun?.result ?? null,
        savedAt: new Date().toISOString(),
      });
      upsertInlineNegotiation(item.sku, (previous) => ({
        sku: item.sku,
        targetPrice: previous?.targetPrice ?? String(parsedTarget),
        maxAcceptablePrice: previous?.maxAcceptablePrice ?? String(parsedMax),
        isRunning: false,
        progressPercent: previous?.progressPercent ?? 0,
        progressLabel: "Negotiation failed.",
        error: message,
        result: previous?.result ?? null,
      }));
    }
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
  const activePlanSavings = activePlan
    ? activePlan.items.reduce((sum, item) => {
        const deal = negotiatedDeals[item.sku];
        return sum + (deal ? Math.max(0, deal.originalPrice - deal.negotiatedPrice) : 0);
      }, 0)
    : 0;
  const activePlanNegotiatedCount = activePlan
    ? activePlan.items.filter((item) => Boolean(negotiatedDeals[item.sku])).length
    : 0;

  function buildNegotiationQuery(plan: PlanOption, item: PlanOption["items"][number]) {
    return new URLSearchParams({
      sku: item.sku,
      title: item.title,
      price: String(item.price),
      planId: plan.id,
      planTitle: plan.title,
    });
  }

  function upsertInlineNegotiation(
    sku: string,
    updater: (current: InlineNegotiationState | undefined) => InlineNegotiationState,
  ) {
    setInlineNegotiations((current) => ({
      ...current,
      [sku]: updater(current[sku]),
    }));
  }

  function getDefaultTargetPrice(price: number) {
    return String(Math.round(price * 0.9));
  }

  function getDefaultMaxAcceptablePrice(price: number) {
    return String(Math.round(price * 0.95));
  }

  function ensureInlineNegotiationState(plan: PlanOption, item: PlanOption["items"][number]) {
    const storedRun = readNegotiationRuns()[item.sku];
    setExpandedNegotiationSku(item.sku);
    upsertInlineNegotiation(item.sku, (current) => ({
      sku: item.sku,
      targetPrice: current?.targetPrice ?? (storedRun ? String(storedRun.targetPrice) : getDefaultTargetPrice(item.price)),
      maxAcceptablePrice:
        current?.maxAcceptablePrice ?? (storedRun ? String(storedRun.maxAcceptablePrice) : getDefaultMaxAcceptablePrice(item.price)),
      isRunning: current?.isRunning ?? false,
      progressPercent: current?.progressPercent ?? storedRun?.progressPercent ?? 0,
      progressLabel: current?.progressLabel ?? storedRun?.progressLabel ?? "Set your target and max acceptable prices.",
      error: current?.error ?? "",
      result: current?.result ?? storedRun?.result ?? null,
    }));
  }

  function setInlineField(sku: string, field: "targetPrice" | "maxAcceptablePrice", value: string) {
    upsertInlineNegotiation(sku, (current) => ({
      sku,
      targetPrice: field === "targetPrice" ? value : current?.targetPrice ?? "",
      maxAcceptablePrice: field === "maxAcceptablePrice" ? value : current?.maxAcceptablePrice ?? "",
      isRunning: current?.isRunning ?? false,
      progressPercent: current?.progressPercent ?? 0,
      progressLabel: current?.progressLabel ?? "Set your target and max acceptable prices.",
      error: current?.error ?? "",
      result: current?.result ?? null,
    }));
  }

  function buildProgressFromEvent(event: BuyerAgentStreamEvent): { percent: number; label: string } | null {
    if (event.type === "session_started") {
      return { percent: 8, label: "Seller session opened. Buyer agent is preparing the first move." };
    }

    if (event.type === "thinking") {
      const base = ((event.round_index - 1) * 2) / 10;
      const percent = Math.min(94, Math.round((base + (event.phase === "buyer_decision" ? 0.35 : 0.7)) * 100));
      return { percent, label: event.message };
    }

    if (event.type === "buyer_turn") {
      return {
        percent: Math.min(94, Math.round((((event.turn.round_index - 1) * 2 + 1) / 10) * 100)),
        label: `Round ${event.turn.round_index}: buyer offer sent.`,
      };
    }

    if (event.type === "seller_turn") {
      return {
        percent: Math.min(96, Math.round((((event.turn.round_index - 1) * 2 + 2) / 10) * 100)),
        label: `Round ${event.turn.round_index}: seller response received.`,
      };
    }

    if (event.type === "done") {
      return { percent: 100, label: event.result.summary };
    }

    if (event.type === "error") {
      return { percent: 100, label: "Negotiation failed." };
    }

    return null;
  }

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
      <section className="mx-auto mt-4 w-full max-w-[1500px] rounded-[28px] border border-slate-200 bg-slate-50 p-4 md:p-5">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-500">AI Proposal Linkage Console</p>
            <h3 className="mt-1 text-base font-semibold text-slate-800">Decision layer + execution layer</h3>
          </div>
          {orderResult ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
              Order placed: {orderResult.order_id}
            </span>
          ) : null}
        </div>
        <div className="mt-5 space-y-5">
          {displayedPlans.length === 0 ? (
            <p className="text-sm text-slate-500">No result bundle yet.</p>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-3">
                {displayedPlans.map((plan) => {
                  const isActive = activePlan?.id === plan.id;
                  const planSavings = plan.items.reduce((sum, item) => {
                    const deal = negotiatedDeals[item.sku];
                    return sum + (deal ? Math.max(0, deal.originalPrice - deal.negotiatedPrice) : 0);
                  }, 0);
                  const hiddenItemCount = Math.max(0, plan.items.length - 3);
                  return (
                    <button
                      className={`flex min-h-[348px] flex-col justify-between rounded-[26px] border p-4 text-left transition ${
                        isActive
                          ? "border-indigo-200 bg-white shadow-[0_18px_50px_rgba(79,70,229,0.12)]"
                          : "border-slate-200 bg-white hover:border-indigo-100 hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
                      }`}
                      key={plan.id}
                      onFocus={() => setActivePlanId(plan.id)}
                      onMouseEnter={() => setActivePlanId(plan.id)}
                      onClick={() => setActivePlanId(plan.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-500">
                            {isActive ? "Active bundle" : "Bundle option"}
                          </p>
                          <h4 className="mt-2 flex items-center gap-2 text-xl font-black text-slate-900">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-sm text-amber-500">
                              ✦
                            </span>
                            <span>{plan.title}</span>
                          </h4>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                            {Math.round(plan.confidence * 100)}% · {plan.confidence >= 0.9 ? "Perfect Match" : plan.confidence >= 0.85 ? "Value Pick" : "Smart Option"}
                          </span>
                          <span className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-indigo-100 text-[11px] font-bold text-indigo-600">
                            {Math.round(plan.confidence * 100)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{plan.summary}</p>
                      {plan.explanation ? (
                        <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-6 text-slate-600">
                          {plan.explanation}
                        </p>
                      ) : null}
                      <div className="mt-4 flex items-center">
                        {plan.items.slice(0, 3).map((item, index) => (
                          <div
                            className={`relative h-16 w-16 overflow-hidden rounded-2xl border-2 border-white bg-slate-100 shadow-sm ${index > 0 ? "-ml-3" : ""}`}
                            key={`${plan.id}-${item.sku}-thumb`}
                          >
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                alt={item.title}
                                className="h-full w-full object-cover"
                                src={item.imageUrl}
                              />
                            ) : (
                              <div className="h-full w-full bg-[linear-gradient(135deg,#cbd5e1,#f8fafc)]" />
                            )}
                          </div>
                        ))}
                        {hiddenItemCount > 0 ? (
                          <div className="-ml-3 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-white bg-slate-900 text-xs font-bold text-white shadow-sm">
                            +{hiddenItemCount}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-4 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs text-slate-500">Bundle total</p>
                          <p className="text-3xl font-black text-slate-950">${plan.totalPrice.toLocaleString()}</p>
                          {planSavings > 0 ? (
                            <p className="mt-1 text-xs font-semibold text-emerald-500">
                              Estimated savings: -${planSavings.toLocaleString()}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`rounded-2xl px-3 py-2 text-xs font-semibold ${
                            isActive
                              ? "bg-indigo-600 text-white"
                              : "border border-slate-200 text-slate-600"
                          }`}
                        >
                          {isActive ? "Selected" : "Inspect"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] md:p-5">
                  {activePlan ? (
                    <>
                      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-500">Execution Layer</p>
                          <h4 className="mt-2 text-3xl font-black text-slate-950">{activePlan.title}</h4>
                          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">{activePlan.summary}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                            onClick={() => setShowOrderConfirm(true)}
                            type="button"
                          >
                            Place order
                          </button>
                          <button
                            className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(79,70,229,0.28)] hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={activePlan.items.length === 0}
                            onClick={handleOpenNegotiation}
                            type="button"
                          >
                            ✨ AI Bargain
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {activePlan.items.map((item) => {
                          const inlineNegotiation = inlineNegotiations[item.sku];
                          const isNegotiationOpen = expandedNegotiationSku === item.sku;
                          return (
                          <article className="flex flex-col rounded-2xl bg-white p-3 shadow-sm transition hover:shadow-md" key={`${activePlan.id}-${item.sku}`}>
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                alt={item.title}
                                className="aspect-[4/3] w-full rounded-2xl object-cover"
                                src={item.imageUrl}
                              />
                            ) : (
                              <div className="aspect-[4/3] w-full rounded-2xl bg-[linear-gradient(135deg,#cbd5e1,#f8fafc)]" />
                            )}
                            <div className="mt-3 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-slate-900">{item.title}</p>
                                <p className="mt-2 text-xs leading-5 text-slate-500">{item.reason}</p>
                              </div>
                              {negotiatedDeals[item.sku] ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-500">
                                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
                                  Negotiated
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-auto pt-4">
                              <div className="rounded-2xl bg-slate-50 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                    Current price
                                  </p>
                                  <div className="mt-1 flex items-end gap-2">
                                    <p
                                      className={`text-3xl font-black leading-none ${
                                        negotiatedDeals[item.sku] ? "text-emerald-500" : "text-slate-950"
                                      }`}
                                    >
                                      ${item.price.toLocaleString()}
                                    </p>
                                    {negotiatedDeals[item.sku] ? (
                                      <p className="pb-1 text-xs font-medium text-slate-400 line-through">
                                        ${negotiatedDeals[item.sku].originalPrice.toLocaleString()}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                                {item.productUrl ? (
                                  <a
                                    className="mt-1 text-[11px] font-semibold text-indigo-600 hover:underline"
                                    href={item.productUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    View details
                                  </a>
                                ) : null}
                              </div>
                              <button
                                className={`mt-3 w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white ${
                                  negotiatedDeals[item.sku]
                                    ? "bg-emerald-500 hover:bg-emerald-400"
                                    : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500"
                                }`}
                                onClick={() => handleOpenItemNegotiation(activePlan, item)}
                                type="button"
                              >
                                {inlineNegotiation?.result || negotiatedDeals[item.sku]
                                  ? "💰 Manage Negotiation"
                                  : "✨ Let AI Negotiate"}
                              </button>
                              </div>
                            </div>
                            {isNegotiationOpen ? (
                              <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3">
                                <div className="space-y-3">
                                  <label className="space-y-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                      Target price
                                    </span>
                                    <input
                                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300"
                                      inputMode="decimal"
                                      onChange={(event) => setInlineField(item.sku, "targetPrice", event.target.value)}
                                      placeholder="e.g. 820"
                                      value={inlineNegotiation?.targetPrice ?? ""}
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                      Max acceptable
                                    </span>
                                    <input
                                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300"
                                      inputMode="decimal"
                                      onChange={(event) => setInlineField(item.sku, "maxAcceptablePrice", event.target.value)}
                                      placeholder="e.g. 880"
                                      value={inlineNegotiation?.maxAcceptablePrice ?? ""}
                                    />
                                  </label>
                                </div>
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                        Negotiation progress
                                      </p>
                                      <p className="mt-1 text-sm font-medium text-slate-700">
                                        {inlineNegotiation?.progressLabel ?? "Not started yet."}
                                      </p>
                                    </div>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                      {Math.round(inlineNegotiation?.progressPercent ?? 0)}%
                                    </span>
                                  </div>
                                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        inlineNegotiation?.isRunning
                                          ? "bg-gradient-to-r from-indigo-600 to-violet-600"
                                          : inlineNegotiation?.result
                                            ? "bg-emerald-500"
                                            : "bg-slate-300"
                                      }`}
                                      style={{ width: `${inlineNegotiation?.progressPercent ?? 0}%` }}
                                    />
                                  </div>
                                  {inlineNegotiation?.error ? (
                                    <p className="mt-2 text-xs text-rose-600">{inlineNegotiation.error}</p>
                                  ) : null}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(79,70,229,0.2)] hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={inlineNegotiation?.isRunning}
                                    onClick={() => handleRunInlineNegotiation(activePlan, item)}
                                    type="button"
                                  >
                                    {inlineNegotiation?.isRunning ? "Negotiating..." : "Auto bargain"}
                                  </button>
                                  <button
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!inlineNegotiation?.isRunning && !inlineNegotiation?.result}
                                    onClick={() => handleViewNegotiation(activePlan, item)}
                                    type="button"
                                  >
                                    View conversation
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </article>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>

                <aside className="xl:sticky xl:top-4 xl:self-start rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] p-4 text-white shadow-[0_18px_50px_rgba(15,23,42,0.18)] md:p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-400">Global Action Rail</p>
                  <h4 className="mt-2 text-3xl font-black">Decision Snapshot</h4>
                  {activePlan ? (
                    <>
                      <div className="mt-5 rounded-[24px] border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Progress</p>
                        <div className="mt-3 overflow-hidden rounded-full bg-white/10">
                          <div className="flex h-2 w-full">
                            <div className="h-full w-1/3 bg-indigo-500" />
                            <div className={`h-full w-1/3 ${activePlanNegotiatedCount > 0 ? "bg-emerald-500" : "bg-white/10"}`} />
                            <div className={`h-full w-1/3 ${orderResult ? "bg-amber-400" : "bg-white/10"}`} />
                          </div>
                        </div>
                        <div className="mt-3 flex justify-between text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          <span>Search</span>
                          <span>Negotiate</span>
                          <span>Ready</span>
                        </div>
                      </div>
                      <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Current total</p>
                        <p className="mt-2 text-4xl font-black">${activePlan.totalPrice.toLocaleString()}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          Compare at the bundle level first, then negotiate item-level pricing without losing the global picture.
                        </p>
                        {activePlanSavings > 0 ? (
                          <p className="mt-3 text-sm font-semibold text-emerald-400">
                            Saved so far: ${activePlanSavings.toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="rounded-[20px] bg-white/5 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-300">AI recommendation signal</p>
                          <p className="mt-2 text-sm font-semibold">{Math.round(activePlan.confidence * 100)}% fit score</p>
                          <p className="mt-1 text-xs leading-5 text-slate-300">
                            Confidence and explanation expose the backend ranking logic instead of hiding it.
                          </p>
                        </div>
                        <div className="rounded-[20px] bg-white/5 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-300">AI certainty rating</p>
                          <p className="mt-2 text-sm font-semibold">
                            {activePlan.confidence >= 0.9 ? "High confidence" : activePlan.confidence >= 0.82 ? "Stable recommendation" : "Review carefully"}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-300">
                            This score combines target coverage, pricing balance, and current negotiation leverage.
                          </p>
                        </div>
                        <div className="rounded-[20px] bg-white/5 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Recommended next action</p>
                          <p className="mt-2 text-sm font-semibold">
                            {activePlan.items.some((item) => negotiatedDeals[item.sku])
                              ? "Review negotiated items, then decide whether to place the order."
                              : "Launch AI auto bargain on the lead item or go straight to checkout."}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : null}
                  <div className="mt-5 flex flex-col gap-2">
                    <button
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!activePlan}
                      onClick={() => setShowOrderConfirm(true)}
                      type="button"
                    >
                      Proceed to checkout
                    </button>
                    <button
                      className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(79,70,229,0.28)] hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!activePlan || activePlan.items.length === 0}
                      onClick={handleOpenNegotiation}
                      type="button"
                    >
                      ✨ AI Bargain
                    </button>
                  </div>
                  <div className="mt-5 rounded-[20px] border border-white/10 bg-white/5 p-4 text-xs leading-6 text-slate-300">
                    {orderResult ? (
                      <>
                        <p className="font-semibold text-white">Order status</p>
                        <p className="mt-2">Order ID: {orderResult.order_id}</p>
                        <p>Tracking: {orderResult.tracking_number}</p>
                        <p>Carrier: {orderResult.carrier}</p>
                        <p>Total: ${orderResult.total_amount.toLocaleString()} {orderResult.currency}</p>
                      </>
                    ) : (
                      <p>No order placed yet. Use the action rail to negotiate or move directly to checkout.</p>
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}
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
