# claude-dash

A dashboard for Claude Code usage limits and live sessions, built to run in a
cmux Dock pane.

## Commands

    claude-dash              # the TUI
    claude-dash --once       # print one frame and exit
    claude-dash --json       # print one snapshot and exit
    claude-dash --focus PID  # move cmux and tmux focus to a session
    claude-dash --watch      # the notification daemon

## Keys

    j / k    move the selection
    Tab      expand or collapse the idle list
    Enter    focus the selected session
    r        refetch the usage limits
    q        quit

## Develop

    bun run test
    bun run typecheck
    bun run build     # writes dist/claude-dash

## Install

The Dock control and the launchd job both point at `~/bin/claude-dash`, so a
rebuild only takes effect once it is copied there:

    bun run build
    install -m 755 dist/claude-dash ~/bin/claude-dash

Use `install`, not `cp`. `cp` writes into the destination file in place. If the
old binary is still running, macOS invalidates the new image and sends SIGKILL
on every exec, so the dashboard dies at startup with `killed` and no output.
`install` unlinks the destination first, which avoids this.

Then see `install/` for the two files. Copy the plist to
`~/Library/LaunchAgents`.

Back up `~/.config/cmux/dock.json` before touching it, then add the object from
`install/dock-control.json` to its `controls` array by hand:

    cp ~/.config/cmux/dock.json ~/.config/cmux/dock.json.bak-$(date +%Y%m%d-%H%M%S)

A malformed `dock.json` takes out the Dock, so the backup is the way back.

## Design

`~/notes/assistant/Research/2026-09-09-claude-dash-design.md`
