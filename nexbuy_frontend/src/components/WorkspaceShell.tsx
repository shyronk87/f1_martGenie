"use client";

import { clearAccessToken, fetchCurrentUser, readAccessToken } from "@/lib/auth";
import { fetchChatHistory } from "@/lib/chat-api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type WorkspaceShellProps = {
  currentPath: string;
  isAuthenticated: boolean;
  currentSessionId?: string | null;
  onOpenAuth: () => void;
  onSignOut: () => void;
  onNewConversation?: () => void;
  children: ReactNode;
};

type HistoryItem = {
  id: string;
  title: string;
  time: string;
  preview: string;
  href: string;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";
const CHAT_HISTORY_REFRESH_EVENT = "nexbuy.chat.history.updated";
const NAV_ITEMS = [
  { label: "Chat", href: "/chat" },
  { label: "Packages", href: "/recommendations" },
  { label: "Negotiation", href: "/negotiation" },
  { label: "Plaza", href: "/plaza" },
  { label: "Seller", href: "/seller-console" },
  { label: "Home", href: "/" },
];

const HISTORY_PRESETS: HistoryItem[] = [
  {
    id: "history-living-room",
    title: "Living room refresh",
    time: "11m ago",
    preview: "Soft modern package, pet-friendly, under $3,000",
    href: "/chat",
  },
  {
    id: "history-dining",
    title: "Dining shortlist",
    time: "Yesterday",
    preview: "Dining set for 4 with light oak and durable finishes",
    href: "/chat",
  },
  {
    id: "history-bedroom",
    title: "Bedroom planning",
    time: "2 days ago",
    preview: "Bedroom package with storage and warm wood tones",
    href: "/chat",
  },
];

export default function WorkspaceShell({
  currentPath,
  isAuthenticated,
  currentSessionId,
  onOpenAuth,
  onSignOut,
  onNewConversation,
  children,
}: WorkspaceShellProps) {
  const router = useRouter();
  const [selectedHistoryId, setSelectedHistoryId] = useState("current");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [remoteHistoryItems, setRemoteHistoryItems] = useState<HistoryItem[]>([]);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const historyItems = useMemo<HistoryItem[]>(
    () => (isAuthenticated ? remoteHistoryItems : HISTORY_PRESETS),
    [isAuthenticated, remoteHistoryItems],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      try {
        const sessions = await fetchChatHistory();
        if (cancelled) {
          return;
        }
        setRemoteHistoryItems(
          sessions.map((session) => ({
            id: session.session_id,
            title: session.title,
            time: new Date(session.updated_at).toLocaleDateString(),
            preview: session.preview,
            href: `/chat?session=${encodeURIComponent(session.session_id)}`,
          })),
        );
      } catch {
        if (!cancelled) {
          setRemoteHistoryItems([]);
        }
      }
    }

    void loadHistory();

    function handleRefresh() {
      void loadHistory();
    }

    window.addEventListener(CHAT_HISTORY_REFRESH_EVENT, handleRefresh);
    window.addEventListener("focus", handleRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(CHAT_HISTORY_REFRESH_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const token = readAccessToken();
    if (!token) {
      return;
    }

    void fetchCurrentUser(token)
      .then((user) => setUserEmail(user.email))
      .catch(() => clearAccessToken());
  }, [isAuthenticated]);

  const activeHistoryId = currentSessionId ?? selectedHistoryId;

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [accountMenuOpen]);

  function handleNewConversation() {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
      window.dispatchEvent(new Event("storage"));
    }
    setSelectedHistoryId("current");
    onNewConversation?.();
    router.push("/chat");
  }

  const avatarLabel = useMemo(() => {
    const base = userEmail.trim().slice(0, 2);
    return base.length > 0 ? base.toUpperCase() : "NX";
  }, [userEmail]);

  return (
    <main className="h-screen overflow-hidden bg-[linear-gradient(180deg,#f7f9fc_0%,#eef2f7_100%)] text-[#101828]">
      <div className="h-full w-full">
        <div className="h-full overflow-hidden border border-[#dbe3ed] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-[#e2e8f0] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfe_100%)] lg:border-b-0 lg:border-r">
            <div className="border-b border-[#e2e8f0] px-4 py-4">
              <Link className="block" href="/">
                <p
                  className="text-[1.55rem] font-normal tracking-[-0.04em] text-[#0f172a] md:text-[1.7rem]"
                  style={{ fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif" }}
                >
                  MartGennie
                </p>
              </Link>
              <div className="mt-5 -mx-4 h-px bg-[#e2e8f0]" />
              <div className="pt-5">
                <div className="space-y-1">
                <button
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition hover:brightness-105"
                  onClick={handleNewConversation}
                  type="button"
                >
                  <span className="text-base leading-none">+</span>
                  <span>New chat</span>
                </button>
                <nav className="space-y-1 pt-2">
                  <span className="block px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#98a2b3]">
                    Navigation
                  </span>
                  {NAV_ITEMS.map((item) => (
                    <Link
                      className={`block rounded-[16px] px-3 py-2 text-sm font-medium transition ${
                        currentPath === item.href
                          ? "bg-[#edf5ff] text-[#123b5f]"
                          : "text-[#526173] hover:bg-[#f4f7fb] hover:text-[#101828]"
                      }`}
                      href={item.href}
                      key={item.label}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#98a2b3]">
                Recent
              </p>
              <div className="space-y-1">
                {historyItems.map((item) => (
                  <Link
                    className={`block w-full rounded-[18px] px-3 py-3 text-left transition ${
                      activeHistoryId === item.id
                        ? "bg-[#edf5ff] text-[#123b5f]"
                        : "text-[#526173] hover:bg-[#f4f7fb]"
                    }`}
                    href={item.href}
                    key={item.id}
                    onClick={() => setSelectedHistoryId(item.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <span className="shrink-0 text-[11px] text-[#98a2b3]">{item.time}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#7b8798]">{item.preview}</p>
                  </Link>
                ))}
              </div>
            </div>

            <div className="border-t border-[#e2e8f0] px-4 py-4">
              {isAuthenticated ? (
                <div className="relative" ref={accountMenuRef}>
                  <button
                    className="flex w-full items-center gap-3 rounded-[18px] bg-[linear-gradient(180deg,#f7fbff_0%,#eef5fd_100%)] px-4 py-3 text-left transition hover:bg-[linear-gradient(180deg,#f3f8ff_0%,#e8f1fc_100%)]"
                    onClick={() => setAccountMenuOpen((current) => !current)}
                    type="button"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#8db4de,#1d4ed8)] text-sm font-bold text-white">
                      {avatarLabel}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#101828]">{userEmail || "Signed in"}</p>
                    </div>
                    <span className="text-sm text-[#667085]">{accountMenuOpen ? "▴" : "▾"}</span>
                  </button>

                  {accountMenuOpen ? (
                    <div className="absolute bottom-full left-0 mb-3 w-full overflow-hidden rounded-[18px] border border-[#d7e1ec] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                      <Link
                        className="block px-4 py-3 text-sm font-medium text-[#344054] transition hover:bg-[#f8fbff]"
                        href="/profile"
                        onClick={() => setAccountMenuOpen(false)}
                      >
                        Profile
                      </Link>
                      <button
                        className="block w-full px-4 py-3 text-left text-sm font-medium text-[#b42318] transition hover:bg-[#fff1f1]"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onSignOut();
                        }}
                        type="button"
                      >
                        Sign out
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-[18px] bg-[linear-gradient(180deg,#f7fbff_0%,#eef5fd_100%)] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7b8798]">Account</p>
                  <p className="mt-2 text-sm font-medium text-[#101828]">Sign in to keep your workspace and deals.</p>
                  <button
                    className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition hover:brightness-105"
                    onClick={onOpenAuth}
                    type="button"
                  >
                    Sign in
                  </button>
                </div>
              )}
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto">{children}</div>
        </div>
      </div>
    </main>
  );
}
