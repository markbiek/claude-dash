import { collect, type Snapshot } from "./collect";
import { resetLabel } from "./format";
import { isOk } from "./result";

export type WatchEntry = { status: string; workspace: string | null };

export type WatchState = {
  sessions: Record<string, WatchEntry>;
  firedUsage: Record<string, number>;
};

export type ActionScope =
  | { readonly kind: "session"; readonly key: string }
  | { readonly kind: "usage"; readonly key: string };

export type Action = {
  kind: "set-status" | "clear-status" | "notify";
  argv: string[];
  // What this action is for. A failed action must not let its own state
  // advance, or the event it was announcing is lost with no way to retry.
  scope: ActionScope;
};

function sessionScope(pid: number): ActionScope {
  return { kind: "session", key: String(pid) };
}

function usageScope(key: string): ActionScope {
  return { kind: "usage", key };
}

export const THRESHOLDS = [50, 80, 95];

const STATUS_KEY = "claude-waiting";
const WAITING_COLOR = "#f5a623";
const WAITING_PRIORITY = "100";
const BODY_MAX = 120;

export function emptyWatchState(): WatchState {
  return { sessions: {}, firedUsage: {} };
}

function setStatus(workspace: string, scope: ActionScope): Action {
  return {
    kind: "set-status",
    scope,
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

function clearStatus(workspace: string, scope: ActionScope): Action {
  return {
    kind: "clear-status",
    scope,
    argv: ["cmux", "clear-status", STATUS_KEY, "--workspace", workspace],
  };
}

function notify(
  title: string,
  body: string,
  workspace: string | null,
  scope: ActionScope,
): Action {
  const argv = ["cmux", "notify", "--title", title, "--body", body.slice(0, BODY_MAX)];
  if (workspace !== null) argv.push("--workspace", workspace);
  return { kind: "notify", argv, scope };
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
          sessionScope(row.pid),
        ),
      );
      if (workspace !== null) {
        actions.push(setStatus(workspace, sessionScope(row.pid)));
      }
    }

    if (was === "waiting" && row.status !== "waiting") {
      const previousWorkspace = prev.sessions[key]?.workspace ?? workspace;
      if (previousWorkspace !== null) {
        actions.push(clearStatus(previousWorkspace, sessionScope(row.pid)));
      }
    }

    // The chip lives on the workspace resolved when the session entered
    // waiting. Keep that workspace for as long as it stays waiting, so the
    // clear lands where the chip actually is even if the target re-resolves.
    const stickyWorkspace =
      row.status === "waiting" && was === "waiting"
        ? (prev.sessions[key]?.workspace ?? workspace)
        : workspace;
    next.sessions[key] = { status: row.status, workspace: stickyWorkspace };
  }

  for (const [key, entry] of Object.entries(prev.sessions)) {
    if (next.sessions[key] !== undefined) continue;
    if (entry.status === "waiting" && entry.workspace !== null) {
      actions.push(clearStatus(entry.workspace, { kind: "session", key }));
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
          usageScope(key),
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

async function runAction(action: Action): Promise<boolean> {
  try {
    const proc = Bun.spawn(action.argv, {
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, CMUX_QUIET: "1" },
    });
    return (await proc.exited) === 0;
  } catch {
    // cmux may not be running at all.
    return false;
  }
}

// Commit the diff, except for the scopes whose actions failed. Those keep their
// previous value so the next tick sees the same transition and retries it. A
// scope with no previous value is dropped entirely, which has the same effect.
//
// The walk covers both maps, not just the new one. A session that disappears
// while its chip is still set has no entry in `next` at all, so iterating only
// `next` would silently drop it and the failed clear would never retry.
function rollback<T>(
  prevMap: Readonly<Record<string, T>>,
  nextMap: Readonly<Record<string, T>>,
  failed: ReadonlySet<string>,
  prefix: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of new Set([...Object.keys(prevMap), ...Object.keys(nextMap)])) {
    if (failed.has(`${prefix}:${key}`)) {
      const previous = prevMap[key];
      if (previous !== undefined) out[key] = previous;
      continue;
    }
    const value = nextMap[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function commit(
  prev: WatchState,
  next: WatchState,
  failed: ReadonlySet<string>,
): WatchState {
  return {
    sessions: rollback(prev.sessions, next.sessions, failed, "session"),
    firedUsage: rollback(prev.firedUsage, next.firedUsage, failed, "usage"),
  };
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
    const failed = new Set<string>();
    for (const action of actions) {
      if (!(await runAction(action))) {
        failed.add(`${action.scope.kind}:${action.scope.key}`);
      }
    }
    state = commit(state, next, failed);
    await Bun.write(opts.statePath, JSON.stringify(state));
  }

  await tick();
  setInterval(() => void tick(), opts.intervalMs);
  await new Promise<void>(() => {});
}
