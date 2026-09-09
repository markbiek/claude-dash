import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSessionFile, scanSessions } from "../src/sessions";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "sessions");

function fixtureTexts(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readFileSync(join(FIXTURE_DIR, f), "utf8"));
}

const ALIVE_PIDS = new Set([1001, 1002, 1003, 1004]);
const isAlive = (pid: number) => ALIVE_PIDS.has(pid);

test("scanSessions keeps live sessions and counts the rest", () => {
  const scan = scanSessions(fixtureTexts(), isAlive);
  expect(scan.sessions.map((s) => s.pid)).toEqual([1001, 1002, 1003, 1004]);
  expect(scan.malformed).toBe(1);
  expect(scan.dead).toBe(1);
});

test("scanSessions preserves an unknown status verbatim", () => {
  const scan = scanSessions(fixtureTexts(), isAlive);
  const odd = scan.sessions.find((s) => s.pid === 1004);
  expect(odd?.status).toBe("compacting");
});

test("parseSessionFile rejects a file with no pid", () => {
  expect(parseSessionFile('{"sessionId":"abc","cwd":"/x"}')).toBe(null);
});

test("parseSessionFile rejects invalid JSON", () => {
  expect(parseSessionFile("{ not json")).toBe(null);
});

test("parseSessionFile defaults the optional fields", () => {
  const s = parseSessionFile(
    '{"pid":7,"sessionId":"abc","cwd":"/x","startedAt":100}',
  );
  expect(s).not.toBe(null);
  expect(s?.name).toBe("abc");
  expect(s?.status).toBe("unknown");
  expect(s?.tmux).toBe(null);
  expect(s?.updatedAt).toBe(100);
});

test("parseSessionFile reads the tmux target", () => {
  const s = parseSessionFile(
    '{"pid":7,"sessionId":"abc","cwd":"/x","tmux":"notes:@2.%51"}',
  );
  expect(s?.tmux).toBe("notes:@2.%51");
});
