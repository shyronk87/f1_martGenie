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
import AuthModal from "@/src/components/AuthModal";
import Navbar from "@/src/components/Navbar";

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

type SavedWorkspaceState = {
  sessionId: string | null;
  messages: ChatMessage[];
  timeline: TimelineEvent[];
  plans: PlanOption[];
  activePlanId: string | null;
  status: string;
  orderResult: MockOrderResponse | null;
  inlineNegotiations: Record<string, InlineNegotiationState>;
  expandedNegotiationSku: string | null;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";

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
  const [isWorkspaceHydrated, setIsWorkspaceHydrated] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [showOrderConfirm, setShowOrderConfirm] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderResult, setOrderResult] = useState<MockOrderResponse | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingQuestions, setOnboardingQuestions] = useState<OnboardingQuestion[]>([]);
  const [onboardingAnswers, setOnboardingAnswers] = useState<Record<string, string | string[]>>({});
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
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
  const plansRef = useRef<PlanOption[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const runStartRef = useRef<number | null>(null);
  const restoredWorkspaceRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
      const restoredWorkspace = raw ? (JSON.parse(raw) as SavedWorkspaceState) : null;

      if (restoredWorkspace) {
        setSessionId(restoredWorkspace.sessionId);
        setMessages(restoredWorkspace.messages);
        setTimeline(restoredWorkspace.timeline);
        setPlans(restoredWorkspace.plans);
        setActivePlanId(restoredWorkspace.activePlanId);
        setStatus(restoredWorkspace.status);
        setOrderResult(restoredWorkspace.orderResult);
        setInlineNegotiations(restoredWorkspace.inlineNegotiations);
        setExpandedNegotiationSku(restoredWorkspace.expandedNegotiationSku);
        plansRef.current = restoredWorkspace.plans;
        restoredWorkspaceRef.current = true;
      }
    } catch {
      window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } finally {
      setIsWorkspaceHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isWorkspaceHydrated || typeof window === "undefined") {
      return;
    }

    const payload: SavedWorkspaceState = {
      sessionId,
      messages,
      timeline,
      plans,
      activePlanId,
      status,
      orderResult,
      inlineNegotiations,
      expandedNegotiationSku,
    };

    window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  }, [activePlanId, expandedNegotiationSku, inlineNegotiations, isWorkspaceHydrated, messages, orderResult, plans, sessionId, status, timeline]);

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
    if (!isWorkspaceHydrated) {
      return;
    }

    let unmounted = false;

    async function bootstrap() {
      const token = readAccessToken();
      if (!token) {
        setStatus("Sign in to start your shopping workspace.");
        setError("You need to sign in before using chat.");
        return;
      }

      try {
        setError("");
        await fetchCurrentUser(token);
        setIsAuthenticated(true);
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
          if (restoredWorkspaceRef.current) {
            if (unmounted) {
              return;
            }
            setStatus((current) => current || "Workspace restored.");
            return;
          }
          const createdSessionId = await createChatSession();
          if (unmounted) {
            return;
          }
          setSessionId(createdSessionId);
          setStatus("Workspace ready. Tell me your room, style, and budget.");
        }
      } catch (bootstrapError) {
        clearAccessToken();
        setIsAuthenticated(false);
        const message =
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Could not initialize workspace.";
        setError(message);
        setStatus("We could not open your workspace. Please sign in again.");
      }
    }

    void bootstrap();

    return () => {
      unmounted = true;
      unsubscribeRef.current?.();
    };
  }, [bootstrapNonce, isWorkspaceHydrated]);

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
          plansRef.current = eventPayload.plans;
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
          if (plansRef.current.length > 0) {
            window.setTimeout(() => {
              router.push("/recommendations");
            }, 180);
          }
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
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f9fc_0%,#eef2f7_100%)] px-4 pb-5 pt-24 text-[#101828] md:px-6">
      <Navbar
        isBlurred={authOpen}
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          clearAccessToken();
          setIsAuthenticated(false);
          router.push("/");
        }}
      />
      <div className="mx-auto grid w-full max-w-[1500px] gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="flex min-h-[86vh] flex-col rounded-[28px] border border-[#dbe3ed] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_18px_50px_rgba(148,163,184,0.12)] md:p-6">
          <div className="flex items-center justify-between border-b border-[#dce4ee] pb-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#101828] md:text-2xl">AI Shopping Assistant</h1>
              <p className="mt-1 text-sm text-[#667085]">{status}</p>
            </div>
            <Link
              className="rounded-full border border-[#d2dae5] bg-white px-4 py-2 text-sm font-medium text-[#344054] transition hover:border-[#bcc7d6] hover:bg-[#f8fafc]"
              href="/"
            >
              Back
            </Link>
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {renderedMessages.length === 0 ? (
              <article className="max-w-[80%] rounded-2xl border border-[#d6e4f5] bg-[linear-gradient(180deg,#eff6ff_0%,#e0ecff_100%)] px-4 py-3 text-sm text-[#1f4f78] shadow-[0_10px_24px_rgba(59,130,246,0.08)]">
                Try: &quot;My living room is 20m2, modern warm wood style, budget $3,000, need sofa + TV
                stand + rug.&quot;
              </article>
            ) : (
              renderedMessages.map((message) => (
                <article
                  className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-7 md:text-[15px] ${
                    message.role === "user"
                      ? "ml-auto border border-[#d6e4f5] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] text-[#123b5f] shadow-[0_10px_24px_rgba(59,130,246,0.08)]"
                      : "mr-auto border border-[#e2e8f0] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] text-[#344054] shadow-[0_10px_24px_rgba(148,163,184,0.08)]"
                  }`}
                  key={message.id}
                >
                  <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[#98a2b3]">
                    {message.role === "user" ? "You" : "AI"}
                  </p>
                  <p>
                    {message.content}
                    {message.id === "assistant-draft" && isSending ? (
                      <span className="ml-2 text-xs text-[#98a2b3]">({runElapsedSec}s)</span>
                    ) : null}
                  </p>
                </article>
              ))
            )}
          </div>

          <form className="mt-4 flex items-end gap-2 border-t border-[#dce4ee] pt-4" onSubmit={handleSend}>
            <textarea
              className="min-h-[56px] w-full resize-none rounded-2xl border border-[#d7dee8] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-3 text-sm text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#93c5fd] focus:shadow-[0_0_0_4px_rgba(147,197,253,0.18)]"
              disabled={!sessionId || isSending}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe your space, style, budget, and must-have items..."
              rows={2}
              value={prompt}
            />
            <button
              className="h-[56px] rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-[#b7c8d8] disabled:text-slate-200"
              disabled={!sessionId || isSending || !prompt.trim()}
              type="submit"
            >
              {isSending ? "Running..." : "Send"}
            </button>
            {isSending ? (
              <button
                className="h-[56px] rounded-2xl border border-[#f3c7cf] bg-[#fff1f3] px-4 text-sm font-semibold text-[#be123c] transition hover:bg-[#ffe4e8]"
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </form>
          {error ? <p className="mt-2 text-sm text-[#be123c]">{error}</p> : null}
        </section>

        <aside className="h-[86vh] overflow-hidden rounded-[28px] border border-[#dbe3ed] bg-[linear-gradient(180deg,#f8fafd_0%,#eef2f7_100%)] p-4 shadow-[0_18px_50px_rgba(148,163,184,0.12)] md:p-5">
          <div className="flex items-center justify-between border-b border-[#dce4ee] pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#8b97a8]">AI Process</p>
              <h2 className="mt-1 text-lg font-semibold text-[#101828]">Pipeline Log</h2>
              <p className="mt-1 text-xs text-[#667085]">
                Live backend events from parsing, search, and bundle generation.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isSending
                  ? "bg-[#dbeafe] text-[#1d4ed8]"
                  : "bg-[#eaf2f8] text-[#475467]"
              }`}
            >
              {isSending ? "Running" : "Idle"}
            </span>
          </div>

          <div className="mt-4 flex h-[calc(86vh-112px)] min-h-0 flex-col rounded-2xl border border-[#dce4ee] bg-white/88 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {timeline.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#dbe3ed] px-3 py-3 text-xs text-[#667085]">
                  Backend pipeline events will appear here after you send a request.
                </p>
              ) : (
                timeline.map((event) => {
                  const friendly = buildFriendlyEvent(event);
                  return (
                    <article className="rounded-xl border border-[#e4eaf1] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-3 py-3 shadow-[0_8px_22px_rgba(148,163,184,0.08)]" key={event.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-[#1f3b57]">{friendly.title}</p>
                        <p className="text-[11px] text-[#98a2b3]">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-[#667085]">{friendly.detail}</p>
                    </article>
                  );
                })
              )}
            </div>
          </div>

        </aside>
      </div>
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
      <AuthModal
        onAuthSuccess={() => {
          setIsAuthenticated(true);
          setError("");
          setStatus("Preparing workspace...");
          setBootstrapNonce((current) => current + 1);
          setAuthOpen(false);
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </main>
  );
}
