import { expect, test } from "bun:test";
import { assemble } from "../src/collect";
import { emptyDetail } from "../src/transcript";
import { parseCmuxTop } from "../src/cmuxmap";
import { ok } from "../src/result";
import type { RawSession } from "../src/sessions";

const MAP = parseCmuxTop(
  [
    "12.4\t1\t1\twindow\twindow:1\ttotal\t",
    "0.1\t1\t1\tworkspace\tworkspace:17\twindow:1\tbug-fix",
    "0.1\t1\t1\tpane\tpane:20\tworkspace:17\t",
    "0.1\t1\t1\tsurface\tsurface:24\tpane:20\ttmux attach -t '=bug-fix'",
  ].join("\n"),
);

function session(over: Partial<RawSession>): RawSession {
  return {
    pid: 1,
    sessionId: "s1",
    cwd: "/Users/mark/notes",
    name: "notes-aa",
    status: "idle",
    updatedAt: 1000,
    statusUpdatedAt: 1000,
    tmux: null,
    kind: "interactive",
    ...over,
  };
}

test("assemble attaches a cmux target when the tmux session matches", () => {
  const snap = assemble({
    now: 5000,
    scan: {
      sessions: [session({ pid: 7, tmux: "bug-fix:@2.%51" })],
      malformed: 0,
      dead: 0,
    },
    details: new Map(),
    usage: ok({ fetchedAt: 4000, rows: [] }),
    map: MAP,
  });
  expect(snap.sessions[0]?.target?.workspace).toBe("workspace:17");
});

test("assemble leaves the target null when no workspace matches", () => {
  const snap = assemble({
    now: 5000,
    scan: {
      sessions: [session({ pid: 7, tmux: "elsewhere:@2.%51" })],
      malformed: 0,
      dead: 0,
    },
    details: new Map(),
    usage: ok({ fetchedAt: 4000, rows: [] }),
    map: MAP,
  });
  expect(snap.sessions[0]?.target).toBe(null);
});

test("assemble merges detail by pid and falls back to an empty detail", () => {
  const details = new Map([
    [7, { ...emptyDetail(), model: "claude-opus-5", branch: "trunk" }],
  ]);
  const snap = assemble({
    now: 5000,
    scan: {
      sessions: [session({ pid: 7 }), session({ pid: 8 })],
      malformed: 2,
      dead: 1,
    },
    details,
    usage: ok({ fetchedAt: 4000, rows: [] }),
    map: MAP,
  });
  expect(snap.sessions[0]?.model).toBe("claude-opus-5");
  expect(snap.sessions[1]?.model).toBe(null);
  expect(snap.malformed).toBe(2);
  expect(snap.dead).toBe(1);
  expect(snap.generatedAt).toBe(5000);
});
