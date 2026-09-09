import type { SessionRow } from "./collect";
import { err, ok, type Result } from "./result";

export type TmuxTarget = { session: string; window: string; pane: string };
export type FocusPlan = { commands: string[][]; hint: string | null };

export function parseTmuxField(field: string | null): TmuxTarget | null {
  if (field === null) return null;
  const match = field.match(/^([^:]+):(@\d+)\.(%\d+)$/);
  if (match === null) return null;
  const [, session, window, pane] = match;
  if (session === undefined || window === undefined || pane === undefined) {
    return null;
  }
  return { session, window, pane };
}

export function planFocus(
  row: Pick<SessionRow, "tmux" | "target" | "name">,
): Result<FocusPlan> {
  const tmux = parseTmuxField(row.tmux);
  if (tmux === null) return err("session is not in tmux");

  const commands: string[][] = [];
  let hint: string | null = null;

  if (row.target !== null) {
    commands.push(["cmux", "focus-window", "--window", row.target.window]);
    commands.push([
      "cmux",
      "select-workspace",
      "--workspace",
      row.target.workspace,
    ]);
  } else {
    hint = `switch to the cmux workspace running tmux session "${tmux.session}"`;
  }

  commands.push(["tmux", "select-window", "-t", tmux.window]);
  commands.push(["tmux", "select-pane", "-t", tmux.pane]);

  return ok({ commands, hint });
}

export async function runFocus(plan: FocusPlan): Promise<Result<null>> {
  for (const argv of plan.commands) {
    const proc = Bun.spawn(argv, {
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, CMUX_QUIET: "1" },
    });
    const code = await proc.exited;
    if (code !== 0) {
      const detail = await new Response(proc.stderr).text();
      return err(`${argv.join(" ")} exited ${code}: ${detail.trim()}`);
    }
  }
  return ok(null);
}
