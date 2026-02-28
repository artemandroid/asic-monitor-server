export function toGh(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // ASIC payload may come in MH/s (e.g. 16110) or GH/s (e.g. 16.11).
  return value > 500 ? value / 1000 : value;
}

export function formatRuntime(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "-";
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  // Show seconds only before first full day of uptime.
  if (d === 0 && s > 0) parts.push(`${s}s`);
  return parts.length > 0 ? parts.join(" ") : "0s";
}

export function formatLastSeen(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour12: false });
  }
  return date.toLocaleString();
}
