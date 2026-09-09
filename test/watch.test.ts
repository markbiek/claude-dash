import { expect, test } from "bun:test";
import { commit, diffWatch, emptyWatchState, THRESHOLDS } from "../src/watch";
import type { SessionRow, Snapshot } from "../src/collect";
import { ok } from "../src/result";

const NOW = 1_788_978_000_000;
const TARGET = { workspace: "workspace:17", window: "window:1", title: "bug-fix" };

function row(over: Partial<SessionRow>): SessionRow {
  return {
    pid: 7,
    sessionId: "s1",
    cwd: "/Users/mark/dev/a8c/wpcom-wt/bug-fix",
    name: "bug-fix-af",
    status: "idle",
    updatedAt: NOW,
    statusUpdatedAt: NOW,
    tmux: "bug-fix:@2.%51",
    kind: "interactive",
    model: "claude-opus-5",
    effort: "high",
    lastUserMessage: "run the tests",
    lastTool: null,
    branch: "trunk",
    target: TARGET,
    ...over,
  };
}

function snapshot(sessions: SessionRow[], usage: Snapshot["usage"] = ok([])): Snapshot {
  return { generatedAt: NOW, usage, sessions, malformed: 0, dead: 0 };
}

test("a session entering waiting produces a notify and a status chip", () => {
  const { actions, next } = diffWatch(
    emptyWatchState(),
    snapshot([row({ status: "waiting" })]),
    THRESHOLDS,
  );
  expect(actions.map((a) => a.kind).sort()).toEqual(["notify", "set-status"]);
  const notify = actions.find((a) => a.kind === "notify");
  expect(notify?.argv).toContain("bug-fix-af needs you");
  expect(notify?.argv).toContain("run the tests");
  expect(next.sessions["7"]).toEqual({ status: "waiting", workspace: "workspace:17" });
});

test("a session that stays waiting produces nothing", () => {
  const prev = { sessions: { "7": { status: "waiting", workspace: "workspace:17" } }, firedUsage: {} };
  const { actions } = diffWatch(prev, snapshot([row({ status: "waiting" })]), THRESHOLDS);
  expect(actions).toEqual([]);
});

test("a session leaving waiting clears the chip", () => {
  const prev = { sessions: { "7": { status: "waiting", workspace: "workspace:17" } }, firedUsage: {} };
  const { actions } = diffWatch(prev, snapshot([row({ status: "busy" })]), THRESHOLDS);
  expect(actions).toHaveLength(1);
  expect(actions[0]?.kind).toBe("clear-status");
  expect(actions[0]?.argv).toContain("workspace:17");
});

test("a waiting session that exits clears its chip", () => {
  const prev = { sessions: { "7": { status: "waiting", workspace: "workspace:17" } }, firedUsage: {} };
  const { actions, next } = diffWatch(prev, snapshot([]), THRESHOLDS);
  expect(actions).toHaveLength(1);
  expect(actions[0]?.kind).toBe("clear-status");
  expect(next.sessions["7"]).toBeUndefined();
});

test("a waiting session with no cmux target still notifies", () => {
  const { actions } = diffWatch(
    emptyWatchState(),
    snapshot([row({ status: "waiting", target: null })]),
    THRESHOLDS,
  );
  expect(actions.map((a) => a.kind)).toEqual(["notify"]);
});

test("a usage bucket fires once at its highest crossed threshold", () => {
  const usage = ok([
    { kind: "weekly_all" as const, label: "WEEK", percent: 83, severity: "warning", resetsAt: "2026-09-13T01:59:59Z" },
  ]);
  const first = diffWatch(emptyWatchState(), snapshot([], usage), THRESHOLDS);
  expect(first.actions).toHaveLength(1);
  expect(first.actions[0]?.argv.join(" ")).toContain("WEEK");
  expect(first.next.firedUsage["weekly_all:2026-09-13T01:59:59Z"]).toBe(80);

  const second = diffWatch(first.next, snapshot([], usage), THRESHOLDS);
  expect(second.actions).toEqual([]);
});

test("a usage bucket fires again at the next threshold", () => {
  const prev = { sessions: {}, firedUsage: { "weekly_all:2026-09-13T01:59:59Z": 80 } };
  const usage = ok([
    { kind: "weekly_all" as const, label: "WEEK", percent: 96, severity: "critical", resetsAt: "2026-09-13T01:59:59Z" },
  ]);
  const { actions, next } = diffWatch(prev, snapshot([], usage), THRESHOLDS);
  expect(actions).toHaveLength(1);
  expect(next.firedUsage["weekly_all:2026-09-13T01:59:59Z"]).toBe(95);
});

test("a new reset window starts with a clean fired set", () => {
  const prev = { sessions: {}, firedUsage: { "weekly_all:2026-09-13T01:59:59Z": 95 } };
  const usage = ok([
    { kind: "weekly_all" as const, label: "WEEK", percent: 55, severity: "normal", resetsAt: "2026-09-20T01:59:59Z" },
  ]);
  const { actions, next } = diffWatch(prev, snapshot([], usage), THRESHOLDS);
  expect(actions).toHaveLength(1);
  expect(next.firedUsage["weekly_all:2026-09-20T01:59:59Z"]).toBe(50);
  expect(next.firedUsage["weekly_all:2026-09-13T01:59:59Z"]).toBeUndefined();
});

test("the chip clears on the workspace it was set on, not the current one", () => {
  const OTHER = { workspace: "workspace:99", window: "window:1", title: "other" };
  const enter = diffWatch(emptyWatchState(), snapshot([row({ status: "waiting" })]), THRESHOLDS);
  expect(enter.actions.find((a) => a.kind === "set-status")?.argv).toContain("workspace:17");

  const drift = diffWatch(
    enter.next,
    snapshot([row({ status: "waiting", target: OTHER })]),
    THRESHOLDS,
  );
  expect(drift.actions).toEqual([]);

  const leave = diffWatch(
    drift.next,
    snapshot([row({ status: "idle", target: OTHER })]),
    THRESHOLDS,
  );
  const cleared = leave.actions.find((a) => a.kind === "clear-status");
  expect(cleared?.argv).toContain("workspace:17");
  expect(cleared?.argv).not.toContain("workspace:99");
});

test("every action names the scope it belongs to", () => {
  const usage = ok([
    { kind: "weekly_all" as const, label: "WEEK", percent: 83, severity: "warning", resetsAt: "R" },
  ]);
  const { actions } = diffWatch(
    emptyWatchState(),
    snapshot([row({ status: "waiting" })], usage),
    THRESHOLDS,
  );
  for (const action of actions) expect(action.scope).toBeDefined();
  expect(
    actions.filter((a) => a.scope.kind === "session").every((a) => a.scope.key === "7"),
  ).toBe(true);
  expect(actions.find((a) => a.scope.kind === "usage")?.scope.key).toBe("weekly_all:R");
});

test("commit keeps everything when no action failed", () => {
  const prev = { sessions: { "7": { status: "idle", workspace: null } }, firedUsage: { a: 50 } };
  const next = { sessions: { "7": { status: "waiting", workspace: "w" } }, firedUsage: { a: 80 } };
  expect(commit(prev, next, new Set())).toEqual(next);
});

test("commit rolls a failed session back so the next tick retries it", () => {
  const prev = { sessions: { "7": { status: "idle", workspace: null } }, firedUsage: {} };
  const next = { sessions: { "7": { status: "waiting", workspace: "w" } }, firedUsage: {} };
  const out = commit(prev, next, new Set(["session:7"]));
  expect(out.sessions["7"]).toEqual({ status: "idle", workspace: null });
});

test("commit drops a failed session that had no previous entry", () => {
  const prev = { sessions: {}, firedUsage: {} };
  const next = { sessions: { "7": { status: "waiting", workspace: "w" } }, firedUsage: {} };
  const out = commit(prev, next, new Set(["session:7"]));
  expect(out.sessions["7"]).toBeUndefined();
});

test("commit rolls back only the usage bucket that failed", () => {
  const prev = { sessions: {}, firedUsage: { a: 50, b: 50 } };
  const next = { sessions: {}, firedUsage: { a: 80, b: 80 } };
  const out = commit(prev, next, new Set(["usage:a"]));
  expect(out.firedUsage).toEqual({ a: 50, b: 80 });
});

test("commit retries a failed clear for a session that vanished", () => {
  const prev = {
    sessions: { "7": { status: "waiting", workspace: "workspace:17" } },
    firedUsage: {},
  };
  const next = { sessions: {}, firedUsage: {} };
  const out = commit(prev, next, new Set(["session:7"]));
  expect(out.sessions["7"]).toEqual({ status: "waiting", workspace: "workspace:17" });
});

test("commit drops a vanished session whose clear succeeded", () => {
  const prev = {
    sessions: { "7": { status: "waiting", workspace: "workspace:17" } },
    firedUsage: {},
  };
  const next = { sessions: {}, firedUsage: {} };
  expect(commit(prev, next, new Set()).sessions["7"]).toBeUndefined();
});

test("a failed usage fetch changes nothing", () => {
  const prev = { sessions: {}, firedUsage: { "weekly_all:x": 50 } };
  const { actions, next } = diffWatch(
    prev,
    { generatedAt: NOW, usage: { ok: false, reason: "reauth" }, sessions: [], malformed: 0, dead: 0 },
    THRESHOLDS,
  );
  expect(actions).toEqual([]);
  expect(next.firedUsage["weekly_all:x"]).toBe(50);
});
