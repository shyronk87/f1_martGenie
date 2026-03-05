"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  AuthUser,
  clearAccessToken,
  fetchCurrentUser,
  getApiBaseUrl,
  loginWithEmail,
  readAccessToken,
  registerWithEmail,
  requestGoogleAuthorization,
  saveAccessToken,
} from "@/lib/auth";

type AuthMode = "login" | "register";

type FormState = {
  email: string;
  password: string;
};

const initialFormState: FormState = {
  email: "",
  password: "",
};

export default function Home() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [form, setForm] = useState<FormState>(initialFormState);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [statusMessage, setStatusMessage] = useState("Checking saved session...");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const token = readAccessToken();

    if (!token) {
      setStatusMessage("No active session. Sign in or create an account.");
      return;
    }

    void restoreSession(token);
  }, []);

  async function restoreSession(token: string) {
    setIsBusy(true);
    setErrorMessage("");

    try {
      const user = await fetchCurrentUser(token);
      setCurrentUser(user);
      setStatusMessage(`Signed in as ${user.email}`);
    } catch {
      clearAccessToken();
      setCurrentUser(null);
      setStatusMessage("Saved session expired. Please sign in again.");
      setErrorMessage("The stored access token is no longer valid.");
    } finally {
      setIsBusy(false);
    }
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setErrorMessage("");

    try {
      if (mode === "register") {
        const user = await registerWithEmail(form.email, form.password);
        setStatusMessage(`Account created for ${user.email}. You can sign in now.`);
        setMode("login");
        setForm((current) => ({
          ...current,
          password: "",
        }));
        return;
      }

      const token = await loginWithEmail(form.email, form.password);
      saveAccessToken(token);
      await restoreSession(token);
      setForm((current) => ({
        ...current,
        password: "",
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Authentication failed.";
      setErrorMessage(message);
      setStatusMessage("Request failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setIsBusy(true);
    setErrorMessage("");

    try {
      const authorizationUrl = await requestGoogleAuthorization();
      window.location.href = authorizationUrl;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start Google login.";
      setErrorMessage(message);
      setStatusMessage("Google sign-in could not be started.");
      setIsBusy(false);
    }
  }

  function handleLogout() {
    clearAccessToken();
    setCurrentUser(null);
    setStatusMessage("Signed out.");
    setErrorMessage("");
  }

  const accessToken = readAccessToken();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(249,115,22,0.22),_transparent_34%),linear-gradient(135deg,_#0f172a_0%,_#111827_45%,_#1f2937_100%)] px-6 py-10 text-slate-100">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[2rem] border border-white/10 bg-white/8 p-8 shadow-2xl shadow-black/30 backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-300">
            Next.js Auth Console
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Frontend wiring for your FastAPI authentication backend.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
            This page is already wired for register, JWT login, current-user
            restore, logout, and Google OAuth handoff.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <InfoCard label="API Base" value={getApiBaseUrl()} />
            <InfoCard
              label="Session"
              value={currentUser ? "Authenticated" : "Anonymous"}
            />
            <InfoCard
              label="Token"
              value={accessToken ? "Stored in localStorage" : "Not stored"}
            />
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-black/20 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-slate-400">
                  Current User
                </p>
                <p className="mt-2 text-lg font-medium text-white">
                  {currentUser?.email ?? "No signed-in user"}
                </p>
              </div>
              <button
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!currentUser}
                onClick={handleLogout}
                type="button"
              >
                Sign out
              </button>
            </div>

            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950/70 p-4 text-xs leading-6 text-slate-300">
              {JSON.stringify(currentUser, null, 2) || "null"}
            </pre>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white px-6 py-7 text-slate-900 shadow-2xl shadow-black/30">
          <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
            <button
              className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                mode === "login"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setMode("login")}
              type="button"
            >
              Email Login
            </button>
            <button
              className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                mode === "register"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setMode("register")}
              type="button"
            >
              Register
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Email
              </span>
              <input
                autoComplete="email"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-orange-400 focus:bg-white"
                onChange={(event) => updateField("email", event.target.value)}
                placeholder="user@example.com"
                required
                type="email"
                value={form.email}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Password
              </span>
              <input
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-orange-400 focus:bg-white"
                minLength={3}
                onChange={(event) => updateField("password", event.target.value)}
                placeholder="Enter your password"
                required
                type="password"
                value={form.password}
              />
            </label>

            <button
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={isBusy}
              type="submit"
            >
              {isBusy
                ? "Working..."
                : mode === "login"
                  ? "Sign In"
                  : "Create Account"}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
              or
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={handleGoogleLogin}
            type="button"
          >
            Continue with Google
          </button>

          <div className="mt-6 rounded-2xl bg-slate-100 p-4">
            <p className="text-sm font-medium text-slate-700">Status</p>
            <p className="mt-2 text-sm leading-7 text-slate-600">{statusMessage}</p>
            {errorMessage ? (
              <p className="mt-2 text-sm leading-7 text-rose-600">{errorMessage}</p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p className="mt-3 text-sm font-medium text-white">{value}</p>
    </div>
  );
}
