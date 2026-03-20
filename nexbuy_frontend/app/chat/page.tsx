"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  clearAccessToken,
  fetchCurrentUser,
  isUnauthorizedAuthError,
  logoutSession,
  readAccessToken,
} from "@/lib/auth";
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
  createFavoriteBundle,
  createFavoriteProduct,
  deleteFavoriteBundle,
  deleteFavoriteProduct,
  fetchFavoriteBundles,
  fetchFavoriteProducts,
} from "@/lib/favorites-api";
import { clearCurrentOrder, setOrderCheckout } from "@/lib/order-store";
import {
  buildMemoryPayloadFromAnswers,
  fetchMemoryProfile,
  fetchOnboardingQuestions,
  saveMemoryProfile,
  type OnboardingQuestion,
} from "@/lib/memory-api";
import { readSelectedProjectId, saveSelectedProjectId } from "@/lib/project-api";
import { shareBundleByEmail, shareProductByEmail } from "@/lib/share-api";
import AuthModal from "@/src/components/AuthModal";
import MemoryQuestionStepper from "@/src/components/MemoryQuestionStepper";
import ProductShareModal from "@/src/components/ProductShareModal";
import WorkspaceShell from "@/src/components/WorkspaceShell";

type FriendlyEvent = {
  title: string;
  detail: string;
};

type SavedWorkspaceState = {
  projectId?: string | null;
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

type MockNegotiationPlan = {
  id: string;
  title: string;
  items: Array<{
    sku: string;
    title: string;
    originalPrice: number;
    currentPrice: number;
    finalPrice: number;
  }>;
  rounds: Array<{
    label: string;
    buyerOffer: number;
    sellerCounter: number;
    buyerLine: string;
    sellerLine: string;
  }>;
  totalOriginalPrice: number;
  totalCurrentPrice: number;
  totalFinalPrice: number;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";
const CHAT_HISTORY_REFRESH_EVENT = "nexbuy.chat.history.updated";
const LEGACY_AI_STATUS = "AI is analyzing your request...";
const AGENT_ANALYZING_STATUS = "Working on it...";
const QUICK_FOCUS_TAGS = [
  { label: "Home & Furniture", icon: "🛋️" },
  { label: "Best Price", icon: "⚡" },
  { label: "Fast Shipping", icon: "🚚" },
];

const QUICK_QUERY_TAGS = [
  { label: "Warm bedside lamp under $180, soft ambient light", icon: "💡" },
  { label: "Mid-century walnut coffee table under $450", icon: "☕" },
];

const DISCOVERY_TAGS = [
  { label: "Home & Furniture", badge: "Live", active: true, icon: "🛋️" },
  { label: "Fashion", badge: "Soon", icon: "👟" },
  { label: "Electronics", badge: "Soon", icon: "💻" },
  { label: "Beauty", badge: "Soon", icon: "🧴" },
  { label: "Kitchen", badge: "Soon", icon: "🍳" },
  { label: "Gaming", badge: "Later", icon: "🎮" },
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
      projectId: raw.projectId ?? null,
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

function deriveListPrice(item: PlanOption["items"][number]) {
  if (typeof item.originalPrice === "number" && item.originalPrice > item.price) {
    return item.originalPrice;
  }

  const stableMarkup = 1.12 + ((item.sku.charCodeAt(item.sku.length - 1) || 0) % 6) * 0.02;
  return Math.round(item.price * stableMarkup * 100) / 100;
}

function buildSavingsMeta(originalPrice: number, currentPrice: number) {
  const safeOriginal = Math.max(originalPrice, currentPrice);
  const savedAmount = Math.max(safeOriginal - currentPrice, 0);
  const savedPercent = safeOriginal > 0 ? Math.round((savedAmount / safeOriginal) * 100) : 0;
  return {
    originalPrice: safeOriginal,
    currentPrice,
    savedAmount: Math.round(savedAmount * 100) / 100,
    savedPercent,
  };
}


function ChatWorkspacePageContent() {
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
  const [selectedFocusTags, setSelectedFocusTags] = useState<string[]>([]);
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [openAttachmentMenu, setOpenAttachmentMenu] = useState<"hero" | "composer" | null>(null);
  const [hoveredUserMessageId, setHoveredUserMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState("");
  const [embeddedExpandedPlanIds, setEmbeddedExpandedPlanIds] = useState<Record<string, string[]>>({});
  const [isResultsPanelOpen, setIsResultsPanelOpen] = useState(false);
  const [resultsPanelWidth, setResultsPanelWidth] = useState(760);
  const [favoriteBundleIdSet, setFavoriteBundleIdSet] = useState<Set<string>>(new Set());
  const [favoriteSkuSet, setFavoriteSkuSet] = useState<Set<string>>(new Set());
  const [isUpdatingFavoriteBundleId, setIsUpdatingFavoriteBundleId] = useState<string | null>(null);
  const [isUpdatingFavoriteSku, setIsUpdatingFavoriteSku] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<
    | { type: "product"; sku: string; title: string }
    | {
        type: "bundle";
        title: string;
        summary: string;
        totalPrice: number;
        items: Array<{ title: string; price: number }>;
      }
    | null
  >(null);
  const [mockNegotiationPlan, setMockNegotiationPlan] = useState<MockNegotiationPlan | null>(null);
  const [status, setStatus] = useState("Preparing workspace...");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [runElapsedSec, setRunElapsedSec] = useState(0);
  const [lastRunElapsedSec, setLastRunElapsedSec] = useState(0);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
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
  const isResizingResultsPanelRef = useRef(false);

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
        if (dump.project_id) {
          saveSelectedProjectId(dump.project_id);
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
        if (isUnauthorizedAuthError(sessionError)) {
          clearAccessToken();
          clearSavedWorkspace();
          setIsAuthenticated(false);
          setSessionId(null);
          setMessages([]);
          setTimeline([]);
          setPlans([]);
          setPackageSnapshots({});
          setActivePlanId(null);
          setError("");
          setStatus("Tell me your room, style, budget, and must-have pieces.");
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
      projectId: readSelectedProjectId() || null,
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

  const latestPackageSnapshotId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const snapshotId = messages[index]?.packageSnapshotId;
      if (snapshotId && packageSnapshots[snapshotId]) {
        return snapshotId;
      }
    }

    const fallbackSnapshotId = Object.keys(packageSnapshots).at(-1);
    return fallbackSnapshotId ?? null;
  }, [messages, packageSnapshots]);

  useEffect(() => {
    if (latestPackageSnapshotId) {
      setIsResultsPanelOpen(true);
      if (typeof window !== "undefined") {
        const preferredWidth = Math.round(window.innerWidth * 0.58);
        setResultsPanelWidth(Math.min(1040, Math.max(560, preferredWidth)));
      }
    }
  }, [latestPackageSnapshotId]);

  useEffect(() => {
    function handlePointerMove(event: MouseEvent) {
      if (!isResizingResultsPanelRef.current) {
        return;
      }

      const nextWidth = Math.min(1040, Math.max(560, window.innerWidth - event.clientX));
      setResultsPanelWidth(nextWidth);
    }

    function handlePointerUp() {
      if (!isResizingResultsPanelRef.current) {
        return;
      }
      isResizingResultsPanelRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, []);

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
        setStatus("Tell me your room, style, budget, and must-have pieces.");
        setError("");
        return;
      }

      try {
        setError("");
        await fetchCurrentUser(token);
        setIsAuthenticated(true);
        try {
          const [favoriteProducts, favoriteBundles] = await Promise.all([
            fetchFavoriteProducts(),
            fetchFavoriteBundles(),
          ]);
          if (unmounted) {
            return;
          }
          setFavoriteSkuSet(new Set(favoriteProducts.map((item) => item.sku_id_default)));
          setFavoriteBundleIdSet(new Set(favoriteBundles.map((item) => item.bundle_id)));
        } catch {
          if (unmounted) {
            return;
          }
          setFavoriteSkuSet(new Set());
          setFavoriteBundleIdSet(new Set());
        }
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
          const createdSessionId = await createChatSession(readSelectedProjectId() || undefined);
          if (unmounted) {
            return;
          }
          setSessionId(createdSessionId);
          notifyHistoryRefresh();
          setStatus("Workspace ready. Tell me your room, style, and budget.");
        }
      } catch (bootstrapError) {
        clearAccessToken();
        setIsAuthenticated(false);
        setFavoriteSkuSet(new Set());
        setFavoriteBundleIdSet(new Set());
        if (isUnauthorizedAuthError(bootstrapError)) {
          setError("");
          setStatus("Tell me your room, style, budget, and must-have pieces.");
          return;
        }
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

  function handleExpiredChatAuth(contentToRestore?: string) {
    clearAccessToken();
    setIsAuthenticated(false);
    setIsSending(false);
    setAuthOpen(true);
    setError("Your sign-in session expired. Please sign in again to continue.");
    setStatus("Sign back in to keep going.");

    if (contentToRestore) {
      setPrompt(contentToRestore);
      window.requestAnimationFrame(() => {
        resizeComposer(heroTextareaRef.current);
        resizeComposer(composerTextareaRef.current);
      });
    }
  }

  async function submitPrompt(content: string, options?: { replaceMessageId?: string | null }) {
    const token = readAccessToken();
    if (!token) {
      setAuthOpen(true);
      return;
    }

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      try {
        activeSessionId = await createChatSession(readSelectedProjectId() || undefined);
        setSessionId(activeSessionId);
        notifyHistoryRefresh();
      } catch (sessionError) {
        if (isUnauthorizedAuthError(sessionError)) {
          handleExpiredChatAuth(content);
          return;
        }
        const message =
          sessionError instanceof Error ? sessionError.message : "Could not create chat session.";
        setError(message);
        setStatus("Could not prepare a workspace.");
        return;
      }
    }

    const userMessageId = options?.replaceMessageId ?? `user-${crypto.randomUUID()}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setPrompt("");
    setDraftAttachments([]);
    setError("");
    setIsSending(true);
    setStreamText("");
    streamTextRef.current = "";
    setTimeline([]);
    setPlans([]);
    setPackageSnapshots({});
    setActivePlanId(null);
    setStatus(AGENT_ANALYZING_STATUS);
    setLastRunElapsedSec(0);
    setThinkingExpanded(false);
    packageSnapshotIdRef.current = null;
    plansRef.current = [];

    if (options?.replaceMessageId) {
      const targetIndex = messages.findIndex((message) => message.id === options.replaceMessageId);
      if (targetIndex >= 0) {
        setMessages([...messages.slice(0, targetIndex), userMessage]);
      } else {
        setMessages((current) => [...current, userMessage]);
      }
      setEditingMessageId(null);
      setEditingMessageContent("");
    } else {
      setMessages((current) => [...current, userMessage]);
    }

    try {
      const { taskId } = await sendChatMessage(activeSessionId, content);
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
      unsubscribeRef.current = subscribeChatStream(activeSessionId, taskId, (eventPayload) => {
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
          setLastRunElapsedSec(runElapsedSec);
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
          setLastRunElapsedSec(runElapsedSec);
          setIsSending(false);
          setStatus("Done. You can refine requirements or ask for alternatives.");
          notifyHistoryRefresh();
        }
      });
    } catch (sendError) {
      if (isUnauthorizedAuthError(sendError)) {
        handleExpiredChatAuth(content);
        return;
      }
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

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || isSending) {
      return;
    }

    await submitPrompt(content);
  }

  function handleCancel() {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setIsSending(false);
    setStreamText("");
    streamTextRef.current = "";
    setLastRunElapsedSec(runElapsedSec);
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

  async function handleSubmitOnboarding() {
    setIsSavingOnboarding(true);
    setError("");
    try {
      await saveMemoryProfile(buildMemoryPayloadFromAnswers(onboardingAnswers));

      const createdSessionId = await createChatSession(readSelectedProjectId() || undefined);
      setSessionId(createdSessionId);
      notifyHistoryRefresh();
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
          content: streamText,
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
  const latestCompletedAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") {
        return messages[index]?.id ?? null;
      }
    }
    return null;
  }, [messages]);
  const visibleThinkingSteps = thinkingExpanded ? displayedTimeline : displayedTimeline.slice(0, 1);
  const currentThinkingTitle =
    displayedTimeline.length === 0 ? "Working through your request" : displayedTimeline[0]?.friendly.title ?? "Working through your request";
  const thinkingSubtitle = isSending
    ? currentThinkingTitle
    : thinkingExpanded
      ? "Detailed steps shown below."
      : "Expand to view details.";

  function formatElapsed(seconds: number) {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  function iconForThinkingStep(title: string) {
    if (title.includes("Understanding") || title.includes("Brief understood")) {
      return "◔";
    }
    if (title.includes("Checking")) {
      return "◌";
    }
    if (title.includes("Searching") || title.includes("Products found")) {
      return "⌕";
    }
    if (title.includes("Building") || title.includes("Packages ready")) {
      return "◫";
    }
    if (title.includes("Done")) {
      return "✓";
    }
    if (title.includes("Something went wrong")) {
      return "!";
    }
    return "·";
  }

  function renderThinkingBlock() {
    if (!isSending && displayedTimeline.length === 0) {
      return null;
    }

    return (
      <article className="mx-auto w-full max-w-[760px]">
        <div className="overflow-hidden">
          <button
            className="flex w-full items-start justify-between gap-4 py-2 text-left transition"
            onClick={() => setThinkingExpanded((current) => !current)}
            type="button"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`bg-[linear-gradient(90deg,#0f172a_0%,#1f4f78_38%,#38bdf8_52%,#1f4f78_68%,#0f172a_100%)] bg-[length:220%_100%] bg-clip-text text-sm font-medium text-transparent ${
                        isSending ? "animate-[thinking-shimmer_2.8s_linear_infinite]" : ""
                      }`}
                    >
                      {isSending ? "Thinking" : "Thought through your request"}
                    </p>
                    {isSending ? (
                      <div className="flex items-center gap-1">
                        <span className="h-1 w-1 animate-pulse rounded-full bg-[#2f7dd3]" />
                        <span className="h-1 w-1 animate-pulse rounded-full bg-[#2f7dd3] [animation-delay:120ms]" />
                        <span className="h-1 w-1 animate-pulse rounded-full bg-[#2f7dd3] [animation-delay:240ms]" />
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-[#667085]">{thinkingSubtitle}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-0.5">
              <span className="text-xs font-medium text-[#98a2b3]">
                {isSending
                  ? formatElapsed(runElapsedSec)
                  : lastRunElapsedSec > 0
                    ? formatElapsed(lastRunElapsedSec)
                    : ""}
              </span>
              <span
                className={`inline-flex items-center justify-center text-[#98a2b3] transition ${thinkingExpanded ? "rotate-180" : ""}`}
              >
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <path
                    d="m6.75 9.75 5.25 5.25 5.25-5.25"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </span>
            </div>
          </button>

          <div className={`overflow-hidden transition-all duration-300 ${thinkingExpanded ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"}`}>
            <div className="pl-10 pr-1 pb-3">
              <div className="mb-2 h-px bg-[linear-gradient(90deg,rgba(217,225,235,0)_0%,rgba(217,225,235,0.95)_12%,rgba(217,225,235,0.95)_88%,rgba(217,225,235,0)_100%)]" />
              <div className="space-y-3">
              {visibleThinkingSteps.map(({ event, friendly }, index) => {
                const isLatest = index === 0;
                return (
                  <div className="flex items-start gap-3" key={event.id}>
                      <div className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[11px] font-semibold text-[#526072]">
                        <span>{iconForThinkingStep(friendly.title)}</span>
                        {isSending && isLatest ? (
                          <span className="absolute h-4 w-4 rounded-full border border-[#bfdbfe] animate-ping opacity-50" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-[#1f2937]">{friendly.title}</p>
                          <span className="text-[11px] text-[#98a2b3]">
                            {new Date(event.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm leading-6 text-[#667085]">{friendly.detail}</p>
                      </div>
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        </div>
      </article>
    );
  }

  function handleToggleEmbeddedPlan(snapshotId: string, planId: string) {
    setEmbeddedExpandedPlanIds((current) => {
      const currentExpanded = current[snapshotId] ?? [];
      const isExpanded = currentExpanded.includes(planId);
      return {
        ...current,
        [snapshotId]: isExpanded
          ? currentExpanded.filter((id) => id !== planId)
          : [...currentExpanded, planId],
      };
    });
  }

  function handleEmbeddedOrder(plan: PlanOption) {
    const subtotal = plan.items.reduce((sum, item) => sum + item.price, 0);
    setOrderCheckout({
      source: "package",
      packageId: plan.id,
      packageTitle: plan.title,
      summary: plan.explanation || plan.summary,
      items: plan.items.map((item) => ({
        sku: item.sku,
        title: item.title,
        price: item.price,
        quantity: 1,
        imageUrl: item.imageUrl ?? null,
      })),
      subtotal,
      negotiatedSavings: 0,
    });
    clearCurrentOrder();
    router.push("/order");
  }

  function handleOpenProductShare(item: PlanOption["items"][number]) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setShareTarget({
      type: "product",
      sku: item.sku,
      title: item.title,
    });
  }

  function handleOpenBundleShare(plan: PlanOption) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setShareTarget({
      type: "bundle",
      title: plan.title,
      summary: plan.explanation || plan.summary,
      totalPrice: plan.totalPrice,
      items: plan.items.map((item) => ({
        title: item.title,
        price: item.price,
      })),
    });
  }

  async function handleSubmitShare(recipientEmail: string) {
    if (!shareTarget) {
      return;
    }
    if (shareTarget.type === "product") {
      await shareProductByEmail({
        sku_id_default: shareTarget.sku,
        recipient_email: recipientEmail,
      });
      return;
    }

    await shareBundleByEmail({
      bundle_title: shareTarget.title,
      summary: shareTarget.summary,
      total_price: shareTarget.totalPrice,
      recipient_email: recipientEmail,
      items: shareTarget.items,
    });
  }

  async function handleToggleFavoriteProduct(item: PlanOption["items"][number]) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }

    setIsUpdatingFavoriteSku(item.sku);
    try {
      if (favoriteSkuSet.has(item.sku)) {
        await deleteFavoriteProduct(item.sku);
        setFavoriteSkuSet((current) => {
          const next = new Set(current);
          next.delete(item.sku);
          return next;
        });
      } else {
        await createFavoriteProduct({
          sku_id_default: item.sku,
          title: item.title,
          category_label: item.categoryLabel ?? null,
          sale_price: item.price,
          image_url: item.imageUrl ?? null,
          product_url: item.productUrl ?? null,
          description_text: item.description ?? null,
          recommendation_reason: item.reason,
          specs: item.specs ?? {},
          source_page: "chat",
        });
        setFavoriteSkuSet((current) => new Set([...current, item.sku]));
      }
    } finally {
      setIsUpdatingFavoriteSku(null);
    }
  }

  async function handleToggleFavoriteBundle(plan: PlanOption) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }

    setIsUpdatingFavoriteBundleId(plan.id);
    try {
      if (favoriteBundleIdSet.has(plan.id)) {
        await deleteFavoriteBundle(plan.id);
        setFavoriteBundleIdSet((current) => {
          const next = new Set(current);
          next.delete(plan.id);
          return next;
        });
      } else {
        await createFavoriteBundle({
          bundle_id: plan.id,
          title: plan.title,
          summary: plan.explanation || plan.summary,
          total_price: plan.totalPrice,
          source_session_id: sessionId,
          source_page: "chat",
          items: plan.items.map((item) => ({
            sku: item.sku,
            title: item.title,
            price: item.price,
            quantity: 1,
            imageUrl: item.imageUrl ?? null,
            categoryLabel: item.categoryLabel ?? null,
          })),
        });
        setFavoriteBundleIdSet((current) => new Set([...current, plan.id]));
      }
    } finally {
      setIsUpdatingFavoriteBundleId(null);
    }
  }

  function handleOpenMockNegotiation(plan: PlanOption) {
    const pricedItems = plan.items.map((item) => {
      const originalPrice = deriveListPrice(item);
      const currentPrice = item.price;
      return {
        sku: item.sku,
        title: item.title,
        originalPrice: Math.round(originalPrice * 100) / 100,
        currentPrice: Math.round(currentPrice * 100) / 100,
        finalPrice: Math.round(currentPrice * 100) / 100,
      };
    });

    const totalOriginalPrice = pricedItems.reduce((sum, item) => sum + item.originalPrice, 0);
    const totalCurrentPrice = pricedItems.reduce((sum, item) => sum + item.currentPrice, 0);
    const totalFinalPrice = pricedItems.reduce((sum, item) => sum + item.finalPrice, 0);
    const roundOneOffer = Math.round(totalCurrentPrice * 0.9 * 100) / 100;
    const roundOneCounter = Math.round(totalCurrentPrice * 1.08 * 100) / 100;
    const roundTwoOffer = Math.round(totalCurrentPrice * 0.95 * 100) / 100;
    const roundTwoCounter = Math.round(totalCurrentPrice * 1.03 * 100) / 100;
    const roundThreeOffer = Math.round(totalCurrentPrice * 100) / 100;

    setMockNegotiationPlan({
      id: plan.id,
      title: plan.title,
      items: pricedItems,
      rounds: [
        {
          label: "Round 1",
          buyerOffer: roundOneOffer,
          sellerCounter: roundOneCounter,
          buyerLine: "Buyer: I like this set, but I need a better number to move forward today.",
          sellerLine: "Seller: I can come down a little, but this is the best counter I can offer at this stage.",
        },
        {
          label: "Round 2",
          buyerOffer: roundTwoOffer,
          sellerCounter: roundTwoCounter,
          buyerLine: "Buyer: That is closer. If we tighten the bundle price a bit more, I can keep the whole set together.",
          sellerLine: "Seller: I reviewed the margin and can narrow the gap with this revised offer.",
        },
        {
          label: "Round 3",
          buyerOffer: roundThreeOffer,
          sellerCounter: totalFinalPrice,
          buyerLine: "Buyer: If you can confirm this final number, I am ready to place the order now.",
          sellerLine: "Seller: Confirmed. We can close the bundle at this final price.",
        },
      ],
      totalOriginalPrice: Math.round(totalOriginalPrice * 100) / 100,
      totalCurrentPrice: Math.round(totalCurrentPrice * 100) / 100,
      totalFinalPrice: Math.round(totalFinalPrice * 100) / 100,
    });
  }

  function renderResultsPanel(snapshotId: string) {
    const snapshotPlans = packageSnapshots[snapshotId];
    if (!snapshotPlans || snapshotPlans.length === 0) {
      return null;
    }
    const expandedPlanIds = embeddedExpandedPlanIds[snapshotId] ?? [snapshotPlans[0]?.id ?? ""];

    return (
      <section className="h-full overflow-y-auto border-l border-[#e2e8f0] bg-[linear-gradient(180deg,#fbfdff_0%,#f5f8fc_100%)]">
        <div className="border-b border-[#e8edf3] px-5 py-4">
          <div className="flex items-center gap-3 pl-10">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8b97a8]">
                Results
              </p>
              <h3 className="mt-2 text-lg font-bold tracking-[-0.03em] text-[#101828]">
                {snapshotPlans.length} package options ready
              </h3>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="space-y-3">
            {snapshotPlans.map((plan) => {
              const isExpanded = expandedPlanIds.includes(plan.id);
              const currentTotalPrice = Math.round(
                plan.items.reduce((sum, item) => sum + item.price, 0) * 100,
              ) / 100;
              const originalTotalPrice = Math.round(
                plan.items.reduce((sum, item) => sum + deriveListPrice(item), 0) * 100,
              ) / 100;
              const totalSavingsMeta = buildSavingsMeta(originalTotalPrice, currentTotalPrice);
              return (
                <div
                  className={`overflow-hidden rounded-[22px] border transition ${
                    isExpanded
                      ? "border-[#bfdbfe] bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)]"
                      : "border-[#e5ebf3] bg-white"
                  }`}
                  key={plan.id}
                >
                  <div className="flex items-start justify-between gap-4 px-4 py-4">
                    <button
                      className="min-w-0 flex-1 text-left transition hover:bg-[#f8fafc]/70"
                      onClick={() => handleToggleEmbeddedPlan(snapshotId, plan.id)}
                      type="button"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 max-w-[320px]">
                            <p className="text-sm font-semibold text-[#101828]">{plan.title}</p>
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#667085]">
                          {plan.explanation || plan.summary}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-start gap-3">
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          aria-label="Share bundle by email"
                          className="inline-flex h-9 w-9 items-center justify-center text-[20px] leading-none text-[#344054] transition hover:-translate-y-0.5 hover:text-[#101828]"
                          onClick={() => handleOpenBundleShare(plan)}
                          type="button"
                        >
                          ✉
                        </button>
                        <button
                          aria-label={favoriteBundleIdSet.has(plan.id) ? "Remove bundle from likes" : "Add bundle to likes"}
                          className={`inline-flex h-9 w-9 items-center justify-center text-[22px] leading-none transition ${
                            favoriteBundleIdSet.has(plan.id) ? "text-[#dc2626]" : "text-[#111827]"
                          }`}
                          disabled={isUpdatingFavoriteBundleId === plan.id}
                          onClick={() => void handleToggleFavoriteBundle(plan)}
                          type="button"
                        >
                          <span aria-hidden="true">{favoriteBundleIdSet.has(plan.id) ? "♥" : "♡"}</span>
                        </button>
                      </div>
                      <button
                        className="flex shrink-0 items-center gap-3 text-left"
                        onClick={() => handleToggleEmbeddedPlan(snapshotId, plan.id)}
                        type="button"
                      >
                        <div className="flex flex-col items-end">
                          <p className="text-xs font-medium text-[#98a2b3] line-through">
                            ${totalSavingsMeta.originalPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </p>
                          <div className="mt-1 rounded-full bg-[linear-gradient(180deg,#eff6ff_0%,#dbeafe_100%)] px-3.5 py-1.5 text-base font-black text-[#123b5f] shadow-[0_8px_20px_rgba(59,130,246,0.12)]">
                            ${totalSavingsMeta.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </div>
                          {totalSavingsMeta.savedAmount > 0 ? (
                            <p className="mt-1 text-xs font-semibold text-[#2563eb]">
                              You save ${totalSavingsMeta.savedAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`inline-flex items-center justify-center text-[#98a2b3] transition ${isExpanded ? "rotate-180" : ""}`}
                        >
                          <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <path
                              d="m6.75 9.75 5.25 5.25 5.25-5.25"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.8"
                            />
                          </svg>
                        </span>
                      </button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="border-t border-[#dce8f5] px-4 py-5">
                      <div
                        className="grid justify-center gap-4"
                        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 280px))" }}
                      >
                        {plan.items.map((item) => (
                          (() => {
                            const itemSavingsMeta = buildSavingsMeta(deriveListPrice(item), item.price);
                            return (
                          <article
                            className="group relative z-0 flex flex-1 flex-col overflow-hidden rounded-[24px] border border-[#dbe5f0] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(244,248,252,0.96)_100%)] shadow-[0_18px_45px_rgba(148,163,184,0.12)] transition duration-300 hover:-translate-y-1 hover:border-[#bfd3ea] hover:shadow-[0_24px_55px_rgba(96,165,250,0.14)]"
                            key={`${plan.id}-${item.sku}`}
                          >
                            <div className="flex items-center justify-between gap-3 px-5 pt-4">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8b97a8]">
                                Click card for details
                              </span>
                              <div className="flex items-center gap-2">
                              <button
                                aria-label="Share by email"
                                className="inline-flex h-8 w-8 items-center justify-center text-[24px] leading-none text-[#344054] transition hover:-translate-y-0.5 hover:text-[#101828]"
                                onClick={() => handleOpenProductShare(item)}
                                type="button"
                              >
                                ✉
                              </button>
                              <button
                                aria-label={favoriteSkuSet.has(item.sku) ? "Remove from likes" : "Add to likes"}
                                className={`inline-flex h-8 w-8 items-center justify-center text-[26px] leading-none transition hover:-translate-y-0.5 ${
                                  favoriteSkuSet.has(item.sku) ? "text-[#dc2626]" : "text-[#111827] hover:text-[#111827]"
                                }`}
                                disabled={isUpdatingFavoriteSku === item.sku}
                                onClick={() => void handleToggleFavoriteProduct(item)}
                                type="button"
                              >
                                <span aria-hidden="true">{favoriteSkuSet.has(item.sku) ? "♥" : "♡"}</span>
                              </button>
                              </div>
                            </div>
                            <Link className="block" href={`/product/${encodeURIComponent(item.sku)}?from=chat`}>
                              <div className="relative h-44 overflow-hidden bg-[linear-gradient(180deg,#edf3f9_0%,#e2e8f0_100%)]">
                                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(191,219,254,0.45),transparent_40%),linear-gradient(180deg,transparent_35%,rgba(15,23,42,0.03)_100%)]" />
                                {item.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    alt={item.title}
                                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                                    src={item.imageUrl}
                                  />
                                ) : (
                                  <div className="h-full w-full bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]" />
                                )}
                              </div>
                              <div className="flex flex-1 flex-col p-5">
                                <h5 className="line-clamp-2 min-h-[3.5rem] text-[17px] font-black leading-7 tracking-[-0.03em] text-[#0f172a]">
                                  {item.title}
                                </h5>
                                <p className="mt-3 line-clamp-3 min-h-[5.25rem] text-sm leading-7 text-[#475467]">
                                  {item.reason}
                                </p>
                                <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                                  <div>
                                    <p className="text-sm font-medium text-[#98a2b3] line-through">
                                      ${itemSavingsMeta.originalPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                    </p>
                                    <p className="mt-1 text-2xl font-black tracking-[-0.03em] text-[#123b5f]">
                                      ${itemSavingsMeta.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                    </p>
                                    {itemSavingsMeta.savedAmount > 0 ? (
                                      <p className="mt-1 text-xs font-semibold text-[#2563eb]">
                                        Save ${itemSavingsMeta.savedAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          </article>
                            );
                          })()
                        ))}
                      </div>

                      <div className="mt-5 flex justify-end gap-3 border-t border-[#e8edf3] pt-4">
                        <button
                          className="inline-flex h-11 items-center justify-center rounded-[16px] border border-[#d6e0eb] bg-white px-5 text-sm font-semibold text-[#123b5f] transition hover:border-[#bfd4ec] hover:bg-[#f8fbff]"
                          onClick={() => handleOpenMockNegotiation(plan)}
                          type="button"
                        >
                          View negotiate
                        </button>
                        <button
                          className="inline-flex h-11 items-center justify-center rounded-[16px] bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition hover:brightness-105"
                          onClick={() => handleEmbeddedOrder(plan)}
                          type="button"
                        >
                          Place order
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

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
        ? "mt-8 w-full rounded-[32px] border border-[#d9e0ea] bg-white px-5 py-3 shadow-[0_18px_45px_rgba(148,163,184,0.12)]"
        : "mx-auto w-full max-w-[760px] rounded-[28px] border border-[#d7dee8] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-2 shadow-[0_12px_36px_rgba(148,163,184,0.12)]";
    const textareaClass =
      which === "hero"
        ? "max-h-[180px] min-h-[34px] w-full resize-none border-none bg-transparent px-1 py-0.5 text-[15px] leading-6 text-[#111827] outline-none placeholder:text-[#98a2b3]"
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
            disabled={isSending}
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

            {which === "hero" ? (
              <div className="ml-1 flex flex-1 flex-wrap items-center gap-2">
                {QUICK_FOCUS_TAGS.map((tag) => (
                  <button
                    aria-pressed={selectedFocusTags.includes(tag.label)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      selectedFocusTags.includes(tag.label)
                        ? "border-[#90b1d8] bg-[#eaf3ff] text-[#204a78] shadow-[0_8px_20px_rgba(144,177,216,0.18)]"
                        : "border-[#d8e2ec] bg-[#f8fbff] text-[#5f6f82] hover:border-[#bfd3e6] hover:bg-[#f3f8fd] hover:text-[#3f556d]"
                    }`}
                    key={tag.label}
                    onClick={() => toggleFocusTag(tag.label)}
                    type="button"
                  >
                    <span className="text-[13px] leading-none">{tag.icon}</span>
                    <span>{tag.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex-1" />
            )}

            <button
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-lg text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition ${
                isSending
                  ? "bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] hover:brightness-105"
                  : "bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] hover:brightness-105 disabled:cursor-not-allowed disabled:bg-[#b7c8d8] disabled:text-slate-200"
              }`}
              disabled={!isSending && (!prompt.trim() && draftAttachments.length === 0)}
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
    setSelectedFocusTags([]);
    setError("");
    setStreamText("");
    streamTextRef.current = "";
    setIsSending(false);
    setSessionId(null);
    setStatus("Preparing workspace...");
    restoredWorkspaceRef.current = false;
    setEditingMessageId(null);
    setEditingMessageContent("");
    setHoveredUserMessageId(null);
    setBootstrapNonce((current) => current + 1);
  }

  function toggleFocusTag(label: string) {
    setSelectedFocusTags((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  }

  async function handleCopyUserMessage(messageId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1200);
    } catch {
      setError("Could not copy this message.");
    }
  }

  function handleStartEditMessage(messageId: string, content: string) {
    if (isSending) {
      return;
    }

    setEditingMessageId(messageId);
    setEditingMessageContent(content);
    setHoveredUserMessageId(messageId);
  }

  function handleCancelEditMessage() {
    setEditingMessageId(null);
    setEditingMessageContent("");
  }

  async function handleSubmitEditedMessage(messageId: string) {
    const content = editingMessageContent.trim();
    if (!content || isSending) {
      return;
    }

    await submitPrompt(content, { replaceMessageId: messageId });
  }

  return (
    <WorkspaceShell
      currentPath="/chat"
      currentSessionId={requestedSessionId ?? sessionId}
      isAuthenticated={isAuthenticated}
      onOpenAuth={() => setAuthOpen(true)}
      onSignOut={() => {
        clearSavedWorkspace();
        void logoutSession().finally(() => {
          setIsAuthenticated(false);
          router.push("/");
        });
      }}
      onNewConversation={handleNewConversation}
    >
      <style jsx global>{`
        @keyframes thinking-shimmer {
          0% {
            background-position: 100% 50%;
          }
          100% {
            background-position: -100% 50%;
          }
        }
      `}</style>
      <div className="h-full">
        <section className="flex min-h-0 h-full">
          <div className="relative flex min-w-0 flex-1 flex-col">
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
                    Include the room, style, budget, and must-have pieces. MartGennie will search products, compare options, and build packages for you.
                  </p>

                  {renderComposer("hero")}

                  <div className="mt-5 flex max-w-[760px] flex-wrap justify-center gap-2.5">
                    {QUICK_QUERY_TAGS.map((query) => (
                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-[#dde3ea] bg-white px-4 py-2 text-sm font-medium text-[#6b7280] shadow-[0_4px_14px_rgba(148,163,184,0.08)] transition hover:-translate-y-0.5 hover:border-[#bfd4ec] hover:text-[#111827]"
                        key={query.label}
                        onClick={() => applyPromptSuggestion(query.label)}
                        type="button"
                      >
                        <span className="text-[14px] leading-none">{query.icon}</span>
                        <span>{query.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-10 flex max-w-[760px] flex-wrap justify-center gap-3">
                    {DISCOVERY_TAGS.map((tag) => (
                      <button
                        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-[0_8px_24px_rgba(148,163,184,0.08)] transition hover:-translate-y-0.5 ${
                          tag.active
                            ? "border-[#9ddcc8] bg-[linear-gradient(180deg,#f5fffb_0%,#effbf6_100%)] text-[#16825d]"
                            : "border-[#e0e6ed] bg-white text-[#6b7280]"
                        }`}
                        key={tag.label}
                        type="button"
                      >
                        <span className="text-[15px] leading-none">{tag.icon}</span>
                        <span>{tag.label}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            tag.active
                              ? "bg-[#dcfce7] text-[#16a34a]"
                              : "bg-[#fff4d6] text-[#f59e0b]"
                          }`}
                        >
                          {tag.badge}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <div key={message.id}>
                      {message.id === latestCompletedAssistantMessageId ? renderThinkingBlock() : null}
                      <article
                        className={`mx-auto w-full max-w-[760px] text-sm leading-8 text-[#111827] md:text-[15px] ${
                          message.role === "user" ? "flex justify-end" : "block"
                        }`}
                        style={{ fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif" }}
                      >
                        {message.role === "user" ? (
                          <div
                            className={`flex flex-col items-end gap-2 ${
                              editingMessageId === message.id ? "w-full max-w-[760px]" : "max-w-[72%]"
                            }`}
                          >
                            {editingMessageId === message.id ? (
                              <div className="w-full rounded-[28px] border border-[#d8dee8] bg-[#f7f8fa] px-4 py-3 shadow-[0_10px_30px_rgba(148,163,184,0.12)]">
                                <textarea
                                  className="min-h-[34px] w-full resize-none border-none bg-transparent text-[15px] leading-6 text-[#111827] outline-none placeholder:text-[#98a2b3]"
                                  onChange={(event) => setEditingMessageContent(event.target.value)}
                                  rows={1}
                                  value={editingMessageContent}
                                />
                                <div className="mt-2 flex items-center justify-end gap-2">
                                  <button
                                    className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium text-[#667085] transition hover:bg-white hover:text-[#344054]"
                                    onClick={handleCancelEditMessage}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={!editingMessageContent.trim() || isSending}
                                    onClick={() => handleSubmitEditedMessage(message.id)}
                                    type="button"
                                  >
                                    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                                      <path
                                        d="M12 5v11"
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeWidth="1.9"
                                      />
                                      <path
                                        d="m7.5 9.5 4.5-4.5 4.5 4.5"
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="1.9"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div
                                className="w-full rounded-[22px] bg-[#f1f1f1] px-4 py-3 text-[#111827]"
                                onMouseEnter={() => setHoveredUserMessageId(message.id)}
                                onMouseLeave={() =>
                                  setHoveredUserMessageId((current) => (current === message.id ? null : current))
                                }
                              >
                                <p>{message.content}</p>
                              </div>
                            )}

                            {hoveredUserMessageId === message.id && editingMessageId !== message.id ? (
                              <div className="mt-0.5 flex items-center justify-end gap-1.5 pr-1">
                                <button
                                  aria-label="Copy message"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#98a2b3] transition hover:bg-[#f4f6f8] hover:text-[#344054]"
                                  onClick={() => handleCopyUserMessage(message.id, message.content)}
                                  type="button"
                                >
                                  {copiedMessageId === message.id ? (
                                    <svg aria-hidden="true" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24">
                                      <path
                                        d="M6 12.5 10 16l8-9"
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="1.9"
                                      />
                                    </svg>
                                  ) : (
                                    <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24">
                                      <rect
                                        height="11"
                                        rx="2.5"
                                        stroke="currentColor"
                                        strokeWidth="1.7"
                                        width="11"
                                        x="9"
                                        y="9"
                                      />
                                      <path
                                        d="M15 7.5V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15h1"
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeWidth="1.7"
                                      />
                                    </svg>
                                  )}
                                </button>
                                <button
                                  aria-label="Edit message"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#98a2b3] transition hover:bg-[#f4f6f8] hover:text-[#344054]"
                                  onClick={() => handleStartEditMessage(message.id, message.content)}
                                  type="button"
                                >
                                  <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24">
                                    <path
                                      d="m14.5 5.5 4 4"
                                      stroke="currentColor"
                                      strokeLinecap="round"
                                      strokeWidth="1.7"
                                    />
                                    <path
                                      d="M6 18.5 9.5 18l8.2-8.2a1.8 1.8 0 0 0 0-2.6l-1-1a1.8 1.8 0 0 0-2.6 0L6 14.5l-.5 4Z"
                                      stroke="currentColor"
                                      strokeLinejoin="round"
                                      strokeWidth="1.7"
                                    />
                                  </svg>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="max-w-none text-[#1f2937]">
                            <p>{message.content}</p>
                          </div>
                        )}
                      </article>
                    </div>
                  ))}

                  {isSending ? (
                    <article
                      className="mx-auto w-full max-w-[760px] text-sm leading-8 text-[#111827] md:text-[15px]"
                      style={{ fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif" }}
                    >
                      {renderThinkingBlock()}
                      <div className="max-w-none text-[#1f2937]">
                        {streamText ? (
                          <p className="relative">
                            {streamText}
                            <span className="ml-2 inline-flex items-center gap-1 align-middle">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#94a3b8]" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#94a3b8] [animation-delay:120ms]" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#94a3b8] [animation-delay:240ms]" />
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ) : null}
                </>
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
            {latestPackageSnapshotId && !isResultsPanelOpen ? (
              <button
                className="absolute right-4 top-1/2 z-20 inline-flex -translate-y-1/2 items-center gap-2 rounded-full border border-[#dbe5ef] bg-white/96 px-3 py-2 text-sm font-semibold text-[#344054] shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur transition hover:border-[#bfd3ea] hover:bg-[#f8fbff]"
                onClick={() => setIsResultsPanelOpen(true)}
                type="button"
              >
                <span>Results</span>
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <path
                    d="m9 5 7 7-7 7"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
            ) : null}
          </div>

          {latestPackageSnapshotId ? (
            <>
              <div
                className={`hidden shrink-0 cursor-col-resize bg-transparent transition-[width,opacity] duration-300 ease-out lg:block ${
                  isResultsPanelOpen
                    ? "w-1.5 opacity-100 hover:bg-[#dbe5ef]"
                    : "w-0 opacity-0 pointer-events-none"
                }`}
                onMouseDown={() => {
                  isResizingResultsPanelRef.current = true;
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                role="separator"
              />
              <aside
                className={`relative hidden shrink-0 overflow-visible transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block ${
                  isResultsPanelOpen
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none translate-x-5 opacity-0"
                }`}
                style={{ width: `${isResultsPanelOpen ? resultsPanelWidth : 0}px` }}
              >
                <button
                  className={`absolute -left-5 top-1/2 z-20 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#d8e2ee] bg-white/92 text-[#98a2b3] shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur transition-all duration-300 hover:text-[#344054] ${
                    isResultsPanelOpen ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"
                  }`}
                  onClick={() => setIsResultsPanelOpen(false)}
                  type="button"
                >
                  <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <path
                      d="M15 19 8 12l7-7"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                </button>
                <div
                  className={`h-full transition-opacity duration-200 ${
                    isResultsPanelOpen ? "opacity-100 delay-75" : "opacity-0"
                  }`}
                >
                  {renderResultsPanel(latestPackageSnapshotId)}
                </div>
              </aside>
            </>
          ) : null}
        </section>
      </div>
      {showOnboarding ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl">
            <MemoryQuestionStepper
              answers={onboardingAnswers}
              description="Answer these once and MartGennie will use them as your long-term memory for future recommendations."
              error={error}
              isSaving={isSavingOnboarding}
              onChangeAnswers={(updater) => setOnboardingAnswers((current) => updater(current))}
              onSubmit={handleSubmitOnboarding}
              questions={onboardingQuestions}
              title="Welcome setup"
            />
          </div>
        </div>
      ) : null}
      <ProductShareModal
        onClose={() => setShareTarget(null)}
        onSubmit={handleSubmitShare}
        open={Boolean(shareTarget)}
        shareLabel={shareTarget?.type === "bundle" ? "bundle" : "product"}
        title={shareTarget?.title ?? ""}
      />
      {mockNegotiationPlan ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0f172a]/35 p-4">
          <div className="flex max-h-[82vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] border border-[#d7e2ee] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.2)]">
            <div className="flex items-start justify-between gap-4 border-b border-[#e7edf4] bg-[linear-gradient(180deg,#fbfdff_0%,#f5f8fc_100%)] px-4 py-3.5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b97a8]">Negotiation preview</p>
                <h3 className="mt-1.5 text-[1.2rem] font-black tracking-[-0.04em] text-[#101828]">{mockNegotiationPlan.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-[#667085]">
                  Review a three-round negotiation path for this bundle before opening the full negotiation flow.
                </p>
              </div>
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#98a2b3] transition hover:bg-[#f8fafc] hover:text-[#344054]"
                onClick={() => setMockNegotiationPlan(null)}
                type="button"
              >
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-4 py-4">
              <div className="grid gap-4 lg:grid-cols-[1.02fr_0.9fr]">
              <div className="space-y-2.5">
                {mockNegotiationPlan.rounds.map((round, index) => (
                  <div className="overflow-hidden rounded-[18px] border border-[#e3eaf3] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)]" key={round.label}>
                    <div className="h-1 w-full bg-[linear-gradient(90deg,#dbeafe_0%,#93c5fd_45%,#60a5fa_100%)]" />
                    <div className="p-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-semibold text-[#123b5f]">{round.label}</p>
                      <span className="rounded-full bg-[#eef4fb] px-3 py-1 text-xs font-semibold text-[#486480]">
                        {index === 2 ? "Accepted" : "Countered"}
                      </span>
                    </div>
                    <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                      <div className="rounded-[14px] border border-[#e6edf5] bg-white px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#98a2b3]">Buyer offer</p>
                        <p className="mt-1 text-base font-black text-[#101828]">${round.buyerOffer.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</p>
                      </div>
                      <div className="rounded-[14px] border border-[#e6edf5] bg-white px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#98a2b3]">Seller counter</p>
                        <p className="mt-1 text-base font-black text-[#101828]">${round.sellerCounter.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                    <div className="mt-2.5 space-y-2">
                      <div className="rounded-[12px] border border-[#e6edf5] bg-white px-3 py-2 text-sm leading-6 text-[#475467]">
                        {round.buyerLine}
                      </div>
                      <div className="rounded-[12px] border border-[#dbeafe] bg-[#f8fbff] px-3 py-2 text-sm leading-6 text-[#123b5f]">
                        {round.sellerLine}
                      </div>
                    </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5">
                <div className="rounded-[18px] border border-[#dbe5ef] bg-[linear-gradient(180deg,#fbfdff_0%,#f6f9fc_100%)] p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b97a8]">Package pricing</p>
                  <div className="mt-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-[#667085]">Original total</span>
                      <span className="text-base font-semibold text-[#98a2b3] line-through">
                        ${mockNegotiationPlan.totalOriginalPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-[#667085]">Final package price</span>
                      <span className="text-lg font-black text-[#2563eb]">
                        ${mockNegotiationPlan.totalFinalPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-[#dbe5ef] bg-white p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b97a8]">Items in this set</p>
                  <div className="mt-2.5 space-y-2">
                    {mockNegotiationPlan.items.map((item) => (
                      <div className="rounded-[14px] border border-[#edf2f7] bg-[#fbfdff] px-3 py-2.5" key={item.sku}>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#101828]">{item.title}</p>
                          <p className="mt-1 text-xs text-[#98a2b3] line-through">
                            ${item.originalPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </p>
                          <p className="mt-1 text-sm font-black text-[#2563eb]">
                            ${item.finalPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </div>
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

export default function ChatWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <ChatWorkspacePageContent />
    </Suspense>
  );
}
