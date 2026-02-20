"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Box, Container, Stack } from "@mui/material";
import { HomeHeader } from "@/app/components/home/HomeHeader";
import { DeyeStationSection } from "@/app/components/home/DeyeStationSection";
import { TuyaSection } from "@/app/components/home/TuyaSection";
import { NotificationsSection } from "@/app/components/home/NotificationsSection";
import { ConfirmActionModal } from "@/app/components/home/ConfirmActionModal";
import { GeneralSettingsModal } from "@/app/components/home/GeneralSettingsModal";
import { MinerSettingsModal } from "@/app/components/home/MinerSettingsModal";
import { BellIcon, LogoutIcon, SettingsIcon } from "@/app/components/icons";
import { useHomeController } from "@/app/hooks/useHomeController";
import { useAppThemeMode } from "@/app/theme/AppThemeProvider";

const NOTIFICATIONS_PANEL_WIDTH_KEY = "mc_notifications_panel_width";
const MinerGridSection = dynamic(
  () => import("@/app/components/home/MinerGridSection").then((m) => m.MinerGridSection),
  { ssr: false },
);

function Home() {
  const home = useHomeController();
  const themeMode = useAppThemeMode();
  const [notificationsPanelWidth, setNotificationsPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 420;
    const raw = window.localStorage.getItem(NOTIFICATIONS_PANEL_WIDTH_KEY);
    if (!raw) return 420;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 280 && parsed <= 900) {
      return parsed;
    }
    return 420;
  });
  const [isResizingNotifications, setIsResizingNotifications] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(420);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const panel = window.document.getElementById("notifications-panel");
    if (!panel) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width < 280 || width > 900) return;
      const rounded = Math.round(width);
      setNotificationsPanelWidth(rounded);
      window.localStorage.setItem(NOTIFICATIONS_PANEL_WIDTH_KEY, String(rounded));
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isResizingNotifications) return;
    const onMove = (event: MouseEvent) => {
      const delta = resizeStartXRef.current - event.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.6);
      const nextWidth = Math.max(280, Math.min(maxWidth, resizeStartWidthRef.current + delta));
      setNotificationsPanelWidth(nextWidth);
      window.localStorage.setItem(NOTIFICATIONS_PANEL_WIDTH_KEY, String(nextWidth));
    };
    const onUp = () => setIsResizingNotifications(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingNotifications]);

  if (!home.authChecked) {
    return null;
  }

  return (
    <Container maxWidth={false} sx={{ p: 2 }}>
      <HomeHeader
        uiLang={home.uiLang}
        reloadPending={home.reloadPending}
        minersCount={home.miners.length}
        settingsIcon={<SettingsIcon />}
        logoutIcon={<LogoutIcon />}
        themeMode={themeMode.mode}
        onOpenSettings={home.openGeneralSettings}
        onSetLang={home.setLanguage}
        onToggleTheme={themeMode.toggleMode}
        onRefresh={() => {
          void home.refreshAll();
        }}
        onReloadConfig={home.reloadConfig}
        onLogout={() => {
          void home.logout();
        }}
      />

      <Box
        sx={{
          mt: 0.25,
          display: { xs: "block", xl: "flex" },
          gap: 1.25,
          alignItems: "stretch",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack spacing={1.25} sx={{ color: "text.primary", minHeight: "100%" }}>
            <DeyeStationSection
              uiLang={home.uiLang}
              deyeStation={home.deyeStation}
              deyeLoading={home.deyeLoading}
              deyeCollapsed={home.deyeCollapsed}
              batteryMode={home.batteryMode}
              batteryModeLabel={home.batteryModeLabel}
              batteryColor={home.batteryColor}
              batteryFill={home.batteryFill}
              kwUnit={home.kwUnit}
              formatUpdatedAt={home.formatUpdatedAt}
              onToggleCollapsed={() => home.setDeyeCollapsed((prev) => !prev)}
            />

            <TuyaSection
              uiLang={home.uiLang}
              tuyaData={home.tuyaData}
              tuyaLoading={home.tuyaLoading}
              tuyaCollapsed={home.tuyaCollapsed}
              hideUnboundAutomats={home.hideUnboundAutomats}
              visibleTuyaDevices={home.visibleTuyaDevices}
              deviceToMiner={home.deviceToMiner}
              tuyaBindingByMiner={home.tuyaBindingByMiner}
              pendingTuyaByDevice={home.pendingTuyaByDevice}
              orderedMiners={home.orderedMiners}
              minerAliases={home.minerAliases}
              onText={home.onText}
              offText={home.offText}
              formatUpdatedAt={home.formatUpdatedAt}
              onToggleCollapsed={() => home.setTuyaCollapsed((prev) => !prev)}
              onToggleHideUnbound={home.setHideUnboundAutomats}
              onSaveTuyaBinding={(minerId, deviceId) => {
                void home.saveTuyaBinding(minerId, deviceId);
              }}
              onRequestTuyaSwitchConfirm={home.requestTuyaSwitchConfirm}
            />

            <MinerGridSection
              uiLang={home.uiLang}
              miners={home.miners}
              orderedMiners={home.orderedMiners}
              minerOrder={home.minerOrder}
              gridRef={home.minerGridRef}
              settingsIcon={<SettingsIcon />}
              minerControlStates={home.minerControlStates}
              pendingActionByMiner={home.pendingActionByMiner}
              minerAliases={home.minerAliases}
              tuyaBindingByMiner={home.tuyaBindingByMiner}
              deviceById={home.deviceById}
              onText={home.onText}
              offText={home.offText}
              statusBadgesVertical={home.statusBadgesVertical}
              boardCountByMiner={home.boardCountByMiner}
              editingAliasFor={home.editingAliasFor}
              aliasDraft={home.aliasDraft}
              lowHashrateRestartGraceMs={home.lowHashrateRestartGraceMs}
              formatRuntime={home.formatRuntime}
              formatLastSeen={home.formatLastSeen}
              isHashrateReady={home.isHashrateReady}
              onOpenMinerSettings={home.openMinerSettings}
              onReorderCard={home.reorderCard}
              onReorderCardToIndex={home.reorderCardToIndex}
              onStartAliasEdit={home.startAliasEdit}
              onAliasDraftChange={home.setAliasDraft}
              onSaveAlias={home.saveAlias}
              onCancelAliasEdit={home.cancelAliasEdit}
              onRequestMinerCommandConfirm={home.requestMinerCommandConfirm}
              onUnlockOverheatControl={(minerId) => {
                void home.unlockOverheatControl(minerId);
              }}
            />
          </Stack>
        </Box>

        {!home.notificationsCollapsed ? (
          <Box
            onMouseDown={(event) => {
              if (typeof window === "undefined" || window.innerWidth < 1200) return;
              event.preventDefault();
              resizeStartXRef.current = event.clientX;
              resizeStartWidthRef.current = notificationsPanelWidth;
              setIsResizingNotifications(true);
            }}
            sx={{
              display: { xs: "none", xl: "flex" },
              width: 14,
              minWidth: 14,
              alignSelf: "stretch",
              cursor: "ew-resize",
              alignItems: "stretch",
              justifyContent: "center",
              userSelect: "none",
            }}
            title="Resize notifications panel"
          >
            <Box
              sx={{
                width: 2,
                borderRadius: 999,
                bgcolor: isResizingNotifications ? "primary.main" : "divider",
                opacity: isResizingNotifications ? 0.8 : 1,
                transition: "background-color 120ms ease",
              }}
            />
          </Box>
        ) : null}

        <Box
          id="notifications-panel"
          sx={{
            width: { xs: "100%", xl: home.notificationsCollapsed ? 72 : notificationsPanelWidth },
            minWidth: { xs: "100%", xl: home.notificationsCollapsed ? 72 : 280 },
            maxWidth: { xs: "100%", xl: "60vw" },
            flexShrink: 0,
            overflow: "auto",
            transition: "width 180ms ease",
            position: "relative",
          }}
        >
          <NotificationsSection
            uiLang={home.uiLang}
            notificationsCollapsed={home.notificationsCollapsed}
            groupedNotificationsCount={home.groupedNotifications.length}
            visibleGroupedNotifications={home.visibleGroupedNotifications}
            bellIcon={<BellIcon />}
            localizeNotificationMessage={home.localizeNotificationMessage}
            restartActionStateForNote={home.restartActionStateForNote}
            onToggleCollapsed={() => home.setNotificationsCollapsed((prev) => !prev)}
            onRequestMinerCommandConfirm={home.requestMinerCommandConfirm}
            containerSx={{ minHeight: "100%" }}
            horizontalCollapse
          />
        </Box>
      </Box>

      {home.pendingConfirmAction && (
        <ConfirmActionModal
          uiLang={home.uiLang}
          pendingConfirmAction={home.pendingConfirmAction}
          onClose={() => home.setPendingConfirmAction(null)}
          onConfirm={() => {
            void home.runConfirmedAction();
          }}
        />
      )}

      {home.showGeneralSettings && home.generalSettingsDraft && (
        <GeneralSettingsModal
          uiLang={home.uiLang}
          draft={home.generalSettingsDraft}
          generalSettingsSaving={home.generalSettingsSaving}
          setDraft={home.setGeneralSettingsDraft}
          onClose={() => {
            home.setShowGeneralSettings(false);
            home.setGeneralSettingsDraft(null);
          }}
          onSave={home.saveGeneralSettings}
        />
      )}

      {home.activeMinerSettingsId && home.minerSettingsDraft && (
        <MinerSettingsModal
          uiLang={home.uiLang}
          draft={home.minerSettingsDraft}
          minerSettingsSaving={home.minerSettingsSaving}
          setDraft={home.setMinerSettingsDraft}
          formatLastSeen={home.formatLastSeen}
          onUnlockOverheatControl={(minerId) => {
            void home.unlockOverheatControl(minerId);
          }}
          onClose={() => {
            home.setActiveMinerSettingsId(null);
            home.setMinerSettingsDraft(null);
          }}
          onSave={home.saveMinerSettings}
        />
      )}
    </Container>
  );
}

export default Home;
