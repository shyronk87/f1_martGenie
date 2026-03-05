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

type StepState = "done" | "active" | "pending";

type FriendlyEvent = {
  title: string;
  detail: string;
};

function buildFriendlyEvent(event: TimelineEvent): FriendlyEvent {
  const type = event.type.toLowerCase();

  if (type.includes("scan") || type.includes("collect")) {
    return {
      title: "正在收集可选商品",
      detail: "AI 正在对比不同商品，筛掉不符合预算或风格的选项。",
    };
  }

  if (type.includes("price") || type.includes("budget")) {
    return {
      title: "正在核对预算",
      detail: "AI 正在确认总价是否在你设定的预算范围内。",
    };
  }

  if (type.includes("plan") || type.includes("ready")) {
    return {
      title: "正在整理推荐方案",
      detail: "AI 正在把候选商品组合成几套可执行的购买方案。",
    };
  }

  if (type.includes("message") || type.includes("response")) {
    return {
      title: "正在生成回复",
      detail: "AI 正在用更容易理解的方式总结给你。",
    };
  }

  if (type.includes("error")) {
    return {
      title: "流程中断",
      detail: "本次处理遇到异常，需要你重试或补充需求。",
    };
  }

  return {
    title: "正在处理需求",
    detail: "AI 正在继续分析你的输入并推进下一步。",
  };
}

function getStepStates(
  hasUserMessage: boolean,
  hasTimeline: boolean,
  hasPlans: boolean,
  isSending: boolean,
): { understand: StepState; match: StepState; assemble: StepState; reply: StepState } {
  if (!hasUserMessage) {
    return {
      understand: "pending",
      match: "pending",
      assemble: "pending",
      reply: "pending",
    };
  }

  if (hasPlans && !isSending) {
    return {
      understand: "done",
      match: "done",
      assemble: "done",
      reply: "done",
    };
  }

  if (hasTimeline) {
    return {
      understand: "done",
      match: "active",
      assemble: isSending ? "active" : "done",
      reply: isSending ? "pending" : "done",
    };
  }

  return {
    understand: "active",
    match: "pending",
    assemble: "pending",
    reply: "pending",
  };
}

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return <span className="inline-flex h-3 w-3 rounded-full bg-emerald-400" />;
  }
  if (state === "active") {
    return <span className="inline-flex h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />;
  }
  return <span className="inline-flex h-3 w-3 rounded-full bg-slate-500" />;
}

export default function ChatWorkspacePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
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

  const hasUserMessage = messages.some((message) => message.role === "user");
  const stepStates = getStepStates(hasUserMessage, timeline.length > 0, plans.length > 0, isSending);
  const timelinePreview = timeline.slice(0, 8);

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
            <div className="flex items-center gap-3 rounded-xl px-2 py-2">
              <StepDot state={stepStates.understand} />
              <div>
                <p className="text-sm font-medium">1) Understand your request</p>
                <p className="text-xs text-slate-500">Extract room, budget, style, and must-haves.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl px-2 py-2">
              <StepDot state={stepStates.match} />
              <div>
                <p className="text-sm font-medium">2) Match products</p>
                <p className="text-xs text-slate-500">Filter catalog and remove low-fit products.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl px-2 py-2">
              <StepDot state={stepStates.assemble} />
              <div>
                <p className="text-sm font-medium">3) Build bundles</p>
                <p className="text-xs text-slate-500">Combine products into practical purchase options.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl px-2 py-2">
              <StepDot state={stepStates.reply} />
              <div>
                <p className="text-sm font-medium">4) Explain recommendation</p>
                <p className="text-xs text-slate-500">Reply in clear language and tradeoffs.</p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-[#dfd8cb] bg-[#fbfaf7] p-3">
            <h3 className="text-sm font-semibold text-[#6d5d49]">Live execution log (human readable)</h3>
            <div className="mt-3 max-h-[36vh] space-y-2 overflow-y-auto pr-1">
              {timelinePreview.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#d9d2c5] px-3 py-3 text-xs text-slate-500">
                  After you send a message, this panel will explain each step in plain language.
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
            <h3 className="text-sm font-semibold text-[#6d5d49]">Plan summary</h3>
            <div className="mt-2 space-y-2">
              {plans.length === 0 ? (
                <p className="text-xs text-slate-500">No plan generated yet.</p>
              ) : (
                plans.slice(0, 3).map((plan) => (
                  <article className="rounded-xl border border-[#e5dfd3] bg-white p-3" key={plan.id}>
                    <p className="text-sm font-medium text-slate-800">{plan.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{plan.summary}</p>
                    <p className="mt-2 text-xs text-[#3f5970]">
                      Total: ${plan.totalPrice.toLocaleString()} | Confidence:{" "}
                      {Math.round(plan.confidence * 100)}%
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
