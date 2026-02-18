import type { ReactNode } from "react";
import { Box, Button, Paper, Stack } from "@mui/material";
import { t, type UiLang } from "@/app/lib/ui-lang";

type HomeHeaderProps = {
  uiLang: UiLang;
  loading: boolean;
  reloadPending: boolean;
  minersCount: number;
  settingsIcon: ReactNode;
  refreshIcon: ReactNode;
  logoutIcon: ReactNode;
  onOpenSettings: () => void;
  onSetLang: (lang: UiLang) => void;
  onRefresh: () => void;
  onReloadConfig: () => void;
  onLogout: () => void;
};

export function HomeHeader({
  uiLang,
  loading,
  reloadPending,
  minersCount,
  settingsIcon,
  refreshIcon,
  logoutIcon,
  onOpenSettings,
  onSetLang,
  onRefresh,
  onReloadConfig,
  onLogout,
}: HomeHeaderProps) {
  const langButtonSx = (lang: UiLang) => ({
    minWidth: 56,
    borderRadius: 999,
    bgcolor: uiLang === lang ? "primary.main" : "transparent",
    color: uiLang === lang ? "primary.contrastText" : "text.secondary",
    borderColor: "divider",
  });

  return (
    <Paper
      component="header"
      elevation={0}
      sx={{
        p: 1.5,
        mb: 1.5,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        background: "linear-gradient(180deg, rgba(17,26,45,0.96) 0%, rgba(17,26,45,0.84) 100%)",
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            px: 1.5,
            py: 0.7,
            borderRadius: 2,
            background: "linear-gradient(135deg, #4f8cff 0%, #2563eb 100%)",
            color: "white",
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 0.3,
            whiteSpace: "nowrap",
            boxShadow: "0 8px 24px rgba(37, 99, 235, 0.35)",
          }}
        >
          {t(uiLang, "mining_control")}
        </Box>

        <Button
          onClick={onOpenSettings}
          color="inherit"
          startIcon={settingsIcon}
          sx={{
            borderRadius: 2,
            px: 1.5,
            color: "text.primary",
            bgcolor: "rgba(148,163,184,0.12)",
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          {t(uiLang, "settings")}
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
        <Stack direction="row" spacing={0.75}>
          <Button variant="outlined" onClick={() => onSetLang("en")} sx={langButtonSx("en")}>EN</Button>
          <Button variant="outlined" onClick={() => onSetLang("uk")} sx={langButtonSx("uk")}>UA</Button>
        </Stack>

        <Button onClick={onRefresh} startIcon={refreshIcon} color="primary">
          {t(uiLang, "refresh")}
        </Button>

        <Button
          onClick={onReloadConfig}
          disabled={reloadPending || loading || minersCount === 0}
          color="secondary"
          variant="outlined"
          sx={{ borderRadius: 2 }}
        >
          {reloadPending ? t(uiLang, "reloading") : t(uiLang, "reload_config")}
        </Button>

        <Button
          onClick={onLogout}
          startIcon={logoutIcon}
          color="error"
          variant="outlined"
          sx={{ borderRadius: 2 }}
        >
          {t(uiLang, "logout")}
        </Button>
      </Stack>
    </Paper>
  );
}
