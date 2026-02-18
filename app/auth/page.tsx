"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { getAuthState, setAuthState } from "@/app/lib/auth-client";
import { readUiLang, t, type UiLang, writeUiLang } from "@/app/lib/ui-lang";

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
    <Container maxWidth="sm" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", py: 4 }}>
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          p: 3,
          borderRadius: 3,
          background: "linear-gradient(180deg, rgba(17,26,45,0.96) 0%, rgba(17,26,45,0.84) 100%)",
        }}
      >
        <Stack spacing={1.5}>
          <Typography variant="h4" fontWeight={900}>{t(uiLang, "mining_control")}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t(uiLang, "login_with_your_allowed_google_email")}
          </Typography>

          <Stack direction="row" spacing={0.75}>
            <Button
              variant={uiLang === "en" ? "contained" : "outlined"}
              color="primary"
              size="small"
              onClick={() => {
                setUiLang("en");
                writeUiLang("en");
              }}
            >
              EN
            </Button>
            <Button
              variant={uiLang === "uk" ? "contained" : "outlined"}
              color="primary"
              size="small"
              onClick={() => {
                setUiLang("uk");
                writeUiLang("uk");
              }}
            >
              UA
            </Button>
          </Stack>

          <FormControlLabel
            control={
              <Checkbox
                checked={keepLoggedIn}
                onChange={(e) => setKeepLoggedIn(e.target.checked)}
                disabled={loggingIn}
              />
            }
            label={t(uiLang, "keep_me_logged_in")}
          />

          <Box ref={buttonRef} sx={{ minHeight: 44 }} />

          {loggingIn && (
            <Typography variant="body2" color="text.secondary">
              {t(uiLang, "signing_in")}
            </Typography>
          )}

          {error && (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
