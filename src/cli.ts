import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { collect } from "./collect";
import { planFocus, runFocus } from "./focus";
import { render } from "./render";
import { isOk } from "./result";
import { runTui } from "./tui";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const CACHE_DIR = join(HOME, ".cache", "claude-dash");
const USAGE_CACHE = join(CACHE_DIR, "usage.json");
const USAGE_TTL_MS = 60_000;
const CMUX_TTL_MS = 10_000;

function ensureCacheDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  ensureCacheDir();

  const focusIndex = args.indexOf("--focus");
  if (focusIndex !== -1) {
    const pid = Number(args[focusIndex + 1]);
    if (!Number.isInteger(pid)) {
      process.stderr.write("usage: claude-dash --focus <pid>\n");
      return 2;
    }
    const snap = await collect({
      now: Date.now(),
      claudeDir: CLAUDE_DIR,
      cachePath: USAGE_CACHE,
      usageTtlMs: USAGE_TTL_MS,
      cmuxTtlMs: CMUX_TTL_MS,
    });
    const row = snap.sessions.find((s) => s.pid === pid);
    if (row === undefined) {
      process.stderr.write(`no live session with pid ${pid}\n`);
      return 1;
    }
    const plan = planFocus(row);
    if (!isOk(plan)) {
      process.stderr.write(plan.reason + "\n");
      return 1;
    }
    if (plan.value.hint !== null) process.stderr.write(plan.value.hint + "\n");
    const result = await runFocus(plan.value);
    if (!isOk(result)) {
      process.stderr.write(result.reason + "\n");
      return 1;
    }
    return 0;
  }

  if (args.includes("--json")) {
    const snap = await collect({
      now: Date.now(),
      claudeDir: CLAUDE_DIR,
      cachePath: USAGE_CACHE,
      usageTtlMs: USAGE_TTL_MS,
      cmuxTtlMs: CMUX_TTL_MS,
    });
    process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
    return 0;
  }

  if (args.includes("--once")) {
    const snap = await collect({
      now: Date.now(),
      claudeDir: CLAUDE_DIR,
      cachePath: USAGE_CACHE,
      usageTtlMs: USAGE_TTL_MS,
      cmuxTtlMs: CMUX_TTL_MS,
    });
    const width = process.stdout.columns ?? 62;
    const lines = render(snap, width, { selected: 0, idleExpanded: false }, HOME);
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
  }

  if (args.length > 0) {
    process.stderr.write(
      "usage: claude-dash [--json | --once | --watch | --focus <pid>]\n",
    );
    return 2;
  }

  await runTui({
    claudeDir: CLAUDE_DIR,
    cachePath: USAGE_CACHE,
    home: HOME,
    usageTtlMs: USAGE_TTL_MS,
    cmuxTtlMs: CMUX_TTL_MS,
    intervalMs: 1_000,
  });
  return 0;
}

process.exit(await main());
