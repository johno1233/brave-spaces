# Brave Spaces

A lightweight Manifest V3 browser extension for **Brave** (Chromium) that brings two popular Vivaldi features:

- **Workspaces** — Named sets of tabs you can switch between inside the same window without closing anything.
- **Web Panels** — Pin websites in a side panel that stays visible next to your tabs.

No React, no TypeScript, no bundler — plain HTML/CSS/JS.

## Features

- Switch between workspaces with keyboard shortcuts or the side panel
- Tabs stay alive in a minimized "parking" window (`💤 Parked — Brave Spaces`)
- Tab groups are preserved across switches
- Web panels with iframe embedding + header stripping (via `declarativeNetRequest`)
- Mobile UA toggle per panel
- Right-click context menu to move tabs between workspaces
- Add current page to panels via toolbar or context menu
- Survives browser restarts (metadata-based recovery)

## Installation

### Load as Unpacked (Recommended for now)

1. Download or clone this repo.
2. Open Brave and go to `brave://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `brave-spaces` folder

The extension icon will appear in your toolbar. Click it to open the side panel.

## Keyboard Shortcuts

- `Ctrl+Shift+Right` / `Cmd+Shift+Right` — Next workspace
- `Ctrl+Shift+Left` / `Cmd+Shift+Left` — Previous workspace
- `Ctrl+Shift+E` / `Cmd+Shift+E` — Open side panel

## Usage

### Workspaces
- Click the **+** next to Workspaces to create a new one from your current tabs.
- Click any workspace to switch (tabs are parked/restored automatically).
- Right-click a workspace or use the ⋯ menu to rename/delete.
- Right-click any browser tab → **Move tab to workspace →**

### Panels
- Use the **+** in the Panels rail or the **+ Current** button in the toolbar to add the current page.
- Click a panel icon to load it in the side panel iframe.
- Toggle **📱 / 💻** to request mobile layout (affects User-Agent for that panel).
- Right-click a panel icon to remove it.
- If a page refuses to embed, use the **Open slim popup** button.

## Architecture

- `background.js` — Service worker (workspace switching, DNR rules, context menus, commands)
- `sidepanel.html` / `.js` / `.css` — Main UI
- `lib/store.js` — chrome.storage.local persistence
- `lib/workspaces.js` — Workspace + parking logic
- `lib/panels.js` — Panel CRUD + current page logic

## Permissions Used

- `tabs`, `windows`, `tabGroups`, `storage`, `sidePanel`, `contextMenus`, `declarativeNetRequest`, `commands`

All durable state lives in `chrome.storage.local`.

## Development Notes

- Pure Manifest V3, no build step.
- To test DNR / embedding: many sites block iframes — the extension strips the relevant headers only for subframes initiated by this extension.
- Restart recovery works via saved URL metadata.

## License

MIT — feel free to use and modify.

## Contributing

This was built slice-by-slice following a strict implementation order. PRs are welcome for polish, new features, or bug fixes.

---

**Status**: v1.0.0 — Core features complete and tested in Brave.