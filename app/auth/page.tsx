"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthState, setAuthState } from "@/app/lib/auth-client";
import { readUiLang, tr, type UiLang, writeUiLang } from "@/app/lib/ui-lang";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, string | number | boolean>,
          ) => void;
        };
      };
    };
  }
}

type SessionResponse = {
  email: string;
  expiresAt: number;
};

export default function AuthPage() {
  const router = useRouter();
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [uiLang, setUiLang] = useState<UiLang>("en");
  const buttonRef = useRef<HTMLDivElement | null>(null);

  const googleClientId = useMemo(
    () => process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "",
    [],
  );

  useEffect(() => {
    const check = async () => {
      const state = getAuthState();
      if (state) {
        router.replace("/");
        return;
      }
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const payload = (await res.json()) as SessionResponse;
          setAuthState(payload, true);
          router.replace("/");
          return;
        }
      } catch {
        // ignore
      }
      setChecked(true);
    };
    void check();
  }, [router]);

  useEffect(() => {
    setUiLang(readUiLang());
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!googleClientId) {
      setError("Google Client ID is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID).");
      return;
    }

    const scriptId = "google-gsi-client";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    const init = () => {
      if (!window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async (response) => {
          const idToken = response.credential;
          if (!idToken) {
            setError("Google did not return credential token.");
            return;
          }
          setLoggingIn(true);
          setError(null);
          try {
            const res = await fetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken, keepLoggedIn }),
            });
            const payload = (await res.json().catch(() => ({}))) as
              | SessionResponse
              | { error?: string };
            if (!res.ok || !("email" in payload) || !("expiresAt" in payload)) {
              throw new Error(
                "error" in payload && payload.error
                  ? payload.error
                  : `Login failed (${res.status})`,
              );
            }
            setAuthState(payload, keepLoggedIn);
            router.replace("/");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed");
          } finally {
            setLoggingIn(false);
          }
        },
      });
      buttonRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        shape: "pill",
        theme: "outline",
        text: "continue_with",
        size: "large",
        width: 340,
      });
    };

    if (existing) {
      init();
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = init;
    script.onerror = () => setError("Failed to load Google Sign-In script.");
    document.head.appendChild(script);
  }, [checked, googleClientId, keepLoggedIn, router]);

  if (!checked) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, #f8f3ea 0%, #f5f8f3 100%)",
        fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: "min(460px, 92vw)",
          background: "white",
          borderRadius: 16,
          padding: 28,
          border: "1px solid #e7e2d8",
          boxShadow: "0 20px 50px rgba(0,0,0,0.08)",
          display: "grid",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0 }}>{tr(uiLang, "Mining Control", "Майнинг Контроль")}</h1>
        <p style={{ margin: 0, color: "#1f2937", fontSize: 14 }}>
          {tr(uiLang, "Login with your allowed Google email.", "Увійдіть через дозволену Google-пошту.")}
        </p>
        <div style={{ display: "inline-flex", gap: 6 }}>
          <button
            onClick={() => {
              setUiLang("en");
              writeUiLang("en");
            }}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: uiLang === "en" ? "#dbeafe" : "#fff",
              color: uiLang === "en" ? "#1d4ed8" : "#334155",
              fontWeight: 700,
            }}
          >
            EN
          </button>
          <button
            onClick={() => {
              setUiLang("uk");
              writeUiLang("uk");
            }}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: uiLang === "uk" ? "#dbeafe" : "#fff",
              color: uiLang === "uk" ? "#1d4ed8" : "#334155",
              fontWeight: 700,
            }}
          >
            UA
          </button>
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          <input
            type="checkbox"
            checked={keepLoggedIn}
            onChange={(e) => setKeepLoggedIn(e.target.checked)}
            disabled={loggingIn}
          />
          <span style={{ color: "#111827" }}>{tr(uiLang, "Keep me logged in", "Запам'ятати вхід")}</span>
        </label>

        <div ref={buttonRef} style={{ minHeight: 44 }} />

        {loggingIn && (
          <div style={{ color: "#374151", fontSize: 13 }}>
            {tr(uiLang, "Signing in...", "Виконується вхід...")}
          </div>
        )}
        {error && (
          <div
            style={{
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#9f1239",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
