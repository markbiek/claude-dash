import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBranchFromGit } from "../src/branch";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "claude-dash-"));
}

test("readBranchFromGit reads a normal repository", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/trunk\n");
  expect(readBranchFromGit(dir)).toBe("trunk");
});

test("readBranchFromGit follows a worktree gitdir file", () => {
  const dir = tmp();
  const real = tmp();
  writeFileSync(join(dir, ".git"), `gitdir: ${real}\n`);
  writeFileSync(join(real, "HEAD"), "ref: refs/heads/domeng-383\n");
  expect(readBranchFromGit(dir)).toBe("domeng-383");
});

test("readBranchFromGit shortens a detached head", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".git"));
  writeFileSync(
    join(dir, ".git", "HEAD"),
    "9f3c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f90123\n",
  );
  expect(readBranchFromGit(dir)).toBe("9f3c1d2");
});

test("readBranchFromGit returns null outside a repository", () => {
  expect(readBranchFromGit(tmp())).toBe(null);
});
