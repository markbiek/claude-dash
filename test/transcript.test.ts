import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTranscript, projectDirName } from "../src/transcript";

const FIXTURE = readFileSync(
  join(import.meta.dir, "fixtures", "transcript.jsonl"),
  "utf8",
);

test("projectDirName matches the real directory names on disk", () => {
  expect(projectDirName("/Users/mark/notes")).toBe("-Users-mark-notes");
  expect(projectDirName("/Users/mark/.claude")).toBe("-Users-mark--claude");
  expect(
    projectDirName(
      "/Users/mark/.cache/review-board/repos/github.a8c.com__Automattic_wpcom__repo",
    ),
  ).toBe(
    "-Users-mark--cache-review-board-repos-github-a8c-com--Automattic-wpcom--repo",
  );
  expect(projectDirName("/Users/mark/dev/a8c/wpcom-wt/bug-fix")).toBe(
    "-Users-mark-dev-a8c-wpcom-wt-bug-fix",
  );
});

test("parseTranscript fills every field from the real fixture", () => {
  const d = parseTranscript(FIXTURE);
  expect(typeof d.model).toBe("string");
  expect(typeof d.branch).toBe("string");
  expect(typeof d.lastUserMessage).toBe("string");
  expect(typeof d.lastTool).toBe("string");
});

test("parseTranscript takes the most recent user message", () => {
  const text = [
    JSON.stringify({ type: "user", message: { content: "first thing" } }),
    JSON.stringify({ type: "user", message: { content: "second thing" } }),
  ].join("\n");
  expect(parseTranscript(text).lastUserMessage).toBe("second thing");
});

test("parseTranscript skips tool results and reminder blocks", () => {
  const text = [
    JSON.stringify({ type: "user", message: { content: "the real question" } }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: "ok" }] },
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: "<system-reminder>noise</system-reminder>" }] },
    }),
  ].join("\n");
  expect(parseTranscript(text).lastUserMessage).toBe("the real question");
});

test("parseTranscript labels a tool with its first useful argument", () => {
  const text = JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-opus-5",
      content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }],
    },
    effort: "high",
  });
  const d = parseTranscript(text);
  expect(d.lastTool).toBe("Bash(npm test)");
  expect(d.model).toBe("claude-opus-5");
  expect(d.effort).toBe("high");
});

test("parseTranscript falls back to the bare tool name", () => {
  const text = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [] } }] },
  });
  expect(parseTranscript(text).lastTool).toBe("TodoWrite");
});

test("parseTranscript ignores subagent turns", () => {
  const text = [
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-5", content: [] },
    }),
    JSON.stringify({
      isSidechain: true,
      type: "assistant",
      message: { model: "claude-haiku-4-5-20251001", content: [] },
    }),
  ].join("\n");
  expect(parseTranscript(text).model).toBe("claude-opus-5");
});

test("parseTranscript survives a truncated first line", () => {
  const text = [
    '{"type":"assis',
    JSON.stringify({ type: "user", message: { content: "still readable" } }),
  ].join("\n");
  expect(parseTranscript(text).lastUserMessage).toBe("still readable");
});

test("parseTranscript returns nulls for an empty file", () => {
  const d = parseTranscript("");
  expect(d.model).toBe(null);
  expect(d.branch).toBe(null);
  expect(d.lastUserMessage).toBe(null);
  expect(d.lastTool).toBe(null);
});
