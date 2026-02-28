import { useState, type ReactNode } from "react";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { Box, Button, IconButton, Menu, MenuItem, Paper, Stack, Tooltip } from "@mui/material";
import type { PaletteMode } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import { t, type UiLang } from "@/app/lib/ui-lang";

type HomeHeaderProps = {
  uiLang: UiLang;
  settingsIcon: ReactNode;
  refreshIcon: ReactNode;
  logoutIcon: ReactNode;
  themeMode: PaletteMode;
  onOpenSettings: () => void;
  onSetLang: (lang: UiLang) => void;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onLogout: () => void;
};

export function HomeHeader({
  uiLang,
  settingsIcon,
  refreshIcon,
  logoutIcon,
  themeMode,
  onOpenSettings,
  onSetLang,
  onToggleTheme,
  onRefresh,
  onLogout,
}: HomeHeaderProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const headerUi = theme.app.header;
  const [langAnchorEl, setLangAnchorEl] = useState<null | HTMLElement>(null);
  const [langMenuWidth, setLangMenuWidth] = useState<number>(0);
  const isLangMenuOpen = Boolean(langAnchorEl);

  const settingsLabel = t(uiLang, "settings");
  const syncLabel = t(uiLang, "sync");
  const themeLabel = themeMode === "dark" ? t(uiLang, "theme_dark") : t(uiLang, "theme_light");
  const logoutLabel = t(uiLang, "logout");
  const currentLangLabel = uiLang === "uk" ? "🇺🇦 Українська" : "🇬🇧 English";
  const languageMenuItemSx = {
    minHeight: headerUi.language.itemHeight,
    px: 1.2,
    borderRadius: headerUi.language.itemRadius,
    fontWeight: headerUi.language.itemFontWeight,
  };
  const baseIconButtonSx = {
    width: headerUi.controlSize,
    height: headerUi.controlSize,
  } as const;
  const iconButtonSx = (
    tone: "secondary" | "settings" | "error",
    iconSize: number,
  ) => {
    const toneStyles =
      tone === "secondary"
        ? {
            color: "secondary.main",
            bgcolor: isDark ? "rgba(148,163,184,0.14)" : "rgba(148,163,184,0.2)",
          }
        : tone === "settings"
          ? {
              color: "text.primary",
              bgcolor: isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.24)",
            }
          : {
              color: "error.main",
              bgcolor: isDark ? "rgba(248,113,113,0.12)" : "rgba(248,113,113,0.16)",
            };

    return {
      ...baseIconButtonSx,
      ...toneStyles,
      "& svg": { width: iconSize, height: iconSize },
    };
  };

  return (
    <Paper
      component="header"
      elevation={0}
      sx={{
        p: 1.25,
        mb: 1.5,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: headerUi.gap,
        background: isDark
          ? "linear-gradient(180deg, rgba(27,30,35,0.96) 0%, rgba(23,26,30,0.88) 100%)"
          : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          component="img"
          src={isDark ? "/mining-control-logo-light.svg" : "/mining-control-logo-dark.svg"}
          alt={t(uiLang, "mining_control")}
          sx={{ width: headerUi.logoSize, height: headerUi.logoSize, display: "block", flexShrink: 0 }}
        />
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
        <Button
          onClick={(event) => {
            setLangMenuWidth(event.currentTarget.clientWidth);
            setLangAnchorEl(event.currentTarget);
          }}
          endIcon={<KeyboardArrowDownRoundedIcon />}
          sx={{
            height: headerUi.controlSize,
            px: 1.35,
            minWidth: 0,
            borderRadius: isLangMenuOpen
              ? headerUi.language.triggerRadiusOpen
              : headerUi.language.triggerRadiusClosed,
            border: "1px solid",
            borderColor: isLangMenuOpen ? "transparent" : "divider",
            color: "text.primary",
            bgcolor: isLangMenuOpen
              ? isDark
                ? "rgba(148,163,184,0.22)"
                : "rgba(148,163,184,0.28)"
              : isDark
                ? "rgba(148,163,184,0.14)"
                : "rgba(148,163,184,0.2)",
            boxShadow: "none",
            "&:hover": {
              boxShadow: "none",
              bgcolor: isDark ? "rgba(148,163,184,0.22)" : "rgba(148,163,184,0.28)",
            },
          }}
        >
          {currentLangLabel}
        </Button>
        <Menu
          anchorEl={langAnchorEl}
          open={isLangMenuOpen}
          onClose={() => setLangAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          PaperProps={{
            sx: {
              mt: "-1px",
              width: langMenuWidth || undefined,
              minWidth: langMenuWidth || undefined,
              boxSizing: "border-box",
              p: 0.45,
              borderRadius: headerUi.language.menuRadius,
              border: "1px solid",
              borderColor: "divider",
              borderTop: 0,
              bgcolor: isDark ? "rgba(27,30,35,0.98)" : "rgba(248,250,252,0.98)",
              boxShadow: isDark
                ? "0 10px 26px rgba(2,6,23,0.42)"
                : "0 10px 26px rgba(15,23,42,0.16)",
              backdropFilter: "blur(10px)",
            },
          }}
          MenuListProps={{ dense: true, sx: { p: 0, display: "grid", gap: 0.35 } }}
        >
          <MenuItem
            selected={uiLang === "en"}
            onClick={() => {
              onSetLang("en");
              setLangAnchorEl(null);
            }}
            sx={languageMenuItemSx}
          >
            🇬🇧 English
          </MenuItem>
          <MenuItem
            selected={uiLang === "uk"}
            onClick={() => {
              onSetLang("uk");
              setLangAnchorEl(null);
            }}
            sx={languageMenuItemSx}
          >
            🇺🇦 Українська
          </MenuItem>
        </Menu>

        <Tooltip title={themeLabel} arrow>
          <IconButton
            onClick={onToggleTheme}
            aria-label={themeLabel}
            sx={iconButtonSx("secondary", headerUi.iconSizeTheme)}
          >
            {themeMode === "dark" ? <DarkModeRoundedIcon /> : <LightModeRoundedIcon />}
          </IconButton>
        </Tooltip>

        <Tooltip title={syncLabel} arrow>
          <IconButton
            onClick={onRefresh}
            aria-label={syncLabel}
            sx={iconButtonSx("secondary", headerUi.iconSizeDefault)}
          >
            {refreshIcon}
          </IconButton>
        </Tooltip>

        <Tooltip title={settingsLabel} arrow>
          <IconButton
            onClick={onOpenSettings}
            aria-label={settingsLabel}
            sx={iconButtonSx("settings", headerUi.iconSizeDefault)}
          >
            {settingsIcon}
          </IconButton>
        </Tooltip>

        <Tooltip title={logoutLabel} arrow>
          <IconButton
            onClick={onLogout}
            aria-label={logoutLabel}
            sx={iconButtonSx("error", headerUi.iconSizeDefault)}
          >
            {logoutIcon}
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
