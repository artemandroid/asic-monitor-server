import type { ReactNode } from "react";
import { Alert, Box, Collapse, Paper, Stack, Typography } from "@mui/material";
import { ActionButton } from "@/app/components/ui/ActionButton";
import type { SxProps, Theme } from "@mui/material/styles";
import { CommandType, type Notification } from "@/app/lib/types";
import { t, type UiLang } from "@/app/lib/ui-lang";

type GroupedNotification = Notification & { count?: number };

type CommandActionState = {
  enabled: boolean;
  title?: string;
};

type NotificationsSectionProps = {
  uiLang: UiLang;
  notificationsCollapsed: boolean;
  groupedNotificationsCount: number;
  visibleGroupedNotifications: GroupedNotification[];
  bellIcon: ReactNode;
  localizeNotificationMessage: (note: Notification) => string;
  restartActionStateForNote: (note: Notification) => CommandActionState;
  wakeActionStateForNote: (note: Notification) => CommandActionState;
  onToggleCollapsed: () => void;
  onRequestMinerCommandConfirm: (minerId: string, command: CommandType) => void;
  containerSx?: SxProps<Theme>;
  horizontalCollapse?: boolean;
};

export function NotificationsSection({
  uiLang,
  notificationsCollapsed,
  groupedNotificationsCount,
  visibleGroupedNotifications,
  bellIcon,
  localizeNotificationMessage,
  restartActionStateForNote,
  wakeActionStateForNote,
  onToggleCollapsed,
  onRequestMinerCommandConfirm,
  containerSx,
  horizontalCollapse = false,
}: NotificationsSectionProps) {
  const getSeverity = (note: Notification): "error" | "warning" | "info" | "success" => {
    switch (note.type) {
      case "COMMAND_RESULT":
        return /\bfailed\b/i.test(note.message) ? "error" : "info";
      case "OVERHEAT_COOLDOWN":
      case "LOW_HASHRATE_PROMPT":
      case "CLIENT_ERROR":
        return "error";
      case "AUTO_RESTART":
      case "BOARD_HASHRATE_DRIFT":
      case "OVERHEAT_WAKE_DEFERRED":
        return "warning";
      case "OVERHEAT_UNLOCKED":
        return "info";
      case "OVERHEAT_WAKE_SENT":
        return "success";
      case "POWER_AUTOMATION":
        return /auto on/i.test(note.message) ? "success" : "warning";
      default:
        return "info";
    }
  };

  if (horizontalCollapse && notificationsCollapsed) {
    return (
      <Paper sx={{ p: 0.8, height: "100%", ...containerSx }}>
        <Stack
          alignItems="center"
          justifyContent="flex-start"
          spacing={0.5}
          sx={{ cursor: "pointer", pt: 0.3 }}
          onClick={onToggleCollapsed}
        >
          {bellIcon}
          <Typography variant="caption" fontWeight={800}>
            {groupedNotificationsCount}
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">▸</Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 1.25, height: "100%", ...containerSx }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ cursor: "pointer" }}
        onClick={onToggleCollapsed}
      >
        <Stack direction="row" alignItems="center" spacing={0.8}>
          {bellIcon}
          <Typography variant="subtitle2" fontWeight={800}>
            {t(uiLang, "notifications")} ({groupedNotificationsCount})
          </Typography>
        </Stack>
        <Typography variant="subtitle2" color="text.secondary">{notificationsCollapsed ? "▸" : "▾"}</Typography>
      </Stack>

      <Collapse in={!notificationsCollapsed}>
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {visibleGroupedNotifications.length === 0 && (
            <Typography variant="body2">{t(uiLang, "no_notifications")}</Typography>
          )}

          {visibleGroupedNotifications.map((note) => (
            <Alert
              key={note.id}
              severity={getSeverity(note)}
              variant="outlined"
              sx={{
                borderRadius: 2,
                alignItems: "flex-start",
                "& .MuiAlert-message": { width: "100%" },
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {new Date(note.createdAt).toLocaleString()}
                {note.count && note.count > 1 ? ` x${note.count}` : ""}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.4 }}>
                {localizeNotificationMessage(note)}
              </Typography>

              {note.action === CommandType.RESTART && note.minerId && (() => {
                const restartAction = restartActionStateForNote(note);
                return (
                  <Box sx={{ mt: 0.9 }}>
                    <ActionButton
                      variant={restartAction.enabled ? "contained" : "outlined"}
                      color={restartAction.enabled ? "primary" : "inherit"}
                      disabled={!restartAction.enabled}
                      title={restartAction.title}
                      onClick={() => onRequestMinerCommandConfirm(note.minerId!, CommandType.RESTART)}
                    >
                      {t(uiLang, "restart_now")}
                    </ActionButton>
                  </Box>
                );
              })()}

              {note.action === CommandType.WAKE && note.minerId && (() => {
                const wakeAction = wakeActionStateForNote(note);
                return (
                  <Box sx={{ mt: 0.9 }}>
                    <ActionButton
                      variant={wakeAction.enabled ? "contained" : "outlined"}
                      color={wakeAction.enabled ? "success" : "inherit"}
                      disabled={!wakeAction.enabled}
                      title={wakeAction.title}
                      onClick={() => onRequestMinerCommandConfirm(note.minerId!, CommandType.WAKE)}
                    >
                      {t(uiLang, "wake")}
                    </ActionButton>
                  </Box>
                );
              })()}
            </Alert>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}
