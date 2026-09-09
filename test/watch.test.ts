import { expect, test } from "bun:test";
import { diffWatch, emptyWatchState, THRESHOLDS } from "../src/watch";
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
