"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PaletteMode } from "@mui/material/styles";
import { createAppTheme } from "./theme";

type AppThemeProviderProps = {
  children: ReactNode;
};

type ThemeModeContextValue = {
  mode: PaletteMode;
  setMode: (mode: PaletteMode) => void;
  toggleMode: () => void;
};

const THEME_MODE_KEY = "mc_theme_mode";
const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function AppThemeProvider({ children }: AppThemeProviderProps) {
  const [mode, setMode] = useState<PaletteMode>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem(THEME_MODE_KEY);
    return stored === "light" || stored === "dark" ? stored : "light";
  });

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const value = useMemo<ThemeModeContextValue>(
    () => ({
      mode,
      setMode: (next) => {
        setMode(next);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(THEME_MODE_KEY, next);
        }
      },
      toggleMode: () => {
        const next: PaletteMode = mode === "dark" ? "light" : "dark";
        setMode(next);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(THEME_MODE_KEY, next);
        }
      },
    }),
    [mode],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useAppThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error("useAppThemeMode must be used within AppThemeProvider");
  }
  return ctx;
}
