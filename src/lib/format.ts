export function initials(email: string) {
  const local = email.split("@")[0].replace(/[^a-z0-9]/gi, "");
  return (local.slice(0, 2) || "GI").toUpperCase();
}

export function fmtPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtEntry(min: number, max: number) {
  return min === max ? fmtPrice(min) : `${fmtPrice(min)} – ${fmtPrice(max)}`;
}

export function fmtR(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 100)}%`;
}

export function fmtMinutes(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const total = Math.round(Math.abs(n));
  if (total < 60) return `${sign}${total}m`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours < 24) return minutes ? `${sign}${hours}h ${minutes}m` : `${sign}${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${sign}${days}d ${restHours}h` : `${sign}${days}d`;
}

export function fmtAge(iso: string | Date, now = Date.now()) {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  const ms = Math.max(0, now - t);
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return fmtMinutes(ms / 60_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Absolute UTC with the year, so a prior-year fill is not hidden by a day-and-month label. */
export function fmtDateTime(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hour}:${minute} UTC`;
}

export function fmtDate(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 });
}
