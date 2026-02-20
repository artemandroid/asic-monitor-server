import type { ReactNode } from "react";
import { Box, Button, FormControl, MenuItem, Paper, Select, Stack } from "@mui/material";
import { t, type UiLang } from "@/app/lib/ui-lang";

type HomeHeaderProps = {
  uiLang: UiLang;
  reloadPending: boolean;
  minersCount: number;
  settingsIcon: ReactNode;
  logoutIcon: ReactNode;
  onOpenSettings: () => void;
  onSetLang: (lang: UiLang) => void;
  onRefresh: () => void;
  onReloadConfig: () => void;
  onLogout: () => void;
};

export function HomeHeader({
  uiLang,
  reloadPending,
  minersCount,
  settingsIcon,
  logoutIcon,
  onOpenSettings,
  onSetLang,
  onRefresh,
  onReloadConfig,
  onLogout,
}: HomeHeaderProps) {
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
        background: "linear-gradient(180deg, rgba(27,30,35,0.96) 0%, rgba(23,26,30,0.88) 100%)",
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            px: 1.5,
            py: 0.7,
            borderRadius: 2,
            background: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
            color: "white",
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 0.3,
            whiteSpace: "nowrap",
            boxShadow: "0 8px 24px rgba(75, 85, 99, 0.35)",
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
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <Select
            value={uiLang}
            onChange={(e) => onSetLang(e.target.value as UiLang)}
            displayEmpty
            renderValue={(value) => (value === "uk" ? "🇺🇦 Українська" : "🇬🇧 English")}
            sx={{
              borderRadius: 2,
              bgcolor: "rgba(148,163,184,0.12)",
              "& .MuiSelect-select": { py: 0.8, fontWeight: 700 },
            }}
          >
            <MenuItem value="en">🇬🇧 English</MenuItem>
            <MenuItem value="uk">🇺🇦 Українська</MenuItem>
          </Select>
        </FormControl>

        <Button
          onClick={onRefresh}
          color="secondary"
          variant="outlined"
          sx={{ borderRadius: 2 }}
        >
          {t(uiLang, "sync")}
        </Button>

        <Button
          onClick={onReloadConfig}
          disabled={reloadPending || minersCount === 0}
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
