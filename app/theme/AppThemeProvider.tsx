"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PaletteMode } from "@mui/material/styles";
import { createAppTheme } from "./theme";

type AppThemeProviderProps = {
  children: ReactNode;
  initialMode: PaletteMode;
};

type ThemeModeContextValue = {
  mode: PaletteMode;
  setMode: (mode: PaletteMode) => void;
  toggleMode: () => void;
};

const THEME_MODE_KEY = "mc_theme_mode";
const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function persistThemeMode(next: PaletteMode) {
  window.localStorage.setItem(THEME_MODE_KEY, next);
  document.cookie = `${THEME_MODE_KEY}=${next}; path=/; max-age=31536000; samesite=lax`;
}

export function AppThemeProvider({ children, initialMode }: AppThemeProviderProps) {
  const [mode, setMode] = useState<PaletteMode>(initialMode);

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const value = useMemo<ThemeModeContextValue>(
    () => ({
      mode,
      setMode: (next) => {
        setMode(next);
        persistThemeMode(next);
      },
      toggleMode: () => {
        const next: PaletteMode = mode === "dark" ? "light" : "dark";
        setMode(next);
        persistThemeMode(next);
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
