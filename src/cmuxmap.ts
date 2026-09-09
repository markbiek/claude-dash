export type CmuxTarget = { workspace: string; window: string; title: string };

export type CmuxMap = {
  byTmuxSession: Map<string, CmuxTarget>;
  byWorkspaceTitle: Map<string, CmuxTarget>;
};

type Row = { type: string; ref: string; parent: string; label: string };

const ATTACH = /tmux\s+attach\s+-t\s+'=([^']+)'/;

export function parseCmuxTop(tsv: string): CmuxMap {
  const rows = new Map<string, Row>();

  for (const line of tsv.split("\n")) {
    if (line.length === 0) continue;
    const cells = line.split("\t");
    const type = cells[3];
    const ref = cells[4];
    if (type === undefined || ref === undefined) continue;
    rows.set(ref, {
      type,
      ref,
      parent: cells[5] ?? "",
      label: cells[6] ?? "",
    });
  }

  const byTmuxSession = new Map<string, CmuxTarget>();
  const byWorkspaceTitle = new Map<string, CmuxTarget>();

  function targetForWorkspace(ws: Row): CmuxTarget | null {
    const window = rows.get(ws.parent);
    if (window === undefined || window.type !== "window") return null;
    return { workspace: ws.ref, window: window.ref, title: ws.label };
  }

  for (const row of rows.values()) {
    if (row.type !== "workspace") continue;
    const target = targetForWorkspace(row);
    if (target === null || row.label.length === 0) continue;
    if (!byWorkspaceTitle.has(row.label)) byWorkspaceTitle.set(row.label, target);
  }

  for (const row of rows.values()) {
    if (row.type !== "surface") continue;
    const match = row.label.match(ATTACH);
    if (match === null || match[1] === undefined) continue;

    const pane = rows.get(row.parent);
    if (pane === undefined || pane.type !== "pane") continue;
    const workspace = rows.get(pane.parent);
    if (workspace === undefined || workspace.type !== "workspace") continue;

    const target = targetForWorkspace(workspace);
    if (target === null) continue;
    if (!byTmuxSession.has(match[1])) byTmuxSession.set(match[1], target);
  }

  return { byTmuxSession, byWorkspaceTitle };
}

export function lookupTarget(
  map: CmuxMap,
  tmuxField: string | null,
): CmuxTarget | null {
  if (tmuxField === null) return null;
  const session = tmuxField.split(":")[0];
  if (session === undefined || session.length === 0) return null;
  return (
    map.byTmuxSession.get(session) ?? map.byWorkspaceTitle.get(session) ?? null
  );
}

export async function readCmuxMap(): Promise<CmuxMap> {
  try {
    const proc = Bun.spawn(
      ["cmux", "top", "--all", "--processes", "--format", "tsv"],
      { stdout: "pipe", stderr: "ignore", env: { ...process.env, CMUX_QUIET: "1" } },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return parseCmuxTop(text);
  } catch {
    return { byTmuxSession: new Map(), byWorkspaceTitle: new Map() };
  }
}
