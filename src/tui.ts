import { collect, type Snapshot } from "./collect";
import { planFocus, runFocus } from "./focus";
import { render, visibleRows, type UiState } from "./render";
import { isOk } from "./result";

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const CLEAR_LINE = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";

export async function runTui(opts: {
  claudeDir: string;
  cachePath: string;
  home: string;
  usageTtlMs: number;
  cmuxTtlMs: number;
  intervalMs: number;
}): Promise<void> {
  const ui: UiState = { selected: 0, idleExpanded: false };
  let snap: Snapshot | null = null;
  let message: string | null = null;
  let running = true;

  function paint(): void {
    const width = process.stdout.columns ?? 62;
    const lines =
      snap === null
        ? [" loading…"]
        : render(snap, width, ui, opts.home);
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
      const count = visibleRows(snap.sessions, ui).length;
      if (ui.selected >= count) ui.selected = Math.max(0, count - 1);
    } catch (e) {
      message = `collect failed: ${String(e)}`;
    }
    paint();
  }

  function move(delta: number): void {
    if (snap === null) return;
    const count = visibleRows(snap.sessions, ui).length;
    if (count === 0) return;
    ui.selected = Math.min(count - 1, Math.max(0, ui.selected + delta));
    paint();
  }

  async function focusSelected(): Promise<void> {
    if (snap === null) return;
    const rows = visibleRows(snap.sessions, ui);
    const row = rows[ui.selected];
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

  function teardown(): void {
    if (!running) return;
    running = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
  }

  process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
  process.on("exit", teardown);
  process.on("SIGINT", () => {
    teardown();
    process.exit(0);
  });
  process.stdout.on("resize", paint);

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (chunk: Buffer) => {
    const key = chunk.toString();
    message = null;
    if (key === "q" || key === "\x03") {
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
