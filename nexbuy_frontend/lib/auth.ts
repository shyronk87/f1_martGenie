export type AuthUser = {
  id?: string;
  email: string;
  is_active?: boolean;
  is_superuser?: boolean;
  is_verified?: boolean;
  is_guest?: boolean;
};

type JwtLoginResponse = {
  access_token: string;
  token_type: string;
};

type OAuthAuthorizeResponse = {
  authorization_url: string;
};

type SessionTokenResponse = {
  access_token: string;
  token_type: string;
};

export class AuthRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
  }
}

const ACCESS_TOKEN_KEY = "nexbuy.access_token";
const USER_EMAIL_KEY = "nexbuy.auth.user_email";
const USER_ID_KEY = "nexbuy.auth.user_id";
const GUEST_DEVICE_ID_KEY = "nexbuy.auth.guest_device_id";
const OAUTH_RETURN_TO_KEY = "nexbuy.auth.return_to";
const DEFAULT_API_BASE_URL = "/api";
export const AUTH_STATE_CHANGE_EVENT = "nexbuy.auth.changed";

export function getApiBaseUrl() {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  return configuredBaseUrl.replace(/\/+$/, "");
}

function isLocalHost(hostname: string | null | undefined) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function buildBackendOriginConfigError(configuredOrigin: string | undefined) {
  if (!configuredOrigin) {
    return new Error(
      "Missing NEXT_PUBLIC_BACKEND_ORIGIN. Set it to the deployed backend origin before building the frontend.",
    );
  }

  if (typeof window !== "undefined") {
    const currentHost = window.location.hostname;
    const parsedOrigin = new URL(configuredOrigin);
    if (!isLocalHost(currentHost) && isLocalHost(parsedOrigin.hostname)) {
      return new Error(
        `Invalid NEXT_PUBLIC_BACKEND_ORIGIN: ${configuredOrigin}. A deployed frontend cannot point to localhost or 127.0.0.1.`,
      );
    }
  }

  return null;
}

export function getBackendOrigin() {
  const configuredOrigin = process.env.NEXT_PUBLIC_BACKEND_ORIGIN;
  const configError = buildBackendOriginConfigError(configuredOrigin);
  if (configError) {
    throw configError;
  }

  return (configuredOrigin as string).replace(/\/+$/, "");
}

export function saveAccessToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

export function readAccessToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function saveAuthUserEmail(email: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(USER_EMAIL_KEY, email);
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

export function saveAuthUserId(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(USER_ID_KEY, userId);
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

export function readAuthUserEmail() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(USER_EMAIL_KEY) ?? "";
}

export function readAuthUserId() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(USER_ID_KEY) ?? "";
}

export function clearAccessToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(USER_EMAIL_KEY);
  window.localStorage.removeItem(USER_ID_KEY);
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

export function getOrCreateGuestDeviceId() {
  if (typeof window === "undefined") {
    return "";
  }

  const existing = window.localStorage.getItem(GUEST_DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const next = crypto.randomUUID();
  window.localStorage.setItem(GUEST_DEVICE_ID_KEY, next);
  return next;
}

let refreshPromise: Promise<string> | null = null;

async function requestSessionRefresh() {
  const response = await fetch(`${getApiBaseUrl()}/auth/session/refresh`, {
    method: "POST",
    credentials: "include",
  });

  const data = await parseJsonResponse<SessionTokenResponse>(
    response,
    "SESSION_EXPIRED",
  );

  if (!data.access_token) {
    throw new AuthRequestError("SESSION_EXPIRED", 401);
  }

  saveAccessToken(data.access_token);
  return data.access_token;
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = requestSessionRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function logoutSession() {
  try {
    await fetch(`${getApiBaseUrl()}/auth/session/logout`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    clearAccessToken();
  }
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit & { skipAuthRetry?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const initialToken = readAccessToken();
  if (initialToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${initialToken}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });

  if (
    (response.status === 401 || response.status === 403) &&
    !init.skipAuthRetry
  ) {
    try {
      const refreshedToken = await refreshAccessToken();
      const retryHeaders = new Headers(init.headers ?? {});
      retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
      return await fetch(input, {
        ...init,
        headers: retryHeaders,
        credentials: init.credentials ?? "include",
      });
    } catch {
      clearAccessToken();
      throw new AuthRequestError("SESSION_EXPIRED", response.status);
    }
  }

  return response;
}

export function saveOAuthReturnTo(path: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(OAUTH_RETURN_TO_KEY, path);
}

export function readOAuthReturnTo() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(OAUTH_RETURN_TO_KEY);
}

export function clearOAuthReturnTo() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(OAUTH_RETURN_TO_KEY);
}

export async function registerWithEmail(email: string, password: string) {
  const response = await fetch(`${getApiBaseUrl()}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  return parseJsonResponse<AuthUser>(response, "Registration failed.");
}

export async function loginWithEmail(email: string, password: string) {
  const formData = new URLSearchParams();
  formData.set("username", email);
  formData.set("password", password);

  const response = await fetch(`${getApiBaseUrl()}/auth/session/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const data = await parseJsonResponse<JwtLoginResponse>(
    response,
    "Login failed.",
  );

  if (!data.access_token) {
    throw new Error("Login succeeded but no access token was returned.");
  }

  return data.access_token;
}

export async function loginAsGuest() {
  const guestDeviceId = getOrCreateGuestDeviceId();
  const response = await fetch(`${getApiBaseUrl()}/auth/session/guest`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      guest_device_id: guestDeviceId,
    }),
  });

  const data = await parseJsonResponse<JwtLoginResponse>(
    response,
    "Guest login failed.",
  );

  if (!data.access_token) {
    throw new Error("Guest login succeeded but no access token was returned.");
  }

  return data.access_token;
}

export async function fetchCurrentUser(token?: string) {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/users/me`, {
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
  });

  return parseJsonResponse<AuthUser>(response, "Could not load current user.");
}

export async function requestGoogleAuthorization() {
  const response = await fetch(`${getApiBaseUrl()}/auth/google/authorize`, {
    credentials: "include",
  });
  const data = await parseJsonResponse<OAuthAuthorizeResponse>(
    response,
    "Could not start Google sign-in.",
  );

  if (!data.authorization_url) {
    throw new Error("Google authorization URL is missing.");
  }

  return data.authorization_url;
}

export async function requestAppleAuthorization() {
  const response = await fetch(`${getApiBaseUrl()}/auth/apple/authorize`, {
    credentials: "include",
  });
  const data = await parseJsonResponse<OAuthAuthorizeResponse>(
    response,
    "Could not start Apple sign-in.",
  );

  if (!data.authorization_url) {
    throw new Error("Apple authorization URL is missing.");
  }

  return data.authorization_url;
}

export function isUnauthorizedAuthError(error: unknown) {
  return (
    error instanceof AuthRequestError && (error.status === 401 || error.status === 403)
  );
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    throw new AuthRequestError(
      readErrorMessage(payload, fallbackMessage),
      response.status,
    );
  }

  if (!payload) {
    throw new Error(fallbackMessage);
  }

  return payload as T;
}

function readErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") {
    return fallbackMessage;
  }

  if ("detail" in payload) {
    const detail = payload.detail;

    if (typeof detail === "string") {
      return mapAuthErrorMessage(detail, fallbackMessage);
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const firstIssue = detail[0];

      if (
        firstIssue &&
        typeof firstIssue === "object" &&
        "msg" in firstIssue &&
        typeof firstIssue.msg === "string"
      ) {
        return mapAuthErrorMessage(firstIssue.msg, fallbackMessage);
      }
    }
  }

  if ("message" in payload && typeof payload.message === "string") {
    return mapAuthErrorMessage(payload.message, fallbackMessage);
  }

  return fallbackMessage;
}

function mapAuthErrorMessage(message: string, fallbackMessage: string) {
  const authErrorMap: Record<string, string> = {
    LOGIN_BAD_CREDENTIALS: "Incorrect email or password.",
    REGISTER_USER_ALREADY_EXISTS: "This email is already registered. Try signing in instead.",
    USER_ALREADY_EXISTS: "This email is already registered. Try signing in instead.",
    INVALID_PASSWORD_EXCEPTION: "Password does not meet the required format.",
    OAUTH_USER_ALREADY_EXISTS: "This email is already linked to an existing account.",
    OAUTH_NOT_AVAILABLE_EMAIL: "The provider did not return a usable email address.",
    OAUTH_INVALID_STATE: "The sign-in session expired. Please try again.",
    OAUTH_CALLBACK_ERROR: "Third-party sign-in could not be completed. Please try again.",
    SESSION_EXPIRED: "Your session expired. Please sign in again.",
    VERIFY_USER_BAD_TOKEN: "This verification link is invalid or has expired.",
    RESET_PASSWORD_BAD_TOKEN: "This reset link is invalid or has expired.",
  };

  return authErrorMap[message] ?? message ?? fallbackMessage;
}
