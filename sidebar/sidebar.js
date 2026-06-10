/* ============================================================================
 * Workspace — popup / sidebar UI
 * ============================================================================
 *
 * This file runs whenever the user opens the popup (toolbar button) or the
 * sidebar pane. Both load sidebar.html, which loads this script.
 *
 * What this file does:
 *  - Asks the background script for the current state (workspaces, etc.)
 *  - Renders the workspace list
 *  - Sends user actions back to the background (switch, create, rename, etc.)
 *  - Listens for state changes and re-renders
 *
 * It does NOT store anything itself. Everything goes through the background
 * script, which owns the data. Closing the popup loses no work.
 *
 * Quick map:
 *  - ICONS / EMOJIS         icon set used in the workspace creator
 *  - state                  current workspace data (a copy from background)
 *  - render() / renderList() draws the UI based on state
 *  - $newBtn / $creator     the "+ New Workspace" UI
 *  - openWorkspaceMenu()    right-click menu on a workspace row
 * ============================================================================
 */

"use strict";

// ---------- icon set (Lucide line icons) ----------
//
// These are the line icons the user can pick when creating a workspace.
// Each value is just the inner SVG paths for that icon — we wrap them in
// an <svg> tag at render time. To add a new icon, paste its paths from
// lucide.dev here under a short key.

const ICONS = {
  layers:        '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  home:          '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  briefcase:     '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'shopping-bag':'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  'shopping-cart':'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  bicycle:       '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  car:           '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  plane:         '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  sailboat:      '<path d="M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z"/><path d="M21 14 10 2 3 14h18Z"/><path d="M10 2v16"/>',
  anchor:        '<circle cx="12" cy="5" r="3"/><line x1="12" x2="12" y1="22" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>',
  compass:       '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  book:          '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  'graduation-cap':'<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  flask:         '<path d="M9 3h6"/><path d="M10 9V3h4v6"/><path d="M4 21h16L14 9h-4Z"/>',
  code:          '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  cpu:           '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  gamepad:       '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
  music:         '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  film:          '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  camera:        '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  heart:         '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  star:          '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  trophy:        '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  flame:         '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  flag:          '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  mail:          '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  coffee:        '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  utensils:      '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  sword:         '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/>',
};

const ICON_ORDER = [
  'layers', 'home', 'briefcase', 'shopping-bag', 'shopping-cart',
  'bicycle', 'car', 'plane', 'sailboat', 'anchor',
  'compass', 'book', 'graduation-cap', 'flask', 'code',
  'cpu', 'gamepad', 'music', 'film', 'camera',
  'heart', 'star', 'trophy', 'flame', 'flag',
  'mail', 'coffee', 'utensils', 'sword',
];

const EMOJIS = [
  '🏠','💼','🛍️','📚','🎮','🎵','🎨','✈️','🍕','☕',
  '🌟','❤️','💰','🎯','🔥','💡','⚙️','📝','🎬','🏆',
  '🌍','📷','🚀','🎓','🎁','🌸','⛵','🎸','📊','📁',
];

function iconSvg(name, size = 18) {
  const path = ICONS[name] || ICONS.layers;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}">${path}</svg>`;
}

function textForName(name) {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Two-word names → first letter of each word (e.g. "Start Page" → "SP").
  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && words[0] && words[1]) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 1).toUpperCase();
}

function textIconHtml(text) {
  return `<span class="text-icon">${escapeHtml(text)}</span>`;
}

function iconHtml(value, name) {
  // Empty/null icon → derive text avatar from the workspace name.
  if (!value) return textIconHtml(textForName(name));
  if (typeof value === 'string' && value.startsWith('icon:')) {
    return iconSvg(value.slice(5));
  }
  // Anything else is treated as an emoji glyph.
  return `<span class="emoji">${escapeHtml(value)}</span>`;
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
const GRIP_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="14" height="14"><line x1="3" x2="13" y1="6" y2="6"/><line x1="3" x2="13" y1="10" y2="10"/></svg>';

// ---------- bg communication ----------

// In the sidebar pane, swap the body background to transparent so the empty
// area below the popup content blends with Firefox's native panel color
// instead of showing our dark grey.
if (new URLSearchParams(location.search).get('context') === 'sidebar') {
  document.body.classList.add('in-sidebar');
}

// Resolve the extension API. Firefox exposes `browser`, Chromium exposes
// `chrome`. When this page is opened as a plain web page (preview / local
// testing) neither runtime exists — we fall back to null so the UI still
// loads and all the click handlers below still wire up. Without this guard a
// top-level `browser.runtime.connect(...)` throws a ReferenceError and aborts
// the whole script, leaving every button dead.
const api = (typeof browser !== "undefined") ? browser
          : (typeof chrome !== "undefined") ? chrome
          : null;
const hasRuntime = !!(api && api.runtime && api.runtime.connect);

let port = null;
if (hasRuntime) {
  try {
    port = api.runtime.connect({ name: "panel-sidebar" });
    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === "state-changed" || msg.type === "workspace-switched" || msg.type === "tab-activated" || msg.type === "tab-updated") {
        refresh();
      }
    });
  } catch (e) {
    port = null;
  }
}

function send(type, payload) {
  if (hasRuntime) {
    try { return api.runtime.sendMessage({ type, ...payload }); }
    catch (e) { return Promise.resolve(null); }
  }
  // No extension runtime → use the local fallback backend (localStorage-
  // backed) so the UI is fully functional and persistent as a plain web page.
  if (window.LocalBackend) return window.LocalBackend.handle(type, payload);
  return Promise.resolve(null);
}

// In local mode there is no port to push "state-changed" broadcasts, so the
// fallback backend calls this whenever it mutates state. (refresh is a
// hoisted function declaration defined below.)
if (!hasRuntime && window.LocalBackend) {
  window.LocalBackend.onChange = refresh;
}

// ---------- state ----------
//
// All variables we mutate as the user interacts with the UI. Kept in module
// scope (no class) for simplicity.

let state = null;          // copy of the workspace data (refreshed from background)
let isCreating = false;    // true while the "+ New Workspace" form is open
let editingId = null;      // if set, the form is editing an existing workspace
let draftIcon = '';        // icon picked in the form (empty string = "use first letter of name")
let draftMode = 'icon';    // 'icon' or 'emoji' — which picker tab is active
let renamingId = null;     // workspace currently being inline-renamed (double-click)

// ---------- elements ----------
//
// One-time DOM lookups so we're not calling getElementById everywhere.

const $list = document.getElementById('list');
const $newBtn = document.getElementById('newBtn');
const $creator = document.getElementById('creator');
const $creatorIconBtn = document.getElementById('creatorIconBtn');
const $creatorName = document.getElementById('creatorName');
const $tabIcon = document.getElementById('tabIcon');
const $tabEmoji = document.getElementById('tabEmoji');
const $iconGrid = document.getElementById('iconGrid');
const $emojiGrid = document.getElementById('emojiGrid');
const $createBtn = document.getElementById('createBtn');
const $cancelBtn = document.getElementById('cancelBtn');
const $ctxMenu = document.getElementById('ctxMenu');

// ---------- boot ----------
//
// Run as soon as the script loads. Pulls state from background, kicks off
// the first render. Subsequent renders are triggered by port messages
// (state-changed, workspace-switched, ...) further up.

// Defined here, but invoked at the very bottom of the file — after the
// refresh/render state (`let refreshInFlight`, `let lastRenderSig`, ...) has
// been initialized. Calling it here would hit those `let`s in their temporal
// dead zone and throw, leaving the panel blank.
async function init() { await refresh(); }

// Coalesce refreshes. Firefox fires tab-activated / tab-updated rapidly when
// switching tabs, and each used to trigger its own full re-render — the cause
// of the visible flashing. If a refresh is already in flight, we don't start
// a second; we just remember to run one more pass when it finishes. Bursts of
// N events collapse into at most 2 state fetches.
let refreshInFlight = false;
let refreshQueued = false;
async function refresh() {
  // Never rebuild the list mid-drag: replacing the dragged row's DOM node
  // cancels the browser's drag and the drop "snaps back". Defer until dragend.
  if (dragId) { refreshQueued = true; return; }
  if (refreshInFlight) { refreshQueued = true; return; }
  refreshInFlight = true;
  try {
    const res = await send('get-state');
    if (res) { state = res.state; render(); }
  } finally {
    refreshInFlight = false;
    if (refreshQueued) { refreshQueued = false; refresh(); }
  }
}

// ---------- render ----------

// Signature of everything the list actually shows. If it hasn't changed since
// the last render we skip rebuilding the DOM entirely — so a tab switch within
// the same workspace (which changes nothing visible here) causes no repaint,
// and no flash.
let lastRenderSig = null;
function renderSignature() {
  return JSON.stringify({
    active: state.activeWorkspaceId,
    renaming: renamingId,
    ws: state.workspaces.map(w => [w.id, w.name, w.icon, w.tabIds.length, w.pinned ? 1 : 0]),
  });
}

function render() {
  if (!state) return;
  const sig = renderSignature();
  if (sig !== lastRenderSig) {
    lastRenderSig = sig;
    renderList();
  }
  if (isCreating) renderCreator();
}

function tabCount(ws) {
  return ws.tabIds.length;
}

function renderList() {
  $list.textContent = '';
  let prevPinned = null;
  for (const ws of state.workspaces) {
    // Visually separate the permanent (pinned) workspace(s) from the editable
    // ones with a divider at the boundary.
    if (prevPinned === true && !ws.pinned) {
      const sep = document.createElement('div');
      sep.className = 'ws-sep';
      $list.appendChild(sep);
    }
    prevPinned = !!ws.pinned;

    const el = document.createElement('div');
    el.className = 'ws' + (ws.id === state.activeWorkspaceId ? ' active' : '') + (ws.pinned ? ' pinned' : '');
    el.dataset.wsId = ws.id;
    el.draggable = !ws.pinned; // permanent ws can't be dragged/reordered

    const count = tabCount(ws);
    const countLabel = `${count} ${count === 1 ? 'tab' : 'tabs'}`;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'ws-icon';
    iconWrap.innerHTML = iconHtml(ws.icon, ws.name);
    el.appendChild(iconWrap);

    const info = document.createElement('div');
    info.className = 'ws-info';

    if (renamingId === ws.id) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'ws-rename-input';
      inp.value = ws.name;
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commitRename(ws.id, inp.value.trim());
        else if (e.key === 'Escape') cancelRename();
      });
      inp.addEventListener('blur', () => commitRename(ws.id, inp.value.trim()));
      inp.addEventListener('click', (e) => e.stopPropagation());
      info.appendChild(inp);
      requestAnimationFrame(() => { inp.focus(); inp.select(); });
    } else {
      const name = document.createElement('div');
      name.className = 'ws-name';
      name.textContent = ws.name;
      info.appendChild(name);

      const cnt = document.createElement('div');
      cnt.className = 'ws-count';
      cnt.textContent = countLabel;
      info.appendChild(cnt);
    }
    el.appendChild(info);

    if (ws.id === state.activeWorkspaceId) {
      const check = document.createElement('span');
      check.className = 'ws-check';
      check.innerHTML = CHECK_SVG;
      el.appendChild(check);
    } else {
      const grip = document.createElement('span');
      grip.className = 'ws-grip';
      grip.innerHTML = GRIP_SVG;
      el.appendChild(grip);
    }

    setupWsEvents(el, ws);
    $list.appendChild(el);
  }
}

function setupWsEvents(el, ws) {
  el.addEventListener('click', (e) => {
    if (renamingId === ws.id) return;
    if (ws.id !== state.activeWorkspaceId) {
      // Optimistic update: change the highlight immediately, even before
      // the background confirms. Otherwise there's a perceptible delay.
      state.activeWorkspaceId = ws.id;
      render();
      send('switch-workspace', { workspaceId: ws.id });
    }
  });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); openWorkspaceMenu(e, ws); });
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (ws.pinned) return; // permanent ws is not renamable
    startRename(ws.id);
  });

  el.addEventListener('dragstart', (e) => {
    if (renamingId === ws.id) { e.preventDefault(); return; }
    dragId = ws.id;
    try { e.dataTransfer.setData('text/plain', 'ws:' + ws.id); } catch {}
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragId = null;
    // Run any refresh that was deferred during the drag.
    if (refreshQueued) { refreshQueued = false; refresh(); }
  });

  // Firefox needs preventDefault on BOTH dragenter and dragover for the row to
  // be treated as a valid drop target; without it the drop is rejected.
  el.addEventListener('dragenter', (e) => {
    if (!dragId || dragId === ws.id) return;
    e.preventDefault();
  });

  el.addEventListener('dragover', (e) => {
    if (!dragId || dragId === ws.id) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    el.classList.toggle('drop-before', before);
    el.classList.toggle('drop-after', !before);
    el.dataset.dropMode = before ? 'before' : 'after';
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('drop-before', 'drop-after');
    delete el.dataset.dropMode;
  });
  el.addEventListener('drop', async (e) => {
    el.classList.remove('drop-before', 'drop-after');
    if (!dragId || dragId === ws.id) return;
    e.preventDefault();
    const mode = el.dataset.dropMode || 'after';
    delete el.dataset.dropMode;
    await reorderWorkspaceToward(dragId, ws.id, mode);
  });
}

let dragId = null;

async function reorderWorkspaceToward(sourceId, targetId, mode) {
  const order = state.workspaces.map(w => w.id);
  const sIdx = order.indexOf(sourceId);
  if (sIdx === -1) return;
  order.splice(sIdx, 1);
  const tIdx = order.indexOf(targetId);
  if (tIdx === -1) return;
  order.splice(mode === 'before' ? tIdx : tIdx + 1, 0, sourceId);

  // Optimistic local reorder so the row moves the instant you drop — pinned
  // workspaces stay on top, matching what the backend will persist. Without
  // this the list only updates after a round-trip, which reads as "snap back".
  const byId = new Map(state.workspaces.map(w => [w.id, w]));
  const reordered = order.map(id => byId.get(id)).filter(Boolean);
  state.workspaces = [...reordered.filter(w => w.pinned), ...reordered.filter(w => !w.pinned)];
  render();

  await send('reorder-workspaces', { order });
}

// ---------- inline rename ----------

function startRename(wsId) { renamingId = wsId; render(); }
function cancelRename() { renamingId = null; render(); }
async function commitRename(wsId, newName) {
  const ws = state.workspaces.find(w => w.id === wsId);
  if (!ws) { renamingId = null; render(); return; }
  const changed = newName && newName !== ws.name;
  // Leave edit mode immediately and redraw. Without rendering here, clicking
  // away with an unchanged name would clear renamingId but leave the input
  // on screen until some unrelated broadcast happened to refresh.
  renamingId = null;
  if (changed) {
    ws.name = newName;       // optimistic, so the redraw shows the new name now
    render();
    await send('rename-workspace', { workspaceId: wsId, name: newName });
  } else {
    render();
  }
}

// ---------- creator ----------

$newBtn.addEventListener('click', startCreating);
$cancelBtn.addEventListener('click', cancelCreating);
$createBtn.addEventListener('click', commitCreating);

$creatorName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitCreating(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelCreating(); }
});

$tabIcon.addEventListener('click', () => setMode('icon'));
$tabEmoji.addEventListener('click', () => setMode('emoji'));

function startCreating() {
  isCreating = true;
  editingId = null;
  draftIcon = 'icon:layers';
  draftMode = 'icon';
  $creator.hidden = false;
  $newBtn.hidden = true;
  $creatorName.value = '';
  $creatorIconBtn.innerHTML = iconHtml(draftIcon, 'New');
  $createBtn.textContent = 'Create';
  setMode('icon');
  renderIconGrid();
  renderEmojiGrid();
  requestAnimationFrame(() => $creatorName.focus());
}

function startEditing(ws) {
  isCreating = true;
  editingId = ws.id;
  draftIcon = ws.icon || 'icon:layers';
  // Determine starting tab based on icon type.
  draftMode = (typeof draftIcon === 'string' && draftIcon.startsWith('icon:')) ? 'icon' : 'emoji';
  $creator.hidden = false;
  $newBtn.hidden = true;
  $creatorName.value = ws.name;
  $creatorIconBtn.innerHTML = iconHtml(draftIcon, ws.name);
  $createBtn.textContent = 'Save';
  setMode(draftMode);
  renderIconGrid();
  renderEmojiGrid();
  requestAnimationFrame(() => { $creatorName.focus(); $creatorName.select(); });
}

function cancelCreating() {
  isCreating = false;
  editingId = null;
  $creator.hidden = true;
  $newBtn.hidden = false;
}

async function commitCreating() {
  const name = $creatorName.value.trim() || 'New Workspace';
  const icon = draftIcon;
  if (editingId) {
    await send('rename-workspace', { workspaceId: editingId, name, icon });
  } else {
    const res = await send('create-workspace', { name, icon });
    if (res?.workspaceId) {
      state.activeWorkspaceId = res.workspaceId;
      render();
      await send('switch-workspace', { workspaceId: res.workspaceId });
    }
  }
  cancelCreating();
}

function setMode(mode) {
  draftMode = mode;
  $iconGrid.hidden = (mode !== 'icon');
  $emojiGrid.hidden = (mode !== 'emoji');
  $tabIcon.classList.toggle('active', mode === 'icon');
  $tabEmoji.classList.toggle('active', mode === 'emoji');
}

function renderCreator() {
  $creatorIconBtn.innerHTML = iconHtml(draftIcon, $creatorName.value || 'New');
  renderIconGrid();
  renderEmojiGrid();
}

function renderIconGrid() {
  $iconGrid.textContent = '';
  for (const name of ICON_ORDER) {
    const btn = document.createElement('button');
    const value = `icon:${name}`;
    btn.className = 'grid-item' + (draftIcon === value ? ' selected' : '');
    btn.title = name.replace(/-/g, ' ');
    btn.innerHTML = iconSvg(name, 19);
    btn.addEventListener('click', () => {
      draftIcon = value;
      $creatorIconBtn.innerHTML = iconHtml(draftIcon, $creatorName.value || 'New');
      for (const c of $iconGrid.children) c.classList.remove('selected');
      btn.classList.add('selected');
    });
    $iconGrid.appendChild(btn);
  }
}

function renderEmojiGrid() {
  $emojiGrid.textContent = '';
  for (const emoji of EMOJIS) {
    const btn = document.createElement('button');
    btn.className = 'grid-item' + (draftIcon === emoji ? ' selected' : '');
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      draftIcon = emoji;
      $creatorIconBtn.innerHTML = iconHtml(draftIcon, $creatorName.value || 'New');
      for (const c of $emojiGrid.children) c.classList.remove('selected');
      btn.classList.add('selected');
    });
    $emojiGrid.appendChild(btn);
  }
}

// ---------- context menu ----------

function closeMenu() { $ctxMenu.hidden = true; $ctxMenu.textContent = ''; }
document.addEventListener('click', (e) => { if (!$ctxMenu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); cancelRename(); } });

function openMenuAt(x, y, items) {
  $ctxMenu.textContent = '';
  for (const item of items) {
    if (item.type === 'sep') { const s = document.createElement('div'); s.className = 'ctx-sep'; $ctxMenu.appendChild(s); continue; }
    const it = document.createElement('button');
    it.className = 'ctx-item' + (item.danger ? ' danger' : '');
    it.textContent = item.label;
    it.addEventListener('click', () => { closeMenu(); item.onClick && item.onClick(); });
    $ctxMenu.appendChild(it);
  }
  $ctxMenu.hidden = false;
  const rect = $ctxMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  $ctxMenu.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
  $ctxMenu.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
}

function openWorkspaceMenu(e, ws) {
  const idx = state.workspaces.findIndex(w => w.id === ws.id);
  const items = [];
  if (ws.id !== state.activeWorkspaceId) {
    items.push({ label: 'Switch to here', onClick: () => send('switch-workspace', { workspaceId: ws.id }) });
  }
  // The permanent (pinned) workspace can't be edited, renamed, reordered, or
  // deleted — only switched to and used.
  if (!ws.pinned) {
    items.push({ label: 'Edit…', onClick: () => startEditing(ws) });
    items.push({ label: 'Rename', onClick: () => startRename(ws.id) });
  }
  items.push({ label: 'New tab here', onClick: () => send('new-tab-in-workspace', { workspaceId: ws.id }) });
  items.push({ label: 'Hibernate all tabs', onClick: () => send('hibernate-workspace', { workspaceId: ws.id }) });
  if (!ws.pinned) {
    // Move only among the non-pinned workspaces (index 0 is the pinned one).
    const firstMovable = state.workspaces.findIndex(w => !w.pinned);
    items.push({ type: 'sep' });
    if (idx > firstMovable) items.push({ label: 'Move up', onClick: () => reorderWorkspaceToward(ws.id, state.workspaces[idx - 1].id, 'before') });
    if (idx < state.workspaces.length - 1) items.push({ label: 'Move down', onClick: () => reorderWorkspaceToward(ws.id, state.workspaces[idx + 1].id, 'after') });
    items.push({ type: 'sep' });
    items.push({
      label: 'Delete workspace',
      danger: true,
      onClick: async () => {
        if (!confirm(`Delete workspace "${ws.name}" and close all its tabs?`)) return;
        await send('delete-workspace', { workspaceId: ws.id });
      },
    });
  }
  openMenuAt(e.clientX, e.clientY, items);
}

// ---------- helpers ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- boot ----------
// Kick off the first load now that all module state is initialized.
init();
