import { expect, test } from "bun:test";
import { parseTmuxField, planFocus } from "../src/focus";
import { isOk } from "../src/result";

const TARGET = { workspace: "workspace:17", window: "window:1", title: "bug-fix" };

test("parseTmuxField splits the three parts", () => {
  expect(parseTmuxField("notes:@2.%51")).toEqual({
    session: "notes",
    window: "@2",
    pane: "%51",
  });
});

test("parseTmuxField rejects a malformed field", () => {
  expect(parseTmuxField("notes")).toBe(null);
  expect(parseTmuxField("notes:@2")).toBe(null);
  expect(parseTmuxField(null)).toBe(null);
});

test("planFocus emits both hops when the cmux target is known", () => {
  const r = planFocus({ tmux: "bug-fix:@2.%51", target: TARGET, name: "bug-fix-af" });
  expect(isOk(r)).toBe(true);
  if (!isOk(r)) return;
  expect(r.value.commands).toEqual([
    ["cmux", "focus-window", "--window", "window:1"],
    ["cmux", "select-workspace", "--workspace", "workspace:17"],
    ["tmux", "select-window", "-t", "@2"],
    ["tmux", "select-pane", "-t", "%51"],
  ]);
  expect(r.value.hint).toBe(null);
});

test("planFocus emits the tmux hop and a hint when no cmux target is known", () => {
  const r = planFocus({ tmux: "bug-fix:@2.%51", target: null, name: "bug-fix-af" });
  expect(isOk(r)).toBe(true);
  if (!isOk(r)) return;
  expect(r.value.commands).toEqual([
    ["tmux", "select-window", "-t", "@2"],
    ["tmux", "select-pane", "-t", "%51"],
  ]);
  expect(r.value.hint).toBe('switch to the cmux workspace running tmux session "bug-fix"');
});

test("planFocus refuses a session that is not in tmux", () => {
  const r = planFocus({ tmux: null, target: TARGET, name: "bg-1" });
  expect(isOk(r)).toBe(false);
  if (!isOk(r)) expect(r.reason).toBe("session is not in tmux");
});
