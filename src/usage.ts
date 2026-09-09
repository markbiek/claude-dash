import { err, isOk, ok, type Result } from "./result";

export type UsageKind = "session" | "weekly_all" | "weekly_scoped";

export type UsageRow = {
  kind: UsageKind;
  label: string;
  percent: number;
  severity: string;
  resetsAt: string | null;
};

export type UsageCache = { fetchedAt: number; rows: UsageRow[] };

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

const KIND_ORDER: UsageKind[] = ["session", "weekly_all", "weekly_scoped"];
const FIXED_LABELS: Partial<Record<UsageKind, string>> = {
  session: "SESSION",
  weekly_all: "WEEK",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function scopedLabel(entry: Record<string, unknown>): string {
  const scope = asRecord(entry.scope);
  const model = scope ? asRecord(scope.model) : null;
  const name = model ? model.display_name : null;
  if (typeof name === "string" && name.length > 0) return name.toUpperCase();
  return "SCOPED";
}

export function parseUsage(payload: unknown): Result<UsageRow[]> {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root.limits)) {
    return err("unexpected usage schema");
  }

  const rows: { order: number; index: number; row: UsageRow }[] = [];

  root.limits.forEach((raw, index) => {
    const entry = asRecord(raw);
    if (entry === null) return;

    const kind = entry.kind;
    if (typeof kind !== "string") return;
    const order = KIND_ORDER.indexOf(kind as UsageKind);
    if (order === -1) return;

    const percent = Number(entry.percent);
    if (!Number.isFinite(percent)) return;

    const label =
      FIXED_LABELS[kind as UsageKind] ?? scopedLabel(entry);
    const resetsAt =
      typeof entry.resets_at === "string" ? entry.resets_at : null;
    const severity =
      typeof entry.severity === "string" ? entry.severity : "normal";

    rows.push({
      order,
      index,
      row: { kind: kind as UsageKind, label, percent, severity, resetsAt },
    });
  });

  rows.sort((a, b) => a.order - b.order || a.index - b.index);
  return ok(rows.map((r) => r.row));
}

export function isFresh(
  cache: UsageCache | null,
  now: number,
  ttlMs: number,
): boolean {
  if (cache === null) return false;
  const age = now - cache.fetchedAt;
  return age >= 0 && age < ttlMs;
}

export function readCredentials(): Result<{
  accessToken: string;
  expiresAt: number;
}> {
  const proc = Bun.spawnSync([
    "security",
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-w",
  ]);
  if (proc.exitCode !== 0) return err("no keychain credentials");

  try {
    const parsed = JSON.parse(proc.stdout.toString());
    const oauth = asRecord(parsed)?.claudeAiOauth;
    const record = asRecord(oauth);
    const token = record?.accessToken;
    const expiresAt = Number(record?.expiresAt);
    if (typeof token !== "string" || token.length === 0) {
      return err("no access token");
    }
    return ok({
      accessToken: token,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    });
  } catch {
    return err("unreadable keychain payload");
  }
}

export async function fetchUsage(
  accessToken: string,
): Promise<Result<UsageRow[]>> {
  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": OAUTH_BETA,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return err(`usage HTTP ${response.status}`);
    return parseUsage(await response.json());
  } catch {
    return err("usage unreachable");
  }
}

async function readCache(path: string): Promise<UsageCache | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return (await file.json()) as UsageCache;
  } catch {
    return null;
  }
}

export async function getUsage(opts: {
  cachePath: string;
  now: number;
  ttlMs: number;
}): Promise<Result<UsageRow[]>> {
  const cache = await readCache(opts.cachePath);
  if (isFresh(cache, opts.now, opts.ttlMs) && cache !== null) {
    return ok(cache.rows);
  }

  const creds = readCredentials();
  if (!isOk(creds)) return creds;
  if (creds.value.expiresAt > 0 && creds.value.expiresAt <= opts.now) {
    return err("reauth");
  }

  const fresh = await fetchUsage(creds.value.accessToken);
  if (!isOk(fresh)) {
    if (cache !== null) return ok(cache.rows);
    return fresh;
  }

  const next: UsageCache = { fetchedAt: opts.now, rows: fresh.value };
  await Bun.write(opts.cachePath, JSON.stringify(next));
  return fresh;
}
