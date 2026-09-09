import { expect, test } from "bun:test";
import { err, isOk, ok } from "../src/result";

test("ok carries a value", () => {
  const r = ok(42);
  expect(isOk(r)).toBe(true);
  if (isOk(r)) expect(r.value).toBe(42);
});

test("err carries a reason", () => {
  const r = err("no token");
  expect(isOk(r)).toBe(false);
  if (!isOk(r)) expect(r.reason).toBe("no token");
});
