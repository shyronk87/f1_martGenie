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

type OAuthAuthorizeResponse = {
  authorization_url: string;
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
const DEFAULT_API_BASE_URL = "/api";

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
    VERIFY_USER_BAD_TOKEN: "This verification link is invalid or has expired.",
    RESET_PASSWORD_BAD_TOKEN: "This reset link is invalid or has expired.",
  };

  return authErrorMap[message] ?? message ?? fallbackMessage;
}
