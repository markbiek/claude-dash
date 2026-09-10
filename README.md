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

### The binary

The Dock control and the launchd job both point at `~/bin/claude-dash`, so a
rebuild only takes effect once it is copied there:

    bun run build
    install -m 755 dist/claude-dash ~/bin/claude-dash

Use `install`, not `cp`. `cp` writes into the destination file in place. If the
old binary is still running, macOS invalidates the new image and sends SIGKILL
on every exec, so the dashboard dies at startup with `killed` and no output.
`install` unlinks the destination first, which avoids this.

### The watch daemon

`claude-dash --watch` posts a cmux notification when a session starts waiting
on you and when a usage limit crosses 50, 80 or 95 percent. Run it under
launchd:

    cp install/com.markbiek.claude-dash-watch.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.markbiek.claude-dash-watch.plist

It logs to `~/.cache/claude-dash/watch.log` and `watch.err`. Both stay empty
when it is healthy.

### The cmux Dock

Dock is a beta feature in cmux and is off by default. Until it is on, every
Dock command fails with `Dock placement is disabled` or
`Right sidebar mode 'dock' is not available`. Turn it on in
Settings > Beta Features > Dock, or from a shell:

    defaults write com.cmuxterm.app "rightSidebar.beta.dock.enabled" -bool true

It takes effect at once. No restart or `cmux reload-config` is needed.

Then give the Dock a control that runs the dashboard. Back up
`~/.config/cmux/dock.json` before touching it, then add the object from
`install/dock-control.json` to its `controls` array by hand:

    cp ~/.config/cmux/dock.json ~/.config/cmux/dock.json.bak-$(date +%Y%m%d-%H%M%S)

If there is no `dock.json` yet, wrap the object yourself:

    {
      "controls": [
        { "id": "claude-dash", "title": "Claude", "command": "/Users/mark/bin/claude-dash", "height": 420 }
      ]
    }

A malformed `dock.json` takes out the Dock, so the backup is the way back.

`dock.json` only seeds an empty Dock. Once cmux has saved a Dock layout it
restores that snapshot on every launch and ignores the file, so if a plain
terminal is already in the Dock, run the dashboard in it or close it first:

    cmux right-sidebar dock
    cmux tree | grep dock
