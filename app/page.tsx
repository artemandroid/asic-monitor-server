"use client";

import { Container, Stack } from "@mui/material";
import { HomeHeader } from "@/app/components/home/HomeHeader";
import { DeyeStationSection } from "@/app/components/home/DeyeStationSection";
import { TuyaSection } from "@/app/components/home/TuyaSection";
import { NotificationsSection } from "@/app/components/home/NotificationsSection";
import { ConfirmActionModal } from "@/app/components/home/ConfirmActionModal";
import { GeneralSettingsModal } from "@/app/components/home/GeneralSettingsModal";
import { MinerSettingsModal } from "@/app/components/home/MinerSettingsModal";
import { MinerGridSection } from "@/app/components/home/MinerGridSection";
import { BellIcon, LogoutIcon, RefreshIcon, SettingsIcon } from "@/app/components/icons";
import { useHomeController } from "@/app/hooks/useHomeController";

export default function Home() {
  const home = useHomeController();

  if (!home.authChecked) {
    return null;
  }

  return (
    <Container maxWidth={false} sx={{ p: 2 }}>
      <HomeHeader
        uiLang={home.uiLang}
        loading={home.loading}
        reloadPending={home.reloadPending}
        minersCount={home.miners.length}
        settingsIcon={<SettingsIcon />}
        refreshIcon={<RefreshIcon />}
        logoutIcon={<LogoutIcon />}
        onOpenSettings={home.openGeneralSettings}
        onSetLang={home.setLanguage}
        onRefresh={() => {
          void home.refreshAll();
        }}
        onReloadConfig={home.reloadConfig}
        onLogout={() => {
          void home.logout();
        }}
      />

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

      <Stack spacing={1.25} sx={{ mt: 1.25, color: "text.primary" }}>
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
          editingAliasFor={home.editingAliasFor}
          aliasDraft={home.aliasDraft}
          lowHashrateRestartGraceMs={home.lowHashrateRestartGraceMs}
          formatRuntime={home.formatRuntime}
          formatLastSeen={home.formatLastSeen}
          isHashrateReady={home.isHashrateReady}
          onOpenMinerSettings={home.openMinerSettings}
          onMoveCardToTop={home.moveCardToTop}
          onStartAliasEdit={home.startAliasEdit}
          onAliasDraftChange={home.setAliasDraft}
          onSaveAlias={home.saveAlias}
          onCancelAliasEdit={home.cancelAliasEdit}
          onRequestMinerCommandConfirm={home.requestMinerCommandConfirm}
          onUnlockOverheatControl={(minerId) => {
            void home.unlockOverheatControl(minerId);
          }}
        />

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
        />
      </Stack>

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
