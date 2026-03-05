export type AuthUser = {
  id?: string;
  email: string;
  is_active?: boolean;
  is_superuser?: boolean;
  is_verified?: boolean;
};

type JwtLoginResponse = {
  access_token: string;
  token_type: string;
};

type GoogleAuthorizeResponse = {
  authorization_url: string;
};

const ACCESS_TOKEN_KEY = "nexbuy.access_token";
const DEFAULT_API_BASE_URL = "http://localhost:8000/api";

export function getApiBaseUrl() {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  return configuredBaseUrl.replace(/\/+$/, "");
}

export function saveAccessToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function readAccessToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function clearAccessToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
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

  const response = await fetch(`${getApiBaseUrl()}/auth/jwt/login`, {
    method: "POST",
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

export async function fetchCurrentUser(token: string) {
  const response = await fetch(`${getApiBaseUrl()}/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return parseJsonResponse<AuthUser>(response, "Could not load current user.");
}

export async function requestGoogleAuthorization() {
  const response = await fetch(`${getApiBaseUrl()}/auth/google/authorize`, {
    credentials: "include",
  });
  const data = await parseJsonResponse<GoogleAuthorizeResponse>(
    response,
    "Could not start Google sign-in.",
  );

  if (!data.authorization_url) {
    throw new Error("Google authorization URL is missing.");
  }

  return data.authorization_url;
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, fallbackMessage));
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
      return detail;
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const firstIssue = detail[0];

      if (
        firstIssue &&
        typeof firstIssue === "object" &&
        "msg" in firstIssue &&
        typeof firstIssue.msg === "string"
      ) {
        return firstIssue.msg;
      }
    }
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  return fallbackMessage;
}
