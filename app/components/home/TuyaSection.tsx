import AppsRoundedIcon from "@mui/icons-material/AppsRounded";
import type { MinerState } from "@/app/lib/types";
import {
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { t, type UiLang } from "@/app/lib/ui-lang";

type TuyaDevice = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  switchCode: string | null;
  powerW: number | null;
  category: string | null;
  productName: string | null;
};

type TuyaSnapshot = {
  updatedAt: string;
  total: number;
  devices: TuyaDevice[];
  error?: string;
};

type TuyaSectionProps = {
  uiLang: UiLang;
  tuyaData: TuyaSnapshot | null;
  tuyaLoading: boolean;
  tuyaCollapsed: boolean;
  hideUnboundAutomats: boolean;
  visibleTuyaDevices: TuyaDevice[];
  deviceToMiner: Map<string, string>;
  tuyaBindingByMiner: Record<string, string>;
  pendingTuyaByDevice: Record<string, "ON" | "OFF" | undefined>;
  orderedMiners: MinerState[];
  minerAliases: Record<string, string>;
  onText: string;
  offText: string;
  formatUpdatedAt: (iso?: string | null) => string;
  onToggleCollapsed: () => void;
  onToggleHideUnbound: (value: boolean) => void;
  onSaveTuyaBinding: (minerId: string, deviceId: string | null) => void;
  onRequestTuyaSwitchConfirm: (device: TuyaDevice, on: boolean) => void;
};

export function TuyaSection({
  uiLang,
  tuyaData,
  tuyaLoading,
  tuyaCollapsed,
  hideUnboundAutomats,
  visibleTuyaDevices,
  deviceToMiner,
  tuyaBindingByMiner,
  pendingTuyaByDevice,
  orderedMiners,
  minerAliases,
  onText,
  offText,
  formatUpdatedAt,
  onToggleCollapsed,
  onToggleHideUnbound,
  onSaveTuyaBinding,
  onRequestTuyaSwitchConfirm,
}: TuyaSectionProps) {
  const theme = useTheme();
  const greenChipText = theme.palette.custom.chipTextOnSuccess;
  const statusLabel = (d: TuyaDevice) =>
    d.on === null ? (d.online ? "?" : t(uiLang, "offl")) : d.on ? onText : offText;
  const statusVariant = (d: TuyaDevice) =>
    d.on === null ? "outlined" : d.on ? "filled" : "outlined";
  const statusColor = (d: TuyaDevice): "success" | "default" =>
    d.on === true ? "success" : "default";

  return (
    <Paper sx={{ p: 1.25, mb: 1.25 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        onClick={onToggleCollapsed}
        sx={{ cursor: "pointer" }}
      >
        <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
          <AppsRoundedIcon sx={{ fontSize: 18, color: "info.light", flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={800}>
            {t(uiLang, "smartlife_automats")} ({visibleTuyaDevices.length}/{tuyaData?.total ?? tuyaData?.devices.length ?? 0})
          </Typography>

          {tuyaCollapsed && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, overflow: "hidden" }}>
              {visibleTuyaDevices.length === 0 ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t(uiLang, "no_devices")}
                  sx={{ borderStyle: "dashed" }}
                />
              ) : (
                visibleTuyaDevices.slice(0, 4).map((d) => (
                  <Chip
                    key={`${d.id}-collapsed`}
                    size="small"
                    color={statusColor(d)}
                    variant={statusVariant(d)}
                    label={d.name}
                    title={`${d.name}: ${statusLabel(d)}`}
                    sx={{
                      maxWidth: 220,
                      borderWidth: d.on === false ? 2 : undefined,
                      color: d.on === true ? greenChipText : undefined,
                      "& .MuiChip-label": {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 700,
                        color: d.on === true ? greenChipText : undefined,
                      },
                    }}
                  />
                ))
              )}
            </Stack>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {tuyaLoading
              ? t(uiLang, "updating")
              : `${t(uiLang, "updated")}: ${formatUpdatedAt(tuyaData?.updatedAt)}`}
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">{tuyaCollapsed ? "▸" : "▾"}</Typography>
        </Stack>
      </Stack>

      <Collapse in={!tuyaCollapsed}>
        <TableContainer sx={{ maxHeight: 260, mt: 1 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t(uiLang, "automat")}</TableCell>
                <TableCell align="center">{t(uiLang, "st")}</TableCell>
                <TableCell align="center">{t(uiLang, "pwr")}</TableCell>
                <TableCell align="center">{t(uiLang, "bind_asic")}</TableCell>
                <TableCell align="center">{t(uiLang, "ctrl")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleTuyaDevices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: "text.secondary" }}>
                    {t(uiLang, "no_devices_yet")}
                  </TableCell>
                </TableRow>
              ) : (
                visibleTuyaDevices.map((device) => {
                  const linkedMinerId = deviceToMiner.get(device.id) ?? "";
                  const pending = pendingTuyaByDevice[device.id];
                  const onDisabled = !device.online || pending === "ON" || device.on === true;
                  const offDisabled = !device.online || pending === "OFF" || device.on === false;

                  return (
                    <TableRow key={device.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700} noWrap maxWidth={260}>
                          {device.name}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          size="small"
                          color={statusColor(device)}
                          variant={statusVariant(device)}
                          label={statusLabel(device)}
                          sx={{
                            minWidth: 74,
                            fontWeight: 700,
                            borderWidth: device.on === false ? 2 : undefined,
                            color: device.on === true ? greenChipText : undefined,
                            "& .MuiChip-label": { color: device.on === true ? greenChipText : undefined },
                          }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        {typeof device.powerW === "number" ? `${device.powerW.toFixed(0)}W` : "-"}
                      </TableCell>
                      <TableCell align="center">
                        <FormControl size="small" sx={{ minWidth: 150 }}>
                          <Select
                            value={linkedMinerId}
                            onChange={(e) => {
                              const targetMiner = e.target.value || null;
                              const oldMinerId =
                                Object.entries(tuyaBindingByMiner).find(([, devId]) => devId === device.id)?.[0] ?? null;
                              if (oldMinerId && oldMinerId !== targetMiner) {
                                onSaveTuyaBinding(oldMinerId, null);
                              }
                              if (targetMiner) {
                                onSaveTuyaBinding(targetMiner, device.id);
                              }
                            }}
                          >
                            <MenuItem value="">-</MenuItem>
                            {orderedMiners.map((m) => (
                              <MenuItem key={`${device.id}-miner-${m.minerId}`} value={m.minerId}>
                                {(minerAliases[m.minerId]?.trim() || m.minerId).slice(0, 24)}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell align="center">
                        <Stack direction="row" spacing={0.6} justifyContent="center">
                          <Button
                            size="small"
                            variant={onDisabled ? "outlined" : "contained"}
                            color="success"
                            disabled={onDisabled}
                            title={device.switchCode ? `Code: ${device.switchCode}` : "No switch code"}
                            onClick={() => onRequestTuyaSwitchConfirm(device, true)}
                          >
                            {pending === "ON" ? "..." : onText}
                          </Button>
                          <Button
                            size="small"
                            variant={offDisabled ? "outlined" : "contained"}
                            color="error"
                            disabled={offDisabled}
                            title={device.switchCode ? `Code: ${device.switchCode}` : "No switch code"}
                            onClick={() => onRequestTuyaSwitchConfirm(device, false)}
                          >
                            {pending === "OFF" ? "..." : offText}
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ mt: 0.75, display: "flex", justifyContent: "flex-end" }}>
          <FormControlLabel
            control={<Switch checked={hideUnboundAutomats} onChange={(e) => onToggleHideUnbound(e.target.checked)} />}
            label={t(uiLang, "hide_unbinded_automats")}
          />
        </Box>
      </Collapse>

      {tuyaData?.error ? (
        <Typography variant="caption" color="error.main" sx={{ mt: 0.75, display: "block" }}>
          Tuya API error: {tuyaData.error}
        </Typography>
      ) : null}
    </Paper>
  );
}
