"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
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
import { readNegotiationRuns, writeNegotiatedDeal, writeNegotiationRun } from "@/lib/negotiation-store";
import { setOrderCheckout } from "@/lib/order-store";
import AuthModal from "@/src/components/AuthModal";
import Navbar from "@/src/components/Navbar";

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
  const planId = searchParams.get("planId") ?? undefined;
  const planTitle = searchParams.get("planTitle") ?? "Recommended bundle";
  const autoStart = searchParams.get("autoStart") === "1";
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
  const hasAutoStartedRef = useRef(false);
  const activeRunIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const priceLabel = useMemo(() => {
    const amount = price ? Number(price) : null;
    return amount && Number.isFinite(amount) ? `$${amount.toLocaleString()}` : "Unknown";
  }, [price]);

  const acceptedPrice =
    agentResult?.outcome === "accepted" && typeof agentResult.final_price === "number"
      ? agentResult.final_price
      : session?.closed && typeof session.accepted_price === "number"
        ? session.accepted_price
        : null;
  const originalPrice = Number(price ?? 0);
  const negotiatedSavings =
    acceptedPrice && Number.isFinite(originalPrice) && originalPrice > acceptedPrice
      ? originalPrice - acceptedPrice
      : 0;

  function applyStoredRun(stored: ReturnType<typeof readNegotiationRuns>[string]) {
    setMode("agent");
    setAgentMessages(buildStoredRunTranscript(stored));
    setSession(stored.result?.seller_session ?? stored.sellerSession);
    setStatus(stored.progressLabel);
    setThinkingMessage(stored.status === "running" ? stored.progressLabel : null);
    setError("");
    setTargetPrice(String(stored.targetPrice));
    setMaxAcceptablePrice(String(stored.maxAcceptablePrice));
    setAgentResult(stored.result ?? null);
    setIsRunningAgent(stored.status === "running");
  }

  useEffect(() => {
    if (!sku) {
      return;
    }

    const storedRuns = readNegotiationRuns();
    const stored = storedRuns[sku];
    if (!stored) {
      if (queryTargetPrice) {
        setTargetPrice(queryTargetPrice);
      }
      if (queryMaxAcceptablePrice) {
        setMaxAcceptablePrice(queryMaxAcceptablePrice);
      }
      return;
    }

    applyStoredRun(stored);
  }, [queryMaxAcceptablePrice, queryTargetPrice, sku]);

  useEffect(() => {
    if (!sku) {
      return;
    }

    const timer = window.setInterval(() => {
      const stored = readNegotiationRuns()[sku];
      if (!stored) {
        return;
      }
      applyStoredRun(stored);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sku]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!sku) {
        setError("Missing sku for negotiation.");
        setStatus("Cannot open negotiation.");
        return;
      }

      const storedRun = readNegotiationRuns()[sku];

      const token = readAccessToken();
      if (!token) {
        setError("Missing access token.");
        setStatus("Please sign in again.");
        return;
      }

      try {
        await fetchCurrentUser(token);
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
          skuIdDefault: sku,
          buyerNote: `Hi, I am interested in ${title}. Can we discuss the price?`,
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
                  content: `I can help with ${title}. Share your target price and I will review it.`,
                  meta: `List price: ${priceLabel}`,
                  label: "Seller",
                },
              ];
        setManualSession(created);
        setSession(created);
        setManualMessages(initialMessages);
        if (!storedRun) {
          setMessages([]);
          setStatus("Set your target and max acceptable prices, then run the buyer agent.");
        }
        if (queryTargetPrice && queryMaxAcceptablePrice) {
          setTargetPrice(queryTargetPrice);
          setMaxAcceptablePrice(queryMaxAcceptablePrice);
        } else if (price && !storedRun) {
          const numericPrice = Number(price);
          setTargetPrice(String(Math.round(numericPrice * 0.9)));
          setMaxAcceptablePrice(String(Math.round(numericPrice * 0.95)));
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
  }, [price, priceLabel, queryMaxAcceptablePrice, queryTargetPrice, sku, title]);

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
          sku,
          title,
          originalPrice: Number(price ?? 0),
          negotiatedPrice: refreshedSession.accepted_price,
          planId,
          planTitle,
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
      return;
    }

    if (event.type === "session_started") {
      activeRunIdRef.current = event.run_id;
      setSession(event.seller_session);
      setStatus("Buyer agent started. Waiting for round 1.");
      setThinkingMessage("Buyer agent is preparing the opening offer.");
      setThinkingStartedAt(Date.now());
      return;
    }

    if (event.type === "buyer_turn") {
      setThinkingMessage("Seller agent is evaluating the new offer.");
      setThinkingStartedAt(Date.now());
      setAgentMessages((current) => [...current, buildBuyerAgentBubble(event.turn)]);
      return;
    }

    if (event.type === "seller_turn") {
      setThinkingMessage("Buyer agent is reviewing the seller response.");
      setThinkingStartedAt(Date.now());
      setAgentMessages((current) => [...current, { ...buildSellerBubble(event.turn), label: "Seller Agent" }]);
      return;
    }

    if (event.type === "done") {
      activeRunIdRef.current = event.result.run_id;
      setThinkingMessage(null);
      setThinkingStartedAt(null);
      setAgentResult(event.result);
      setIsRunningAgent(false);
      setSession(event.result.seller_session);
      setStatus(event.result.summary);
      writeNegotiationRun({
        sku,
        title,
        originalPrice: Number(price ?? 0),
        planId,
        planTitle,
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
          sku,
          title,
          originalPrice: Number(price ?? 0),
          negotiatedPrice: event.result.final_price,
          planId,
          planTitle,
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
    }
  }, [planId, planTitle, price, sku, title]);

  const handleRunBuyerAgent = useCallback(async () => {
    const parsedTarget = Number(targetPrice);
    const parsedMax = Number(maxAcceptablePrice);
    if (
      !sku ||
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
    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();

    try {
      await streamBuyerAgentNegotiation(
        {
        skuIdDefault: sku,
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
      }
    } finally {
      setIsRunningAgent(false);
      streamAbortRef.current = null;
    }
  }, [
    buildStreamEvent,
    isRunningAgent,
    maxAcceptablePrice,
    sku,
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
    router.push("/recommendations");
  }

  function handleProceedToOrder() {
    if (!sku || acceptedPrice == null) {
      return;
    }

    setOrderCheckout({
      source: "negotiation",
      packageId: planId,
      packageTitle: title,
      summary: `Finalized from ${planTitle} after negotiation.`,
      items: [
        {
          sku,
          title,
          price: acceptedPrice,
          quantity: 1,
        },
      ],
      subtotal: acceptedPrice,
      negotiatedSavings,
    });
    router.push("/order");
  }

  useEffect(() => {
    if (!autoStart || hasAutoStartedRef.current || !isAuthenticated || !sku) {
      return;
    }
    if (!targetPrice.trim() || !maxAcceptablePrice.trim() || isRunningAgent || agentResult) {
      return;
    }

    hasAutoStartedRef.current = true;
    void handleRunBuyerAgent();
  }, [
    agentResult,
    autoStart,
    handleRunBuyerAgent,
    isAuthenticated,
    isRunningAgent,
    maxAcceptablePrice,
    sku,
    targetPrice,
  ]);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f9fc_0%,#edf2f8_100%)] px-4 pb-6 pt-24 text-[#101828] md:px-6">
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
      <div className="mx-auto grid w-full max-w-7xl gap-5 xl:grid-cols-[1.5fr_0.6fr]">
        <section className="flex min-h-[84vh] flex-col rounded-[30px] border border-[#dbe4ef] bg-white/95 p-4 shadow-[0_24px_80px_rgba(148,163,184,0.14)] md:p-5 lg:p-6">
          <div className="flex items-center justify-between border-b border-[#e7edf4] pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#7c8da5]">Conversation</p>
              <h2 className="mt-1 text-2xl font-black text-[#101828]">Buyer vs Seller</h2>
              <p className="mt-2 text-sm text-[#667085]">
                Direct bargaining for <span className="font-semibold text-[#101828]">{title}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  mode === "manual"
                    ? "bg-[#2563eb] text-white"
                    : "border border-[#d8e2ee] bg-white text-[#667085]"
                }`}
                onClick={() => setMode("manual")}
                type="button"
              >
                Manual
              </button>
              <button
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  mode === "agent"
                    ? "bg-[#111827] text-white"
                    : "border border-[#d8e2ee] bg-white text-[#667085]"
                }`}
                onClick={() => setMode("agent")}
                type="button"
              >
                Buyer Agent
              </button>
              <Link
                className="rounded-full border border-[#d7e1ec] bg-white px-3 py-1 text-xs font-semibold text-[#344054] transition hover:border-[#bfd4ec] hover:bg-[#f8fbff]"
                href="/recommendations"
              >
                Back to packages
              </Link>
            </div>
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-[28px] border border-[#e7edf4] bg-[linear-gradient(180deg,#fbfdff_0%,#f4f7fb_100%)] p-4 md:p-5">
            {messages.length === 0 ? (
              mode === "agent" ? (
                <div className="rounded-2xl border border-dashed border-[#d5dfeb] bg-white px-4 py-4 text-sm text-[#667085]">
                  {isRunningAgent ? (
                    <div className="space-y-2">
                      <p className="font-semibold text-[#344054]">Buyer agent is negotiating now.</p>
                      <p>
                        The system is generating buyer-side decisions, validating them, and sending
                        them to the seller agent. Transcript messages will appear here round by round.
                      </p>
                    </div>
                  ) : agentResult ? (
                    <div className="space-y-2">
                      <p className="font-semibold text-[#344054]">Negotiation finished with no transcript.</p>
                      <p>{agentResult.summary}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-semibold text-[#344054]">Buyer agent is not running yet.</p>
                      <p>
                        Enter your target price and max acceptable price below, then click
                        <span className="mx-1 font-semibold text-[#2563eb]">Auto bargain</span>
                        to start the automatic negotiation.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#d5dfeb] px-4 py-4 text-sm text-[#667085]">
                  Preparing the seller agent...
                </div>
              )
            ) : (
              messages.map((message) => (
                <article
                  className={`max-w-[88%] rounded-[24px] px-4 py-3 md:px-5 md:py-4 ${
                    message.pending
                      ? "mr-auto border border-dashed border-[#d5dfeb] bg-white text-[#475467]"
                      : message.role === "buyer"
                      ? "ml-auto bg-[linear-gradient(180deg,#2563eb_0%,#1d4ed8_100%)] text-white"
                      : "mr-auto border border-[#dbe4ef] bg-white text-[#101828]"
                  }`}
                  key={message.id}
                >
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      message.pending
                        ? "text-[#98a2b3]"
                        : message.role === "buyer"
                          ? "text-[#dbeafe]"
                          : "text-[#98a2b3]"
                    }`}
                  >
                    {message.label ?? (message.role === "buyer" ? "Buyer" : "Seller")}
                  </p>
                  <p className="mt-1 text-sm leading-7">{message.content}</p>
                  {message.meta ? (
                    <p
                      className={`mt-2 text-[11px] ${
                        message.role === "buyer" ? "text-[#dbeafe]" : "text-[#667085]"
                      }`}
                    >
                      {message.meta}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>

          {mode === "manual" ? (
            <form className="mt-4 border-t border-[#e7edf4] pt-4" onSubmit={handleSubmit}>
              <textarea
                className="min-h-[110px] w-full resize-none rounded-[24px] border border-[#d7e1ec] bg-[#fbfdff] px-4 py-3 text-sm text-[#101828] outline-none focus:border-[#93c5fd]"
                disabled={!manualSession || isSubmitting || manualSession.closed}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Example: I can do $850 if you can confirm today."
                rows={3}
                value={prompt}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[#667085]">
                  Mention a price in your message and the backend will submit it as your offer.
                </p>
                <button
                  className="rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 py-3 text-sm font-semibold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!manualSession || isSubmitting || manualSession.closed || !prompt.trim()}
                  type="submit"
                >
                  {isSubmitting ? "Sending..." : "Send offer"}
                </button>
              </div>
              {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
            </form>
          ) : (
            <div className="mt-4 border-t border-[#e7edf4] pt-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">
                      Target Price
                    </span>
                    <input
                      className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-[#fbfdff] px-4 text-sm text-[#101828] outline-none focus:border-[#93c5fd]"
                      min="1"
                      onChange={(event) => setTargetPrice(event.target.value)}
                      placeholder="Ideal closing price"
                      step="0.01"
                      type="number"
                      value={targetPrice}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">
                      Max Acceptable
                    </span>
                    <input
                      className="h-12 w-full rounded-2xl border border-[#d7e1ec] bg-[#fbfdff] px-4 text-sm text-[#101828] outline-none focus:border-[#93c5fd]"
                      min="1"
                      onChange={(event) => setMaxAcceptablePrice(event.target.value)}
                      placeholder="Hard ceiling"
                      step="0.01"
                      type="number"
                      value={maxAcceptablePrice}
                    />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    className="h-12 rounded-full border border-[#d7e1ec] bg-white px-5 text-sm font-semibold text-[#344054] transition hover:border-[#bfd4ec] hover:bg-[#f8fbff] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleCancelBuyerAgent()}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="h-12 rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isRunningAgent || !targetPrice.trim() || !maxAcceptablePrice.trim()}
                    onClick={handleRunBuyerAgent}
                    type="button"
                  >
                    {isRunningAgent ? "Running..." : "Auto bargain"}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-[#667085]">
                The buyer agent will negotiate automatically for up to 5 rounds. It will try to hit
                your target price and never go above your max acceptable price.
              </p>
              {agentResult ? (
                <p className="mt-2 text-sm text-[#344054]">
                  Outcome: <span className="font-semibold">{agentResult.outcome}</span>
                  {agentResult.final_price ? ` | Final price: ${agentResult.final_price.toLocaleString()}` : ""}
                </p>
              ) : null}
              {acceptedPrice != null ? (
                <button
                  className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.16)] transition hover:brightness-105"
                  onClick={handleProceedToOrder}
                  type="button"
                >
                  Proceed to order
                </button>
              ) : null}
              {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
            </div>
          )}
        </section>

        <aside className="rounded-[28px] border border-[#dbe4ef] bg-[linear-gradient(180deg,#f8fbff_0%,#eef3f9_100%)] p-5 shadow-[0_20px_60px_rgba(148,163,184,0.14)]">
          <p className="text-xs font-semibold tracking-[0.24em] text-[#7c8da5] uppercase">Seller agent</p>
          <h1 className="mt-2 text-3xl font-black text-[#101828]">Try bargain</h1>
          <p className="mt-3 text-sm leading-7 text-[#667085]">
            Negotiate directly with the seller on a single product before you go back to place the
            order.
          </p>

          <div className="mt-5 rounded-3xl border border-[#dfe7f1] bg-white/95 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[#7c8da5]">Current item</p>
            <h2 className="mt-1 text-xl font-bold text-[#101828]">{title}</h2>
            <p className="mt-2 text-sm text-[#667085]">From plan: {planTitle}</p>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-[#f8fbff] p-3">
                <p className="text-xs text-[#7c8da5]">List price</p>
                <p className="mt-1 text-lg font-bold text-[#101828]">{priceLabel}</p>
              </div>
              <div className="rounded-2xl bg-[#f8fbff] p-3">
                <p className="text-xs text-[#7c8da5]">Negotiation status</p>
                <p className="mt-1 text-sm font-semibold text-[#101828]">{status}</p>
              </div>
            </div>
          </div>

          {session ? (
            <div className="mt-5 rounded-3xl border border-[#dfe7f1] bg-white/90 p-4 text-sm text-[#475467]">
              <p>Session ID: {session.session_id}</p>
              <p className="mt-1">Max rounds: {session.max_rounds}</p>
              <p className="mt-1">
                Seller floor: {formatMoney(Number(session.pricing_params.min_expected_price ?? 0)) ?? "N/A"}
              </p>
              <p className="mt-1">
                Current result:{" "}
                {session.closed && session.accepted_price
                  ? `Accepted at ${formatMoney(session.accepted_price)}`
                  : session.closed
                    ? "Closed without accepted price"
                    : "Open"}
              </p>
              {acceptedPrice != null ? (
                <button
                  className="mt-4 inline-flex h-11 items-center justify-center rounded-full border border-[#cdd9e7] bg-white px-5 text-sm font-semibold text-[#101828] transition hover:border-[#bed0e5] hover:bg-[#f8fbff]"
                  onClick={handleProceedToOrder}
                  type="button"
                >
                  Place order
                </button>
              ) : null}
            </div>
          ) : null}

          {mode === "agent" ? (
            <div className="mt-5 rounded-3xl border border-[#dfe7f1] bg-white/90 p-4 text-sm text-[#475467]">
              <p className="font-semibold text-[#101828]">Buyer agent status</p>
              <p className="mt-2">
                {isRunningAgent
                  ? "Running automatic negotiation..."
                  : agentResult
                    ? `Outcome: ${agentResult.outcome}`
                    : "Waiting to start."}
              </p>
              {agentResult ? (
                <>
                  <p className="mt-1">Target price: {formatMoney(agentResult.target_price) ?? "N/A"}</p>
                  <p className="mt-1">
                    Max acceptable: {formatMoney(agentResult.max_acceptable_price) ?? "N/A"}
                  </p>
                  <p className="mt-1">Summary: {agentResult.summary}</p>
                </>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
      <AuthModal
        onAuthSuccess={() => {
          setIsAuthenticated(true);
          setAuthOpen(false);
        }}
        onClose={() => setAuthOpen(false)}
        open={authOpen}
      />
    </main>
  );
}
