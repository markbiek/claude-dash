import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lookupTarget, parseCmuxTop } from "../src/cmuxmap";

const REAL = readFileSync(
  join(import.meta.dir, "fixtures", "cmux-top.tsv"),
  "utf8",
);

const SYNTHETIC = [
  "12.4\t1952954744\t36\twindow\twindow:1\ttotal\t",
  "0.1\t13452392\t4\tworkspace\tworkspace:17\twindow:1\tbug-fix",
  "0.1\t13452392\t4\tpane\tpane:20\tworkspace:17\t",
  "0.1\t13452392\t4\tsurface\tsurface:24\tpane:20\ttmux attach -t '=bug-fix'",
  "0.0\t1868136\t1\tprocess\t57084\tsurface:24\ttmux",
  "0.1\t12977256\t4\tworkspace\tworkspace:2\twindow:1\treview",
  "0.1\t12977256\t4\tpane\tpane:2\tworkspace:2\t",
  "0.1\t12977256\t4\tsurface\tsurface:3\tpane:2\ttms",
].join("\n");

test("parseCmuxTop links a tmux surface to its workspace and window", () => {
  const map = parseCmuxTop(SYNTHETIC);
  const target = map.byTmuxSession.get("bug-fix");
  expect(target).toEqual({
    workspace: "workspace:17",
    window: "window:1",
    title: "bug-fix",
  });
});

test("parseCmuxTop indexes every workspace by its title", () => {
  const map = parseCmuxTop(SYNTHETIC);
  expect(map.byWorkspaceTitle.get("review")).toEqual({
    workspace: "workspace:2",
    window: "window:1",
    title: "review",
  });
});

test("lookupTarget takes the tmux session name from the session field", () => {
  const map = parseCmuxTop(SYNTHETIC);
  expect(lookupTarget(map, "bug-fix:@2.%51")?.workspace).toBe("workspace:17");
});

test("lookupTarget falls back to the workspace title", () => {
  const map = parseCmuxTop(SYNTHETIC);
  expect(lookupTarget(map, "review:@1.%3")?.workspace).toBe("workspace:2");
});

test("lookupTarget returns null for an unknown session", () => {
  const map = parseCmuxTop(SYNTHETIC);
  expect(lookupTarget(map, "nowhere:@1.%1")).toBe(null);
  expect(lookupTarget(map, null)).toBe(null);
});

test("parseCmuxTop finds at least one tmux surface in the real capture", () => {
  const map = parseCmuxTop(REAL);
  expect(map.byTmuxSession.size).toBeGreaterThan(0);
  for (const target of map.byTmuxSession.values()) {
    expect(target.workspace.startsWith("workspace:")).toBe(true);
    expect(target.window.startsWith("window:")).toBe(true);
  }
});
