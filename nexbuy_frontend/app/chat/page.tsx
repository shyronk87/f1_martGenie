"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import {
  createChatSession,
  type ChatMessage,
  type PlanOption,
  sendChatMessage,
  subscribeChatStream,
  type TimelineEvent,
} from "@/lib/chat-api";

type FriendlyEvent = {
  title: string;
  detail: string;
};

function buildFriendlyEvent(event: TimelineEvent): FriendlyEvent {
  const type = event.type.toLowerCase();

  if (type.includes("scan") || type.includes("collect")) {
    return {
      title: "正在收集可选商品",
      detail: event.message,
    };
  }

  if (type.includes("price") || type.includes("budget")) {
    return {
      title: "正在核对预算",
      detail: event.message,
    };
  }

  if (type.includes("plan") || type.includes("ready")) {
    return {
      title: "正在整理推荐方案",
      detail: event.message,
    };
  }

  if (type.includes("message") || type.includes("response")) {
    return {
      title: "正在生成回复",
      detail: event.message,
    };
  }

  if (type.includes("error")) {
    return {
      title: "流程中断",
      detail: event.message,
    };
  }

  return {
    title: "正在处理需求",
    detail: event.message,
  };
}


export default function ChatWorkspacePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("Preparing workspace...");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamText, setStreamText] = useState("");
  const streamTextRef = useRef("");
  const unsubscribeRef = useRef<(() => void) | null>(null);

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
        const createdSessionId = await createChatSession();
        if (unmounted) {
          return;
        }
        setSessionId(createdSessionId);
        setStatus("Workspace ready. Tell me your room, style, and budget.");
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
  const activePlan =
    plans.find((plan) => plan.id === activePlanId) ??
    (plans.length > 0 ? plans[0] : null);

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
                  <p>{message.content}</p>
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
              <h2 className="mt-1 text-lg font-semibold">Thinking and execution</h2>
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

          <div className="mt-4 space-y-2 rounded-2xl border border-[#dfd8cb] bg-[#f8f5ef] p-3">
            <p className="text-xs text-slate-600">
              Live logs from <code>user_content_analysis</code> and <code>query_data</code> are shown below.
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-[#dfd8cb] bg-[#fbfaf7] p-3">
            <h3 className="text-sm font-semibold text-[#6d5d49]">Live execution log</h3>
            <div className="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              {timelinePreview.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#d9d2c5] px-3 py-3 text-xs text-slate-500">
                  After you send a message, real backend steps will appear here.
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

          <div className="mt-4 rounded-2xl border border-[#dfd8cb] bg-[#f8f5ef] p-3">
            <h3 className="text-sm font-semibold text-[#6d5d49]">Search results</h3>
            <div className="mt-2 max-h-[32vh] space-y-3 overflow-y-auto pr-1">
              {plans.length === 0 ? (
                <p className="text-xs text-slate-500">No result bundle yet.</p>
              ) : (
                <>
                  {plans.length > 1 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {plans.map((plan) => (
                        <button
                          className={`rounded-full border px-3 py-1 text-xs ${
                            (activePlan?.id ?? plans[0].id) === plan.id
                              ? "border-[#2f6fa3] bg-[#e6f2fb] text-[#21537b]"
                              : "border-[#d4cdbf] bg-white text-slate-600"
                          }`}
                          key={plan.id}
                          onClick={() => setActivePlanId(plan.id)}
                          type="button"
                        >
                          {plan.title}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {activePlan ? (
                    <>
                      <article className="rounded-xl border border-[#e5dfd3] bg-white p-3">
                        <p className="text-sm font-medium text-slate-800">{activePlan.title}</p>
                        <p className="mt-1 text-xs text-slate-600">{activePlan.summary}</p>
                        {activePlan.explanation ? (
                          <p className="mt-2 rounded-lg border border-[#e5dfd3] bg-[#fcfbf8] p-2 text-xs text-slate-700">
                            {activePlan.explanation}
                          </p>
                        ) : null}
                        <p className="mt-2 text-xs text-[#3f5970]">
                          Total: ${activePlan.totalPrice.toLocaleString()} | Confidence:{" "}
                          {Math.round(activePlan.confidence * 100)}%
                        </p>
                      </article>
                      <div className="grid gap-2">
                        {activePlan.items.map((item) => (
                          <article className="rounded-xl border border-[#e5dfd3] bg-white p-2" key={item.sku}>
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                alt={item.title}
                                className="h-28 w-full rounded-lg border border-slate-200 object-cover"
                                src={item.imageUrl}
                              />
                            ) : null}
                            <p className="mt-2 text-xs font-semibold text-slate-800">{item.title}</p>
                            <div className="mt-1 flex items-center justify-between">
                              <p className="text-xs font-semibold text-slate-900">
                                ${item.price.toLocaleString()}
                              </p>
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
                          </article>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
