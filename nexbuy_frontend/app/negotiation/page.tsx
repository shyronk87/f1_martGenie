"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearAccessToken,
  fetchCurrentUser,
  logoutSession,
  readAccessToken,
  readAuthUserId,
  saveAuthUserEmail,
  saveAuthUserId,
} from "@/lib/auth";
import {
  cancelBuyerAgentNegotiation,
  createNegotiationSession,
  fetchNegotiationSession,
  streamBuyerAgentNegotiation,
  submitNegotiationOffer,
  type BuyerAgentRunResult,
  type BuyerAgentStreamEvent,
  type BuyerAgentTurn,
  type NegotiationSession,
  type NegotiationTurn,
} from "@/lib/negotiation-api";
import {
  getLatestNegotiationRun,
  readNegotiationRuns,
  writeNegotiatedDeal,
  writeNegotiationRun,
} from "@/lib/negotiation-store";
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

type ChatBubble = {
  id: string;
  role: "buyer" | "seller";
  content: string;
  meta?: string;
  label?: string;
  pending?: boolean;
};

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return `$${value.toLocaleString()}`;
}

function extractOffer(message: string): number | null {
  const match = message.match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

function buildSellerBubble(turn: NegotiationTurn): ChatBubble {
  const priceLabel = formatMoney(turn.seller_counter_price);
  const metaParts = [
    `Round ${turn.round_index}`,
    `Decision: ${turn.seller_decision}`,
    priceLabel ? `Seller price: ${priceLabel}` : null,
  ].filter(Boolean);

  return {
    id: `seller-${turn.round_index}-${turn.created_at}`,
    role: "seller",
    content: turn.seller_message,
    meta: metaParts.join(" | "),
  };
}

function buildBuyerAgentBubble(turn: BuyerAgentTurn): ChatBubble {
  return {
    id: `agent-buyer-${turn.round_index}-${turn.created_at}`,
    role: "buyer",
    label: "Buyer Agent",
    content: turn.buyer_message,
    meta: [
      turn.buyer_offer ? `Offer: ${formatMoney(turn.buyer_offer)}` : null,
      `Strategy: ${turn.rationale}`,
      turn.llm_decision_verified === false ? `Fallback: ${turn.llm_verification_note ?? "used safe policy"}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  };
}

function buildAgentTranscript(result: BuyerAgentRunResult): ChatBubble[] {
  return result.turns.flatMap((turn) => {
    const bubbles: ChatBubble[] = [buildBuyerAgentBubble(turn)];
    if (turn.seller_turn) {
      bubbles.push({ ...buildSellerBubble(turn.seller_turn), label: "Seller Agent" });
    }
    return bubbles;
  });
}

function buildStoredRunTranscript(stored: ReturnType<typeof readNegotiationRuns>[string]): ChatBubble[] {
  return stored.result
    ? buildAgentTranscript(stored.result)
    : stored.turns.flatMap((turn) => {
        const bubbles: ChatBubble[] = [buildBuyerAgentBubble(turn)];
        if (turn.seller_turn) {
          bubbles.push({ ...buildSellerBubble(turn.seller_turn), label: "Seller Agent" });
        }
        return bubbles;
      });
}

export default function NegotiationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sku = searchParams.get("sku") ?? "";
  const title = searchParams.get("title") ?? "Selected item";
  const price = searchParams.get("price");
  const imageUrl = searchParams.get("imageUrl");
  const planId = searchParams.get("planId") ?? undefined;
  const planTitle = searchParams.get("planTitle") ?? "Recommended bundle";
  const sessionId = searchParams.get("sessionId") ?? undefined;
  const queryTargetPrice = searchParams.get("targetPrice");
  const queryMaxAcceptablePrice = searchParams.get("maxAcceptablePrice");

  const [session, setSession] = useState<NegotiationSession | null>(null);
  const [manualSession, setManualSession] = useState<NegotiationSession | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [manualMessages, setManualMessages] = useState<ChatBubble[]>([]);
  const [agentMessages, setAgentMessages] = useState<ChatBubble[]>([]);
  const [mode, setMode] = useState<"manual" | "agent">("agent");
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [maxAcceptablePrice, setMaxAcceptablePrice] = useState("");
  const [status, setStatus] = useState("Initializing seller negotiation...");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [agentResult, setAgentResult] = useState<BuyerAgentRunResult | null>(null);
  const [thinkingMessage, setThinkingMessage] = useState<string | null>(null);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [thinkingElapsedSeconds, setThinkingElapsedSeconds] = useState(0);
  const activeRunIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const agentTurnsRef = useRef<BuyerAgentTurn[]>([]);
  const sellerSessionRef = useRef<NegotiationSession | null>(null);
  const [fallbackRun, setFallbackRun] = useState<ReturnType<typeof getLatestNegotiationRun> | null>(null);

  const resolvedSku = sku || fallbackRun?.sku || "";
  const resolvedTitle = title !== "Selected item" ? title : fallbackRun?.title || "Selected item";
  const resolvedPrice =
    price ?? (typeof fallbackRun?.originalPrice === "number" ? String(fallbackRun.originalPrice) : null);
  const resolvedPlanId = planId ?? fallbackRun?.planId;
  const resolvedPlanTitle =
    planTitle !== "Recommended bundle" ? planTitle : fallbackRun?.planTitle || "Recommended bundle";
  const resolvedSessionId = sessionId ?? fallbackRun?.sessionId ?? undefined;
  const negotiationScope = useMemo(
    () => ({
      userId: readAuthUserId(),
      sessionId: resolvedSessionId ?? null,
      planId: resolvedPlanId ?? null,
    }),
    [resolvedPlanId, resolvedSessionId],
  );

  const priceLabel = useMemo(() => {
    const amount = resolvedPrice ? Number(resolvedPrice) : null;
    return amount && Number.isFinite(amount) ? `$${amount.toLocaleString()}` : "Unknown";
  }, [resolvedPrice]);

  const acceptedPrice =
    agentResult?.outcome === "accepted" && typeof agentResult.final_price === "number"
      ? agentResult.final_price
      : session?.closed && typeof session.accepted_price === "number"
        ? session.accepted_price
        : null;
  const acceptedSellerMessageId =
    acceptedPrice != null
      ? [...messages].reverse().find((message) => message.role === "seller" && !message.pending)?.id ?? null
      : null;

  function applyStoredRun(stored: ReturnType<typeof readNegotiationRuns>[string]) {
    setMode("agent");
    setAgentMessages(buildStoredRunTranscript(stored));
    setSession(stored.result?.seller_session ?? stored.sellerSession);
    sellerSessionRef.current = stored.result?.seller_session ?? stored.sellerSession;
    setStatus(stored.progressLabel);
    setThinkingMessage(stored.status === "running" ? stored.progressLabel : null);
    setError("");
    setAgentResult(stored.result ?? null);
    setIsRunningAgent(stored.status === "running");
    agentTurnsRef.current = stored.result?.turns ?? stored.turns;
  }

  const persistNegotiationRun = useCallback(
    (params: {
      status: "running" | "done";
      progressLabel: string;
      progressPercent: number;
      result?: BuyerAgentRunResult | null;
    }) => {
      writeNegotiationRun({
        userId: negotiationScope.userId || "anonymous",
        sessionId: negotiationScope.sessionId || "global",
        planId: negotiationScope.planId || "global",
        sku: resolvedSku,
        title: resolvedTitle,
        originalPrice: Number(resolvedPrice ?? 0),
        planTitle: resolvedPlanTitle,
        targetPrice: Number(targetPrice) || 0,
        maxAcceptablePrice: Number(maxAcceptablePrice) || 0,
        status: params.status,
        progressLabel: params.progressLabel,
        progressPercent: params.progressPercent,
        turns: agentTurnsRef.current,
        sellerSession: sellerSessionRef.current,
        result: params.result ?? null,
        savedAt: new Date().toISOString(),
      });
    },
    [
      maxAcceptablePrice,
      negotiationScope.planId,
      negotiationScope.sessionId,
      negotiationScope.userId,
      resolvedPlanTitle,
      resolvedPrice,
      resolvedSku,
      resolvedTitle,
      targetPrice,
    ],
  );

  useEffect(() => {
    if (sku) {
      return;
    }
    setFallbackRun(getLatestNegotiationRun({ userId: readAuthUserId() }));
  }, [sku]);

  useEffect(() => {
    if (!resolvedSku) {
      return;
    }

    const storedRuns = readNegotiationRuns(negotiationScope);
    const stored = storedRuns[resolvedSku];
    if (!stored) {
      if (queryTargetPrice) {
        setTargetPrice(queryTargetPrice);
      }
      if (queryMaxAcceptablePrice) {
        setMaxAcceptablePrice(queryMaxAcceptablePrice);
      }
      return;
    }

    setTargetPrice(String(stored.targetPrice));
    setMaxAcceptablePrice(String(stored.maxAcceptablePrice));
    applyStoredRun(stored);
  }, [negotiationScope, queryMaxAcceptablePrice, queryTargetPrice, resolvedSku]);

  useEffect(() => {
    if (!resolvedSku) {
      return;
    }

    const timer = window.setInterval(() => {
      const stored = readNegotiationRuns(negotiationScope)[resolvedSku];
      if (!stored) {
        return;
      }
      applyStoredRun(stored);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [negotiationScope, resolvedSku]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!resolvedSku) {
        setError("Missing sku for negotiation.");
        setStatus("Cannot open negotiation.");
        return;
      }

      const storedRun = readNegotiationRuns(negotiationScope)[resolvedSku];

      if (!storedRun) {
        if (queryTargetPrice) {
          setTargetPrice(queryTargetPrice);
        }
        if (queryMaxAcceptablePrice) {
          setMaxAcceptablePrice(queryMaxAcceptablePrice);
        }
        if (!queryTargetPrice && !queryMaxAcceptablePrice && resolvedPrice) {
          const numericPrice = Number(resolvedPrice);
          if (Number.isFinite(numericPrice) && numericPrice > 0) {
            setTargetPrice(String(Math.round(numericPrice * 0.9)));
            setMaxAcceptablePrice(String(Math.round(numericPrice * 0.95)));
          }
        }
      }

      const token = readAccessToken();
      if (!token) {
        setError("Missing access token.");
        setStatus("Please sign in again.");
        return;
      }

      try {
        const user = await fetchCurrentUser(token);
        saveAuthUserEmail(user.email);
        if (user.id) {
          saveAuthUserId(user.id);
        }
        setIsAuthenticated(true);
      } catch {
        clearAccessToken();
        setIsAuthenticated(false);
        setError("Session expired. Please sign in again.");
        setStatus("Negotiation unavailable.");
        return;
      }

      try {
        const created = await createNegotiationSession({
          skuIdDefault: resolvedSku,
        });

        if (cancelled) {
          return;
        }

        const sellerTurns = created.turns.map(buildSellerBubble);
        const initialMessages =
          sellerTurns.length > 0
            ? sellerTurns
            : [
                {
                  id: "seller-opening",
                  role: "seller" as const,
                  content: `I can help with ${resolvedTitle}. Share your target price and I will review it.`,
                  meta: `List price: ${priceLabel}`,
                  label: "Seller",
                },
              ];
        setManualSession(created);
        setSession(created);
        sellerSessionRef.current = created;
        setManualMessages(initialMessages);
        if (!storedRun) {
          setMessages([]);
          setStatus("Set your target and max acceptable prices, then run the buyer agent.");
        }
      } catch (bootstrapError) {
        const message =
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Could not initialize negotiation.";
        setError(message);
        setStatus("Negotiation unavailable.");
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [
    negotiationScope,
    priceLabel,
    queryMaxAcceptablePrice,
    queryTargetPrice,
    resolvedPrice,
    resolvedSku,
    resolvedTitle,
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualSession || !prompt.trim() || isSubmitting || mode !== "manual") {
      return;
    }

    const buyerMessage = prompt.trim();
    const buyerOffer = extractOffer(buyerMessage);

    setPrompt("");
    setError("");
    setIsSubmitting(true);
    setManualMessages((current) => [
      ...current,
      {
        id: `buyer-${crypto.randomUUID()}`,
        role: "buyer",
        content: buyerMessage,
        meta: buyerOffer ? `Offer: ${formatMoney(buyerOffer)}` : "Message only",
        label: "You",
      },
    ]);

    try {
      const turn = await submitNegotiationOffer({
        sessionId: manualSession.session_id,
        buyerOffer,
        buyerMessage,
      });
      const refreshedSession = await fetchNegotiationSession(manualSession.session_id);

      setManualSession(refreshedSession);
      setSession(refreshedSession);
      setManualMessages((current) => [...current, buildSellerBubble(turn)]);
      if (refreshedSession.closed && refreshedSession.accepted_price) {
        writeNegotiatedDeal({
          userId: negotiationScope.userId || "anonymous",
          sessionId: negotiationScope.sessionId || "global",
          planId: negotiationScope.planId || "global",
          sku: resolvedSku,
          title: resolvedTitle,
          originalPrice: Number(resolvedPrice ?? 0),
          negotiatedPrice: refreshedSession.accepted_price,
          planTitle: resolvedPlanTitle,
          acceptedAt: new Date().toISOString(),
        });
        setStatus("Deal accepted. You can go back and place the order.");
      } else if (refreshedSession.closed) {
        setStatus("This negotiation is already closed.");
      } else {
        setStatus("Seller replied. You can continue bargaining.");
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Could not send negotiation message.";
      setError(message);
      setStatus("Negotiation request failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    if (!thinkingStartedAt) {
      setThinkingElapsedSeconds(0);
      return;
    }

    setThinkingElapsedSeconds(Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000)));
    const timer = window.setInterval(() => {
      setThinkingElapsedSeconds(Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [thinkingStartedAt]);

  useEffect(() => {
    const baseMessages = mode === "manual" ? manualMessages : agentMessages;
    if (mode === "agent" && thinkingMessage) {
      setMessages([
        ...baseMessages,
        {
          id: "agent-thinking",
          role: "seller",
          label: "System",
          content: thinkingMessage,
          meta: `${thinkingElapsedSeconds}s`,
          pending: true,
        },
      ]);
      return;
    }
    setMessages(baseMessages);
  }, [agentMessages, manualMessages, mode, thinkingElapsedSeconds, thinkingMessage]);

  useEffect(() => {
    if (mode === "manual") {
      setSession(manualSession);
      if (manualSession) {
        setStatus(manualSession.closed ? "Negotiation closed." : "Seller is ready for your offer.");
      }
      setThinkingMessage(null);
      setThinkingStartedAt(null);
      return;
    }

    if (agentResult) {
      setSession(agentResult.seller_session);
      setStatus(agentResult.summary);
      return;
    }

    if (isRunningAgent) {
      setStatus("Buyer agent is bargaining with the seller...");
    } else {
      setStatus("Set your target and max acceptable prices, then run the buyer agent.");
    }
  }, [agentResult, isRunningAgent, manualSession, mode]);

  const buildStreamEvent = useCallback((event: BuyerAgentStreamEvent) => {
    if (event.type === "thinking") {
      setThinkingMessage(event.message);
      setThinkingStartedAt(Date.now());
      persistNegotiationRun({
        status: "running",
        progressLabel: event.message,
        progressPercent: 12,
      });
      return;
    }

    if (event.type === "session_started") {
      activeRunIdRef.current = event.run_id;
      setSession(event.seller_session);
      sellerSessionRef.current = event.seller_session;
      setStatus("Buyer agent started. Waiting for round 1.");
      setThinkingMessage("Buyer agent is preparing the opening offer.");
      setThinkingStartedAt(Date.now());
      persistNegotiationRun({
        status: "running",
        progressLabel: "Buyer agent started. Waiting for round 1.",
        progressPercent: 18,
      });
      return;
    }

    if (event.type === "buyer_turn") {
      setThinkingMessage("Seller agent is evaluating the new offer.");
      setThinkingStartedAt(Date.now());
      setAgentMessages((current) => [...current, buildBuyerAgentBubble(event.turn)]);
      agentTurnsRef.current = [...agentTurnsRef.current, event.turn];
      persistNegotiationRun({
        status: "running",
        progressLabel: "Seller agent is evaluating the new offer.",
        progressPercent: 45,
      });
      return;
    }

    if (event.type === "seller_turn") {
      setThinkingMessage("Buyer agent is reviewing the seller response.");
      setThinkingStartedAt(Date.now());
      setAgentMessages((current) => [...current, { ...buildSellerBubble(event.turn), label: "Seller Agent" }]);
      if (agentTurnsRef.current.length > 0) {
        const updated = [...agentTurnsRef.current];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          seller_turn: event.turn,
        };
        agentTurnsRef.current = updated;
      }
      persistNegotiationRun({
        status: "running",
        progressLabel: "Buyer agent is reviewing the seller response.",
        progressPercent: 72,
      });
      return;
    }

    if (event.type === "done") {
      activeRunIdRef.current = event.result.run_id;
      setThinkingMessage(null);
      setThinkingStartedAt(null);
      setAgentResult(event.result);
      setIsRunningAgent(false);
      setSession(event.result.seller_session);
      sellerSessionRef.current = event.result.seller_session;
      agentTurnsRef.current = event.result.turns;
      setStatus(event.result.summary);
      writeNegotiationRun({
        userId: negotiationScope.userId || "anonymous",
        sessionId: negotiationScope.sessionId || "global",
        planId: negotiationScope.planId || "global",
        sku: resolvedSku,
        title: resolvedTitle,
        originalPrice: Number(resolvedPrice ?? 0),
        planTitle: resolvedPlanTitle,
        targetPrice: event.result.target_price,
        maxAcceptablePrice: event.result.max_acceptable_price,
        status: "done",
        progressLabel: event.result.summary,
        progressPercent: 100,
        turns: event.result.turns,
        sellerSession: event.result.seller_session,
        result: event.result,
        savedAt: new Date().toISOString(),
      });
      if (event.result.outcome === "accepted" && typeof event.result.final_price === "number") {
        writeNegotiatedDeal({
          userId: negotiationScope.userId || "anonymous",
          sessionId: negotiationScope.sessionId || "global",
          planId: negotiationScope.planId || "global",
          sku: resolvedSku,
          title: resolvedTitle,
          originalPrice: Number(resolvedPrice ?? 0),
          negotiatedPrice: event.result.final_price,
          planTitle: resolvedPlanTitle,
          acceptedAt: new Date().toISOString(),
        });
      }
      return;
    }

    if (event.type === "error") {
      if (event.run_id) {
        activeRunIdRef.current = event.run_id;
      }
      setThinkingMessage(null);
      setThinkingStartedAt(null);
      setIsRunningAgent(false);
      setError(event.error);
      setStatus("Buyer agent negotiation failed.");
      persistNegotiationRun({
        status: "done",
        progressLabel: "Buyer agent negotiation failed.",
        progressPercent: 100,
      });
    }
  }, [
    negotiationScope.planId,
    negotiationScope.sessionId,
    negotiationScope.userId,
    persistNegotiationRun,
    resolvedPlanTitle,
    resolvedPrice,
    resolvedSku,
    resolvedTitle,
  ]);

  const handleRunBuyerAgent = useCallback(async () => {
    const parsedTarget = Number(targetPrice);
    const parsedMax = Number(maxAcceptablePrice);
    if (
      !resolvedSku ||
      !Number.isFinite(parsedTarget) ||
      !Number.isFinite(parsedMax) ||
      parsedTarget <= 0 ||
      parsedMax <= 0 ||
      parsedMax < parsedTarget ||
      isRunningAgent
    ) {
      setError("Enter valid target and max acceptable prices first.");
      return;
    }

    setError("");
    setIsRunningAgent(true);
    setMode("agent");
    setAgentResult(null);
    setAgentMessages([]);
    setThinkingMessage("Buyer agent is preparing the opening offer.");
    setThinkingStartedAt(Date.now());
    setStatus("Buyer agent is bargaining with the seller...");
    activeRunIdRef.current = null;
    agentTurnsRef.current = [];
    sellerSessionRef.current = session;
    persistNegotiationRun({
      status: "running",
      progressLabel: "Buyer agent is preparing the opening offer.",
      progressPercent: 5,
    });
    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();

    try {
      await streamBuyerAgentNegotiation(
        {
        skuIdDefault: resolvedSku,
        targetPrice: parsedTarget,
        maxAcceptablePrice: parsedMax,
        },
        buildStreamEvent,
        { signal: streamAbortRef.current.signal },
      );
    } catch (runError) {
      const message =
        runError instanceof Error ? runError.message : "Could not run buyer agent negotiation.";
      if (message !== "This operation was aborted" && message !== "signal is aborted without reason") {
        setError(message);
        setThinkingMessage(null);
        setStatus("Buyer agent negotiation failed.");
        persistNegotiationRun({
          status: "done",
          progressLabel: "Buyer agent negotiation failed.",
          progressPercent: 100,
        });
      }
    } finally {
      setIsRunningAgent(false);
      streamAbortRef.current = null;
    }
  }, [
    buildStreamEvent,
    isRunningAgent,
    maxAcceptablePrice,
    persistNegotiationRun,
    session,
    resolvedSku,
    targetPrice,
  ]);

  async function handleCancelBuyerAgent() {
    if (isRunningAgent && activeRunIdRef.current) {
      try {
        await cancelBuyerAgentNegotiation(activeRunIdRef.current);
      } catch {
        // Ignore and still abort client-side stream.
      }
    }

    streamAbortRef.current?.abort();
    setIsRunningAgent(false);
    setThinkingMessage(null);
    setThinkingStartedAt(null);
    setStatus("Buyer agent negotiation cancelled.");
    setError("");
    activeRunIdRef.current = null;
    persistNegotiationRun({
      status: "done",
      progressLabel: "Buyer agent negotiation cancelled.",
      progressPercent: 100,
    });
  }

  function handleViewUpdatedPackage() {
    if (!resolvedSku || acceptedPrice == null) {
      return;
    }
    router.push("/chat");
  }

  return (
    <>
      <WorkspaceShell
        currentPath="/negotiation"
        isAuthenticated={isAuthenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          void logoutSession().finally(() => {
            setIsAuthenticated(false);
            router.push("/");
          });
        }}
      >
      <div className="grid h-full min-h-screen w-full overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-h-0 flex-col border-r border-[#e2e8f0] bg-[linear-gradient(180deg,#fbfdff_0%,#f3f6fa_100%)]">
          <div className="border-b border-[#e2e8f0] px-6 py-5">
            <div className="mx-auto flex w-full max-w-[920px] items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#98a2b3]">
                  Negotiation
                </p>
                <p className="mt-2 text-sm leading-6 text-[#667085]">
                  Set your offer range, then bargain manually or let the agent work through the seller conversation.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    mode === "manual"
                      ? "bg-[#111827] text-white"
                      : "text-[#667085] hover:bg-white"
                  }`}
                  onClick={() => setMode("manual")}
                  type="button"
                >
                  Manual
                </button>
                <button
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    mode === "agent"
                      ? "bg-[#111827] text-white"
                      : "text-[#667085] hover:bg-white"
                  }`}
                  onClick={() => setMode("agent")}
                  type="button"
                >
                  Agent
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto flex max-w-[920px] flex-col gap-5">
              {messages.length === 0 ? (
                <div className="mx-auto w-full max-w-[760px] rounded-[24px] border border-dashed border-[#d8e2ee] bg-white/70 px-5 py-5 text-sm leading-7 text-[#667085]">
                  {mode === "agent"
                    ? isRunningAgent
                      ? "The agent is preparing the first offer. Updates will appear here as the negotiation progresses."
                      : "Set your target and walk-away price on the right, then start the negotiation."
                    : "The seller session is ready. Send your first offer below to begin the conversation."}
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    className={`mx-auto w-full max-w-[760px] ${
                      message.role === "buyer" ? "flex justify-end" : "flex justify-start"
                    }`}
                    key={message.id}
                  >
                    <article
                      className={`max-w-[78%] ${
                        message.pending
                          ? "px-1 py-1 text-[#667085]"
                          : message.role === "buyer"
                            ? "rounded-[24px] bg-[#eceff3] px-4 py-3 text-[#101828]"
                            : "px-1 py-1 text-[#101828]"
                      }`}
                    >
                      <p className="text-sm leading-7">{message.content}</p>
                      {message.meta ? (
                        <p className="mt-2 text-[11px] text-[#98a2b3]">{message.meta}</p>
                      ) : null}
                      {message.id === acceptedSellerMessageId ? (
                        <button
                          className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.16)] transition hover:brightness-105"
                          onClick={handleViewUpdatedPackage}
                          type="button"
                        >
                          View updated package
                        </button>
                      ) : null}
                    </article>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border-t border-[#e2e8f0] px-6 py-5">
            <div className="mx-auto w-full max-w-[920px]">
              {mode === "manual" ? (
                <form className="space-y-3" onSubmit={handleSubmit}>
                  <div className="rounded-[28px] border border-[#d7e1ec] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(148,163,184,0.08)]">
                    <textarea
                      className="min-h-[68px] w-full resize-none bg-transparent text-sm leading-7 text-[#101828] outline-none placeholder:text-[#98a2b3]"
                      disabled={!manualSession || isSubmitting || manualSession.closed}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Example: I can do $850 if you can confirm today."
                      rows={3}
                      value={prompt}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#eef2f6] pt-3">
                      <p className="text-xs text-[#98a2b3]">
                        Mention a price in your message and it will be submitted as your offer.
                      </p>
                      <button
                        className="inline-flex h-9 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-4 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!manualSession || isSubmitting || manualSession.closed || !prompt.trim()}
                        type="submit"
                      >
                        {isSubmitting ? "Sending..." : "Send offer"}
                      </button>
                    </div>
                  </div>
                  {error ? <p className="text-sm text-rose-600">{error}</p> : null}
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-[28px] border border-[#d7e1ec] bg-white px-4 py-4 shadow-[0_10px_30px_rgba(148,163,184,0.08)]">
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">
                          Target price
                        </span>
                        <input
                          className="h-11 w-full rounded-2xl border border-[#d7e1ec] bg-[#fbfdff] px-4 text-sm text-[#101828] outline-none focus:border-[#93c5fd]"
                          min="1"
                          onChange={(event) => setTargetPrice(event.target.value)}
                          placeholder="Ideal closing price"
                          step="0.01"
                          type="number"
                          value={targetPrice}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">
                          Walk-away price
                        </span>
                        <input
                          className="h-11 w-full rounded-2xl border border-[#d7e1ec] bg-[#fbfdff] px-4 text-sm text-[#101828] outline-none focus:border-[#93c5fd]"
                          min="1"
                          onChange={(event) => setMaxAcceptablePrice(event.target.value)}
                          placeholder="Hard ceiling"
                          step="0.01"
                          type="number"
                          value={maxAcceptablePrice}
                        />
                      </label>
                      <div className="flex items-center md:justify-end">
                        <button
                          className={`h-11 rounded-full px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            isRunningAgent
                              ? "border border-[#d7e1ec] bg-white text-[#344054] hover:border-[#bfd4ec] hover:bg-[#f8fbff]"
                              : "bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] text-white hover:brightness-105"
                          }`}
                          disabled={!isRunningAgent && (!targetPrice.trim() || !maxAcceptablePrice.trim())}
                          onClick={isRunningAgent ? () => void handleCancelBuyerAgent() : handleRunBuyerAgent}
                          type="button"
                        >
                          {isRunningAgent ? "Cancel" : "Run agent"}
                        </button>
                      </div>
                    </div>
                  </div>
                  {agentResult ? (
                    <p className="text-sm text-[#475467]">
                      Outcome: <span className="font-semibold text-[#101828]">{agentResult.outcome}</span>
                      {agentResult.final_price ? ` · Final price ${agentResult.final_price.toLocaleString()}` : ""}
                    </p>
                  ) : null}
                  {error ? <p className="text-sm text-rose-600">{error}</p> : null}
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)]">
          <div className="border-b border-[#e2e8f0] px-5 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#98a2b3]">
              Live context
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[#101828]">
              Negotiation setup
            </h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-4">
              <section className="border-b border-[#e6edf5] pb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">
                  Current item
                </p>
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={resolvedTitle}
                    className="mt-3 aspect-[4/3] w-full rounded-[22px] object-cover"
                    src={imageUrl}
                  />
                ) : (
                  <div className="mt-3 aspect-[4/3] w-full rounded-[22px] bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                )}
                <h3 className="mt-2 text-lg font-bold leading-7 text-[#101828]">{resolvedTitle}</h3>
                <p className="mt-2 text-sm text-[#667085]">From package: {resolvedPlanTitle}</p>
                <div className="mt-3 rounded-[22px] border border-[#dfe7f1] bg-white px-4 py-3">
                  <p className="text-xs text-[#98a2b3]">List price</p>
                  <p className="mt-1 text-lg font-bold text-[#101828]">{priceLabel}</p>
                </div>
              </section>

              <section className="border-b border-[#e6edf5] pb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">
                  Price guardrails
                </p>
                <div className="mt-3 grid gap-3">
                  <div className="rounded-[22px] border border-[#dfe7f1] bg-white px-4 py-3">
                    <p className="text-xs text-[#98a2b3]">Seller floor</p>
                    <p className="mt-1 text-lg font-bold text-[#101828]">
                      {session
                        ? formatMoney(Number(session.pricing_params.min_expected_price ?? 0)) ?? "N/A"
                        : "N/A"}
                    </p>
                  </div>
                  <p className="text-xs leading-6 text-[#667085]">
                    Set your target and walk-away prices in the composer below. The agent will use those values for this run.
                  </p>
                </div>
              </section>

              <section className="border-b border-[#e6edf5] pb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">
                  Status
                </p>
                <p className="mt-3 text-sm leading-7 text-[#344054]">{status}</p>
                {session ? (
                  <div className="mt-3 space-y-1 text-xs text-[#667085]">
                    <p>Max rounds: {session.max_rounds}</p>
                    <p>
                      Session:{" "}
                      {session.closed && session.accepted_price
                        ? `Accepted at ${formatMoney(session.accepted_price)}`
                        : session.closed
                          ? "Closed"
                          : "Open"}
                    </p>
                  </div>
                ) : null}
              </section>

              {mode === "agent" ? (
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">
                    Agent run
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[#344054]">
                    {isRunningAgent
                      ? "The buyer agent is actively negotiating."
                      : agentResult
                        ? agentResult.summary
                        : "Set your guardrails, then start the agent when you are ready."}
                  </p>
                </section>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
      </WorkspaceShell>
      <AuthModal
        onAuthSuccess={() => {
          setIsAuthenticated(true);
          setAuthOpen(false);
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </>
  );
}
