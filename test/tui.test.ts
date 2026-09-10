import { expect, test } from "bun:test";
import { coalesceInput, parseMouseClick } from "../src/tui";

test("parseMouseClick reads an SGR left-button press", () => {
  expect(parseMouseClick("\x1b[<0;12;7M")).toEqual({ col: 12, row: 7 });
});

test("parseMouseClick ignores releases, other buttons and drags", () => {
  expect(parseMouseClick("\x1b[<0;12;7m")).toBe(null);
  expect(parseMouseClick("\x1b[<2;12;7M")).toBe(null);
  expect(parseMouseClick("\x1b[<32;12;7M")).toBe(null);
  expect(parseMouseClick("\x1b[<64;12;7M")).toBe(null);
});

test("parseMouseClick takes the first report when two arrive together", () => {
  expect(parseMouseClick("\x1b[<0;3;9M\x1b[<0;3;9m\x1b[<0;3;9M")).toEqual({ col: 3, row: 9 });
});

test("parseMouseClick ignores plain keys", () => {
  expect(parseMouseClick("j")).toBe(null);
  expect(parseMouseClick("\x1b[A")).toBe(null);
  expect(parseMouseClick("")).toBe(null);
});

test("coalesceInput holds a split escape sequence until it is whole", () => {
  const first = coalesceInput("", "\x1b");
  expect(first).toEqual({ key: null, pending: "\x1b" });
  const second = coalesceInput(first.pending, "[<0;5;14M");
  expect(second).toEqual({ key: "\x1b[<0;5;14M", pending: "" });
});

test("coalesceInput passes whole reads straight through", () => {
  expect(coalesceInput("", "j")).toEqual({ key: "j", pending: "" });
  expect(coalesceInput("", "\x1b[A")).toEqual({ key: "\x1b[A", pending: "" });
  expect(coalesceInput("", "\x1b[<0;5;14M")).toEqual({ key: "\x1b[<0;5;14M", pending: "" });
});
