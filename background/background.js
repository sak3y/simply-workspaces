/* ============================================================================
 * Workspace — background script
 * ============================================================================
 *
 * What is this file?
 * ------------------
 * This script runs in the background as long as Firefox is open. It's the
 * brain of the extension. It owns all the data (which tabs belong to which
 * workspace) and listens for every tab-related event Firefox emits.
 *
 * The popup (sidebar/sidebar.js) is just a UI. It cannot store anything
 * permanently. So when the user clicks "switch workspace" or "rename", the
 * popup sends a message here, this script does the work and saves it.
 *
 * Big picture data shape:
 * -----------------------
 *   {
 *     workspaces: [
 *       {
 *         id: "ws_xxx",            // unique workspace id (we generate it)
 *         name: "Main",            // shown in the UI
 *         icon: "icon:home",       // either "icon:NAME" or an emoji glyph
 *         color: "#ff8c42",        // accent color
 *         tabIds: [12, 34, ...],   // Firefox tab IDs that live in this workspace
 *         stacks: [],              // (legacy slot, always empty — see migration in reconcileWithBrowser)
 *         lastActiveTabId: 34,     // remember which tab the user was on
 *       },
 *       ...
 *     ],
 *     activeWorkspaceId: "ws_xxx", // which workspace is currently visible
 *     tabIndex: { [tabId]: {workspaceId} },  // reverse lookup, rebuilt on load
 *   }
 *
 * This whole object lives in browser.storage.local under the key below.
 * ============================================================================
 */

"use strict";

const STORAGE_KEY = "panel.state.v1";

// First-run default state (used only when storage is empty).
const DEFAULT_STATE = () => ({
  workspaces: [
    {
      id: wsId(),
      name: "Home",
      icon: "icon:home",
      color: "#ff8c42",
      pinned: true,    // permanent: cannot be renamed, edited, or deleted
      stacks: [],
      tabIds: [],
    },
  ],
  activeWorkspaceId: null,
  tabIndex: {},
});

// Guarantee exactly the invariant the UI relies on: at least one pinned
// (permanent) workspace always exists. Older saved state predates the flag,
// so promote the first workspace if none is pinned. Called on every load.
function ensurePinnedWorkspace() {
  if (!state.workspaces || state.workspaces.length === 0) {
    const def = DEFAULT_STATE();
    state.workspaces = def.workspaces;
    state.activeWorkspaceId = state.workspaces[0].id;
  }
  if (!state.workspaces.some(w => w.pinned)) {
    state.workspaces[0].pinned = true;
  }
}

// Unique workspace ID generator. Two workspaces sharing an id is catastrophic:
// every `find(w => w.id === X)` returns the FIRST match, so a second workspace
// with a duplicate id silently mirrors the first one's tabs in the UI (the
// "tabs duplicated across workspaces" bug). A bare Math.random() slice can, in
// rare cases, repeat. Combining a monotonic counter, a timestamp, and a random
// suffix makes a collision impossible within a session and astronomically
// unlikely across sessions.
let wsIdCounter = 0;
function wsId() {
  wsIdCounter += 1;
  return "ws_" + Date.now().toString(36) + "_" + wsIdCounter.toString(36)
       + "_" + Math.random().toString(36).slice(2, 8);
}

// Top-level mutable state. Loaded once on startup, then mutated in place.
let state = null;

// Save is debounced — when many things change quickly we batch them into
// one storage write. saveTimer holds the pending setTimeout handle.
let saveTimer = null;

// When the user creates a new workspace, the background script also creates
// the workspace's first tab. The tab's onCreated event fires asynchronously,
// so we need to remember "the next tab created should go to workspace X".
// This little holding spot does that.
let pendingWsForNextTab = null;

// ---------- persistence ----------

async function loadState() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) {
    state = stored[STORAGE_KEY];
  } else {
    state = DEFAULT_STATE();
    state.activeWorkspaceId = state.workspaces[0].id;
  }
  await reconcileWithBrowser();
  scheduleSave();
}

function scheduleSave() {
  // Debounce: cancel any in-flight save and queue a new one in 200 ms.
  // This way 10 quick changes only cause one disk write.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    browser.storage.local.set({ [STORAGE_KEY]: state }).catch(() => {});
  }, 200);
}

// ---------- reconciliation ----------
//
// Tab IDs change every time Firefox restarts. So the workspace data we
// loaded from storage probably references tab IDs that no longer exist,
// and Firefox may have tabs we don't know about (session restore, etc).
//
// reconcileWithBrowser() runs once on startup to fix both problems:
//  1. Strip dead tab IDs out of workspaces.
//  2. Adopt any unknown tabs into the active workspace.
//
// Without this, the popup would show ghost entries and new tabs would
// appear "homeless".

async function reconcileWithBrowser() {
  ensurePinnedWorkspace();

  const allTabs = await browser.tabs.query({ currentWindow: true });
  const liveIds = new Set(allTabs.map(t => t.id));

  // Migration: older saved state used "stacks" (Vivaldi-style sub-folders).
  // We removed that feature, so flatten any populated stacks back into the
  // workspace's loose tabIds. Idempotent — once stacks is empty this does
  // nothing on subsequent runs.
  for (const ws of state.workspaces) {
    if (ws.stacks && ws.stacks.length > 0) {
      for (const stack of ws.stacks) {
        if (stack && stack.tabIds) ws.tabIds.push(...stack.tabIds);
      }
      ws.stacks = [];
    } else if (!ws.stacks) {
      ws.stacks = []; // ensure the field exists
    }
  }

  // Step 1 — clean out dead tab IDs and rebuild the tab→workspace lookup.
  // A tab must belong to exactly one workspace. If saved state somehow lists
  // the same tab id in two workspaces (a crash mid-move, an older buggy build),
  // it would show up — and stay visible — in both, the "tabs duplicated across
  // workspaces" bug. We enforce single membership here: the first workspace to
  // claim a live tab keeps it; later workspaces drop it. `claimed` also guards
  // against the same id appearing twice within one workspace's list.
  const newIndex = {};
  const claimed = new Set();
  for (const ws of state.workspaces) {
    ws.tabIds = ws.tabIds.filter(id => liveIds.has(id) && !claimed.has(id));
    for (const id of ws.tabIds) {
      claimed.add(id);
      newIndex[id] = { workspaceId: ws.id };
    }
  }
  state.tabIndex = newIndex;

  // Step 2 — any tab Firefox has but we don't know about, drop it into the
  // active workspace. This handles session-restored tabs after a crash etc.
  const active = getActiveWorkspace();
  for (const t of allTabs) {
    if (!state.tabIndex[t.id]) {
      active.tabIds.push(t.id);
      state.tabIndex[t.id] = { workspaceId: active.id };
    }
  }

  // Remember which tab was active when we started up. Without this, the
  // first time the user switches workspaces and comes back, we wouldn't
  // know which tab to focus.
  const focused = allTabs.find(t => t.active);
  if (focused) {
    const ref = state.tabIndex[focused.id];
    if (ref) {
      const ws = state.workspaces.find(w => w.id === ref.workspaceId);
      if (ws) ws.lastActiveTabId = focused.id;
    }
  }

  // Finally, hide tabs that don't belong to the active workspace.
  await applyWorkspaceVisibility();
}

function getActiveWorkspace() {
  return state.workspaces.find(w => w.id === state.activeWorkspaceId) || state.workspaces[0];
}

// ---------- workspace visibility ----------
//
// This is the heart of the extension. When the user switches workspaces, we
// hide every tab not in the new workspace and show every tab that is.
//
// Firefox quirks to be aware of:
//  - You cannot hide the currently-active tab. Firefox just ignores the
//    request. So we must activate a tab in the new workspace first.
//  - tabs.hide() can fail per-tab (pinned tabs, about: pages, etc.). We
//    hide one at a time so a single failure doesn't kill the others.
//  - Firefox may rearrange things while our async calls are in flight, so
//    we re-query the tab list at the last second before hiding.

async function applyWorkspaceVisibility() {
  const active = getActiveWorkspace();
  const activeIds = new Set(collectWorkspaceTabIds(active));
  const allTabs = await browser.tabs.query({ currentWindow: true });

  // Sort tabs into "show these" (belongs to active workspace) and "hide
  // these" (belongs to some other workspace).
  const toShow = [];
  const toHide = [];
  for (const t of allTabs) {
    if (activeIds.has(t.id)) toShow.push(t.id);
    else toHide.push(t.id);
  }

  console.log("[Workspace] Switch to:", active.name, "show:", toShow, "hide:", toHide);

  // Step 1 — un-hide the new workspace's tabs first, so we have something
  // to focus before we start hiding stuff.
  if (toShow.length) {
    try { await browser.tabs.show(toShow); }
    catch (e) { console.error("[Workspace] tabs.show failed:", e); }
  }

  // Step 2 — if Firefox is currently focused on a tab we're about to hide,
  // activate something else first. Otherwise Firefox silently refuses to
  // hide the active tab and we end up with a tab from the wrong workspace
  // still on screen.
  const focused = allTabs.find(t => t.active);
  if (focused && !activeIds.has(focused.id)) {
    if (toShow.length) {
      // Prefer the tab the user was last on in this workspace.
      const preferred = (active.lastActiveTabId && toShow.includes(active.lastActiveTabId))
        ? active.lastActiveTabId
        : toShow[0];
      try { await browser.tabs.update(preferred, { active: true }); }
      catch (e) { console.error("[Workspace] tabs.update active failed:", e); }
    } else {
      // Edge case: the active workspace is empty. Make a fresh tab so the
      // window isn't blank.
      try {
        const t = await browser.tabs.create({ url: "about:newtab", active: true });
        active.tabIds.push(t.id);
        state.tabIndex[t.id] = { workspaceId: active.id };
        active.lastActiveTabId = t.id;
      } catch (e) { console.error("[Workspace] tabs.create fallback failed:", e); }
    }
  }

  // Step 3 — hide the rest, one at a time. Re-query first because the world
  // may have changed while we were awaiting the activation above.
  if (toHide.length) {
    const fresh = await browser.tabs.query({ currentWindow: true });
    const stillToHide = fresh.filter(t => !activeIds.has(t.id) && !t.active && !t.hidden).map(t => t.id);
    for (const id of stillToHide) {
      try { await browser.tabs.hide(id); }
      catch (e) { console.error("[Workspace] tabs.hide failed for tab", id, ":", e); }
    }
  }

  // Step 4 — clean up Firefox's native tab groups (the colored groups in
  // the tab strip). Collapse groups whose tabs are all hidden, expand any
  // that have visible tabs. Requires Firefox 137+, no-ops on older versions.
  if (browser.tabGroups) {
    try {
      const win = await browser.windows.getCurrent();
      const groups = await browser.tabGroups.query({ windowId: win.id });
      for (const group of groups) {
        const tabsInGroup = await browser.tabs.query({ groupId: group.id });
        const hasVisible = tabsInGroup.some(t => !t.hidden);
        if (!hasVisible && !group.collapsed) {
          try { await browser.tabGroups.update(group.id, { collapsed: true }); } catch (e) {}
        } else if (hasVisible && group.collapsed) {
          try { await browser.tabGroups.update(group.id, { collapsed: false }); } catch (e) {}
        }
      }
    } catch (e) { /* tabGroups API not available - older Firefox */ }
  }
}

function collectWorkspaceTabIds(ws) {
  // Returns a copy of the workspace's tab IDs. (We used to also flatten
  // tabs from sub-stacks here, but stacks are gone so this is a thin
  // wrapper. Kept as a function in case tab membership ever gets more
  // complex again.)
  return [...ws.tabIds];
}

// ---------- tab event sync ----------
//
// Whenever Firefox creates, removes, or activates a tab, we update our
// state to match. This keeps everything in sync no matter how the user
// opened/closed the tab — could've been a click, Ctrl+T, a script, etc.

// Fires when ANY tab is created. Decides which workspace it belongs to.
browser.tabs.onCreated.addListener(async (tab) => {
  if (!state) return;
  if (state.tabIndex[tab.id]) return; // we already know about it

  let ws = null;

  // First check: did our own createWorkspace() ask us to claim this tab?
  if (pendingWsForNextTab) {
    ws = state.workspaces.find(w => w.id === pendingWsForNextTab) || null;
    pendingWsForNextTab = null;
  }

  // Otherwise: if the tab was opened by another tab (e.g. middle-click a
  // link), it inherits its parent's workspace.
  if (!ws && tab.openerTabId && state.tabIndex[tab.openerTabId]) {
    const ref = state.tabIndex[tab.openerTabId];
    ws = state.workspaces.find(w => w.id === ref.workspaceId) || null;
  }

  // Default: drop it in the active workspace.
  if (!ws) ws = getActiveWorkspace();

  // Record the assignment.
  ws.tabIds.push(tab.id);
  state.tabIndex[tab.id] = { workspaceId: ws.id };

  // If the new tab landed in a hidden workspace, hide it immediately so it
  // doesn't appear in the user's tab strip.
  if (ws.id !== state.activeWorkspaceId) {
    try { await browser.tabs.hide(tab.id); } catch (e) {}
  }

  scheduleSave();
  broadcast("state-changed");
});

// Fires when a tab is closed.
browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (!state) return;
  const ref = state.tabIndex[tabId];
  if (!ref) return;
  const wasInActiveWs = ref.workspaceId === state.activeWorkspaceId;
  removeTabFromState(tabId);
  scheduleSave();
  broadcast("state-changed");

  // If the user just closed the last tab in the active workspace, open a
  // fresh blank tab so the workspace isn't empty (mirrors Firefox's default
  // "close last tab → open new tab" behavior). Skip if the whole window is
  // closing — no point creating a new tab when Firefox is on the way out.
  if (wasInActiveWs && !removeInfo.isWindowClosing) {
    const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    if (ws && collectWorkspaceTabIds(ws).length === 0) {
      try {
        const t = await browser.tabs.create({ active: true });
        ws.tabIds.push(t.id);
        state.tabIndex[t.id] = { workspaceId: ws.id };
        ws.lastActiveTabId = t.id;
        scheduleSave();
        broadcast("state-changed");
      } catch (e) { console.warn("Failed to create replacement tab:", e); }
    }
  }
});

// Fires when a tab's title, favicon, status etc. change. We only care about
// "structural" updates, not every keystroke in a URL bar.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.pinned !== undefined || changeInfo.status === "complete") {
    broadcast("tab-updated", { tabId, tab });
  }
});

// Fires when the user (or a script) switches to a different tab.
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  if (state) {
    const ref = state.tabIndex[tabId];
    if (ref) {
      const ws = state.workspaces.find(w => w.id === ref.workspaceId);
      if (ws) {
        ws.lastActiveTabId = tabId;

        // If Firefox just focused a tab in a DIFFERENT workspace (can happen
        // when the user clicks a link from a hidden tab, or session restore
        // jumps around), our "active workspace" is now lying. Auto-switch to
        // match what's actually visible.
        if (ws.id !== state.activeWorkspaceId) {
          state.activeWorkspaceId = ws.id;
          await applyWorkspaceVisibility();
          broadcast("workspace-switched", { workspaceId: ws.id });
        }
        scheduleSave();
      }
    }
  }
  broadcast("tab-activated", { tabId });
});

// We don't track Firefox's native tab-strip drag reordering. The popup
// has its own drag-to-reorder for workspaces and that's authoritative.
browser.tabs.onMoved.addListener(() => {});

function removeTabFromState(tabId) {
  const ref = state.tabIndex[tabId];
  if (!ref) return;
  const ws = state.workspaces.find(w => w.id === ref.workspaceId);
  if (ws) {
    ws.tabIds = ws.tabIds.filter(id => id !== tabId);
  }
  delete state.tabIndex[tabId];
}

// ---------- messaging ----------
//
// The popup talks to us in two ways:
//
//   1. A long-lived "port" connection. We use this to PUSH updates from
//      here to the popup (e.g. "the state changed, redraw"). The popup
//      opens the port when it loads.
//
//   2. One-off sendMessage requests. The popup uses these to ASK us to do
//      something (switch workspace, create workspace, etc.) and waits for
//      a reply.
//
// The two channels keep request/response separate from broadcast updates.

// Set of currently-connected popup instances. Usually 0 or 1 (popup or
// sidebar pane), but could be 2 if both are open.
const ports = new Set();

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel-sidebar") return; // not us
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

// Push a message to every connected popup.
function broadcast(type, payload) {
  for (const p of ports) {
    try { p.postMessage({ type, payload }); } catch (e) {}
  }
}

// Handle one-off requests from the popup. Each `case` matches a `type`
// the popup sends in `send('type', ...)`.
browser.runtime.onMessage.addListener(async (msg) => {
  if (!state) await loadState();

  switch (msg.type) {
    case "get-state":
      return { state, workspaceTabs: await getActiveWorkspaceTabs() };

    case "switch-workspace":
      return await switchWorkspace(msg.workspaceId);

    case "create-workspace":
      return await createWorkspace(msg.name, msg.icon);

    case "rename-workspace":
      return await renameWorkspace(msg.workspaceId, msg.name, msg.icon);

    case "delete-workspace":
      return await deleteWorkspace(msg.workspaceId);

    case "move-tab-to-workspace":
      return await moveTabToWorkspace(msg.tabId, msg.workspaceId);

    case "reorder-workspaces":
      return await reorderWorkspaces(msg.order);

    case "hibernate-workspace": {
      const ws = state.workspaces.find(w => w.id === msg.workspaceId);
      if (ws) {
        const ids = collectWorkspaceTabIds(ws);
        try { await browser.tabs.discard(ids); } catch (e) {}
      }
      return { ok: true };
    }

    case "new-tab-in-workspace": {
      const ws = state.workspaces.find(w => w.id === msg.workspaceId) || getActiveWorkspace();
      const wasActive = ws.id === state.activeWorkspaceId;
      // Claim the next-created tab for THIS workspace. Without this, onCreated
      // falls back to getActiveWorkspace() and a "New tab here" on a non-active
      // workspace would wrongly land in the active one. onCreated also hides it
      // when the target workspace isn't active.
      pendingWsForNextTab = ws.id;
      let tab;
      try {
        tab = await browser.tabs.create({ active: wasActive });
      } catch (e) {
        pendingWsForNextTab = null;
        return { ok: false };
      }
      return { ok: true, tabId: tab.id };
    }
  }
});

// ---------- workspace ops ----------

async function getActiveWorkspaceTabs() {
  const ws = getActiveWorkspace();
  const ids = collectWorkspaceTabIds(ws);
  if (ids.length === 0) return [];
  const tabs = await browser.tabs.query({ currentWindow: true });
  const map = new Map(tabs.map(t => [t.id, t]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

async function switchWorkspace(workspaceId) {
  if (!state.workspaces.find(w => w.id === workspaceId)) return { ok: false };
  state.activeWorkspaceId = workspaceId;
  await applyWorkspaceVisibility();
  scheduleSave();
  broadcast("workspace-switched", { workspaceId });
  updateActionIcons();
  return { ok: true };
}

async function createWorkspace(name, icon) {
  const ws = {
    id: wsId(),
    name: name || "New Workspace",
    icon: typeof icon === "string" && icon ? icon : "icon:layers",
    color: pickColor(state.workspaces.length),
    stacks: [],
    tabIds: [],
  };
  state.workspaces.push(ws);
  scheduleSave();
  rebuildTabContextMenu();
  // Show the new workspace in the panel immediately — BEFORE awaiting the tab
  // creation below. Otherwise the row only appears after Firefox finishes
  // making the tab, which is a visible lag.
  broadcast("state-changed");

  // Create the workspace's initial tab. We mark our intent so the
  // onCreated listener assigns it to the new workspace, and onCreated
  // will hide it (since the new workspace is not yet active).
  pendingWsForNextTab = ws.id;
  try {
    const t = await browser.tabs.create({ active: false, url: "about:newtab" });
    // Register the tab to THIS workspace synchronously rather than depending
    // on the async onCreated event. onCreated can fire after the caller
    // switches to the new workspace, which left the workspace momentarily
    // empty and let the active workspace's tabs leak in. onCreated is a no-op
    // once the tab is already in tabIndex.
    if (!state.tabIndex[t.id]) {
      ws.tabIds.push(t.id);
      state.tabIndex[t.id] = { workspaceId: ws.id };
    }
    ws.lastActiveTabId = t.id;
    // The new workspace isn't active yet, so keep its tab hidden.
    try { await browser.tabs.hide(t.id); } catch (e) {}
  } catch (e) {
    console.warn("Failed to create initial tab for workspace:", e);
  }
  pendingWsForNextTab = null;

  scheduleSave();
  broadcast("state-changed"); // update the tab count now the tab exists
  return { ok: true, workspaceId: ws.id };
}

async function renameWorkspace(workspaceId, name, icon) {
  const ws = state.workspaces.find(w => w.id === workspaceId);
  if (!ws) return { ok: false };
  if (ws.pinned) return { ok: false, reason: "pinned" }; // permanent ws is not editable
  if (typeof name === "string") ws.name = name;
  if (typeof icon === "string") ws.icon = icon;
  scheduleSave();
  broadcast("state-changed");
  rebuildTabContextMenu();
  if (ws.id === state.activeWorkspaceId) updateActionIcons();
  return { ok: true };
}

async function deleteWorkspace(workspaceId) {
  const ws = state.workspaces.find(w => w.id === workspaceId);
  if (!ws) return { ok: false };
  if (ws.pinned) return { ok: false, reason: "pinned" }; // permanent ws cannot be deleted
  // Close all its tabs.
  const ids = collectWorkspaceTabIds(ws);
  if (ids.length) {
    try { await browser.tabs.remove(ids); } catch (e) {}
  }
  state.workspaces = state.workspaces.filter(w => w.id !== workspaceId);
  for (const id of ids) delete state.tabIndex[id];
  if (state.activeWorkspaceId === workspaceId) {
    state.activeWorkspaceId = state.workspaces[0].id;
    await applyWorkspaceVisibility();
  }
  scheduleSave();
  broadcast("state-changed");
  rebuildTabContextMenu();
  return { ok: true };
}

async function moveTabToWorkspace(tabId, workspaceId) {
  const targetWs = state.workspaces.find(w => w.id === workspaceId);
  if (!targetWs) return { ok: false };
  if (targetWs.id === state.activeWorkspaceId) return { ok: true }; // no-op

  // BUGFIX: if we're moving the currently-active tab away, focus another
  // tab in the active workspace first — otherwise applyWorkspaceVisibility
  // will see "the active tab is being hidden" and switch workspaces.
  let tabBeingMoved;
  try { tabBeingMoved = await browser.tabs.get(tabId); } catch { return { ok: false }; }

  if (tabBeingMoved.active) {
    const activeWs = getActiveWorkspace();
    const stayingIds = collectWorkspaceTabIds(activeWs).filter(id => id !== tabId);
    if (stayingIds.length) {
      const preferred = (activeWs.lastActiveTabId && stayingIds.includes(activeWs.lastActiveTabId))
        ? activeWs.lastActiveTabId
        : stayingIds[0];
      try { await browser.tabs.update(preferred, { active: true }); } catch (e) {}
    } else {
      // active workspace would be empty — open a new tab so it isn't blank
      const t = await browser.tabs.create({ url: "about:newtab", active: true });
      activeWs.tabIds.push(t.id);
      state.tabIndex[t.id] = { workspaceId: activeWs.id };
    }
  }

  // Remove from current location.
  removeTabFromState(tabId);
  // Add as loose tab to target.
  targetWs.tabIds.push(tabId);
  state.tabIndex[tabId] = { workspaceId: targetWs.id };
  // Hide it (target is not active by the no-op check above).
  try { await browser.tabs.hide(tabId); } catch (e) {}

  scheduleSave();
  broadcast("state-changed");
  return { ok: true };
}

async function reorderWorkspaces(order) {
  if (!Array.isArray(order)) return { ok: false };
  const ordered = order.map(id => state.workspaces.find(w => w.id === id)).filter(Boolean);
  const remaining = state.workspaces.filter(w => !order.includes(w.id));
  const next = [...ordered, ...remaining];
  // Pinned (permanent) workspaces always stay at the top, in their existing
  // relative order — they can't be dragged down among the editable ones.
  state.workspaces = [...next.filter(w => w.pinned), ...next.filter(w => !w.pinned)];
  scheduleSave();
  broadcast("state-changed");
  rebuildTabContextMenu();
  return { ok: true };
}

// ---------- action title ----------
// The toolbar icon is a static grey layers SVG (icons/icon-*.svg). We only
// update the hover title to reflect the active workspace.

async function updateActionIcons() {
  if (!state) return;
  const ws = getActiveWorkspace();
  if (!ws) return;
  try { await browser.browserAction.setTitle({ title: `Workspace: ${ws.name}` }); } catch (e) {}
  try { await browser.sidebarAction.setTitle({ title: `Workspace: ${ws.name}` }); } catch (e) {}
}

// ---------- color palette ----------

const PALETTE = ["#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#6366f1", "#a855f7", "#ec4899", "#14b8a6"];
function pickColor(seed) { return PALETTE[seed % PALETTE.length]; }

// ---------- commands ----------

browser.commands.onCommand.addListener(async (cmd) => {
  if (!state) await loadState();
  if (cmd === "next-workspace" || cmd === "prev-workspace") {
    const idx = state.workspaces.findIndex(w => w.id === state.activeWorkspaceId);
    const dir = cmd === "next-workspace" ? 1 : -1;
    const next = state.workspaces[(idx + dir + state.workspaces.length) % state.workspaces.length];
    await switchWorkspace(next.id);
  }
});

// ---------- tab context menu ----------
// Adds a "Move to workspace" submenu to the right-click context menu of any
// tab in Firefox's native tab strip. Rebuilt whenever workspaces change.

const MENU_ROOT_ID = "panel-move-root";
let menuItemIds = [];

function rebuildTabContextMenu() {
  if (!state) return;
  // Wipe everything and rebuild. removeAll is more reliable than tracking IDs.
  browser.menus.removeAll().then(() => {
    menuItemIds = [];
    try {
      browser.menus.create({
        id: MENU_ROOT_ID,
        title: "Move to workspace",
        contexts: ["tab"],
      });
      menuItemIds.push(MENU_ROOT_ID);
    } catch (e) {
      console.error("[Workspace] menus.create root failed:", e);
    }

    for (const ws of state.workspaces) {
      const id = `panel-move-to-${ws.id}`;
      try {
        browser.menus.create({
          id,
          parentId: MENU_ROOT_ID,
          title: ws.name + (ws.id === state.activeWorkspaceId ? " (current)" : ""),
          contexts: ["tab"],
          enabled: ws.id !== state.activeWorkspaceId,
        });
        menuItemIds.push(id);
      } catch (e) {
        console.error("[Workspace] menus.create item failed:", e);
      }
    }
    console.log("[Workspace] Rebuilt tab menu with", state.workspaces.length, "workspaces");
  }).catch(e => console.error("[Workspace] menus.removeAll failed:", e));
}

browser.menus.onClicked.addListener(async (info, tab) => {
  if (!state || !tab) return;
  if (typeof info.menuItemId !== "string") return;
  if (!info.menuItemId.startsWith("panel-move-to-")) return;
  const targetWsId = info.menuItemId.slice("panel-move-to-".length);
  console.log("[Workspace] Move tab", tab.id, "to workspace", targetWsId);
  // If multiple tabs are highlighted, move all of them.
  let tabIds = [tab.id];
  if (tab.highlighted) {
    const highlighted = await browser.tabs.query({ highlighted: true, currentWindow: true });
    tabIds = highlighted.map(t => t.id);
  }
  for (const tabId of tabIds) {
    await moveTabToWorkspace(tabId, targetWsId);
  }
});

// ---------- boot ----------

loadState().then(() => {
  rebuildTabContextMenu();
  updateActionIcons();
});
