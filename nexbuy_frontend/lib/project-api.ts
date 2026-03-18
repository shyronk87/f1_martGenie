import { getApiBaseUrl, readAccessToken } from "@/lib/auth";

export type ProjectItem = {
  id: string;
  title: string;
  summary?: string | null;
  updated_at: string;
};

type ProjectListResponse = {
  items: ProjectItem[];
};

type ProjectCreateInput = {
  title: string;
  summary?: string | null;
};

export const PROJECT_SELECTION_STORAGE_KEY = "nexbuy.projects.current";
export const PROJECT_SELECTION_CHANGE_EVENT = "nexbuy.projects.current.changed";

function buildAuthHeaders() {
  const token = readAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function readSelectedProjectId() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(PROJECT_SELECTION_STORAGE_KEY) ?? "";
}

export function saveSelectedProjectId(projectId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PROJECT_SELECTION_STORAGE_KEY, projectId);
  window.dispatchEvent(new Event(PROJECT_SELECTION_CHANGE_EVENT));
}

export function clearSelectedProjectId() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(PROJECT_SELECTION_STORAGE_KEY);
  window.dispatchEvent(new Event(PROJECT_SELECTION_CHANGE_EVENT));
}

export function subscribeSelectedProject(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener(PROJECT_SELECTION_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(PROJECT_SELECTION_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function readSelectedProjectServerSnapshot() {
  return "";
}

export async function fetchProjects(): Promise<ProjectItem[]> {
  const response = await fetch(`${getApiBaseUrl()}/projects`, {
    headers: buildAuthHeaders(),
  });
  const payload = await parseJsonResponse<ProjectListResponse>(response, "Could not load projects.");
  return payload.items;
}

export async function createProject(payload: ProjectCreateInput): Promise<ProjectItem> {
  const response = await fetch(`${getApiBaseUrl()}/projects`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<ProjectItem>(response, "Could not create project.");
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    if (payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string") {
      throw new Error(payload.detail);
    }
    throw new Error(fallbackMessage);
  }

  if (!payload) {
    throw new Error(fallbackMessage);
  }

  return payload as T;
}
