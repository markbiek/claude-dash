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
    cp dist/claude-dash ~/bin/claude-dash

Then see `install/` for the two files. Copy the plist to
`~/Library/LaunchAgents` and add the Dock control to
`~/.config/cmux/dock.json`.

## Design

`~/notes/assistant/Research/2026-09-09-claude-dash-design.md`
