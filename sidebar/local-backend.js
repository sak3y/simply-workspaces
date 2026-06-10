/* ============================================================================
 * Workspace — local (no-extension) fallback backend
 * ============================================================================
 *
 * When sidebar.html is loaded as a real Firefox extension, the background
 * script (background/background.js) owns all state and talks to the real
 * tab APIs. This file is NOT used in that case.
 *
 * But when the same page is opened as a plain web page — for local preview,
 * design work, or testing — there is no background script and no `browser`
 * runtime. Without a backend, every action (create/rename/switch/delete a
 * workspace) is a no-op and nothing persists.
 *
 * This module provides a drop-in stand-in. It implements the exact same
 * message protocol the background script answers (get-state,
 * create-workspace, switch-workspace, ...) and persists state to
 * localStorage so it survives reloads. sidebar.js routes through it
 * automatically whenever the extension runtime is unavailable.
 *
 * There are no real browser tabs in this mode, so tab IDs are synthetic
 * counters and "tab count" reflects only tabs created via the UI.
 * ============================================================================
 */

(function () {
  "use strict";

  // Separate key from the extension's ("panel.state.v1") so the two never
  // clobber each other if both ever run against the same origin.
  const STORAGE_KEY = "panel.state.local.v1";

  const PALETTE = ["#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#6366f1", "#a855f7", "#ec4899", "#14b8a6"];
  function pickColor(seed) { return PALETTE[seed % PALETTE.length]; }
  // Collision-proof workspace id (mirrors background.js). Two workspaces sharing
  // an id make every `find(w => w.id === X)` resolve to the first, so the second
  // row mirrors the first's tabs — the "tabs duplicated across workspaces" bug.
  // Counter + timestamp + random rules that out.
  let wsIdCounter = 0;
  function wsId() {
    wsIdCounter += 1;
    return "ws_" + Date.now().toString(36) + "_" + wsIdCounter.toString(36)
         + "_" + Math.random().toString(36).slice(2, 8);
  }

  // Synthetic tab-id source. Seeded high to avoid colliding with anything.
  let fakeTabSeq = 1000;

  let onChange = null; // sidebar.js sets this to its refresh() function.

  function defaultState() {
    const id = wsId();
    return {
      workspaces: [
        { id, name: "Home", icon: "icon:home", color: "#ff8c42", pinned: true, stacks: [], tabIds: [] },
      ],
      activeWorkspaceId: id,
      tabIndex: {},
    };
  }

  // Mirror the background script: at least one pinned (permanent) workspace
  // must always exist. Promote the first if older saved state has none.
  function ensurePinned(s) {
    if (!s.workspaces.some(w => w.pinned)) s.workspaces[0].pinned = true;
  }

  // ---------- persistence ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        // Validate the shape so a corrupt entry can't brick the UI.
        if (s && Array.isArray(s.workspaces) && s.workspaces.length > 0 && s.activeWorkspaceId) {
          // Make sure the active id still points at a real workspace.
          if (!s.workspaces.find(w => w.id === s.activeWorkspaceId)) {
            s.activeWorkspaceId = s.workspaces[0].id;
          }
          // Bump the fake tab sequence past any persisted tab ids.
          for (const ws of s.workspaces) {
            for (const id of ws.tabIds || []) {
              if (typeof id === "number" && id >= fakeTabSeq) fakeTabSeq = id + 1;
            }
          }
          ensurePinned(s);
          return s;
        }
      }
    } catch (e) { /* fall through to defaults */ }
    const s = defaultState();
    persist(s);
    return s;
  }

  let state = load();

  function persist(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s || state)); }
    catch (e) { /* storage full / disabled — non-fatal in preview */ }
  }

  // Persist then notify the UI to re-render (mirrors the background script's
  // broadcast("state-changed") behavior).
  function emit() {
    persist();
    if (typeof onChange === "function") {
      try { onChange(); } catch (e) {}
    }
  }

  function getActive() {
    return state.workspaces.find(w => w.id === state.activeWorkspaceId) || state.workspaces[0];
  }

  // A defensive deep copy so callers can't mutate our canonical state
  // directly (the real backend returns a structured-clone copy too).
  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  // ---------- message handlers ----------
  // Each case mirrors the corresponding case in background.js's
  // onMessage listener and returns the same response shape.

  async function handle(type, payload) {
    payload = payload || {};
    switch (type) {
      case "get-state":
        return { state: snapshot(), workspaceTabs: [] };

      case "create-workspace": {
        const ws = {
          id: wsId(),
          name: payload.name || "New Workspace",
          icon: (typeof payload.icon === "string" && payload.icon) ? payload.icon : "icon:layers",
          color: pickColor(state.workspaces.length),
          pinned: false,
          stacks: [],
          tabIds: [++fakeTabSeq], // mirror the real backend: a new ws gets one tab
        };
        state.workspaces.push(ws);
        emit();
        return { ok: true, workspaceId: ws.id };
      }

      case "switch-workspace": {
        if (!state.workspaces.find(w => w.id === payload.workspaceId)) return { ok: false };
        state.activeWorkspaceId = payload.workspaceId;
        emit();
        return { ok: true };
      }

      case "rename-workspace": {
        const ws = state.workspaces.find(w => w.id === payload.workspaceId);
        if (!ws) return { ok: false };
        if (ws.pinned) return { ok: false, reason: "pinned" };
        if (typeof payload.name === "string") ws.name = payload.name;
        if (typeof payload.icon === "string") ws.icon = payload.icon;
        emit();
        return { ok: true };
      }

      case "delete-workspace": {
        const ws = state.workspaces.find(w => w.id === payload.workspaceId);
        if (!ws) return { ok: false };
        if (ws.pinned) return { ok: false, reason: "pinned" };
        state.workspaces = state.workspaces.filter(w => w.id !== payload.workspaceId);
        if (state.activeWorkspaceId === payload.workspaceId) {
          state.activeWorkspaceId = state.workspaces[0].id;
        }
        emit();
        return { ok: true };
      }

      case "reorder-workspaces": {
        const order = payload.order;
        if (!Array.isArray(order)) return { ok: false };
        const ordered = order.map(id => state.workspaces.find(w => w.id === id)).filter(Boolean);
        const remaining = state.workspaces.filter(w => !order.includes(w.id));
        const next = [...ordered, ...remaining];
        // Pinned workspaces always stay at the top.
        state.workspaces = [...next.filter(w => w.pinned), ...next.filter(w => !w.pinned)];
        emit();
        return { ok: true };
      }

      case "move-tab-to-workspace": {
        // No real tabs in local mode, but keep the contract.
        const target = state.workspaces.find(w => w.id === payload.workspaceId);
        if (!target) return { ok: false };
        emit();
        return { ok: true };
      }

      case "new-tab-in-workspace": {
        const ws = state.workspaces.find(w => w.id === payload.workspaceId) || getActive();
        const tabId = ++fakeTabSeq;
        ws.tabIds.push(tabId);
        emit();
        return { ok: true, tabId };
      }

      case "hibernate-workspace":
        return { ok: true };

      default:
        return null;
    }
  }

  // ---------- public surface ----------

  window.LocalBackend = {
    handle,
    set onChange(fn) { onChange = fn; },
    get onChange() { return onChange; },
    // Exposed for tests / a future "reset" affordance.
    _reset() { state = defaultState(); persist(); if (onChange) onChange(); },
    _key: STORAGE_KEY,
  };
})();
