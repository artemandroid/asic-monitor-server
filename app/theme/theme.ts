import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#6b7280",
      contrastText: "#f8fafc",
    },
    secondary: {
      main: "#9ca3af",
    },
    background: {
      default: "#0f1113",
      paper: "#171a1e",
    },
    divider: "rgba(148, 163, 184, 0.24)",
    success: {
      main: "#34d399",
    },
    warning: {
      main: "#f59e0b",
    },
    error: {
      main: "#f87171",
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
          border: "1px solid rgba(148, 163, 184, 0.22)",
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
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
  },
});
