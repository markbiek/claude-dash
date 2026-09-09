import { collect, type Snapshot } from "./collect";
import { resetLabel } from "./format";
import { isOk } from "./result";

export type WatchEntry = { status: string; workspace: string | null };

export type WatchState = {
  sessions: Record<string, WatchEntry>;
  firedUsage: Record<string, number>;
};

export type Action = {
  kind: "set-status" | "clear-status" | "notify";
  argv: string[];
};

export const THRESHOLDS = [50, 80, 95];

const STATUS_KEY = "claude-waiting";
const WAITING_COLOR = "#f5a623";
const WAITING_PRIORITY = "100";
const BODY_MAX = 120;

export function emptyWatchState(): WatchState {
  return { sessions: {}, firedUsage: {} };
}

function setStatus(workspace: string): Action {
  return {
    kind: "set-status",
    argv: [
      "cmux",
      "set-status",
      STATUS_KEY,
      "waiting",
      "--color",
      WAITING_COLOR,
      "--priority",
      WAITING_PRIORITY,
      "--workspace",
      workspace,
    ],
  };
}

function clearStatus(workspace: string): Action {
  return {
    kind: "clear-status",
    argv: ["cmux", "clear-status", STATUS_KEY, "--workspace", workspace],
  };
}

function notify(title: string, body: string, workspace: string | null): Action {
  const argv = ["cmux", "notify", "--title", title, "--body", body.slice(0, BODY_MAX)];
  if (workspace !== null) argv.push("--workspace", workspace);
  return { kind: "notify", argv };
}

export function diffWatch(
  prev: WatchState,
  snap: Snapshot,
  thresholds: number[],
): { actions: Action[]; next: WatchState } {
  const actions: Action[] = [];
  const next: WatchState = { sessions: {}, firedUsage: { ...prev.firedUsage } };

  for (const row of snap.sessions) {
    const key = String(row.pid);
    const workspace = row.target?.workspace ?? null;
    const was = prev.sessions[key]?.status ?? null;

    if (row.status === "waiting" && was !== "waiting") {
      actions.push(
        notify(
          `${row.name} needs you`,
          row.lastUserMessage ?? row.cwd,
          workspace,
        ),
      );
      if (workspace !== null) actions.push(setStatus(workspace));
    }

    if (was === "waiting" && row.status !== "waiting") {
      const previousWorkspace = prev.sessions[key]?.workspace ?? workspace;
      if (previousWorkspace !== null) actions.push(clearStatus(previousWorkspace));
    }

    next.sessions[key] = { status: row.status, workspace };
  }

  for (const [key, entry] of Object.entries(prev.sessions)) {
    if (next.sessions[key] !== undefined) continue;
    if (entry.status === "waiting" && entry.workspace !== null) {
      actions.push(clearStatus(entry.workspace));
    }
  }

  if (isOk(snap.usage)) {
    const live = new Set<string>();
    for (const usage of snap.usage.value) {
      const key = `${usage.kind}:${usage.resetsAt ?? "none"}`;
      live.add(key);
      const fired = prev.firedUsage[key] ?? 0;
      const crossed = thresholds.filter((t) => usage.percent >= t && t > fired);
      const highest = crossed[crossed.length - 1];
      if (highest === undefined) {
        next.firedUsage[key] = fired;
        continue;
      }
      actions.push(
        notify(
          `Claude ${usage.label} at ${Math.round(usage.percent)}%`,
          `resets ${resetLabel(usage.resetsAt, snap.generatedAt)}`,
          null,
        ),
      );
      next.firedUsage[key] = highest;
    }
    for (const key of Object.keys(next.firedUsage)) {
      if (!live.has(key)) delete next.firedUsage[key];
    }
  }

  return { actions, next };
}

async function readState(path: string): Promise<WatchState> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return emptyWatchState();
    const parsed = (await file.json()) as Partial<WatchState>;
    return {
      sessions: parsed.sessions ?? {},
      firedUsage: parsed.firedUsage ?? {},
    };
  } catch {
    return emptyWatchState();
  }
}

async function runAction(action: Action): Promise<void> {
  try {
    const proc = Bun.spawn(action.argv, {
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, CMUX_QUIET: "1" },
    });
    await proc.exited;
  } catch {
    // cmux may not be running. The next tick tries again.
  }
}

export async function runWatch(opts: {
  claudeDir: string;
  cachePath: string;
  statePath: string;
  usageTtlMs: number;
  cmuxTtlMs: number;
  intervalMs: number;
}): Promise<void> {
  let state = await readState(opts.statePath);

  async function tick(): Promise<void> {
    let snap: Snapshot;
    try {
      snap = await collect({
        now: Date.now(),
        claudeDir: opts.claudeDir,
        cachePath: opts.cachePath,
        usageTtlMs: opts.usageTtlMs,
        cmuxTtlMs: opts.cmuxTtlMs,
      });
    } catch {
      return;
    }

    const { actions, next } = diffWatch(state, snap, THRESHOLDS);
    for (const action of actions) await runAction(action);
    state = next;
    await Bun.write(opts.statePath, JSON.stringify(state));
  }

  await tick();
  setInterval(() => void tick(), opts.intervalMs);
  await new Promise<void>(() => {});
}
