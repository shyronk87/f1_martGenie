"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import {
  createNegotiationSession,
  fetchNegotiationSession,
  submitNegotiationOffer,
  type NegotiationSession,
  type NegotiationTurn,
} from "@/lib/negotiation-api";
import { writeNegotiatedDeal } from "@/lib/negotiation-store";

type ChatBubble = {
  id: string;
  role: "buyer" | "seller";
  content: string;
  meta?: string;
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

export default function NegotiationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sku = searchParams.get("sku") ?? "";
  const title = searchParams.get("title") ?? "Selected item";
  const price = searchParams.get("price");
  const planId = searchParams.get("planId") ?? undefined;
  const planTitle = searchParams.get("planTitle") ?? "Recommended bundle";

  const [session, setSession] = useState<NegotiationSession | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("Initializing seller negotiation...");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const priceLabel = useMemo(() => {
    const amount = price ? Number(price) : null;
    return amount && Number.isFinite(amount) ? `$${amount.toLocaleString()}` : "Unknown";
  }, [price]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!sku) {
        setError("Missing sku for negotiation.");
        setStatus("Cannot open negotiation.");
        return;
      }

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
        setSession(created);
        setMessages(
          sellerTurns.length > 0
            ? sellerTurns
            : [
                {
                  id: "seller-opening",
                  role: "seller",
                  content: `I can help with ${title}. Share your target price and I will review it.`,
                  meta: `List price: ${priceLabel}`,
                },
              ],
        );
        setStatus(created.closed ? "Negotiation closed." : "Seller is ready for your offer.");
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
  }, [priceLabel, sku, title]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !prompt.trim() || isSubmitting) {
      return;
    }

    const buyerMessage = prompt.trim();
    const buyerOffer = extractOffer(buyerMessage);

    setPrompt("");
    setError("");
    setIsSubmitting(true);
    setMessages((current) => [
      ...current,
      {
        id: `buyer-${crypto.randomUUID()}`,
        role: "buyer",
        content: buyerMessage,
        meta: buyerOffer ? `Offer: ${formatMoney(buyerOffer)}` : "Message only",
      },
    ]);

    try {
      const turn = await submitNegotiationOffer({
        sessionId: session.session_id,
        buyerOffer,
        buyerMessage,
      });
      const refreshedSession = await fetchNegotiationSession(session.session_id);

      setSession(refreshedSession);
      setMessages((current) => [...current, buildSellerBubble(turn)]);
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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f8efe2_0%,#f4efe8_42%,#ece7df_100%)] px-4 py-6 text-[#231f1a] md:px-6">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[0.92fr_1.08fr]">
        <aside className="rounded-[28px] border border-[#dfd1bf] bg-[#f9f3ea] p-5 shadow-[0_20px_60px_rgba(80,54,16,0.08)]">
          <p className="text-xs font-semibold tracking-[0.24em] text-[#ad7c43] uppercase">Seller agent</p>
          <h1 className="mt-2 text-3xl font-black text-[#3f2b18]">Try bargain</h1>
          <p className="mt-3 text-sm leading-7 text-[#6c5742]">
            You are entering a direct price negotiation with the seller agent for the lead item in
            your recommended bundle.
          </p>

          <div className="mt-5 rounded-3xl border border-[#e6d7c4] bg-white/90 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[#93745a]">Current item</p>
            <h2 className="mt-1 text-xl font-bold text-[#2f241a]">{title}</h2>
            <p className="mt-2 text-sm text-[#6f6154]">From plan: {planTitle}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
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

        <section className="flex min-h-[82vh] flex-col rounded-[30px] border border-[#eadfce] bg-white p-4 shadow-[0_24px_80px_rgba(58,39,15,0.08)] md:p-5">
          <div className="flex items-center justify-between border-b border-[#efe7da] pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#b58a52]">Conversation</p>
              <h2 className="mt-1 text-2xl font-black text-[#2f241a]">Buyer vs Seller</h2>
            </div>
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

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-[24px] bg-[#fcfaf7] p-3">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#deceb9] px-4 py-4 text-sm text-[#7b6b59]">
                Preparing the seller agent...
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`max-w-[82%] rounded-[24px] px-4 py-3 ${
                    message.role === "buyer"
                      ? "ml-auto bg-[#2f6fa3] text-white"
                      : "mr-auto border border-[#eadfce] bg-white text-[#2f241a]"
                  }`}
                  key={message.id}
                >
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      message.role === "buyer" ? "text-[#d9ecfb]" : "text-[#a28463]"
                    }`}
                  >
                    {message.role === "buyer" ? "Buyer" : "Seller"}
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

          <form className="mt-4 border-t border-[#efe7da] pt-4" onSubmit={handleSubmit}>
            <textarea
              className="min-h-[90px] w-full resize-none rounded-[24px] border border-[#decfb8] bg-[#fffcf8] px-4 py-3 text-sm text-[#2f241a] outline-none focus:border-[#c9965a]"
              disabled={!session || isSubmitting || session.closed}
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
                disabled={!session || isSubmitting || session.closed || !prompt.trim()}
                type="submit"
              >
                {isSubmitting ? "Sending..." : "Send offer"}
              </button>
            </div>
            {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
          </form>
        </section>
      </div>
    </main>
  );
}
