"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import {
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

export default function NegotiationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sku = searchParams.get("sku") ?? "";
  const title = searchParams.get("title") ?? "Selected item";
  const price = searchParams.get("price");
  const planId = searchParams.get("planId") ?? undefined;
  const planTitle = searchParams.get("planTitle") ?? "Recommended bundle";

  const [session, setSession] = useState<NegotiationSession | null>(null);
  const [manualSession, setManualSession] = useState<NegotiationSession | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [manualMessages, setManualMessages] = useState<ChatBubble[]>([]);
  const [agentMessages, setAgentMessages] = useState<ChatBubble[]>([]);
  const [mode, setMode] = useState<"manual" | "agent">("agent");
  const [prompt, setPrompt] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [maxAcceptablePrice, setMaxAcceptablePrice] = useState("");
  const [status, setStatus] = useState("Initializing seller negotiation...");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [agentResult, setAgentResult] = useState<BuyerAgentRunResult | null>(null);
  const [thinkingMessage, setThinkingMessage] = useState<string | null>(null);

  const priceLabel = useMemo(() => {
    const amount = price ? Number(price) : null;
    return amount && Number.isFinite(amount) ? `$${amount.toLocaleString()}` : "Unknown";
  }, [price]);

  useEffect(() => {
    if (!sku) {
      return;
    }

    const storedRuns = readNegotiationRuns();
    const stored = storedRuns[sku];
    if (!stored) {
      return;
    }

    setMode("agent");
    setAgentMessages(
      stored.result
        ? buildAgentTranscript(stored.result)
        : stored.turns.flatMap((turn) => {
            const bubbles: ChatBubble[] = [buildBuyerAgentBubble(turn)];
            if (turn.seller_turn) {
              bubbles.push({ ...buildSellerBubble(turn.seller_turn), label: "Seller Agent" });
            }
            return bubbles;
          }),
    );
    setSession(stored.result?.seller_session ?? stored.sellerSession);
    setStatus(stored.progressLabel);
    setThinkingMessage(null);
    setError("");
    setTargetPrice(String(stored.targetPrice));
    setMaxAcceptablePrice(String(stored.maxAcceptablePrice));
    setAgentResult(stored.result ?? null);
    setIsRunningAgent(stored.status === "running");
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
      } catch {
        clearAccessToken();
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
        if (price && !storedRun) {
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
  }, [price, priceLabel, sku, title]);

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
    const baseMessages = mode === "manual" ? manualMessages : agentMessages;
    if (mode === "agent" && thinkingMessage) {
      setMessages([
        ...baseMessages,
        {
          id: "agent-thinking",
          role: "seller",
          label: "System",
          content: thinkingMessage,
          meta: "Thinking...",
          pending: true,
        },
      ]);
      return;
    }
    setMessages(baseMessages);
  }, [agentMessages, manualMessages, mode, thinkingMessage]);

  useEffect(() => {
    if (mode === "manual") {
      setSession(manualSession);
      if (manualSession) {
        setStatus(manualSession.closed ? "Negotiation closed." : "Seller is ready for your offer.");
      }
      setThinkingMessage(null);
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

  function buildStreamEvent(event: BuyerAgentStreamEvent) {
    if (event.type === "thinking") {
      setThinkingMessage(event.message);
      return;
    }

    if (event.type === "session_started") {
      setSession(event.seller_session);
      setStatus("Buyer agent started. Waiting for round 1.");
      setThinkingMessage("Buyer agent is preparing the opening offer.");
      return;
    }

    if (event.type === "buyer_turn") {
      setThinkingMessage("Seller agent is evaluating the new offer.");
      setAgentMessages((current) => [...current, buildBuyerAgentBubble(event.turn)]);
      return;
    }

    if (event.type === "seller_turn") {
      setThinkingMessage("Buyer agent is reviewing the seller response.");
      setAgentMessages((current) => [...current, { ...buildSellerBubble(event.turn), label: "Seller Agent" }]);
      return;
    }

    if (event.type === "done") {
      setThinkingMessage(null);
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
      setThinkingMessage(null);
      setIsRunningAgent(false);
      setError(event.error);
      setStatus("Buyer agent negotiation failed.");
    }
  }

  async function handleRunBuyerAgent() {
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
    setStatus("Buyer agent is bargaining with the seller...");

    try {
      await streamBuyerAgentNegotiation(
        {
        skuIdDefault: sku,
        targetPrice: parsedTarget,
        maxAcceptablePrice: parsedMax,
        },
        buildStreamEvent,
      );
    } catch (runError) {
      const message =
        runError instanceof Error ? runError.message : "Could not run buyer agent negotiation.";
      setError(message);
      setThinkingMessage(null);
      setStatus("Buyer agent negotiation failed.");
    } finally {
      setIsRunningAgent(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f8efe2_0%,#f4efe8_42%,#ece7df_100%)] px-4 py-6 text-[#231f1a] md:px-6">
      <div className="mx-auto grid w-full max-w-7xl gap-5 xl:grid-cols-[1.5fr_0.6fr]">
        <section className="flex min-h-[84vh] flex-col rounded-[30px] border border-[#eadfce] bg-white p-4 shadow-[0_24px_80px_rgba(58,39,15,0.08)] md:p-5 lg:p-6">
          <div className="flex items-center justify-between border-b border-[#efe7da] pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#b58a52]">Conversation</p>
              <h2 className="mt-1 text-2xl font-black text-[#2f241a]">Buyer vs Seller</h2>
              <p className="mt-2 text-sm text-[#7c6957]">
                Direct bargaining for <span className="font-semibold text-[#3f2b18]">{title}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  mode === "manual"
                    ? "bg-[#2f6fa3] text-white"
                    : "border border-[#d8cbb7] bg-white text-[#6f5a44]"
                }`}
                onClick={() => setMode("manual")}
                type="button"
              >
                Manual
              </button>
              <button
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  mode === "agent"
                    ? "bg-[#8f5a2a] text-white"
                    : "border border-[#d8cbb7] bg-white text-[#6f5a44]"
                }`}
                onClick={() => setMode("agent")}
                type="button"
              >
                Buyer Agent
              </button>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  session?.closed
                    ? "bg-[#e8ece3] text-[#4a6440]"
                    : "bg-[#f8ead7] text-[#8a5e22]"
                }`}
              >
                {session?.closed ? "Closed" : "Open"}
              </span>
            </div>
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-[28px] border border-[#f0e7da] bg-[#fcfaf7] p-4 md:p-5">
            {messages.length === 0 ? (
              mode === "agent" ? (
                <div className="rounded-2xl border border-dashed border-[#deceb9] bg-[#fffaf3] px-4 py-4 text-sm text-[#7b6b59]">
                  {isRunningAgent ? (
                    <div className="space-y-2">
                      <p className="font-semibold text-[#5f4a37]">Buyer agent is negotiating now.</p>
                      <p>
                        The system is generating buyer-side decisions, validating them, and sending
                        them to the seller agent. Transcript messages will appear here round by round.
                      </p>
                    </div>
                  ) : agentResult ? (
                    <div className="space-y-2">
                      <p className="font-semibold text-[#5f4a37]">Negotiation finished with no transcript.</p>
                      <p>{agentResult.summary}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-semibold text-[#5f4a37]">Buyer agent is not running yet.</p>
                      <p>
                        Enter your target price and max acceptable price below, then click
                        <span className="mx-1 font-semibold text-[#8f5a2a]">Auto bargain</span>
                        to start the automatic negotiation.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#deceb9] px-4 py-4 text-sm text-[#7b6b59]">
                  Preparing the seller agent...
                </div>
              )
            ) : (
              messages.map((message) => (
                <article
                  className={`max-w-[88%] rounded-[24px] px-4 py-3 md:px-5 md:py-4 ${
                    message.pending
                      ? "mr-auto border border-dashed border-[#d7c6b0] bg-[#fffaf3] text-[#6c5842]"
                      : message.role === "buyer"
                      ? "ml-auto bg-[#2f6fa3] text-white"
                      : "mr-auto border border-[#eadfce] bg-white text-[#2f241a]"
                  }`}
                  key={message.id}
                >
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      message.pending
                        ? "text-[#a28463]"
                        : message.role === "buyer"
                          ? "text-[#d9ecfb]"
                          : "text-[#a28463]"
                    }`}
                  >
                    {message.label ?? (message.role === "buyer" ? "Buyer" : "Seller")}
                  </p>
                  <p className="mt-1 text-sm leading-7">{message.content}</p>
                  {message.meta ? (
                    <p
                      className={`mt-2 text-[11px] ${
                        message.role === "buyer" ? "text-[#d9ecfb]" : "text-[#7d6954]"
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
            <form className="mt-4 border-t border-[#efe7da] pt-4" onSubmit={handleSubmit}>
              <textarea
                className="min-h-[110px] w-full resize-none rounded-[24px] border border-[#decfb8] bg-[#fffcf8] px-4 py-3 text-sm text-[#2f241a] outline-none focus:border-[#c9965a]"
                disabled={!manualSession || isSubmitting || manualSession.closed}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Example: I can do $850 if you can confirm today."
                rows={3}
                value={prompt}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[#8a7761]">
                  Mention a price in your message and the backend will submit it as your offer.
                </p>
                <button
                  className="rounded-full bg-[#8f5a2a] px-5 py-3 text-sm font-semibold text-white hover:bg-[#7d4f25] disabled:cursor-not-allowed disabled:bg-[#ccb59f]"
                  disabled={!manualSession || isSubmitting || manualSession.closed || !prompt.trim()}
                  type="submit"
                >
                  {isSubmitting ? "Sending..." : "Send offer"}
                </button>
              </div>
              {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
            </form>
          ) : (
            <div className="mt-4 border-t border-[#efe7da] pt-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#93745a]">
                      Target Price
                    </span>
                    <input
                      className="h-12 w-full rounded-2xl border border-[#decfb8] bg-[#fffcf8] px-4 text-sm text-[#2f241a] outline-none focus:border-[#c9965a]"
                      min="1"
                      onChange={(event) => setTargetPrice(event.target.value)}
                      placeholder="Ideal closing price"
                      step="0.01"
                      type="number"
                      value={targetPrice}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#93745a]">
                      Max Acceptable
                    </span>
                    <input
                      className="h-12 w-full rounded-2xl border border-[#decfb8] bg-[#fffcf8] px-4 text-sm text-[#2f241a] outline-none focus:border-[#c9965a]"
                      min="1"
                      onChange={(event) => setMaxAcceptablePrice(event.target.value)}
                      placeholder="Hard ceiling"
                      step="0.01"
                      type="number"
                      value={maxAcceptablePrice}
                    />
                  </label>
                </div>
                <div>
                  <button
                    className="h-12 rounded-full bg-[#8f5a2a] px-5 text-sm font-semibold text-white hover:bg-[#7d4f25] disabled:cursor-not-allowed disabled:bg-[#ccb59f]"
                    disabled={isRunningAgent || !targetPrice.trim() || !maxAcceptablePrice.trim()}
                    onClick={handleRunBuyerAgent}
                    type="button"
                  >
                    {isRunningAgent ? "Running..." : "Auto bargain"}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-[#8a7761]">
                The buyer agent will negotiate automatically for up to 5 rounds. It will try to hit
                your target price and never go above your max acceptable price.
              </p>
              {agentResult ? (
                <p className="mt-2 text-sm text-[#5f4a37]">
                  Outcome: <span className="font-semibold">{agentResult.outcome}</span>
                  {agentResult.final_price ? ` | Final price: ${agentResult.final_price.toLocaleString()}` : ""}
                </p>
              ) : null}
              {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
            </div>
          )}
        </section>

        <aside className="rounded-[28px] border border-[#dfd1bf] bg-[#f9f3ea] p-5 shadow-[0_20px_60px_rgba(80,54,16,0.08)]">
          <p className="text-xs font-semibold tracking-[0.24em] text-[#ad7c43] uppercase">Seller agent</p>
          <h1 className="mt-2 text-3xl font-black text-[#3f2b18]">Try bargain</h1>
          <p className="mt-3 text-sm leading-7 text-[#6c5742]">
            Negotiate directly with the seller on a single product before you go back to place the
            order.
          </p>

          <div className="mt-5 rounded-3xl border border-[#e6d7c4] bg-white/90 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[#93745a]">Current item</p>
            <h2 className="mt-1 text-xl font-bold text-[#2f241a]">{title}</h2>
            <p className="mt-2 text-sm text-[#6f6154]">From plan: {planTitle}</p>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-[#fbf7f1] p-3">
                <p className="text-xs text-[#90745d]">List price</p>
                <p className="mt-1 text-lg font-bold text-[#2f241a]">{priceLabel}</p>
              </div>
              <div className="rounded-2xl bg-[#fbf7f1] p-3">
                <p className="text-xs text-[#90745d]">Negotiation status</p>
                <p className="mt-1 text-sm font-semibold text-[#2f241a]">{status}</p>
              </div>
            </div>
          </div>

          {session ? (
            <div className="mt-5 rounded-3xl border border-[#e6d7c4] bg-[#fffdf9] p-4 text-sm text-[#5f4a37]">
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
            </div>
          ) : null}

          {mode === "agent" ? (
            <div className="mt-5 rounded-3xl border border-[#e6d7c4] bg-[#fffdf9] p-4 text-sm text-[#5f4a37]">
              <p className="font-semibold text-[#3f2b18]">Buyer agent status</p>
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

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="rounded-full border border-[#ccb598] px-4 py-2 text-sm font-semibold text-[#6b4f2b] hover:bg-[#f3e3ce]"
              onClick={() => router.push("/chat")}
              type="button"
            >
              Back to workspace
            </button>
            <Link
              className="rounded-full border border-[#d8c8b5] px-4 py-2 text-sm font-semibold text-[#5d4a39] hover:bg-white"
              href="/"
            >
              Home
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
