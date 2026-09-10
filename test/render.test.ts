import { expect, test } from "bun:test";
import { groupOf, orderRows, render, renderFrame, shortModel, visibleRows } from "../src/render";
import type { SessionRow, Snapshot } from "../src/collect";
import { err, ok } from "../src/result";

const NOW = 1_788_978_000_000;

function row(over: Partial<SessionRow>): SessionRow {
  return {
    pid: 1,
    sessionId: "s1",
    cwd: "/Users/mark/notes",
    name: "notes-aa",
    status: "idle",
    updatedAt: NOW - 60_000,
    statusUpdatedAt: NOW - 60_000,
    tmux: null,
    kind: "interactive",
    model: "claude-opus-5",
    effort: "high",
    lastUserMessage: "do the thing",
    lastTool: "Bash(npm test)",
    branch: "main",
    target: null,
    ...over,
  };
}

function snapshot(sessions: SessionRow[]): Snapshot {
  return {
    generatedAt: NOW,
    usageAt: NOW,
    usage: ok([
      { kind: "session", label: "SESSION", percent: 5, severity: "normal", resetsAt: null },
      { kind: "weekly_all", label: "WEEK", percent: 23, severity: "normal", resetsAt: null },
      { kind: "weekly_scoped", label: "FABLE", percent: 13, severity: "normal", resetsAt: null },
    ]),
    sessions,
    malformed: 0,
    dead: 0,
  };
}

test("groupOf maps every status to one of three groups", () => {
  expect(groupOf("waiting")).toBe("waiting");
  expect(groupOf("busy")).toBe("busy");
  expect(groupOf("idle")).toBe("other");
  expect(groupOf("compacting")).toBe("other");
});

test("orderRows puts waiting first, then busy, then the rest", () => {
  const rows = orderRows([
    row({ pid: 1, status: "idle" }),
    row({ pid: 2, status: "waiting" }),
    row({ pid: 3, status: "busy" }),
  ]);
  expect(rows.map((r) => r.pid)).toEqual([2, 3, 1]);
});

test("orderRows sorts within a group by most recent status change", () => {
  const rows = orderRows([
    row({ pid: 1, status: "idle", statusUpdatedAt: NOW - 100_000 }),
    row({ pid: 2, status: "idle", statusUpdatedAt: NOW - 1_000 }),
  ]);
  expect(rows.map((r) => r.pid)).toEqual([2, 1]);
});

test("visibleRows caps the collapsed idle list at five", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    row({ pid: 100 + i, status: "idle", statusUpdatedAt: NOW - i * 1000 }),
  );
  const collapsed = visibleRows(many, { selectedPid: null, idleExpanded: false });
  expect(collapsed).toHaveLength(5);
  const expanded = visibleRows(many, { selectedPid: null, idleExpanded: true });
  expect(expanded).toHaveLength(9);
});

test("visibleRows never hides a waiting or busy row", () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => row({ pid: 100 + i, status: "idle" })),
    row({ pid: 1, status: "waiting" }),
    row({ pid: 2, status: "busy" }),
  ];
  const visible = visibleRows(rows, { selectedPid: null, idleExpanded: false });
  expect(visible.map((r) => r.pid).slice(0, 2)).toEqual([1, 2]);
  expect(visible).toHaveLength(7);
});

test("shortModel strips the vendor prefix and the date suffix", () => {
  expect(shortModel("claude-opus-5")).toBe("opus-5");
  expect(shortModel("claude-haiku-4-5-20251001")).toBe("haiku-4-5");
  expect(shortModel("claude-fable-5-1")).toBe("fable-5-1");
  expect(shortModel(null)).toBe("—");
});

test("render draws one usage line per limit", () => {
  const lines = render(snapshot([]), 62, { selectedPid: null, idleExpanded: false }, "/Users/mark");
  expect(lines[0]).toContain("SESSION");
  expect(lines[1]).toContain("WEEK");
  expect(lines[2]).toContain("FABLE");
  expect(lines[0]).toContain("5%");
});

test("render shows the usage reason when the fetch failed", () => {
  const snap = { ...snapshot([]), usage: err("reauth") };
  const lines = render(snap, 62, { selectedPid: null, idleExpanded: false }, "/Users/mark");
  expect(lines.join("\n")).toContain("reauth");
});

test("render gives a waiting session four detail lines", () => {
  const snap = snapshot([
    row({
      pid: 9,
      status: "waiting",
      name: "antelopemoo-7b",
      cwd: "/Users/mark/dev/personal/antelopemoo",
      lastUserMessage: "add a retry to the fetch loop",
      lastTool: "Bash(npm test)",
    }),
  ]);
  const text = render(snap, 62, { selectedPid: null, idleExpanded: false }, "/Users/mark").join("\n");
  expect(text).toContain("waiting");
  expect(text).toContain("antelopemoo-7b");
  expect(text).toContain("opus-5");
  expect(text).toContain("main");
  expect(text).toContain("add a retry to the fetch loop");
  expect(text).toContain("Bash(npm test)");
});

test("render marks the selected row and only that row", () => {
  const snap = snapshot([
    row({ pid: 1, status: "waiting", name: "aaa" }),
    row({ pid: 2, status: "busy", name: "bbb" }),
  ]);
  const lines = render(snap, 62, { selectedPid: 2, idleExpanded: false }, "/Users/mark");
  const marked = lines.filter((l) => l.startsWith("▸"));
  expect(marked).toHaveLength(1);
  expect(marked[0]).toContain("bbb");
});

test("render never exceeds the requested width", () => {
  const snap = snapshot([
    row({
      pid: 1,
      status: "waiting",
      name: "a-very-long-session-name-that-will-not-fit",
      cwd: "/Users/mark/dev/a8c/wpcom-wt/some-extremely-long-worktree-name",
      lastUserMessage: "x".repeat(300),
      lastTool: "Bash(" + "y".repeat(300) + ")",
    }),
  ]);
  for (const width of [40, 62, 100]) {
    for (const line of render(snap, width, { selectedPid: null, idleExpanded: false }, "/Users/mark")) {
      expect([...line].length).toBeLessThanOrEqual(width);
    }
  }
});

test("render puts the model in a fixed column regardless of its length", () => {
  const snap = snapshot([
    row({ pid: 1, status: "busy", name: "sessionname", model: "claude-opus-5" }),
    row({ pid: 2, status: "busy", name: "sessionname", model: "claude-fable-5-1" }),
  ]);
  const heads = render(snap, 62, { selectedPid: null, idleExpanded: false }, "/Users/mark")
    .filter((l) => /^[ ▸][●◆] /.test(l));
  expect(heads).toHaveLength(2);
  expect(heads[0]?.indexOf("opus-5")).toBe(heads[1]?.indexOf("fable-5-1"));
});

test("render never emits two blank lines in a row", () => {
  const snap = snapshot([
    row({ pid: 1, status: "waiting" }),
    row({ pid: 2, status: "busy" }),
    row({ pid: 3, status: "idle" }),
    row({ pid: 4, status: "idle" }),
  ]);
  const lines = render(snap, 62, { selectedPid: null, idleExpanded: false }, "/Users/mark");
  for (let i = 1; i < lines.length; i++) {
    expect(lines[i] === "" && lines[i - 1] === "").toBe(false);
  }
});

test("render shows a bare dash for a missing user message, not a quoted one", () => {
  const snap = snapshot([row({ pid: 1, status: "busy", lastUserMessage: null })]);
  const text = render(snap, 62, { selectedPid: null, idleExpanded: false }, "/Users/mark").join("\n");
  expect(text).toContain("› —");
  expect(text).not.toContain('"—"');
});

test("render leaves no trailing whitespace on any line", () => {
  const snap = snapshot([
    row({ pid: 1, status: "waiting" }),
    row({ pid: 2, status: "busy" }),
    row({ pid: 3, status: "idle" }),
  ]);
  for (const line of render(snap, 62, { selectedPid: null, idleExpanded: false }, "/Users/mark")) {
    expect(line).toBe(line.replace(/\s+$/, ""));
  }
});

test("render reports an empty session list", () => {
  const text = render(snapshot([]), 62, { selectedPid: null, idleExpanded: false }, "/Users/mark").join("\n");
  expect(text).toContain("no live sessions");
});

test("render reports unreadable session files", () => {
  const snap = { ...snapshot([]), malformed: 2 };
  const text = render(snap, 62, { selectedPid: null, idleExpanded: false }, "/Users/mark").join("\n");
  expect(text).toContain("2 unreadable session files");
});

test("render marks the row whose pid is selected, wherever it has sorted to", () => {
  const snap = snapshot([
    row({ pid: 1, status: "waiting", name: "alpha", statusUpdatedAt: NOW - 10_000 }),
    row({ pid: 2, status: "busy", name: "bravo", statusUpdatedAt: NOW - 20_000 }),
  ]);
  const marked = render(snap, 62, { selectedPid: 2, idleExpanded: false }, "/Users/mark")
    .filter((l) => l.startsWith("▸"));
  expect(marked).toHaveLength(1);
  expect(marked[0]).toContain("bravo");
});

test("render says so when the usage rows are stale", () => {
  const base = snapshot([]);
  const fresh = render(
    { ...base, usageAt: NOW - 30_000 },
    62,
    { selectedPid: null, idleExpanded: false },
    "/Users/mark",
  ).join("\n");
  const stale = render(
    { ...base, usageAt: NOW - 3 * 3_600_000 },
    62,
    { selectedPid: null, idleExpanded: false },
    "/Users/mark",
  ).join("\n");
  expect(fresh).not.toContain("refresh failing");
  expect(stale).toContain("3h old — refresh failing");
});

test("renderFrame maps every session line to its pid and nothing else", () => {
  const snap = snapshot([
    row({ pid: 7, status: "busy", name: "busy-one" }),
    row({ pid: 9, status: "idle", name: "idle-one" }),
  ]);
  const ui = { selectedPid: null, idleExpanded: true };
  const { lines, pids } = renderFrame(snap, 62, ui, "/Users/mark");

  expect(pids.length).toBe(lines.length);
  expect(lines).toEqual(render(snap, 62, ui, "/Users/mark"));

  // All four detail lines of a running session belong to it.
  const busyLines = pids.map((p, i) => (p === 7 ? i : -1)).filter((i) => i !== -1);
  expect(busyLines.length).toBe(4);
  expect(lines[busyLines[0]!]).toContain("busy-one");
  expect(lines[busyLines[3]!]).toContain("Bash(npm test)");

  // An idle session is one line.
  const idleLines = pids.map((p, i) => (p === 9 ? i : -1)).filter((i) => i !== -1);
  expect(idleLines.length).toBe(1);
  expect(lines[idleLines[0]!]).toContain("idle-one");

  // Usage bars, section headers and blank lines map to nothing.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "" || line.startsWith(" ──") || /^ (SESSION|WEEK|FABLE)/.test(line)) {
      expect(pids[i]).toBe(null);
    }
  }
});
