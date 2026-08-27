// lib/workspaces.js
// Workspace CRUD + Parking window switcher + Tab groups recreation (Slice 6 + 10)
// Groups are captured on snapshot and recreated after tabs are moved into a workspace.
// Groups are lost on chrome.tabs.move, so we always rebuild them from metadata.
// Slice 10: Added extra safeguards against duplicate park windows.

async function captureCurrentSnapshot(ws) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const tabsMeta = [];
    const groupMap = new Map(); // groupId -> {title, color, tabUrls}

    for (const tab of tabs) {
      let groupTitle = null;
      let groupColor = null;

      if (tab.groupId && tab.groupId !== -1 && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        try {
          const grp = await chrome.tabGroups.get(tab.groupId);
          groupTitle = grp.title || null;
          groupColor = grp.color || null;

          if (!groupMap.has(tab.groupId)) {
            groupMap.set(tab.groupId, {
              title: grp.title || '',
              color: grp.color || 'grey',
              tabUrls: []
            });
          }
          groupMap.get(tab.groupId).tabUrls.push(tab.url);
        } catch (e) {}
      }

      tabsMeta.push({
        url: tab.url || '',
        title: tab.title || tab.url || '',
        pinned: !!tab.pinned,
        index: tab.index,
        groupTitle,
        groupColor
      });
    }

    if (ws) {
      ws.tabs = tabsMeta;
      ws.groups = Array.from(groupMap.values());
    }

    return { tabsMeta, groups: Array.from(groupMap.values()) };
  } catch (e) {
    console.error('captureCurrentSnapshot failed', e);
    if (ws) {
      ws.tabs = [];
      ws.groups = [];
    }
    return { tabsMeta: [], groups: [] };
  }
}

async function createWorkspace(name = 'New Workspace', emoji = '📁') {
  const state = await BraveSpacesStore.getState();

  const currentId = state.activeWorkspaceId;
  const currentWs = state.workspaces.find(w => w.id === currentId);
  if (currentWs) {
    await captureCurrentSnapshot(currentWs);
    currentWs.tabIds = [];
  }

  const newId = 'ws_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newWs = {
    id: newId,
    name: name.trim() || 'New Workspace',
    emoji: emoji.trim() || '📁',
    tabIds: [],
    tabs: [],
    groups: []
  };

  state.workspaces.push(newWs);
  state.activeWorkspaceId = newId;

  try {
    const liveTabs = await chrome.tabs.query({ currentWindow: true });
    newWs.tabIds = liveTabs.map(t => t.id).filter(Boolean);
  } catch {}

  await BraveSpacesStore.setState(state);
  console.log('[workspaces] Created new workspace', newWs);
  return newWs;
}

async function renameWorkspace(id, newName, newEmoji) {
  const state = await BraveSpacesStore.getState();
  const ws = state.workspaces.find(w => w.id === id);
  if (!ws) return false;

  if (newName !== undefined && newName !== null) {
    ws.name = String(newName).trim() || ws.name;
  }
  if (newEmoji !== undefined && newEmoji !== null) {
    ws.emoji = String(newEmoji).trim() || ws.emoji;
  }

  await BraveSpacesStore.setState(state);
  return true;
}

async function deleteWorkspace(id) {
  const state = await BraveSpacesStore.getState();

  if (state.workspaces.length <= 1) {
    alert('Cannot delete the last workspace.');
    return false;
  }

  const wsIndex = state.workspaces.findIndex(w => w.id === id);
  if (wsIndex === -1) return false;

  const ws = state.workspaces[wsIndex];
  const tabCount = (ws.tabs && ws.tabs.length) || (ws.tabIds && ws.tabIds.length) || 0;

  if (tabCount > 0) {
    const ok = confirm(`Delete "${ws.name}" (${tabCount} tabs)? This cannot be undone.`);
    if (!ok) return false;
  }

  state.workspaces.splice(wsIndex, 1);

  if (state.activeWorkspaceId === id) {
    state.activeWorkspaceId = state.workspaces[0]?.id || null;
  }

  await BraveSpacesStore.setState(state);
  console.log('[workspaces] Deleted workspace', id);
  return true;
}

// === Parking window helpers (Slice 4 + 10) ===

async function findParkWindow() {
  const state = await BraveSpacesStore.getState();
  let parkId = state.parkWindowId;

  if (parkId) {
    try {
      await chrome.windows.get(parkId);
      return parkId;
    } catch (e) {}
  }

  try {
    const wins = await chrome.windows.getAll({ populate: true });
    for (const w of wins) {
      if (w.title && w.title.includes('💤 Parked — Brave Spaces')) {
        const s = await BraveSpacesStore.getState();
        s.parkWindowId = w.id;
        await BraveSpacesStore.setState(s);
        return w.id;
      }
    }
  } catch (e) {
    console.warn('findParkWindow search failed', e);
  }

  return null;
}

async function getOrCreateParkWindow() {
  let parkId = await findParkWindow();
  if (parkId) return parkId;

  // Slice 10: Extra safeguard against creating duplicate park windows
  try {
    const allWins = await chrome.windows.getAll({ populate: false });
    for (const w of allWins) {
      if (w.title && w.title.includes('💤 Parked')) {
        // Already exists, update state if needed
        const s = await BraveSpacesStore.getState();
        if (s.parkWindowId !== w.id) {
          s.parkWindowId = w.id;
          await BraveSpacesStore.setState(s);
        }
        return w.id;
      }
    }
  } catch (e) {}

  const win = await chrome.windows.create({
    url: 'chrome://newtab/',
    state: 'minimized',
    focused: false
  });

  parkId = win.id;

  if (win.tabs && win.tabs[0] && win.tabs[0].id) {
    try {
      const titleHtml = '<!DOCTYPE html><html><head><title>💤 Parked — Brave Spaces</title></head>' +
        '<body style="background:#1a1a1a;color:#888;font-family:system-ui;padding:20px;font-size:13px">' +
        '💤 Parked workspace tabs live in this minimized window.<br>Do not close it.</body></html>';
      await chrome.tabs.update(win.tabs[0].id, {
        url: 'data:text/html;charset=utf-8,' + encodeURIComponent(titleHtml)
      });
    } catch (e) {
      console.warn('Could not set park title tab', e);
    }
  }

  const s = await BraveSpacesStore.getState();
  s.parkWindowId = parkId;
  await BraveSpacesStore.setState(s);
  console.log('[workspaces] Created park window', parkId);
  return parkId;
}

async function switchToWorkspace(targetId) {
  const state = await BraveSpacesStore.getState();
  if (!targetId || state.activeWorkspaceId === targetId) return;

  const currentWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  const targetWs = state.workspaces.find(w => w.id === targetId);
  if (!targetWs) return;

  const currentWindow = await chrome.windows.getCurrent();
  const currentWindowId = currentWindow.id;

  console.log('[switch] Switching', state.activeWorkspaceId, '→', targetId);

  if (currentWs) {
    await captureCurrentSnapshot(currentWs);
  }

  const parkWindowId = await getOrCreateParkWindow();
  state.parkWindowId = parkWindowId;

  let currentTabs = await chrome.tabs.query({ windowId: currentWindowId });
  let tabIdsToMove = currentTabs.map(t => t.id).filter(Boolean);

  let placeholderInCurrent = null;
  if (tabIdsToMove.length > 0) {
    const ph = await chrome.tabs.create({
      windowId: currentWindowId,
      url: 'chrome://newtab/',
      active: false
    });
    placeholderInCurrent = ph.id;
  }

  if (tabIdsToMove.length > 0) {
    await chrome.tabs.move(tabIdsToMove, { windowId: parkWindowId, index: -1 });
    if (currentWs) {
      currentWs.tabIds = tabIdsToMove;
    }
  }

  let targetLiveIds = targetWs.tabIds || [];
  let validLive = [];

  for (const tid of targetLiveIds) {
    try {
      const t = await chrome.tabs.get(tid);
      if (t) validLive.push(tid);
    } catch {}
  }

  if (validLive.length === 0 && targetWs.tabs && targetWs.tabs.length > 0) {
    console.log('[switch] Rebuilding target tabs from metadata');
    const rebuilt = [];
    for (const meta of targetWs.tabs) {
      if (!meta.url || meta.url === '' || meta.url.startsWith('chrome://newtab')) continue;
      try {
        const created = await chrome.tabs.create({
          windowId: parkWindowId,
          url: meta.url,
          pinned: !!meta.pinned,
          active: false
        });
        rebuilt.push(created.id);
      } catch (e) {
        console.warn('Failed to rebuild tab:', meta.url, e);
      }
    }
    validLive = rebuilt;
    targetWs.tabIds = validLive;
  }

  if (validLive.length > 0) {
    await chrome.tabs.move(validLive, { windowId: currentWindowId, index: -1 });
  }

  if (placeholderInCurrent) {
    try {
      const nowInCurrent = await chrome.tabs.query({ windowId: currentWindowId });
      if (nowInCurrent.length > 1) {
        await chrome.tabs.remove(placeholderInCurrent);
      }
    } catch {}
  }

  let tabsNowCurrent = await chrome.tabs.query({ windowId: currentWindowId });
  if (tabsNowCurrent.length === 0) {
    await chrome.tabs.create({ windowId: currentWindowId, url: 'chrome://newtab/' });
  }

  let tabsNowPark = await chrome.tabs.query({ windowId: parkWindowId });
  if (tabsNowPark.length === 0) {
    await chrome.tabs.create({ windowId: parkWindowId, url: 'chrome://newtab/', active: false });
  }

  targetWs.tabIds = (await chrome.tabs.query({ windowId: currentWindowId })).map(t => t.id).filter(Boolean);

  // Slice 6: Recreate tab groups
  if (targetWs.groups && targetWs.groups.length > 0) {
    const tabsAfterMove = await chrome.tabs.query({ windowId: currentWindowId });
    for (const g of targetWs.groups) {
      if (!g.title && (!g.tabUrls || g.tabUrls.length === 0)) continue;

      const tabsForThisGroup = tabsAfterMove
        .filter(t => g.tabUrls && g.tabUrls.includes(t.url))
        .map(t => t.id);

      if (tabsForThisGroup.length > 0) {
        try {
          const newGroup = await chrome.tabGroups.create({
            title: g.title || '',
            color: g.color || 'grey'
          });
          await chrome.tabs.group({
            tabIds: tabsForThisGroup,
            groupId: newGroup.id
          });
          console.log('[groups] Recreated group', g.title, 'with', tabsForThisGroup.length, 'tabs');
        } catch (e) {
          console.warn('Failed to recreate group', g.title, e);
        }
      }
    }
  }

  state.activeWorkspaceId = targetId;
  await BraveSpacesStore.setState(state);

  try {
    await chrome.windows.update(currentWindowId, { focused: true });
  } catch {}

  console.log('[switch] Completed switch to', targetId);
}

// === Slice 5/6/10 rebuild ===
async function rebuildParkedTabsIfNeeded() {
  console.log('[workspaces] Running startup rebuild for parked tabs from metadata...');
  const state = await BraveSpacesStore.getState();
  const parkWindowId = await getOrCreateParkWindow();

  let changed = false;

  const activeWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  if (activeWs) {
    try {
      await captureCurrentSnapshot(activeWs);
      const live = await chrome.tabs.query({ currentWindow: true });
      activeWs.tabIds = live.map(t => t.id).filter(Boolean);
      changed = true;
    } catch (e) {}
  }

  const parkTabs = await chrome.tabs.query({ windowId: parkWindowId });

  for (const ws of state.workspaces) {
    if (ws.id === state.activeWorkspaceId) continue;

    let valid = [];
    for (const tid of (ws.tabIds || [])) {
      try {
        const t = await chrome.tabs.get(tid);
        if (t) valid.push(tid);
      } catch {}
    }

    if (valid.length > 0) {
      ws.tabIds = valid;
      continue;
    }

    const metaUrls = new Set((ws.tabs || []).map(m => m.url).filter(u => u && u.length > 0));
    const matchedIds = [];
    const used = new Set();

    for (const tab of parkTabs) {
      if (metaUrls.has(tab.url) && !used.has(tab.id)) {
        matchedIds.push(tab.id);
        used.add(tab.id);
        metaUrls.delete(tab.url);
      }
    }

    if (matchedIds.length > 0) {
      ws.tabIds = matchedIds;
      changed = true;
      console.log(`[rebuild] Re-associated ${matchedIds.length} restored tabs for "${ws.name}"`);
      continue;
    }

    if (ws.tabs && ws.tabs.length > 0) {
      const newIds = [];
      for (const meta of ws.tabs) {
        if (!meta.url || meta.url === '' || meta.url.startsWith('chrome://newtab')) continue;
        try {
          const created = await chrome.tabs.create({
            windowId: parkWindowId,
            url: meta.url,
            pinned: !!meta.pinned,
            active: false
          });
          newIds.push(created.id);
        } catch (e) {
          console.warn('[rebuild] Failed to create tab from metadata:', meta.url, e);
        }
      }
      ws.tabIds = newIds;
      changed = true;
      console.log(`[rebuild] Rebuilt ${newIds.length} tabs from metadata for "${ws.name}"`);
    }
  }

  if (changed) {
    await BraveSpacesStore.setState(state);
  }

  console.log('[workspaces] Startup rebuild complete');
  return state;
}

async function moveTabToWorkspace(tabId, targetWorkspaceId) {
  if (!tabId || !targetWorkspaceId) return;

  const state = await BraveSpacesStore.getState();
  const targetWs = state.workspaces.find(w => w.id === targetWorkspaceId);
  if (!targetWs) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) return;

    const tabMeta = {
      url: tab.url,
      title: tab.title || tab.url,
      pinned: !!tab.pinned,
      index: tab.index,
      groupTitle: null,
      groupColor: null
    };

    for (const ws of state.workspaces) {
      if (ws.tabIds) {
        ws.tabIds = ws.tabIds.filter(id => id !== tabId);
      }
      if (ws.tabs) {
        ws.tabs = ws.tabs.filter(t => t.url !== tab.url);
      }
    }

    if (!targetWs.tabs) targetWs.tabs = [];
    targetWs.tabs = targetWs.tabs.filter(t => t.url !== tab.url);
    targetWs.tabs.push(tabMeta);

    if (!targetWs.tabIds) targetWs.tabIds = [];
    if (!targetWs.tabIds.includes(tabId)) {
      targetWs.tabIds.push(tabId);
    }

    const parkId = await getOrCreateParkWindow();

    if (targetWorkspaceId === state.activeWorkspaceId) {
      const currentWin = await chrome.windows.getCurrent();
      if (tab.windowId !== currentWin.id) {
        await chrome.tabs.move(tabId, { windowId: currentWin.id, index: -1 });
      }
    } else {
      if (tab.windowId !== parkId) {
        await chrome.tabs.move(tabId, { windowId: parkId, index: -1 });
      }
    }

    await BraveSpacesStore.setState(state);
    console.log(`[workspaces] Moved tab ${tabId} to workspace ${targetWorkspaceId}`);
  } catch (e) {
    console.error('moveTabToWorkspace failed', e);
  }
}

// Expose
const WorkspacesAPI = {
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  captureCurrentSnapshot,
  switchToWorkspace,
  getOrCreateParkWindow,
  findParkWindow,
  rebuildParkedTabsIfNeeded,
  moveTabToWorkspace
};

if (typeof window !== 'undefined') {
  window.BraveSpacesWorkspaces = WorkspacesAPI;
}
if (typeof self !== 'undefined') {
  self.BraveSpacesWorkspaces = WorkspacesAPI;
}
