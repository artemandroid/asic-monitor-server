"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthState, setAuthState } from "@/app/lib/auth-client";

export default function AuthPage() {
  const router = useRouter();
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const state = getAuthState();
    if (state) {
      router.replace("/");
      return;
    }
    setChecked(true);
  }, [router]);

  const handleLogin = () => {
    setAuthState(keepLoggedIn);
    router.replace("/");
  };

  if (!checked) {
    return null;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, #f8f3ea 0%, #f5f8f3 100%)",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          width: "min(440px, 90vw)",
          background: "white",
          borderRadius: 16,
          padding: 32,
          border: "1px solid #e7e2d8",
          boxShadow: "0 20px 50px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Mining Control</h1>
        <p style={{ marginTop: 0, color: "#555" }}>
          Demo login. Google auth will be added later.
        </p>
        <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={keepLoggedIn}
              onChange={(e) => setKeepLoggedIn(e.target.checked)}
            />
            <span>Keep me logged in</span>
          </label>
          <button
            onClick={handleLogin}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #1d4ed8",
              background: "#1d4ed8",
              color: "white",
              fontWeight: 600,
            }}
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
}
