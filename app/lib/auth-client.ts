"use client";

type AuthState = {
  token: string;
  expiresAt: number;
};

const LOCAL_KEY = "mc_auth";
const SESSION_KEY = "mc_auth_session";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readStore(key: string): AuthState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
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

export function setAuthState(keepLoggedIn: boolean) {
  if (typeof window === "undefined") return;
  const token = crypto.randomUUID();
  const expiresAt =
    Date.now() + (keepLoggedIn ? PERSIST_TTL_MS : SESSION_TTL_MS);
  const state: AuthState = { token, expiresAt };

  if (keepLoggedIn) {
    writeStore(LOCAL_KEY, state, true);
    window.sessionStorage.removeItem(SESSION_KEY);
  } else {
    writeStore(SESSION_KEY, state, false);
    window.localStorage.removeItem(LOCAL_KEY);
  }
}

export function clearAuthState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_KEY);
  window.sessionStorage.removeItem(SESSION_KEY);
}
