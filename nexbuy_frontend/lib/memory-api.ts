import { authenticatedFetch, getApiBaseUrl, readAccessToken } from "@/lib/auth";

export type OnboardingQuestion = {
  key: string;
  question: string;
  type: string;
  options: string[];
  multi_select: boolean;
  helper_text?: string | null;
  placeholder?: string | null;
  allow_custom_input?: boolean;
  custom_input_key?: string | null;
  custom_input_label?: string | null;
  custom_input_placeholder?: string | null;
};

export type MemoryProfilePayload = {
  housing_type?: string | null;
  space_tier?: string | null;
  household_members?: string[];
  style_preferences?: string[];
  price_philosophy?: string | null;
  negative_constraints?: string[];
  room_priorities?: string[];
  function_preferences?: string[];
  notes?: string | null;
  decision_priority?: string | null;
  raw_answers?: Record<string, unknown>;
};

export type MemoryProfileResponse = {
  onboarding_required: boolean;
  profile: MemoryProfilePayload | null;
};

export type OnboardingAnswerMap = Record<string, string | string[]>;

function normalizeScalar(value: string | string[] | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeList(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.filter((item) => item.trim().length > 0) : [];
}

function prettifyStoredValue(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseFreeInputEntries(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildMemoryPayloadFromAnswers(answers: OnboardingAnswerMap): MemoryProfilePayload {
  const roomPriorities = [
    ...normalizeList(answers.room_priorities),
    ...parseFreeInputEntries(answers.room_priorities_custom),
  ];
  const negativeConstraints = [
    ...normalizeList(answers.negative_constraints),
    ...parseFreeInputEntries(answers.negative_constraints_custom),
  ];
  const selectedNotes = normalizeList(answers.notes).map(prettifyStoredValue);
  const freeNotes = parseFreeInputEntries(answers.notes_custom);
  const notes = [...selectedNotes, ...freeNotes].join("\n").trim();

  return {
    housing_type: normalizeScalar(answers.housing_type),
    room_priorities: roomPriorities,
    space_tier: normalizeScalar(answers.space_tier),
    household_members: normalizeList(answers.household_members),
    style_preferences: normalizeList(answers.style_preferences),
    function_preferences: normalizeList(answers.function_preferences),
    price_philosophy: normalizeScalar(answers.price_philosophy),
    negative_constraints: negativeConstraints,
    notes: notes.length > 0 ? notes : null,
    decision_priority: normalizeScalar(answers.decision_priority),
    raw_answers: answers,
  };
}

function authHeaders() {
  const token = readAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
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

export async function fetchMemoryProfile(): Promise<MemoryProfileResponse> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/memory/profile`, {
    headers: authHeaders(),
  });
  return parseJsonResponse<MemoryProfileResponse>(response, "Could not load memory profile.");
}

export async function fetchOnboardingQuestions(): Promise<OnboardingQuestion[]> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/memory/onboarding/questions`, {
    headers: authHeaders(),
  });
  return parseJsonResponse<OnboardingQuestion[]>(
    response,
    "Could not load onboarding questions.",
  );
}

export async function saveMemoryProfile(payload: MemoryProfilePayload): Promise<MemoryProfileResponse> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/memory/profile`, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<MemoryProfileResponse>(response, "Could not save memory profile.");
}
