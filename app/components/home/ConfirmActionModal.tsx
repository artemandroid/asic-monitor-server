import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import type { CommandType } from "@/app/lib/types";
import { t, type UiLang } from "@/app/lib/ui-lang";

type TuyaDevice = {
  name: string;
};

type PendingConfirmAction =
  | { kind: "MINER_COMMAND"; minerId: string; command: CommandType }
  | { kind: "TUYA_SWITCH"; device: TuyaDevice; on: boolean };

type ConfirmActionModalProps = {
  uiLang: UiLang;
  pendingConfirmAction: PendingConfirmAction;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmActionModal({
  uiLang,
  pendingConfirmAction,
  onClose,
  onConfirm,
}: ConfirmActionModalProps) {
  const tuyaActionKey = pendingConfirmAction.kind === "TUYA_SWITCH"
    ? pendingConfirmAction.on
      ? "action_turn_on"
      : "action_turn_off"
    : null;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800 }}>{t(uiLang, "confirm_action")}</DialogTitle>
      <DialogContent>
        <Typography variant="body1">
          {pendingConfirmAction.kind === "MINER_COMMAND" ? (
            <>
              {pendingConfirmAction.command === "RESTART" &&
                t(uiLang, "confirm_restart_miner", { minerId: pendingConfirmAction.minerId })}
              {pendingConfirmAction.command === "SLEEP" &&
                t(uiLang, "confirm_sleep_miner", { minerId: pendingConfirmAction.minerId })}
              {pendingConfirmAction.command === "WAKE" &&
                t(uiLang, "confirm_wake_miner", { minerId: pendingConfirmAction.minerId })}
            </>
          ) : (
            t(uiLang, "confirm_turn_automat", {
              action: tuyaActionKey ? t(uiLang, tuyaActionKey) : "",
              name: pendingConfirmAction.device.name,
            })
          )}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {t(uiLang, "cancel")}
        </Button>
        <Button color="primary" onClick={onConfirm} autoFocus>
          {t(uiLang, "confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
