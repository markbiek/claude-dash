import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type SessionDetail = {
  model: string | null;
  effort: string | null;
  lastUserMessage: string | null;
  lastTool: string | null;
  branch: string | null;
};

const TAIL_BYTES = 64 * 1024;

const TOOL_TARGET_KEYS = [
  "command",
  "file_path",
  "pattern",
  "path",
  "prompt",
  "query",
  "url",
  "skill",
];

export function emptyDetail(): SessionDetail {
  return {
    model: null,
    effort: null,
    lastUserMessage: null,
    lastTool: null,
    branch: null,
  };
}

export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function cleanUserText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("<")) return null;
  return trimmed.replace(/\s+/g, " ");
}

function userText(message: Record<string, unknown> | null): string | null {
  if (message === null) return null;
  const content = message.content;
  if (typeof content === "string") return cleanUserText(content);
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    const b = asRecord(block);
    if (b === null || b.type !== "text") continue;
    if (typeof b.text !== "string") continue;
    const cleaned = cleanUserText(b.text);
    if (cleaned !== null) return cleaned;
  }
  return null;
}

function toolLabel(block: Record<string, unknown>): string | null {
  const name = block.name;
  if (typeof name !== "string" || name.length === 0) return null;
  const input = asRecord(block.input);
  if (input === null) return name;
  for (const key of TOOL_TARGET_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return `${name}(${value.replace(/\s+/g, " ").trim()})`;
    }
  }
  return name;
}

function lastToolFrom(message: Record<string, unknown> | null): string | null {
  if (message === null) return null;
  const content = message.content;
  if (!Array.isArray(content)) return null;
  for (let i = content.length - 1; i >= 0; i--) {
    const b = asRecord(content[i]);
    if (b === null || b.type !== "tool_use") continue;
    const label = toolLabel(b);
    if (label !== null) return label;
  }
  return null;
}

function complete(d: SessionDetail): boolean {
  return (
    d.model !== null &&
    d.branch !== null &&
    d.lastUserMessage !== null &&
    d.lastTool !== null
  );
}

export function parseTranscript(text: string): SessionDetail {
  const detail = emptyDetail();
  const lines = text.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    if (complete(detail)) break;
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const d = asRecord(raw);
    if (d === null) continue;
    if (d.isSidechain === true) continue;

    if (
      detail.branch === null &&
      typeof d.gitBranch === "string" &&
      d.gitBranch.length > 0
    ) {
      detail.branch = d.gitBranch;
    }

    const message = asRecord(d.message);

    if (d.type === "assistant") {
      if (detail.model === null && typeof message?.model === "string") {
        detail.model = message.model;
        detail.effort = typeof d.effort === "string" ? d.effort : null;
      }
      if (detail.lastTool === null) {
        detail.lastTool = lastToolFrom(message);
      }
    }

    if (d.type === "user" && detail.lastUserMessage === null) {
      detail.lastUserMessage = userText(message);
    }
  }

  return detail;
}

const pathCache = new Map<string, string | null>();

export async function findTranscript(
  projectsDir: string,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const cached = pathCache.get(sessionId);
  if (cached !== undefined) return cached;

  const guess = join(projectsDir, projectDirName(cwd), `${sessionId}.jsonl`);
  if (await Bun.file(guess).exists()) {
    pathCache.set(sessionId, guess);
    return guess;
  }

  let dirs: string[];
  try {
    dirs = await readdir(projectsDir);
  } catch {
    pathCache.set(sessionId, null);
    return null;
  }

  for (const dir of dirs) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`);
    if (await Bun.file(candidate).exists()) {
      pathCache.set(sessionId, candidate);
      return candidate;
    }
  }

  pathCache.set(sessionId, null);
  return null;
}

type DetailCacheEntry = { size: number; mtimeMs: number; detail: SessionDetail };
const detailCache = new Map<string, DetailCacheEntry>();

export async function readDetail(
  projectsDir: string,
  cwd: string,
  sessionId: string,
): Promise<SessionDetail> {
  const path = await findTranscript(projectsDir, cwd, sessionId);
  if (path === null) return emptyDetail();

  const file = Bun.file(path);
  const size = file.size;
  const mtimeMs = file.lastModified;

  const cached = detailCache.get(path);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    return cached.detail;
  }

  const start = Math.max(0, size - TAIL_BYTES);
  const text = await file.slice(start, size).text();
  const detail = parseTranscript(text);
  detailCache.set(path, { size, mtimeMs, detail });
  return detail;
}
