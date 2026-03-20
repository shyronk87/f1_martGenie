"use client";

import {
  AUTH_STATE_CHANGE_EVENT,
  clearAccessToken,
  fetchCurrentUser,
  readAccessToken,
  readAuthUserEmail,
  saveAuthUserId,
  saveAuthUserEmail,
} from "@/lib/auth";
import { deleteChatSession, fetchChatHistory } from "@/lib/chat-api";
import {
  createProject,
  deleteProject,
  fetchProjects,
  readSelectedProjectId,
  readSelectedProjectServerSnapshot,
  saveSelectedProjectId,
  subscribeSelectedProject,
  type ProjectItem,
} from "@/lib/project-api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
  preview: string;
  href: string;
};

const WORKSPACE_STORAGE_KEY = "nexbuy.chat.workspace";
const CHAT_HISTORY_REFRESH_EVENT = "nexbuy.chat.history.updated";
const NAV_ITEMS = [
  { label: "Chat", href: "/chat" },
  { label: "Plaza", href: "/plaza" },
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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectSummary, setNewProjectSummary] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [remoteHistoryItems, setRemoteHistoryItems] = useState<HistoryItem[]>([]);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [isDeletingProjectId, setIsDeletingProjectId] = useState<string | null>(null);
  const [isDeletingHistoryId, setIsDeletingHistoryId] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const authToken = useSyncExternalStore(
    subscribeAuthSnapshot,
    readAuthTokenSnapshot,
    readAuthTokenServerSnapshot,
  );
  const authUserEmail = useSyncExternalStore(
    subscribeAuthSnapshot,
    readAuthUserEmailSnapshot,
    readAuthUserEmailServerSnapshot,
  );
  const selectedProjectId = useSyncExternalStore(
    subscribeSelectedProject,
    readSelectedProjectId,
    readSelectedProjectServerSnapshot,
  );
  const effectiveAuthenticated = isAuthenticated || Boolean(authToken);

  const historyItems = useMemo<HistoryItem[]>(
    () => (effectiveAuthenticated ? remoteHistoryItems : []),
    [effectiveAuthenticated, remoteHistoryItems],
  );
  const displayProjects = useMemo<ProjectItem[]>(
    () => (effectiveAuthenticated ? projects : []),
    [effectiveAuthenticated, projects],
  );
  const displayEmail = effectiveAuthenticated ? authUserEmail || "Signed in" : "";

  useEffect(() => {
    if (!effectiveAuthenticated) {
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      try {
        const sessions = await fetchChatHistory(selectedProjectId || undefined);
        if (cancelled) {
          return;
        }
        setRemoteHistoryItems(
          sessions.map((session) => ({
            id: session.session_id,
            title: session.title,
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
  }, [effectiveAuthenticated, selectedProjectId]);

  useEffect(() => {
    if (!effectiveAuthenticated) {
      return;
    }

    let cancelled = false;

    async function loadProjects() {
      try {
        const items = await fetchProjects();
        if (cancelled) {
          return;
        }
        setProjects(items);
        if ((!selectedProjectId || !items.some((item) => item.id === selectedProjectId)) && items[0]?.id) {
          saveSelectedProjectId(items[0].id);
        }
      } catch {
        if (!cancelled) {
          setProjects([]);
        }
      }
    }

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, [effectiveAuthenticated, selectedProjectId]);

  useEffect(() => {
    if (!effectiveAuthenticated) {
      return;
    }

    const token = authToken || readAccessToken();
    if (!token) {
      return;
    }

    void fetchCurrentUser(token)
      .then((user) => {
        saveAuthUserEmail(user.email);
        if (user.id) {
          saveAuthUserId(user.id);
        }
      })
      .catch(() => clearAccessToken());
  }, [authToken, effectiveAuthenticated]);

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

  useEffect(() => {
    if (!openActionMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setOpenActionMenu(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [openActionMenu]);

  function handleNewConversation() {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
      window.dispatchEvent(new Event("storage"));
    }
    setSelectedHistoryId("current");
    onNewConversation?.();
    router.push("/chat");
  }

  function handleNewProject() {
    if (!effectiveAuthenticated) {
      onOpenAuth();
      return;
    }
    setNewProjectTitle("");
    setNewProjectSummary("");
    setProjectModalOpen(true);
  }

  async function handleConfirmCreateProject() {
    const title = newProjectTitle.trim();
    if (!title) {
      return;
    }

    try {
      setIsCreatingProject(true);
      const nextProject = await createProject({
        title,
        summary: newProjectSummary.trim() || null,
      });
      setProjects((current) => [nextProject, ...current]);
      saveSelectedProjectId(nextProject.id);
      onNewConversation?.();
      setProjectModalOpen(false);
      setNewProjectTitle("");
      setNewProjectSummary("");
      router.push("/chat");
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    try {
      setIsDeletingProjectId(projectId);
      setOpenActionMenu(null);
      await deleteProject(projectId);
      const items = await fetchProjects();
      setProjects(items);
      const selectedStillExists = items.some((item) => item.id === selectedProjectId);
      const fallbackProjectId = selectedStillExists ? selectedProjectId : (items[0]?.id ?? undefined);
      if (!selectedStillExists && items[0]?.id) {
        saveSelectedProjectId(items[0].id);
      }
      const sessions = await fetchChatHistory(fallbackProjectId);
      setRemoteHistoryItems(
        sessions.map((session) => ({
          id: session.session_id,
          title: session.title,
          preview: session.preview,
          href: `/chat?session=${encodeURIComponent(session.session_id)}`,
        })),
      );
      if (currentPath === "/chat" && currentSessionId) {
        onNewConversation?.();
        router.push("/chat");
      }
    } finally {
      setIsDeletingProjectId(null);
    }
  }

  async function handleDeleteHistoryItem(sessionId: string) {
    try {
      setIsDeletingHistoryId(sessionId);
      setOpenActionMenu(null);
      await deleteChatSession(sessionId);
      const sessions = await fetchChatHistory(selectedProjectId || undefined);
      setRemoteHistoryItems(
        sessions.map((session) => ({
          id: session.session_id,
          title: session.title,
          preview: session.preview,
          href: `/chat?session=${encodeURIComponent(session.session_id)}`,
        })),
      );
      if (currentSessionId === sessionId) {
        onNewConversation?.();
        router.push("/chat");
      }
    } finally {
      setIsDeletingHistoryId(null);
    }
  }

  const avatarLabel = useMemo(() => {
    const base = authUserEmail.trim().slice(0, 2);
    return base.length > 0 ? base.toUpperCase() : "NX";
  }, [authUserEmail]);

  return (
    <main className="h-screen overflow-hidden bg-[linear-gradient(180deg,#f7f9fc_0%,#eef2f7_100%)] text-[#101828]">
      <div className="h-full w-full">
        <div className="h-full overflow-hidden border border-[#dbe3ed] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-[#e2e8f0] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfe_100%)] lg:border-b-0 lg:border-r">
            <div className="border-b border-[#e2e8f0] px-4 py-4">
              <Link className="block" href="/chat">
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

                <div className="space-y-2 pt-3">
                  <div className="px-3 pb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#98a2b3]">
                      Projects
                    </span>
                  </div>
                  {displayProjects.length > 0 ? (
                    <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                      {displayProjects.map((project) => (
                        <div
                          className={`group relative rounded-[18px] transition ${
                            selectedProjectId === project.id
                              ? "bg-[#edf5ff] text-[#123b5f]"
                              : "text-[#526173] hover:bg-[#f4f7fb]"
                          }`}
                          key={project.id}
                        >
                          <button
                            className="block w-full px-3 py-3 pr-12 text-left"
                            onClick={() => {
                              saveSelectedProjectId(project.id);
                              router.push("/chat");
                            }}
                            type="button"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{project.title}</p>
                              {project.summary ? (
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#7b8798]">
                                  {project.summary}
                                </p>
                              ) : null}
                            </div>
                          </button>
                          <div
                            className="absolute right-2 top-2"
                            ref={openActionMenu === `project:${project.id}` ? actionMenuRef : null}
                          >
                            <button
                              aria-label="Open project actions"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#98a2b3] opacity-0 transition hover:bg-[#e9eff7] hover:text-[#344054] group-hover:opacity-100"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenActionMenu((current) =>
                                  current === `project:${project.id}` ? null : `project:${project.id}`,
                                );
                              }}
                              type="button"
                            >
                              <span className="text-lg leading-none">⋯</span>
                            </button>
                            {openActionMenu === `project:${project.id}` ? (
                              <div className="absolute right-0 top-9 z-20 w-[120px] overflow-hidden rounded-[14px] border border-[#dbe3ed] bg-white py-1 shadow-[0_18px_32px_rgba(15,23,42,0.12)]">
                                <button
                                  className="block w-full px-3 py-2 text-left text-sm font-medium text-[#b42318] transition hover:bg-[#fff1f1]"
                                  disabled={isDeletingProjectId === project.id}
                                  onClick={() => void handleDeleteProject(project.id)}
                                  type="button"
                                >
                                  {isDeletingProjectId === project.id ? "Deleting..." : "Delete"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-2 text-xs leading-5 text-[#98a2b3]">
                      No projects yet.
                    </div>
                  )}
                  <div className="pt-1">
                    <button
                      className="inline-flex h-9 w-full items-center justify-center rounded-[16px] border border-[#dce5ef] bg-[#f8fbff] text-sm font-semibold text-[#486480] transition hover:border-[#bfd4ec] hover:bg-[#eef4fb] hover:text-[#123b5f]"
                      onClick={handleNewProject}
                      type="button"
                    >
                      + New project
                    </button>
                  </div>
                </div>

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
              {historyItems.length > 0 ? (
                <div className="space-y-1">
                  {historyItems.map((item) => (
                    <div
                      className={`group relative rounded-[18px] transition ${
                        activeHistoryId === item.id
                          ? "bg-[#edf5ff] text-[#123b5f]"
                          : "text-[#526173] hover:bg-[#f4f7fb]"
                      }`}
                      key={item.id}
                    >
                      <Link
                        className="block w-full px-3 py-3 pr-12 text-left"
                        href={item.href}
                        onClick={() => setSelectedHistoryId(item.id)}
                      >
                        <p className="truncate text-sm font-medium">{item.title}</p>
                      </Link>
                      <div
                        className="absolute right-2 top-2"
                        ref={openActionMenu === `history:${item.id}` ? actionMenuRef : null}
                      >
                        <button
                          aria-label="Open chat actions"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#98a2b3] opacity-0 transition hover:bg-[#e9eff7] hover:text-[#344054] group-hover:opacity-100"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setOpenActionMenu((current) =>
                              current === `history:${item.id}` ? null : `history:${item.id}`,
                            );
                          }}
                          type="button"
                        >
                          <span className="text-lg leading-none">⋯</span>
                        </button>
                        {openActionMenu === `history:${item.id}` ? (
                          <div className="absolute right-0 top-9 z-20 w-[120px] overflow-hidden rounded-[14px] border border-[#dbe3ed] bg-white py-1 shadow-[0_18px_32px_rgba(15,23,42,0.12)]">
                            <button
                              className="block w-full px-3 py-2 text-left text-sm font-medium text-[#b42318] transition hover:bg-[#fff1f1]"
                              disabled={isDeletingHistoryId === item.id}
                              onClick={() => void handleDeleteHistoryItem(item.id)}
                              type="button"
                            >
                              {isDeletingHistoryId === item.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-xs leading-5 text-[#98a2b3]">
                  No saved chats yet.
                </div>
              )}
            </div>

            <div className="border-t border-[#e2e8f0] px-4 py-4">
              <div className="mb-4 space-y-1">
                <span className="block px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#98a2b3]">
                  About
                </span>
                <Link
                  className={`block rounded-[16px] px-3 py-2 text-sm font-medium transition ${
                    currentPath === "/about"
                      ? "bg-[#edf5ff] text-[#123b5f]"
                      : "text-[#526173] hover:bg-[#f4f7fb] hover:text-[#101828]"
                  }`}
                  href="/about"
                >
                  About MartGennie
                </Link>
              </div>
              {effectiveAuthenticated ? (
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
                      <p className="truncate text-sm font-semibold text-[#101828]">{displayEmail}</p>
                    </div>
                    <span className="text-sm text-[#667085]">{accountMenuOpen ? "▴" : "▾"}</span>
                  </button>

                  {accountMenuOpen ? (
                    <div className="absolute bottom-full left-0 mb-3 w-full overflow-hidden rounded-[18px] border border-[#d7e1ec] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                      <Link
                        className="block px-4 py-3 text-sm font-medium text-[#344054] transition hover:bg-[#f8fbff]"
                        href="/favorites"
                        onClick={() => setAccountMenuOpen(false)}
                      >
                        My likes
                      </Link>
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
                  <button
                    className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition hover:brightness-105"
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
      {projectModalOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.28)] px-4 backdrop-blur-sm"
          onClick={() => {
            if (!isCreatingProject) {
              setProjectModalOpen(false);
            }
          }}
          role="dialog"
        >
          <div
            className="w-full max-w-[420px] rounded-[28px] border border-[#dbe3ed] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.16)]"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7c8da5]">
              New project
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[#101828]">
              Create project
            </h2>
            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">
                Project name
              </span>
              <input
                className="h-12 w-full rounded-[18px] border border-[#dce5ef] bg-white px-4 text-sm text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#93c5fd] focus:ring-4 focus:ring-[#dbeafe]"
                maxLength={255}
                onChange={(event) => setNewProjectTitle(event.target.value)}
                placeholder="Living room refresh"
                type="text"
                value={newProjectTitle}
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8da5]">
                Description
              </span>
              <textarea
                className="min-h-[96px] w-full resize-none rounded-[18px] border border-[#dce5ef] bg-white px-4 py-3 text-sm leading-6 text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#93c5fd] focus:ring-4 focus:ring-[#dbeafe]"
                maxLength={500}
                onChange={(event) => setNewProjectSummary(event.target.value)}
                placeholder="Optional"
                value={newProjectSummary}
              />
            </label>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                className="inline-flex h-11 items-center justify-center rounded-[16px] border border-[#dce5ef] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f8fafc]"
                onClick={() => setProjectModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex h-11 items-center justify-center rounded-[16px] bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!newProjectTitle.trim() || isCreatingProject}
                onClick={() => void handleConfirmCreateProject()}
                type="button"
              >
                {isCreatingProject ? "Creating..." : "Create project"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function subscribeAuthSnapshot(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(AUTH_STATE_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(AUTH_STATE_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function readAuthTokenSnapshot() {
  return readAccessToken() ?? "";
}

function readAuthTokenServerSnapshot() {
  return "";
}

function readAuthUserEmailSnapshot() {
  return readAuthUserEmail() ?? "";
}

function readAuthUserEmailServerSnapshot() {
  return "";
}
