import { expect, test } from "bun:test";
import { bar, pad, relAge, resetLabel, shortPath, truncate } from "../src/format";

test("bar fills proportionally", () => {
  expect(bar(0, 10)).toBe("▁▁▁▁▁▁▁▁▁▁");
  expect(bar(50, 10)).toBe("█████▁▁▁▁▁");
  expect(bar(100, 10)).toBe("██████████");
});

test("bar shows at least one block for a nonzero percent", () => {
  expect(bar(1, 20)).toBe("█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁");
});

test("bar clamps out of range input", () => {
  expect(bar(-5, 4)).toBe("▁▁▁▁");
  expect(bar(140, 4)).toBe("████");
});

test("relAge uses the largest unit that fits", () => {
  expect(relAge(5_000)).toBe("now");
  expect(relAge(4 * 60_000)).toBe("4m");
  expect(relAge(2 * 3_600_000)).toBe("2h");
  expect(relAge(3 * 86_400_000)).toBe("3d");
});

// The two ISO strings below are the real resets_at values from the captured
// usage response. September 2026 is EDT, so the offset is -04:00.
test("resetLabel uses a clock time on the same day", () => {
  const now = new Date("2026-09-09T14:00:00-04:00").getTime();
  const iso = "2026-09-09T22:59:59.000Z";
  expect(resetLabel(iso, now)).toBe("6:59p");
});

test("resetLabel uses a weekday on a later day", () => {
  const now = new Date("2026-09-09T14:00:00-04:00").getTime();
  const iso = "2026-09-13T01:59:59.000Z";
  expect(resetLabel(iso, now)).toBe("Sat 9p");
});

test("resetLabel handles a null reset", () => {
  expect(resetLabel(null, 0)).toBe("—");
});

test("shortPath replaces home and collapses the middle", () => {
  const home = "/Users/mark";
  expect(shortPath("/Users/mark/notes", home, 24)).toBe("~/notes");
  expect(shortPath("/Users/mark/dev/a8c/wpcom-wt/domeng-383", home, 20))
    .toBe("~/…/domeng-383");
});

test("shortPath truncates a long final segment", () => {
  const home = "/Users/mark";
  expect(shortPath("/Users/mark/dev/a8c/wpcom-wt/domain-abilities", home, 14))
    .toBe("~/…/domain-ab…");
});

test("truncate adds an ellipsis only when it cuts", () => {
  expect(truncate("short", 10)).toBe("short");
  expect(truncate("a-much-longer-string", 10)).toBe("a-much-lo…");
});

test("pad right-pads to the requested width", () => {
  expect(pad("ab", 5)).toBe("ab   ");
  expect(pad("abcdef", 3)).toBe("abc");
});
