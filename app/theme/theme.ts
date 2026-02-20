import { createTheme } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material/styles";

export function createAppTheme(mode: PaletteMode) {
  const isLight = mode === "light";
  return createTheme({
    palette: {
      mode,
      primary: {
        main: isLight ? "#475569" : "#6b7280",
        contrastText: "#f8fafc",
      },
      secondary: {
        main: isLight ? "#64748b" : "#9ca3af",
      },
      background: {
        default: isLight ? "#f3f6fb" : "#0f1113",
        paper: isLight ? "#ffffff" : "#171a1e",
      },
      divider: isLight ? "rgba(100, 116, 139, 0.24)" : "rgba(148, 163, 184, 0.24)",
      text: isLight
        ? {
            primary: "#0f172a",
            secondary: "#475569",
          }
        : {
            primary: "#e2e8f0",
            secondary: "#94a3b8",
          },
      success: {
        main: "#34d399",
      },
      warning: {
        main: "#f59e0b",
      },
      error: {
        main: "#f87171",
      },
      custom: {
        chipTextOnSuccess: isLight ? "#065f46" : "#111827",
        deyeNeutralGray: "#64748b",
        deyeFullBlue: "#60a5fa",
        deyeNegativeRed: "#ef4444",
      },
    },
    shape: {
      borderRadius: 12,
    },
    typography: {
      fontFamily: "'Space Grotesk', 'Manrope', 'IBM Plex Sans', 'Segoe UI', sans-serif",
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            border: isLight
              ? "1px solid rgba(148, 163, 184, 0.28)"
              : "1px solid rgba(148, 163, 184, 0.22)",
          },
        },
      },
      MuiButton: {
        defaultProps: {
          variant: "contained",
        },
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 700,
            borderRadius: 999,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: ({ ownerState, theme }) =>
            ownerState.color === "success" &&
            ownerState.variant === "filled" &&
            theme.palette.mode === "light"
              ? {
                  backgroundColor: "rgba(52, 211, 153, 0.18)",
                  border: "1px solid rgba(16, 185, 129, 0.4)",
                }
              : {},
        },
      },
      MuiTextField: {
        defaultProps: {
          size: "small",
        },
      },
    },
  });
}

export const appTheme = createAppTheme("light");
