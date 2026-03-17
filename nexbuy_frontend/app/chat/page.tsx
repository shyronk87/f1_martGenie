"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import {
  createChatSession,
  fetchChatSessionDump,
  type ChatMessage,
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
import AuthModal from "@/src/components/AuthModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

type FriendlyEvent = {
  title: string;
  detail: string;
};

type SavedWorkspaceState = {
  sessionId: string | null;
  messages: ChatMessage[];
  timeline: TimelineEvent[];
  plans: PlanOption[];
  packageSnapshots?: Record<string, PlanOption[]>;
  activePlanId: string | null;
  status: string;
};

type DraftAttachment = {
  id: string;
  name: string;
  sizeLabel: string;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";
const CHAT_HISTORY_REFRESH_EVENT = "nexbuy.chat.history.updated";
const LEGACY_AI_STATUS = "AI is analyzing your request...";
const AGENT_ANALYZING_STATUS = "Agent is analyzing your request...";
const STARTER_PROMPTS = [
  {
    title: "Example brief",
    description:
      "Modern minimalist living room furniture with a $5000 budget.",
    prompt:
      "I have a budget of $5000 for modern minimalist living room furniture. I mainly need a sectional sofa and a solid wood coffee table. I have a Golden Retriever, so the fabric needs to be scratch-resistant.",
    highlights: ["Sectional sofa", "Solid wood coffee table", "Scratch-resistant fabric"],
  },
];

function buildFriendlyEvent(event: TimelineEvent): FriendlyEvent {
  const type = event.type.toLowerCase();
  const rawMessage = event.message.trim();
  const message = rawMessage.toLowerCase();

  if (message.includes("task accepted and dispatched")) {
    return {
      title: "Request received",
      detail: "Your request is in the queue and the agent has started working on it.",
    };
  }

  if (type === "scan_started") {
    return {
      title: "Understanding your request",
      detail: "The agent is reading your brief and identifying the key items, budget, and style.",
    };
  }

  if (type === "scan_progress") {
    if (message.includes("long-term memory")) {
      return {
        title: "Checking your preferences",
        detail: "The agent is looking at your saved shopping preferences to guide the search.",
      };
    }
    if (message.includes("structured fields extracted")) {
      return {
        title: "Brief understood",
        detail: "Your room, budget, and must-have items have been turned into a structured shopping brief.",
      };
    }
    if (message.includes("sending request to requirement-analysis model")) {
      return {
        title: "Understanding your request",
        detail: "The agent is turning your message into a clear shopping plan.",
      };
    }
    if (message.includes("searching product catalog")) {
      return {
        title: "Searching products",
        detail: "The catalog is being searched for products that match your request.",
      };
    }
    if (message.includes("query_data") || message.includes("database") || message.includes("search")) {
      return {
        title: "Searching products",
        detail: "Matching products are being gathered and ranked.",
      };
    }
    if (message.includes("bundle_composer")) {
      return {
        title: "Building packages",
        detail: "The agent is turning the matched products into a few package options.",
      };
    }
    if (message.includes("analysis")) {
      return {
        title: "Understanding your request",
        detail: "The agent is refining what matters most in your brief.",
      };
    }
    return {
      title: "Working on your request",
      detail: "The agent is moving to the next step.",
    };
  }

  if (type === "candidate_found") {
    return {
      title: "Products found",
      detail: rawMessage.match(/\d+/)
        ? `The search found ${rawMessage.match(/\d+/)?.[0]} relevant products to consider.`
        : "The search found a set of relevant products to consider.",
    };
  }

  if (type === "bundle_built") {
    return {
      title: "Building packages",
      detail: message.includes("generated")
        ? "The package options are ready to review."
        : "The agent is combining the best matches into a few package options.",
    };
  }

  if (type === "plan_ready") {
    return {
      title: "Packages ready",
      detail: "Your package options are ready to open and compare.",
    };
  }

  if (type === "done") {
    return {
      title: "Done",
      detail: "The recommendation process is complete.",
    };
  }

  if (type.includes("error")) {
    return {
      title: "Something went wrong",
      detail: rawMessage,
    };
  }

  return {
    title: "Update",
    detail: "The agent is progressing through another step.",
  };
}

function shouldDisplayTimelineEvent(event: TimelineEvent) {
  const message = event.message.toLowerCase();

  if (
    message.startsWith("[query_data]") ||
    message.startsWith("[user_content_analysis]") ||
    message.startsWith("[bundle_composer]") ||
    message.includes("llm provider=") ||
    message.includes("client initialized") ||
    message.includes("json parsed") ||
    message.includes("done in ") ||
    message.includes("filters summary") ||
    message.includes("valid options=") ||
    message.includes("guard dropped") ||
    message.includes("input candidates=") ||
    message.includes("memory loaded but no default field was applied") ||
    message.includes("long memory loaded") ||
    message.includes("compacted messages=") ||
    message.includes("matched products=") ||
    message.includes("db query finished") ||
    message.includes("filters built")
  ) {
    return false;
  }

  return true;
}

function normalizeStatus(status: string) {
  return status === LEGACY_AI_STATUS ? AGENT_ANALYZING_STATUS : status;
}

function normalizeWorkspace(raw: SavedWorkspaceState | null) {
  if (!raw) {
    return null;
  }

  return {
    sessionId: raw.sessionId ?? null,
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    plans: Array.isArray(raw.plans) ? raw.plans : [],
    packageSnapshots:
      raw.packageSnapshots && typeof raw.packageSnapshots === "object" ? raw.packageSnapshots : {},
    activePlanId: raw.activePlanId ?? null,
    status: typeof raw.status === "string" ? raw.status : "Preparing workspace...",
  } satisfies SavedWorkspaceState;
}

function clearSavedWorkspace() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

function notifyHistoryRefresh() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(CHAT_HISTORY_REFRESH_EVENT));
}


export default function ChatWorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const [isWorkspaceHydrated, setIsWorkspaceHydrated] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [packageSnapshots, setPackageSnapshots] = useState<Record<string, PlanOption[]>>({});
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingQuestions, setOnboardingQuestions] = useState<OnboardingQuestion[]>([]);
  const [onboardingAnswers, setOnboardingAnswers] = useState<Record<string, string | string[]>>({});
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [openAttachmentMenu, setOpenAttachmentMenu] = useState<"hero" | "composer" | null>(null);
  const [status, setStatus] = useState("Preparing workspace...");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [runElapsedSec, setRunElapsedSec] = useState(0);
  const [streamText, setStreamText] = useState("");
  const streamTextRef = useRef("");
  const heroTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const heroFileInputRef = useRef<HTMLInputElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const heroImageInputRef = useRef<HTMLInputElement | null>(null);
  const composerImageInputRef = useRef<HTMLInputElement | null>(null);
  const plansRef = useRef<PlanOption[]>([]);
  const packageSnapshotIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const runStartRef = useRef<number | null>(null);
  const restoredWorkspaceRef = useRef(false);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
      const restoredWorkspace = normalizeWorkspace(
        raw ? (JSON.parse(raw) as SavedWorkspaceState) : null,
      );

      if (restoredWorkspace) {
        setSessionId(restoredWorkspace.sessionId);
        setMessages(restoredWorkspace.messages);
        setTimeline(restoredWorkspace.timeline);
        setPlans(restoredWorkspace.plans);
        setPackageSnapshots(restoredWorkspace.packageSnapshots ?? {});
        setActivePlanId(restoredWorkspace.activePlanId);
        setStatus(normalizeStatus(restoredWorkspace.status));
        plansRef.current = restoredWorkspace.plans;
        restoredWorkspaceRef.current = Boolean(
          restoredWorkspace.sessionId ||
            restoredWorkspace.messages.length ||
            restoredWorkspace.timeline.length ||
            restoredWorkspace.plans.length,
        );
      }
    } catch {
      clearSavedWorkspace();
    } finally {
      setIsWorkspaceHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isWorkspaceHydrated || !requestedSessionId) {
      return;
    }

    const token = readAccessToken();
    if (!token) {
      return;
    }

    let cancelled = false;

    void fetchChatSessionDump(requestedSessionId)
      .then((dump) => {
        if (cancelled) {
          return;
        }
        setSessionId(dump.session_id);
        setMessages(dump.messages);
        setTimeline([]);
        setPlans(dump.plans);
        setPackageSnapshots(dump.packageSnapshots ?? {});
        setActivePlanId(dump.plans[0]?.id ?? null);
        setStatus("Workspace restored.");
        setError("");
        restoredWorkspaceRef.current = true;
        plansRef.current = dump.plans;
      })
      .catch((sessionError) => {
        if (cancelled) {
          return;
        }
        setError(sessionError instanceof Error ? sessionError.message : "Could not restore chat session.");
      });

    return () => {
      cancelled = true;
    };
  }, [isWorkspaceHydrated, requestedSessionId]);

  useEffect(() => {
    if (!isWorkspaceHydrated || typeof window === "undefined") {
      return;
    }

    const payload: SavedWorkspaceState = {
      sessionId,
      messages,
      timeline,
      plans,
      packageSnapshots,
      activePlanId,
      status,
    };

    window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  }, [activePlanId, isWorkspaceHydrated, messages, packageSnapshots, plans, sessionId, status, timeline]);

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
    if (!openAttachmentMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!attachmentMenuRef.current?.contains(event.target as Node)) {
        setOpenAttachmentMenu(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [openAttachmentMenu]);

  useEffect(() => {
    resizeComposer(heroTextareaRef.current);
    resizeComposer(composerTextareaRef.current);
  }, [prompt]);

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
          if (sessionId) {
            if (unmounted) {
              return;
            }
            setStatus((current) =>
              current && current !== "Preparing workspace..."
                ? current
                : restoredWorkspaceRef.current
                  ? "Workspace restored."
                  : "Workspace ready. Tell me your room, style, and budget.",
            );
            return;
          }
          if (requestedSessionId) {
            setStatus("Restoring saved workspace...");
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
  }, [bootstrapNonce, isWorkspaceHydrated, requestedSessionId, sessionId]);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || !sessionId || isSending) {
      return;
    }

    setPrompt("");
    setDraftAttachments([]);
    setError("");
    setIsSending(true);
    setStreamText("");
    streamTextRef.current = "";
    setStatus(AGENT_ANALYZING_STATUS);
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
      notifyHistoryRefresh();
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
          if (eventPayload.snapshotId) {
            setPackageSnapshots((current) => ({
              ...current,
              [eventPayload.snapshotId as string]: eventPayload.plans,
            }));
          }
          packageSnapshotIdRef.current = eventPayload.snapshotId ?? null;
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
                packageSnapshotId:
                  plansRef.current.length > 0 ? packageSnapshotIdRef.current ?? undefined : undefined,
              },
            ]);
          }
          setStreamText("");
          streamTextRef.current = "";
          setIsSending(false);
          setStatus("Done. You can refine requirements or ask for alternatives.");
          notifyHistoryRefresh();
          if (plansRef.current.length > 0) {
            window.setTimeout(() => {
              router.push(
                packageSnapshotIdRef.current
                  ? `/recommendations?snapshot=${encodeURIComponent(packageSnapshotIdRef.current)}`
                  : "/recommendations",
              );
            }, 180);
          }
        }
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Could not send message.";
      if (message.includes("Chat session not found")) {
        clearSavedWorkspace();
        setSessionId(null);
        setMessages([]);
        setTimeline([]);
        setPlans([]);
        setPackageSnapshots({});
        setActivePlanId(null);
        setPrompt(content);
        setError("Your previous chat expired after the backend restarted. A new workspace is being prepared.");
        setStatus("Preparing a new workspace...");
        setIsSending(false);
        setBootstrapNonce((current) => current + 1);
        return;
      }
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

  function resizeComposer(textarea: HTMLTextAreaElement | null) {
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const maxHeight = textarea.dataset.variant === "hero" ? 180 : 220;
    const minHeight = textarea.dataset.variant === "hero" ? 24 : 40;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, minHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function handlePromptChange(value: string, textarea: HTMLTextAreaElement | null) {
    setPrompt(value);
    resizeComposer(textarea);
  }

  function openAttachmentPicker(which: "hero" | "composer", kind: "image" | "file") {
    setOpenAttachmentMenu(null);

    if (which === "hero") {
      if (kind === "image") {
        heroImageInputRef.current?.click();
        return;
      }
      heroFileInputRef.current?.click();
      return;
    }

    if (kind === "image") {
      composerImageInputRef.current?.click();
      return;
    }
    composerFileInputRef.current?.click();
  }

  function formatFileSize(size: number) {
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
      return `${Math.round(size / 1024)} KB`;
    }
    return `${size} B`;
  }

  function handleAttachmentChange(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    const nextFiles = Array.from(files).map((file) => ({
      id: `file-${crypto.randomUUID()}`,
      name: file.name,
      sizeLabel: formatFileSize(file.size),
    }));

    setDraftAttachments((current) => [...current, ...nextFiles]);
  }

  function removeAttachment(attachmentId: string) {
    setDraftAttachments((current) => current.filter((item) => item.id !== attachmentId));
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

  const renderedMessages = isSending
    ? [
        ...messages,
        {
          id: "assistant-draft",
          role: "assistant" as const,
          content: streamText || AGENT_ANALYZING_STATUS,
          createdAt: new Date().toISOString(),
        },
      ]
    : messages;
  const displayedTimeline = useMemo(() => {
    const visible = timeline
      .filter(shouldDisplayTimelineEvent)
      .map((event) => ({
        event,
        friendly: buildFriendlyEvent(event),
      }));

    const deduped: Array<{ event: TimelineEvent; friendly: FriendlyEvent }> = [];
    const seen = new Set<string>();

    for (const item of visible) {
      const key = item.friendly.title;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(item);
    }

    return deduped;
  }, [timeline]);
  const hasConversation = renderedMessages.length > 0;
  function applyPromptSuggestion(value: string) {
    setPrompt(value);
    window.requestAnimationFrame(() => {
      resizeComposer(heroTextareaRef.current);
      resizeComposer(composerTextareaRef.current);
    });
  }

  function renderComposer(which: "hero" | "composer") {
    const textareaRef = which === "hero" ? heroTextareaRef : composerTextareaRef;
    const fileInputRef = which === "hero" ? heroFileInputRef : composerFileInputRef;
    const placeholder =
      which === "hero"
        ? "Ask anything about the room, style, budget, and must-have pieces..."
        : "Refine the brief, add another room, or ask for a different mix...";
    const wrapperClass =
      which === "hero"
        ? "mt-8 w-full rounded-[32px] border border-[#d9e0ea] bg-white px-5 py-1.5 shadow-[0_18px_45px_rgba(148,163,184,0.12)]"
        : "mx-auto w-full max-w-[760px] rounded-[28px] border border-[#d7dee8] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-2 shadow-[0_12px_36px_rgba(148,163,184,0.12)]";
    const textareaClass =
      which === "hero"
        ? "max-h-[180px] min-h-[24px] w-full resize-none border-none bg-transparent px-1 py-0 text-[15px] leading-6 text-[#111827] outline-none placeholder:text-[#98a2b3]"
        : "max-h-[220px] min-h-[40px] w-full resize-none border-none bg-transparent px-1 py-0.5 text-[15px] leading-6 text-[#111827] outline-none placeholder:text-[#98a2b3]";
    const toolbarClass =
      which === "hero"
        ? "mt-1 flex items-center justify-between gap-3"
        : "mt-2 flex items-center justify-between gap-3";

    return (
      <div className={wrapperClass}>
        <form onSubmit={handleSend}>
          <input
            className="hidden"
            multiple
            onChange={(event) => {
              handleAttachmentChange(event.target.files);
              event.currentTarget.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <input
            accept="image/*"
            className="hidden"
            multiple
            onChange={(event) => {
              handleAttachmentChange(event.target.files);
              event.currentTarget.value = "";
            }}
            ref={which === "hero" ? heroImageInputRef : composerImageInputRef}
            type="file"
          />
          <textarea
            className={textareaClass}
            data-variant={which}
            disabled={!sessionId || isSending}
            onChange={(event) => handlePromptChange(event.target.value, textareaRef.current)}
            placeholder={placeholder}
            ref={textareaRef}
            rows={1}
            style={{ fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif" }}
            value={prompt}
          />

          {draftAttachments.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {draftAttachments.map((attachment) => (
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-[#d7dee8] bg-[#f8fafc] px-3 py-1 text-xs text-[#475467]"
                  key={attachment.id}
                >
                  <span className="truncate">{attachment.name}</span>
                  <span className="text-[#98a2b3]">{attachment.sizeLabel}</span>
                  <button
                    className="text-[#98a2b3] transition hover:text-[#111827]"
                    onClick={() => removeAttachment(attachment.id)}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className={toolbarClass}>
            <div className="relative flex items-center gap-2" ref={openAttachmentMenu === which ? attachmentMenuRef : null}>
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#d7dee8] bg-white text-xl text-[#344054] transition hover:border-[#bfd4ec] hover:bg-[#f7fbff]"
                onClick={() => setOpenAttachmentMenu((current) => (current === which ? null : which))}
                type="button"
              >
                +
              </button>
              {openAttachmentMenu === which ? (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-2xl border border-[#d7dee8] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
                  <button
                    className="block w-full px-4 py-3 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f8fbff]"
                    onClick={() => openAttachmentPicker(which, "image")}
                    type="button"
                  >
                    Add image
                  </button>
                  <button
                    className="block w-full border-t border-[#eef2f6] px-4 py-3 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f8fbff]"
                    onClick={() => openAttachmentPicker(which, "file")}
                    type="button"
                  >
                    Add file
                  </button>
                </div>
              ) : null}
            </div>

            <button
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-lg text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition ${
                isSending
                  ? "bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] hover:brightness-105"
                  : "bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] hover:brightness-105 disabled:cursor-not-allowed disabled:bg-[#b7c8d8] disabled:text-slate-200"
              }`}
              disabled={!isSending && (!sessionId || (!prompt.trim() && draftAttachments.length === 0))}
              onClick={isSending ? handleCancel : undefined}
              type={isSending ? "button" : "submit"}
            >
              {isSending ? <span className="h-3.5 w-3.5 rounded-[3px] bg-white" /> : "↑"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  function handleNewConversation() {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    clearSavedWorkspace();
    setMessages([]);
    setTimeline([]);
    setPlans([]);
    setPackageSnapshots({});
    setActivePlanId(null);
    setPrompt("");
    setError("");
    setStreamText("");
    streamTextRef.current = "";
    setIsSending(false);
    setSessionId(null);
    setStatus("Preparing workspace...");
    restoredWorkspaceRef.current = false;
    setBootstrapNonce((current) => current + 1);
  }

  return (
    <WorkspaceShell
      currentPath="/chat"
      currentSessionId={requestedSessionId ?? sessionId}
      isAuthenticated={isAuthenticated}
      onOpenAuth={() => setAuthOpen(true)}
      onSignOut={() => {
        clearSavedWorkspace();
        clearAccessToken();
        setIsAuthenticated(false);
        router.push("/");
      }}
      onNewConversation={handleNewConversation}
    >
      <div className="h-full lg:grid lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-0 flex-col border-b border-[#e2e8f0] lg:border-b-0 lg:border-r">
            <div
              className={`flex-1 overflow-y-auto px-5 py-5 md:px-6 ${
                hasConversation ? "space-y-6" : "flex flex-col items-center justify-center"
              }`}
            >
              {!hasConversation ? (
                <div className="flex w-full max-w-[720px] flex-1 flex-col items-center justify-center px-3 pb-8 pt-4 text-center">
                  <h2
                    className="max-w-[640px] text-[34px] font-normal leading-[1.14] tracking-[-0.05em] text-[#111827] md:text-[44px]"
                    style={{ fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif" }}
                  >
                    Describe what you want to buy.
                  </h2>
                  <p className="mt-4 max-w-[500px] text-sm leading-7 text-[#667085] md:text-[15px]">
                    Include the room, style, budget, and must-have pieces. The agent will search products and build packages while the log runs on the right.
                  </p>

                  {renderComposer("hero")}

                  <div className="mt-5 flex max-w-[760px] flex-wrap justify-center gap-2">
                    {STARTER_PROMPTS.map((suggestion) => (
                      <button
                        className="w-full max-w-[760px] rounded-[24px] border border-[#dde5ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-4 text-left transition hover:border-[#bfd4ec] hover:bg-[#f7fbff] hover:shadow-[0_14px_34px_rgba(148,163,184,0.12)]"
                        key={suggestion.prompt}
                        onClick={() => applyPromptSuggestion(suggestion.prompt)}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">
                              {suggestion.title}
                            </p>
                            <p className="mt-2 text-sm font-medium text-[#101828]">
                              {suggestion.description}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm text-[#98a2b3]">↗</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {suggestion.highlights.map((highlight) => (
                            <span
                              className="rounded-full border border-[#d8e2ec] bg-white px-3 py-1 text-[11px] text-[#667085]"
                              key={highlight}
                            >
                              {highlight}
                            </span>
                          ))}
                        </div>
                        <p className="mt-3 line-clamp-2 text-xs leading-6 text-[#667085]">
                          {suggestion.prompt}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                renderedMessages.map((message) => (
                  <article
                    className={`mx-auto w-full max-w-[760px] text-sm leading-8 text-[#111827] md:text-[15px] ${
                      message.role === "user"
                        ? "flex justify-end"
                        : "block"
                    }`}
                    key={message.id}
                    style={{ fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif" }}
                  >
                    {message.role === "user" ? (
                      <div className="max-w-[72%] rounded-[22px] bg-[#f1f1f1] px-4 py-3 text-[#111827]">
                        <p>{message.content}</p>
                      </div>
                    ) : (
                      <div className="max-w-none text-[#1f2937]">
                        <p>
                          {message.content}
                          {message.id === "assistant-draft" && isSending ? (
                            <span className="ml-2 text-xs text-[#98a2b3]">({runElapsedSec}s)</span>
                          ) : null}
                        </p>
                      </div>
                    )}
                    {message.role === "assistant" && message.packageSnapshotId ? (
                      <button
                        className="mt-4 inline-flex items-center rounded-full border border-[#d6e4f5] bg-white px-3 py-1.5 text-xs font-semibold text-[#1f4f78] transition hover:border-[#bfd4ec] hover:bg-[#eef6ff]"
                        onClick={() =>
                          router.push(
                            `/recommendations?snapshot=${encodeURIComponent(message.packageSnapshotId as string)}`,
                          )
                        }
                        type="button"
                      >
                        View packages
                      </button>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            {hasConversation ? (
              <div className="px-5 py-4 md:px-6">
                {renderComposer("composer")}
                {error ? <p className="mt-2 text-sm text-[#be123c]">{error}</p> : null}
              </div>
            ) : error ? (
              <div className="border-t border-[#e2e8f0] px-5 py-4 md:px-6">
                <p className="text-sm text-[#be123c]">{error}</p>
              </div>
            ) : null}
          </section>

        <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
            <div className="flex items-center justify-between border-b border-[#dce4ee] px-5 py-4 md:px-5">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#8b97a8]">Agent Process</p>
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

            <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] px-3 pb-3 pt-3">
              <div className="h-full space-y-2 overflow-y-auto pr-1">
                {displayedTimeline.length === 0 ? (
                  <p className="border border-dashed border-[#dbe3ed] bg-white/70 px-3 py-3 text-xs text-[#667085]">
                    You will see simple progress updates here after you send a request.
                  </p>
                ) : (
                  displayedTimeline.map(({ event, friendly }) => {
                    return (
                      <article className="border border-[#e4eaf1] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-3 py-3 shadow-[0_8px_22px_rgba(148,163,184,0.08)]" key={event.id}>
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
    </WorkspaceShell>
  );
}
