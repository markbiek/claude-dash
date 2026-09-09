import { join } from "node:path";
import { readBranchFromGit } from "./branch";
import {
  lookupTarget,
  readCmuxMap,
  type CmuxMap,
  type CmuxTarget,
} from "./cmuxmap";
import type { Result } from "./result";
import {
  readSessionsDir,
  type RawSession,
  type SessionScan,
} from "./sessions";
import {
  emptyDetail,
  readDetail,
  type SessionDetail,
} from "./transcript";
import { getUsage, type UsageRow } from "./usage";

export type SessionRow = RawSession &
  SessionDetail & { target: CmuxTarget | null };

export type Snapshot = {
  generatedAt: number;
  usage: Result<UsageRow[]>;
  sessions: SessionRow[];
  malformed: number;
  dead: number;
};

export function assemble(args: {
  now: number;
  scan: SessionScan;
  details: Map<number, SessionDetail>;
  usage: Result<UsageRow[]>;
  map: CmuxMap;
}): Snapshot {
  const sessions = args.scan.sessions.map((s): SessionRow => {
    const detail = args.details.get(s.pid) ?? emptyDetail();
    return { ...s, ...detail, target: lookupTarget(args.map, s.tmux) };
  });

  return {
    generatedAt: args.now,
    usage: args.usage,
    sessions,
    malformed: args.scan.malformed,
    dead: args.scan.dead,
  };
}

let cmuxCache: { at: number; map: CmuxMap } | null = null;

async function cachedCmuxMap(now: number, ttlMs: number): Promise<CmuxMap> {
  if (cmuxCache !== null && now - cmuxCache.at >= 0 && now - cmuxCache.at < ttlMs) {
    return cmuxCache.map;
  }
  const map = await readCmuxMap();
  cmuxCache = { at: now, map };
  return map;
}

export async function collect(opts: {
  now: number;
  claudeDir: string;
  cachePath: string;
  usageTtlMs: number;
  cmuxTtlMs: number;
}): Promise<Snapshot> {
  const projectsDir = join(opts.claudeDir, "projects");

  const [scan, usage, map] = await Promise.all([
    readSessionsDir(join(opts.claudeDir, "sessions")),
    getUsage({
      cachePath: opts.cachePath,
      now: opts.now,
      ttlMs: opts.usageTtlMs,
    }),
    cachedCmuxMap(opts.now, opts.cmuxTtlMs),
  ]);

  const details = new Map<number, SessionDetail>();
  await Promise.all(
    scan.sessions.map(async (s) => {
      const detail = await readDetail(projectsDir, s.cwd, s.sessionId);
      const branch = detail.branch ?? readBranchFromGit(s.cwd);
      details.set(s.pid, { ...detail, branch });
    }),
  );

  return assemble({ now: opts.now, scan, details, usage, map });
}
