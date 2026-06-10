# Panel — A Vivaldi-style Tab Manager for Firefox

A vertical tab panel for Firefox inspired by Vivaldi's tab manager. Built as a
WebExtension, so it works on stable Firefox without compromising your profile.

## Features

- **Vertical tab panel** — full-height sidebar with dense, native styling
- **Tab stacks** — drag a tab onto another to group them; click the header to collapse
- **Workspaces** — separate sets of tabs; switch and only those tabs are visible
- **Quick search** (`Ctrl+Shift+P`) — Vivaldi-style "jump to tab" command palette
- **In-panel filter** — instant fuzzy filter at the top of the sidebar
- **Hibernate** — discard tabs to free RAM (per tab, per stack, or whole workspace)
- **Drag & drop** — reorder tabs, drop into stacks, drop onto workspace tabs to move
- **Keyboard shortcuts** — toggle panel, switch workspaces, open search
- **Mute/unmute, pin, duplicate, reload** from a right-click menu on any tab
- **Light/dark theme** — follows the OS

## Install (temporary, for development)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on…"**.
3. Pick `manifest.json` from this folder.
4. Open the panel: `Ctrl+Shift+E`, or click the toolbar icon.

The "temporary" add-on lives until you restart Firefox. To install permanently
without signing, use Firefox **Developer Edition** or **Nightly** and set
`xpinstall.signatures.required = false` in `about:config`, then load the
packaged `.zip` (rename to `.xpi`) via `about:addons` → gear icon → Install
add-on from file.

## Optional: hide the native tab strip (full Vivaldi feel)

The extension cannot remove Firefox's native horizontal tab strip from inside
a sandboxed extension — that requires user-chrome customisation. A drop-in
`userChrome.css` is included.

See `userChrome/userChrome.css` for step-by-step instructions. The short
version: enable `toolkit.legacyUserProfileCustomizations.stylesheets` in
`about:config`, drop the file into your profile's `chrome/` folder, restart.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+E` | Toggle the tab panel |
| `Ctrl+Shift+P` | Quick tab search popup |
| `Ctrl+Alt+→` | Next workspace |
| `Ctrl+Alt+←` | Previous workspace |

You can rebind these in `about:addons` → ⚙ → Manage Extension Shortcuts.

## Tab gestures inside the panel

| Gesture | Action |
| --- | --- |
| Click | Switch to tab |
| Middle-click | Close tab |
| Right-click | Tab actions menu |
| Drag tab onto tab | Form a stack |
| Drag tab onto stack header | Add to stack |
| Drag tab onto workspace tab | Move to that workspace |
| Drag tab between rows | Reorder |
| Double-click stack header | Rename stack |
| Double-click workspace | Rename workspace |
| Right-click workspace | Workspace actions (hibernate, delete, etc.) |

## Honest limitations

A WebExtension cannot do everything Vivaldi does natively:

1. **Cannot remove the native tab strip** — use the included `userChrome.css`.
2. **Cannot tile tabs** into split-pane views; that's deep browser plumbing.
3. **Tab thumbnails** would require capturing every tab on activation; not
   currently included to keep the extension lightweight.

Everything else — stacks, workspaces, search, hibernation, drag-and-drop —
is implemented and works.

## File layout

```
manifest.json             # extension manifest
background/background.js  # state owner, event handlers, command dispatch
sidebar/                  # the main vertical panel UI
  sidebar.html
  sidebar.css
  sidebar.js
popup/                    # quick search popup (Ctrl+Shift+P)
  popup.html
  popup.css
  popup.js
icons/                    # SVG icons
userChrome/               # optional: hide Firefox's native tab strip
README.md
```

## State storage

State (workspaces, stack assignments, names, colors) lives in
`browser.storage.local` under the key `panel.state.v1`. It survives restarts.
Tab IDs do not — on every load the extension reconciles the saved structure
against the live tab list and drops any stale references, then adopts any
tabs Firefox has opened that the panel doesn't know about (assigning them to
the active workspace).

## Permissions, and why

| Permission | Reason |
| --- | --- |
| `tabs` | Read tab title/URL/favicon; activate/close/duplicate tabs |
| `tabHide` | Show/hide tabs when switching workspaces |
| `sessions` | (Reserved for upcoming "recently closed" feature) |
| `storage` | Persist workspaces and stacks |
| `menus` | Right-click menus |
| `<all_urls>` | Read favicons across origins (the permission is required to inspect tab URLs in any tab API call) |

No network calls, no telemetry.

## License

Do whatever you want with this. It's a starting point — fork it, extend it.
