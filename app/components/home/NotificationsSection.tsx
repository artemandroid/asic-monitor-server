import type { ReactNode } from "react";
import { Alert, Box, Collapse, Paper, Stack, Typography } from "@mui/material";
import { ActionButton } from "@/app/components/ui/ActionButton";
import type { SxProps, Theme } from "@mui/material/styles";
import { CommandType, type Notification } from "@/app/lib/types";
import { t, type UiLang } from "@/app/lib/ui-lang";

type GroupedNotification = Notification & { count?: number };

type RestartActionState = {
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
  restartActionStateForNote: (note: Notification) => RestartActionState;
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
  onToggleCollapsed,
  onRequestMinerCommandConfirm,
  containerSx,
  horizontalCollapse = false,
}: NotificationsSectionProps) {
  const isRestartNotification = (note: Notification) =>
    note.action === CommandType.RESTART || /restart|рестарт|перезапуск|перезавантаж/i.test(note.message);
  const isOffNotification = (note: Notification) =>
    /auto off|power off|turned off|switch off|вимк|відключ|отключ|знеструм|sleep/i.test(note.message);
  const getSeverity = (note: Notification): "error" | "info" | "success" => {
    if (isOffNotification(note)) return "error";
    if (isRestartNotification(note)) return "info";
    return "success";
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
            </Alert>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}
