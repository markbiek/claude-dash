import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { collect } from "./collect";

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

  process.stderr.write("usage: claude-dash [--json]\n");
  return 2;
}

process.exit(await main());
