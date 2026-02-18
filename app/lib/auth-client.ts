"use client";

type AuthState = {
  email: string;
  expiresAt: number;
};

const LOCAL_KEY = "mc_auth";
const SESSION_KEY = "mc_auth_session";

function readStore(key: string): AuthState | null {
  if (typeof window === "undefined") return null;
  const raw =
    key === LOCAL_KEY
      ? window.localStorage.getItem(key)
      : window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

function writeStore(key: string, state: AuthState, persistent: boolean) {
  if (typeof window === "undefined") return;
  const value = JSON.stringify(state);
  if (persistent) {
    window.localStorage.setItem(key, value);
  } else {
    window.sessionStorage.setItem(key, value);
  }
}

export function getAuthState(): AuthState | null {
  if (typeof window === "undefined") return null;

  const local = readStore(LOCAL_KEY);
  const session = readStore(SESSION_KEY);
  const state = local ?? session;
  if (!state) return null;

  if (Date.now() >= state.expiresAt) {
    clearAuthState();
    return null;
  }
  return state;
}

export function setAuthState(
  state: { email: string; expiresAt: number },
  keepLoggedIn: boolean,
) {
  if (typeof window === "undefined") return;
  const payload: AuthState = {
    email: state.email.trim().toLowerCase(),
    expiresAt: state.expiresAt,
  };

  if (keepLoggedIn) {
    writeStore(LOCAL_KEY, payload, true);
    window.sessionStorage.removeItem(SESSION_KEY);
  } else {
    writeStore(SESSION_KEY, payload, false);
    window.localStorage.removeItem(LOCAL_KEY);
  }
}

export function clearAuthState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_KEY);
  window.sessionStorage.removeItem(SESSION_KEY);
}
