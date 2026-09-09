import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type RawSession = {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  status: string;
  updatedAt: number;
  statusUpdatedAt: number;
  tmux: string | null;
  kind: string;
};

export type SessionScan = {
  sessions: RawSession[];
  malformed: number;
  dead: number;
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseSessionFile(text: string): RawSession | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;

  const pid = Number(d.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (typeof d.sessionId !== "string" || d.sessionId.length === 0) return null;
  if (typeof d.cwd !== "string" || d.cwd.length === 0) return null;

  const startedAt = num(d.startedAt, 0);
  const updatedAt = num(d.updatedAt, startedAt);

  return {
    pid,
    sessionId: d.sessionId,
    cwd: d.cwd,
    name: str(d.name, d.sessionId),
    status: str(d.status, "unknown"),
    updatedAt,
    statusUpdatedAt: num(d.statusUpdatedAt, updatedAt),
    tmux: typeof d.tmux === "string" && d.tmux.length > 0 ? d.tmux : null,
    kind: str(d.kind, "unknown"),
  };
}

export function scanSessions(
  files: string[],
  isAlive: (pid: number) => boolean,
): SessionScan {
  const sessions: RawSession[] = [];
  let malformed = 0;
  let dead = 0;

  for (const text of files) {
    const parsed = parseSessionFile(text);
    if (parsed === null) {
      malformed += 1;
      continue;
    }
    if (!isAlive(parsed.pid)) {
      dead += 1;
      continue;
    }
    sessions.push(parsed);
  }

  sessions.sort((a, b) => a.pid - b.pid);
  return { sessions, malformed, dead };
}

export function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
}

export async function readSessionsDir(
  dir: string,
  isAlive: (pid: number) => boolean = defaultIsAlive,
): Promise<SessionScan> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { sessions: [], malformed: 0, dead: 0 };
  }

  const texts: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      texts.push(await readFile(join(dir, name), "utf8"));
    } catch {
      // A session that exits mid-read removes its own file. Ignore it.
    }
  }

  return scanSessions(texts, isAlive);
}
