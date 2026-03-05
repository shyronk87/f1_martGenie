"use client";

import { useEffect, useState } from "react";
import { clearAccessToken, fetchCurrentUser, saveAccessToken } from "@/lib/auth";

function readHashParams() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  return new URLSearchParams(hash);
}

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing Google sign-in...");

  useEffect(() => {
    async function completeOAuth() {
      const params = readHashParams();
      const error = params.get("error");
      const accessToken = params.get("access_token");

      if (error) {
        clearAccessToken();
        setMessage(`Google sign-in failed: ${error}`);
        return;
      }

      if (!accessToken) {
        clearAccessToken();
        setMessage("Google sign-in failed: missing access token.");
        return;
      }

      try {
        saveAccessToken(accessToken);
        await fetchCurrentUser(accessToken);
        setMessage("Google sign-in complete. Redirecting...");
        window.setTimeout(() => {
          window.location.replace("/");
        }, 800);
      } catch {
        clearAccessToken();
        setMessage("Google sign-in failed: token validation failed.");
      }
    }

    void completeOAuth();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-white/8 p-8 text-center shadow-2xl shadow-black/30 backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-300">
          OAuth Callback
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Finalizing session
        </h1>
        <p className="mt-4 text-base leading-8 text-slate-300">{message}</p>
      </div>
    </main>
  );
}
