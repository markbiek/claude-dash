const FILLED = "█";
const EMPTY = "▁";

export function bar(percent: number, width: number): string {
  if (width <= 0) return "";
  const clamped = Math.min(100, Math.max(0, percent));
  let filled = Math.round((clamped / 100) * width);
  if (clamped > 0 && filled === 0) filled = 1;
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

export function relAge(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function resetLabel(isoOrNull: string | null, now: number): string {
  if (isoOrNull === null) return "—";
  const at = new Date(isoOrNull);
  if (Number.isNaN(at.getTime())) return "—";
  const today = new Date(now);
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  const hour24 = at.getHours();
  const suffix = hour24 < 12 ? "a" : "p";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  if (sameDay) {
    const mins = String(at.getMinutes()).padStart(2, "0");
    return `${hour12}:${mins}${suffix}`;
  }
  return `${WEEKDAYS[at.getDay()] ?? ""} ${hour12}${suffix}`;
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

export function shortPath(absPath: string, home: string, max: number): string {
  let p = absPath;
  if (p === home) p = "~";
  else if (p.startsWith(home + "/")) p = "~/" + p.slice(home.length + 1);
  if (p.length <= max) return p;

  const parts = p.split("/");
  const last = parts[parts.length - 1] ?? p;
  const head = parts[0] ?? "";
  const collapsed = `${head}/…/${last}`;
  if (collapsed.length <= max) return collapsed;

  const room = max - (head.length + 3);
  if (room <= 0) return truncate(p, max);
  return `${head}/…/${truncate(last, room)}`;
}
