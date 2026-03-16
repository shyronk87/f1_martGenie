"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import {
  loginWithEmail,
  registerWithEmail,
  requestGoogleAuthorization,
  saveAccessToken,
} from "@/lib/auth";

type AuthMode = "login" | "register";

type Props = {
  onSuccess?: () => void | Promise<void>;
};

export default function AuthForm({ onSuccess }: Props) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function switchMode(nextMode: AuthMode, options?: { preserveEmail?: boolean }) {
    setMode(nextMode);
    setError("");
    setMessage("");
    setPassword("");

    if (!options?.preserveEmail) {
      setEmail("");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      if (mode === "register") {
        const user = await registerWithEmail(email, password);
        setMessage(`Account created for ${user.email}. You can sign in now.`);
        switchMode("login", { preserveEmail: true });
        setMessage(`Account created for ${user.email}. You can sign in now.`);
        return;
      }

      const token = await loginWithEmail(email, password);
      saveAccessToken(token);
      setMessage("Signed in successfully.");
      await onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleGoogle() {
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      const authorizationUrl = await requestGoogleAuthorization();
      window.location.href = authorizationUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start Google sign-in.");
      setIsBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[640px] rounded-[32px] border border-[#d9e0ea] bg-[linear-gradient(180deg,#ffffff_0%,#f3f6fa_100%)] p-7 shadow-[0_30px_90px_rgba(148,163,184,0.18)] md:p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b97a8]">
          Welcome
        </p>
        <h3 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[#101828] md:text-[2.2rem]">
          {mode === "login" ? "Welcome back to MartGennie." : "Create your MartGennie account."}
        </h3>
        <p className="mt-3 max-w-[34rem] text-base leading-7 text-[#667085]">
          {mode === "login"
            ? "Sign in to continue your shopping workflow across chat, recommendations, and negotiation."
            : "Set up your account to save preferences, follow recommendations, and continue deals across sessions."}
        </p>
      </div>

      <div className="grid grid-cols-2 rounded-2xl border border-[#d7dee8] bg-[#eef2f6] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
        <button
          className={`rounded-xl px-4 py-2.5 text-base font-semibold transition ${
            mode === "login"
              ? "bg-[#101828] text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]"
              : "text-[#667085] hover:text-[#344054]"
          }`}
          onClick={() => switchMode("login")}
          type="button"
        >
          Sign In
        </button>
        <button
          className={`rounded-xl px-4 py-2.5 text-base font-semibold transition ${
            mode === "register"
              ? "bg-[#101828] text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]"
              : "text-[#667085] hover:text-[#344054]"
          }`}
          onClick={() => switchMode("register")}
          type="button"
        >
          Register
        </button>
      </div>

      <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
        <input
          autoComplete="email"
          className="h-[52px] w-full rounded-2xl border border-[#d7dee8] bg-white px-4 text-base text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#94a3b8] focus:bg-white"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter email"
          required
          type="email"
          value={email}
        />
        <input
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="h-[52px] w-full rounded-2xl border border-[#d7dee8] bg-white px-4 text-base text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#94a3b8] focus:bg-white"
          minLength={3}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          required
          type="password"
          value={password}
        />
        <button
          className="h-[52px] w-full rounded-2xl bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)] text-lg font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.22)] transition hover:brightness-105 disabled:opacity-60"
          disabled={isBusy}
          type="submit"
        >
          {isBusy ? "Please wait..." : mode === "login" ? "Continue" : "Create Account"}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-[#dbe2eb]" />
        <span className="text-sm text-[#8b97a8]">Or continue with Google</span>
        <div className="h-px flex-1 bg-[#dbe2eb]" />
      </div>

      <button
        className="flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl border border-[#d7dee8] bg-white text-lg font-semibold text-[#101828] shadow-[0_10px_24px_rgba(148,163,184,0.1)] transition hover:border-[#c9d3df] hover:bg-[#fbfcfd] disabled:opacity-60"
        disabled={isBusy}
        onClick={handleGoogle}
        type="button"
      >
        <Image alt="Google" height={20} src="/google.png" width={20} />
        Continue with Google
      </button>

      {message ? <p className="mt-4 text-sm text-[#156f52]">{message}</p> : null}
      {error ? <p className="mt-4 text-sm text-[#c24157]">{error}</p> : null}
    </div>
  );
}
