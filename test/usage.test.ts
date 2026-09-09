import { expect, test } from "bun:test";
import { isFresh, parseUsage } from "../src/usage";
import { isOk } from "../src/result";
import fixture from "./fixtures/usage.json";

test("parseUsage reads the three rows from the real response", () => {
  const r = parseUsage(fixture);
  expect(isOk(r)).toBe(true);
  if (!isOk(r)) return;
  expect(r.value.map((row) => row.kind)).toEqual([
    "session",
    "weekly_all",
    "weekly_scoped",
  ]);
  for (const row of r.value) {
    expect(Number.isFinite(row.percent)).toBe(true);
    expect(typeof row.label).toBe("string");
    expect(row.label.length).toBeGreaterThan(0);
  }
});

test("parseUsage takes the scoped label from the response, not a constant", () => {
  const payload = {
    limits: [
      { kind: "session", percent: 5, severity: "normal", resets_at: "2026-09-09T22:59:59Z", scope: null },
      { kind: "weekly_all", percent: 23, severity: "normal", resets_at: "2026-09-13T01:59:59Z", scope: null },
      {
        kind: "weekly_scoped",
        percent: 13,
        severity: "normal",
        resets_at: "2026-09-13T01:59:59Z",
        scope: { model: { id: null, display_name: "Sonnet" }, surface: null },
      },
    ],
  };
  const r = parseUsage(payload);
  expect(isOk(r)).toBe(true);
  if (!isOk(r)) return;
  expect(r.value[2]?.label).toBe("SONNET");
  expect(r.value[0]?.label).toBe("SESSION");
  expect(r.value[1]?.label).toBe("WEEK");
});

test("parseUsage keeps several scoped rows in response order", () => {
  const payload = {
    limits: [
      { kind: "weekly_scoped", percent: 4, severity: "normal", resets_at: null, scope: { model: { display_name: "Opus" } } },
      { kind: "session", percent: 1, severity: "normal", resets_at: null, scope: null },
      { kind: "weekly_scoped", percent: 9, severity: "normal", resets_at: null, scope: { model: { display_name: "Fable" } } },
    ],
  };
  const r = parseUsage(payload);
  expect(isOk(r)).toBe(true);
  if (!isOk(r)) return;
  expect(r.value.map((row) => row.label)).toEqual(["SESSION", "OPUS", "FABLE"]);
});

test("parseUsage rejects a payload with no limits array", () => {
  const r = parseUsage({ five_hour: { utilization: 5 } });
  expect(isOk(r)).toBe(false);
  if (!isOk(r)) expect(r.reason).toBe("unexpected usage schema");
});

test("parseUsage drops a row with a non-numeric percent", () => {
  const payload = {
    limits: [
      { kind: "session", percent: "oops", severity: "normal", resets_at: null, scope: null },
      { kind: "weekly_all", percent: 23, severity: "normal", resets_at: null, scope: null },
    ],
  };
  const r = parseUsage(payload);
  expect(isOk(r)).toBe(true);
  if (isOk(r)) expect(r.value.map((row) => row.kind)).toEqual(["weekly_all"]);
});

test("isFresh honours the TTL", () => {
  const cache = { fetchedAt: 1_000_000, rows: [] };
  expect(isFresh(cache, 1_030_000, 60_000)).toBe(true);
  expect(isFresh(cache, 1_090_000, 60_000)).toBe(false);
  expect(isFresh(null, 1_000_000, 60_000)).toBe(false);
});

test("isFresh rejects a cache from the future", () => {
  const cache = { fetchedAt: 2_000_000, rows: [] };
  expect(isFresh(cache, 1_000_000, 60_000)).toBe(false);
});
