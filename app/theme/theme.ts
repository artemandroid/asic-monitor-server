import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#4f8cff",
    },
    secondary: {
      main: "#22d3ee",
    },
    background: {
      default: "#0b1220",
      paper: "#111a2d",
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
