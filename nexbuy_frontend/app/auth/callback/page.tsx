"use client";

import { useEffect } from "react";
import { clearAccessToken, fetchCurrentUser, saveAccessToken } from "@/lib/auth";

function readHashParams() {
  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(rawHash);
}

export default function AuthCallbackPage() {
  useEffect(() => {
    async function completeOAuth() {
      const hashParams = readHashParams();
      const error = hashParams.get("error");
      const accessToken = hashParams.get("access_token");

      if (error) {
        clearAccessToken();
        window.location.replace(`/?auth_error=${encodeURIComponent(error)}`);
        return;
      }

      if (!accessToken) {
        clearAccessToken();
        window.location.replace("/?auth_error=missing_access_token");
        return;
      }

      try {
        saveAccessToken(accessToken);
        await fetchCurrentUser(accessToken);
        window.location.replace("/chat");
      } catch {
        clearAccessToken();
        window.location.replace("/?auth_error=token_validation_failed");
      }
    }

    void completeOAuth();
  }, []);

  return null;
}
