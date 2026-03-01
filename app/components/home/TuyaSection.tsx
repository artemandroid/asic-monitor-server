import AppsRoundedIcon from "@mui/icons-material/AppsRounded";
import type { MinerState } from "@/app/lib/types";
import {
  Box,
  Chip,
  Collapse,
  FormControl,
  FormControlLabel,
  MenuItem,
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
import { ActionButton } from "@/app/components/ui/ActionButton";
import { SectionPaper } from "@/app/components/ui/SectionPaper";
import { StatusChip } from "@/app/components/ui/StatusChip";
import { t, type UiLang } from "@/app/lib/ui-lang";

type TuyaDevice = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  switchCode: string | null;
  powerW: number | null;
  energyTodayKwh: number | null;
  energyTotalKwh: number | null;
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
  deyeStationByDeviceId: Record<string, string>;
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
  deyeStationByDeviceId,
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
  const statusLabel = (d: TuyaDevice) =>
    d.on === null ? (d.online ? "?" : t(uiLang, "offl")) : d.on ? onText : offText;
  const compactCellSx = {
    py: 0.45,
    px: 1,
  } as const;
  const totalTodayKwh = (tuyaData?.devices ?? []).reduce(
    (sum, d) => sum + (typeof d.energyTodayKwh === "number" ? d.energyTodayKwh : 0),
    0,
  );
  const formatKwh = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value)
      ? `${value.toFixed(Math.abs(value) < 1 ? 3 : 2)} kWh`
      : "-";

  return (
    <SectionPaper sx={{ mb: 1.25 }}>
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
            {t(uiLang, "smartlife_automats")} ({t(uiLang, "today_kwh")}: {totalTodayKwh.toFixed(2)} kWh)
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
                  <StatusChip
                    key={`${d.id}-collapsed`}
                    isActive={d.on}
                    label={d.name}
                    title={`${d.name}: ${statusLabel(d)}`}
                    truncate
                    sx={{ maxWidth: 220 }}
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
                <TableCell sx={compactCellSx}>{t(uiLang, "automat")}</TableCell>
                <TableCell align="center" sx={compactCellSx}>{t(uiLang, "st")}</TableCell>
                <TableCell align="center" sx={compactCellSx}>{t(uiLang, "pwr")}</TableCell>
                <TableCell align="center" sx={compactCellSx}>{t(uiLang, "today_kwh")}</TableCell>
                <TableCell align="center" sx={compactCellSx}>{t(uiLang, "deye_station")}</TableCell>
                <TableCell align="center" sx={compactCellSx}>{t(uiLang, "bind_asic")}</TableCell>
                <TableCell align="center" sx={compactCellSx}>{t(uiLang, "ctrl")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleTuyaDevices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ ...compactCellSx, color: "text.secondary" }}>
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
                      <TableCell sx={compactCellSx}>
                        <Typography variant="body2" fontWeight={700} noWrap maxWidth={260}>
                          {device.name}
                        </Typography>
                      </TableCell>
                      <TableCell align="center" sx={compactCellSx}>
                        <StatusChip
                          isActive={device.on}
                          label={statusLabel(device)}
                          sx={{ minWidth: 74 }}
                        />
                      </TableCell>
                      <TableCell align="center" sx={compactCellSx}>
                        {typeof device.powerW === "number" ? `${device.powerW.toFixed(0)}W` : "-"}
                      </TableCell>
                      <TableCell align="center" sx={compactCellSx}>
                        {formatKwh(device.energyTodayKwh)}
                      </TableCell>
                      <TableCell align="center" sx={compactCellSx}>
                        <Typography variant="body2" noWrap maxWidth={140}>
                          {deyeStationByDeviceId[device.id] ?? "-"}
                        </Typography>
                      </TableCell>
                      <TableCell align="center" sx={{ ...compactCellSx, minWidth: 260 }}>
                        <FormControl size="small" sx={{ width: 260 }}>
                          <Select
                            value={linkedMinerId}
                            displayEmpty
                            sx={{ width: "100%" }}
                            renderValue={(selected) => {
                              const minerId = String(selected ?? "");
                              if (!minerId) {
                                return (
                                  <Typography variant="body2" color="text.disabled">
                                    {t(uiLang, "choose_miner")}
                                  </Typography>
                                );
                              }
                              return minerAliases[minerId]?.trim() || minerId;
                            }}
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
                            <MenuItem value="">
                              <Typography variant="body2" color="text.disabled">
                                {t(uiLang, "choose_miner")}
                              </Typography>
                            </MenuItem>
                            {orderedMiners.map((m) => (
                              <MenuItem key={`${device.id}-miner-${m.minerId}`} value={m.minerId}>
                                {minerAliases[m.minerId]?.trim() || m.minerId}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell align="center" sx={compactCellSx}>
                        <Stack direction="row" spacing={0.6} justifyContent="center">
                          <ActionButton
                            minWidth={74}
                            variant={onDisabled ? "outlined" : "contained"}
                            color="success"
                            disabled={onDisabled}
                            title={device.switchCode ? `Code: ${device.switchCode}` : "No switch code"}
                            onClick={() => onRequestTuyaSwitchConfirm(device, true)}
                          >
                            {pending === "ON" ? "..." : onText}
                          </ActionButton>
                          <ActionButton
                            minWidth={74}
                            variant={offDisabled ? "outlined" : "contained"}
                            color="error"
                            disabled={offDisabled}
                            title={device.switchCode ? `Code: ${device.switchCode}` : "No switch code"}
                            onClick={() => onRequestTuyaSwitchConfirm(device, false)}
                          >
                            {pending === "OFF" ? "..." : offText}
                          </ActionButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ mt: 0.75, display: "flex", justifyContent: "flex-start" }}>
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
    </SectionPaper>
  );
}
