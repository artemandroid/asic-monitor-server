// ── External API ───────────────────────────────────────────────────────────────

/** Hard timeout for all outbound HTTP requests to external APIs (Deye, Tuya). */
export const FETCH_TIMEOUT_MS = 15_000;

// ── Deye ───────────────────────────────────────────────────────────────────────

/** Default Deye OpenAPI base URL used when DEYE_BASE_URL is not set. */
export const DEYE_BASE_URL_DEFAULT = "https://eu1-developer.deyecloud.com/v1.0";

/** Default timezone for "today" station-history requests. */
export const DEYE_HISTORY_DAY_TIME_ZONE_DEFAULT = "Europe/Kiev";

/** Cache TTL for computed today generation from /station/history (milliseconds). */
export const DEYE_HISTORY_GENERATION_CACHE_TTL_MS = 6 * 60 * 1_000;

// ── Tuya ──────────────────────────────────────────────────────────────────────

/** How long a cached Tuya snapshot stays fresh. Also used as the background-refresh interval. */
export const TUYA_CACHE_MAX_AGE_MS = 60 * 60 * 1_000; // 1 hour

/** Background-refresh fires at the same cadence as the cache TTL. */
export const TUYA_BACKGROUND_REFRESH_MS = TUYA_CACHE_MAX_AGE_MS;

// ── Power automation ───────────────────────────────────────────────────────────

/** Minimum quiet period between consecutive automation decisions. */
export const POWER_AUTOMATION_DEBOUNCE_MS = 45_000;

/** Minimum wall-clock interval between automation loop runs. */
export const POWER_AUTOMATION_MIN_RUN_INTERVAL_MS = 15_000;

/** Battery SoC (%) below which miners are force-powered off when no explicit threshold is set. */
export const DEFAULT_CRITICAL_OFF_BATTERY_PERCENT = 30;

/** Minutes a miner sleeps after an overheat event when no per-miner value is set. */
export const DEFAULT_OVERHEAT_SLEEP_MINUTES = 30;

/** kW tolerance added when checking whether solar generation "covers" consumption. */
export const GENERATION_COVER_TOLERANCE_KW = 0.2;

/** kW threshold below which battery discharge is considered effectively zero. */
export const BATTERY_NOT_DISCHARGING_MAX_KW = 0.05;

// ── Metrics ────────────────────────────────────────────────────────────────────

/** Board-level hashrate deviation (%) that triggers a drift notification. */
export const BOARD_HASHRATE_DRIFT_PERCENT = 10;

/** Minimum time between repeated board-drift notifications for the same miner. */
export const BOARD_HASHRATE_DRIFT_NOTIFY_COOLDOWN_MS = 10 * 60 * 1_000;

// ── UI polling defaults ────────────────────────────────────────────────────────

/** Default miner-list polling interval when the server has not provided a setting. */
export const DEFAULT_MINER_SYNC_MS = 60_000;

/** Default Deye station polling interval when the server has not provided a setting. */
export const DEFAULT_DEYE_SYNC_MS = 360_000;

/** Default Tuya polling interval (mirrors the cache TTL). */
export const DEFAULT_TUYA_SYNC_MS = TUYA_CACHE_MAX_AGE_MS;

/** Tuya sync interval in seconds (used when reporting back to settings API). */
export const FIXED_TUYA_SYNC_SEC = TUYA_CACHE_MAX_AGE_MS / 1_000;

/** How long after a low-hashrate restart the UI suppresses further restart prompts. */
export const LOW_HASHRATE_RESTART_GRACE_MS = 10 * 60 * 1_000;

/** How long a manual control action (restart/sleep/wake) locks the UI control buttons. */
export const CONTROL_ACTION_LOCK_MS = 10 * 60 * 1_000;

// ── Electricity tariff ──────────────────────────────────────────────────────────

/** Hour (inclusive) at which the night tariff zone begins. */
export const NIGHT_TARIFF_START_HOUR = 23;

/** Hour (exclusive) at which the night tariff zone ends (day begins). */
export const NIGHT_TARIFF_END_HOUR = 7;
