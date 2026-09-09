import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function readBranchFromGit(cwd: string): string | null {
  const dotGit = join(cwd, ".git");

  let headPath: string;
  try {
    const stat = statSync(dotGit);
    if (stat.isDirectory()) {
      headPath = join(dotGit, "HEAD");
    } else {
      const pointer = readFileSync(dotGit, "utf8").trim();
      const match = pointer.match(/^gitdir:\s*(.+)$/);
      if (match === null || match[1] === undefined) return null;
      headPath = join(match[1], "HEAD");
    }
  } catch {
    return null;
  }

  let head: string;
  try {
    head = readFileSync(headPath, "utf8").trim();
  } catch {
    return null;
  }

  const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (ref !== null && ref[1] !== undefined) return ref[1];
  if (/^[0-9a-f]{40}$/.test(head)) return head.slice(0, 7);
  return null;
}
