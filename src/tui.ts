import { collect, type Snapshot } from "./collect";
import { planFocus, runFocus } from "./focus";
import { renderFrame, visibleRows, type Frame, type UiState } from "./render";
import { isOk } from "./result";

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const CLEAR_LINE = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";
// 1000 reports button presses; 1006 makes the report SGR-encoded, which does
// not overflow past column 223 the way the legacy encoding does.
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1000l";

export type MouseClick = { col: number; row: number };

// A CSI sequence can arrive split across reads: the ESC byte alone, then the
// rest. That is how cmux's `send` delivers it, and a pty gives no guarantee
// either way. A prefix that has not reached its final byte yet is held back
// and joined to the next read.
function isPartialCsi(s: string): boolean {
  if (s === "\x1b") return true;
  if (!s.startsWith("\x1b[")) return false;
  return !/^\x1b\[[<?]?[\d;]*[A-Za-z~]/.test(s);
}

export function coalesceInput(
  pending: string,
  chunk: string,
): { key: string | null; pending: string } {
  const joined = pending + chunk;
  if (isPartialCsi(joined)) return { key: null, pending: joined };
  return { key: joined, pending: "" };
}

// An SGR mouse report is ESC [ < button ; col ; row M for a press and the
// same with a trailing m for a release. Button 0 is the left button; bit 5
// marks motion and bit 6 marks the wheel, so both are excluded by the exact
// match on 0. Rows and columns are 1-based. Only the first report in a chunk
// counts, so a fast double-click that arrives as one read is one click.
export function parseMouseClick(key: string): MouseClick | null {
  const m = /^\x1b\[<0;(\d+);(\d+)M/.exec(key);
  if (m === null) return null;
  return { col: Number(m[1]), row: Number(m[2]) };
}

export async function runTui(opts: {
  claudeDir: string;
  cachePath: string;
  home: string;
  usageTtlMs: number;
  cmuxTtlMs: number;
  intervalMs: number;
}): Promise<void> {
  const ui: UiState = { selectedPid: null, idleExpanded: true };
  let snap: Snapshot | null = null;
  let message: string | null = null;
  let running = true;
  // The last painted frame. A click is resolved against what is on screen,
  // not against a fresh render, so the row under the pointer is the row the
  // user saw.
  let frame: Frame = { lines: [], pids: [] };

  function paint(): void {
    const width = process.stdout.columns ?? 62;
    frame =
      snap === null
        ? { lines: [" loading…"], pids: [null] }
        : renderFrame(snap, width, ui, opts.home);
    const lines = [...frame.lines];
    if (message !== null) lines.push("", ` ${message}`);
    const body = lines.map((l) => l + CLEAR_LINE).join("\r\n");
    process.stdout.write(CURSOR_HOME + body + "\r\n" + CLEAR_BELOW);
  }

  async function refresh(): Promise<void> {
    try {
      snap = await collect({
        now: Date.now(),
        claudeDir: opts.claudeDir,
        cachePath: opts.cachePath,
        usageTtlMs: opts.usageTtlMs,
        cmuxTtlMs: opts.cmuxTtlMs,
      });
      // The selected session can end between polls. Fall back to the top row
      // rather than leaving the marker on a pid that is no longer listed.
      const rows = visibleRows(snap.sessions, ui);
      if (!rows.some((r) => r.pid === ui.selectedPid)) {
        ui.selectedPid = rows[0]?.pid ?? null;
      }
    } catch (e) {
      message = `collect failed: ${String(e)}`;
    }
    paint();
  }

  function move(delta: number): void {
    if (snap === null) return;
    const rows = visibleRows(snap.sessions, ui);
    if (rows.length === 0) return;
    const current = rows.findIndex((r) => r.pid === ui.selectedPid);
    const from = current === -1 ? 0 : current;
    const to = Math.min(rows.length - 1, Math.max(0, from + delta));
    ui.selectedPid = rows[to]?.pid ?? null;
    paint();
  }

  async function focusSelected(): Promise<void> {
    if (snap === null) return;
    const rows = visibleRows(snap.sessions, ui);
    const row = rows.find((r) => r.pid === ui.selectedPid);
    if (row === undefined) return;
    const plan = planFocus(row);
    if (!isOk(plan)) {
      message = plan.reason;
      paint();
      return;
    }
    const result = await runFocus(plan.value);
    message = isOk(result) ? plan.value.hint : result.reason;
    paint();
  }

  function clickRow(row: number): void {
    const pid = frame.pids[row - 1] ?? null;
    if (pid === null) return;
    ui.selectedPid = pid;
    paint();
    void focusSelected();
  }

  function teardown(): void {
    if (!running) return;
    running = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(MOUSE_OFF + CURSOR_SHOW + ALT_SCREEN_OFF);
  }

  process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE + MOUSE_ON);
  process.on("exit", teardown);
  // A cmux Dock pane drops to a shell when its command exits rather than
  // closing, so a skipped teardown leaves that pane in raw mode on the
  // alternate screen. The exit event does not fire for an unhandled fatal
  // signal, so every signal that can end this process must be named.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      teardown();
      process.exit(0);
    });
  }
  process.stdout.on("resize", paint);

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  let pending = "";
  process.stdin.on("data", (chunk: Buffer) => {
    const joined = coalesceInput(pending, chunk.toString());
    pending = joined.pending;
    if (joined.key === null) return;
    const key = joined.key;
    message = null;
    const click = parseMouseClick(key);
    if (click !== null) {
      clickRow(click.row);
    } else if (key === "q" || key === "\x03") {
      teardown();
      process.exit(0);
    } else if (key === "j" || key === "\x1b[B") {
      move(1);
    } else if (key === "k" || key === "\x1b[A") {
      move(-1);
    } else if (key === "\t") {
      ui.idleExpanded = !ui.idleExpanded;
      paint();
    } else if (key === "\r" || key === "\n") {
      void focusSelected();
    } else if (key === "r") {
      void Bun.write(opts.cachePath, "").then(refresh);
    }
  });

  await refresh();
  setInterval(() => void refresh(), opts.intervalMs);
  await new Promise<void>(() => {});
}
