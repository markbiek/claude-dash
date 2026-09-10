import type { SessionRow, Snapshot } from "./collect";
import { bar, pad, relAge, resetLabel, shortPath, truncate } from "./format";
import { isOk } from "./result";

// The selection is a pid, not an index. The list re-sorts whenever a session
// changes status, and an index would then point at a different session than the
// one the user is looking at.
export type UiState = { selectedPid: number | null; idleExpanded: boolean };
export type Group = "waiting" | "busy" | "other";

const IDLE_PREVIEW = 5;
const STALE_USAGE_MS = 120_000;
// The model sits in a fixed column so the eye can scan it. Nine characters
// covers the longest short name in use (fable-5-1, haiku-4-5).
const MODEL_W = 9;
const AGE_W = 4;
const GROUP_ORDER: Group[] = ["waiting", "busy", "other"];
const MARKER: Record<Group, string> = { waiting: "●", busy: "◆", other: " " };
const TOOL_ICON: Record<Group, string> = { waiting: "⏸", busy: "⚙", other: "·" };
const GROUP_TITLE: Record<Group, string> = {
  waiting: "waiting",
  busy: "running",
  other: "idle",
};

export function groupOf(status: string): Group {
  if (status === "waiting") return "waiting";
  if (status === "busy") return "busy";
  return "other";
}

export function orderRows(sessions: SessionRow[]): SessionRow[] {
  return [...sessions].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(groupOf(a.status));
    const gb = GROUP_ORDER.indexOf(groupOf(b.status));
    if (ga !== gb) return ga - gb;
    return b.statusUpdatedAt - a.statusUpdatedAt;
  });
}

export function visibleRows(
  sessions: SessionRow[],
  ui: UiState,
): SessionRow[] {
  const ordered = orderRows(sessions);
  if (ui.idleExpanded) return ordered;
  const kept: SessionRow[] = [];
  let idleShown = 0;
  for (const row of ordered) {
    if (groupOf(row.status) !== "other") {
      kept.push(row);
      continue;
    }
    if (idleShown < IDLE_PREVIEW) {
      kept.push(row);
      idleShown += 1;
    }
  }
  return kept;
}

export function shortModel(model: string | null): string {
  if (model === null || model.length === 0) return "—";
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function fit(left: string, right: string, width: number): string {
  const room = width - right.length - 1;
  const head = pad(truncate(left, Math.max(0, room)), Math.max(0, room));
  return truncate(`${head} ${right}`, width);
}

function sectionLine(title: string, width: number): string {
  const prefix = ` ── ${title} `;
  const dashes = Math.max(0, width - prefix.length);
  return prefix + "─".repeat(dashes);
}

function usageLines(snap: Snapshot, width: number): string[] {
  if (!isOk(snap.usage)) {
    return [truncate(` USAGE    ${snap.usage.reason}`, width)];
  }
  if (snap.usage.value.length === 0) {
    return [truncate(" USAGE    no limits reported", width)];
  }

  const barWidth = Math.max(6, Math.min(21, width - 41));
  const lines = snap.usage.value.map((u) => {
    const percent = String(Math.round(u.percent)).padStart(3);
    const reset = resetLabel(u.resetsAt, snap.generatedAt);
    const line =
      ` ${pad(u.label, 8)} ${bar(u.percent, barWidth)} ${percent}%   resets ${reset}`;
    return truncate(line, width);
  });

  // A failed refresh serves the last good numbers. Say how old they are, or the
  // dashboard is confidently wrong and the only tell is a reset time in the past.
  const age = snap.usageAt === null ? 0 : snap.generatedAt - snap.usageAt;
  if (age >= STALE_USAGE_MS) {
    lines.push(truncate(` ${relAge(age)} old — refresh failing`, width));
  }

  return lines;
}

function detailLines(
  row: SessionRow,
  selected: boolean,
  snap: Snapshot,
  width: number,
  home: string,
): string[] {
  const group = groupOf(row.status);
  const sel = selected ? "▸" : " ";
  const age = relAge(snap.generatedAt - row.statusUpdatedAt);

  const head = fit(
    `${sel}${MARKER[group]} ${row.name}`,
    `${pad(shortModel(row.model), MODEL_W)} ${age.padStart(AGE_W)}`,
    width,
  );

  const branch = row.branch ?? "—";
  const place = truncate(
    `   ${shortPath(row.cwd, home, Math.max(8, width - branch.length - 7))} · ${branch}`,
    width,
  );

  // A missing message is not a message that says "—". Leave it unquoted.
  const said =
    row.lastUserMessage === null
      ? "   › —"
      : truncate(`   › "${row.lastUserMessage}"`, width);
  const tool = truncate(`   ${TOOL_ICON[group]} ${row.lastTool ?? "—"}`, width);

  return [head, place, said, tool];
}

function idleLine(
  row: SessionRow,
  selected: boolean,
  snap: Snapshot,
  width: number,
  home: string,
): string {
  const sel = selected ? "▸" : " ";
  const age = relAge(snap.generatedAt - row.statusUpdatedAt);
  const name = pad(truncate(row.name, 18), 18);
  const place = shortPath(row.cwd, home, Math.max(8, width - 30));
  return fit(`${sel}  ${name} ${place}`, age.padStart(AGE_W), width);
}

// One frame of output. `pids` runs parallel to `lines`: the pid of the session
// drawn on that line, or null for anything that is not a session (usage bars,
// section headers, blanks). A mouse click resolves through it.
export type Frame = { lines: string[]; pids: (number | null)[] };

export function renderFrame(
  snap: Snapshot,
  width: number,
  ui: UiState,
  home: string,
): Frame {
  const lines: string[] = [];
  const pids: (number | null)[] = [];
  function push(line: string, pid: number | null = null): void {
    lines.push(line);
    pids.push(pid);
  }

  for (const line of usageLines(snap, width)) push(line);
  push("");

  const ordered = orderRows(snap.sessions);
  const visible = visibleRows(snap.sessions, ui);
  const hidden = ordered.length - visible.length;

  if (ordered.length === 0) {
    push(truncate(" no live sessions", width));
  }

  let lastGroup: Group | null = null;
  visible.forEach((row) => {
    const group = groupOf(row.status);
    if (group !== lastGroup) {
      // A detail block already ends in a blank line. Do not add a second.
      if (lastGroup !== null && lines[lines.length - 1] !== "") push("");
      push(sectionLine(GROUP_TITLE[group], width));
      lastGroup = group;
    }
    const selected = row.pid === ui.selectedPid;
    if (group === "other") {
      push(idleLine(row, selected, snap, width, home), row.pid);
    } else {
      for (const line of detailLines(row, selected, snap, width, home)) {
        push(line, row.pid);
      }
      push("");
    }
  });

  if (hidden > 0) {
    push(truncate(`   + ${hidden} more`, width));
  }
  if (snap.malformed > 0) {
    const noun = snap.malformed === 1 ? "file" : "files";
    push(truncate(` ${snap.malformed} unreadable session ${noun}`, width));
  }

  return { lines, pids };
}

export function render(
  snap: Snapshot,
  width: number,
  ui: UiState,
  home: string,
): string[] {
  return renderFrame(snap, width, ui, home).lines;
}
