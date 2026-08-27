// Slice 9: DNR rules + mobile UA + pop-out fallback + previous features

importScripts('./lib/store.js');
importScripts('./lib/workspaces.js');
importScripts('./lib/panels.js');

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function updateDNRRules() {
  try {
    const state = await BraveSpacesStore.getState();
    const activePanel = (state.panels || []).find(p => p.id === state.activePanelId);
    const extId = chrome.runtime.id;

    const removeRuleIds = [1, 2];
    const addRules = [];

    // Rule 1: Strip X-Frame-Options / CSP for our sub_frames (always)
    addRules.push({
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "X-Frame-Options", operation: "remove" },
          { header: "Frame-Options", operation: "remove" },
          { header: "Content-Security-Policy", operation: "remove" }
        ]
      },
      condition: {
        resourceTypes: ["sub_frame"],
        initiatorDomains: [extId]
      }
    });

    // Rule 2: Mobile UA only if the active panel requests it
    if (activePanel && activePanel.mobileUa) {
      addRules.push({
        id: 2,
        priority: 2,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "User-Agent", operation: "set", value: MOBILE_UA }
          ]
        },
        condition: {
          resourceTypes: ["sub_frame"],
          initiatorDomains: [extId]
        }
      });
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });

    console.log('[DNR] Rules updated. Mobile UA:', !!(activePanel && activePanel.mobileUa));
  } catch (e) {
    console.error('updateDNRRules failed', e);
  }
}

async function rebuildContextMenus() {
  try {
    await chrome.contextMenus.removeAll();

    // Workspace move
    chrome.contextMenus.create({
      id: 'move-tab-to-workspace',
      title: 'Move tab to workspace →',
      contexts: ['tab']
    });

    const state = await BraveSpacesStore.getState();
    const workspaces = state.workspaces || [];

    for (const ws of workspaces) {
      chrome.contextMenus.create({
        id: `move-to-${ws.id}`,
        parentId: 'move-tab-to-workspace',
        title: `${ws.emoji || '📁'} ${ws.name}`,
        contexts: ['tab']
      });
    }

    // Add to panel
    chrome.contextMenus.create({
      id: 'add-to-panel',
      title: 'Add to Brave Spaces panel',
      contexts: ['page', 'link']
    });
  } catch (e) {
    console.error('Failed to rebuild context menus', e);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Brave Spaces installed/updated', details);

  await BraveSpacesStore.ensureSeeded();

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.error('Failed to set panel behavior', e);
  }

  try {
    await BraveSpacesWorkspaces.rebuildParkedTabsIfNeeded();
  } catch (e) {
    console.warn('rebuild on install failed', e);
  }

  await rebuildContextMenus();
  await updateDNRRules();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Brave Spaces startup');

  await BraveSpacesStore.ensureSeeded();

  try {
    await BraveSpacesWorkspaces.getOrCreateParkWindow();
    await BraveSpacesWorkspaces.rebuildParkedTabsIfNeeded();
  } catch (e) {
    console.warn('Startup park/rebuild failed', e);
  }

  await rebuildContextMenus();
  await updateDNRRules();
});

// Update menus and DNR on any state change (active panel or mobileUa)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.braveSpaces) {
    rebuildContextMenus();
    updateDNRRules();
  }
});

// Keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const state = await BraveSpacesStore.getState();
    const workspaces = state.workspaces || [];
    if (workspaces.length === 0) return;

    const currentIndex = workspaces.findIndex(w => w.id === state.activeWorkspaceId);

    if (command === 'next-workspace') {
      const nextIndex = (currentIndex + 1) % workspaces.length;
      await BraveSpacesWorkspaces.switchToWorkspace(workspaces[nextIndex].id);
    } else if (command === 'prev-workspace') {
      const prevIndex = (currentIndex - 1 + workspaces.length) % workspaces.length;
      await BraveSpacesWorkspaces.switchToWorkspace(workspaces[prevIndex].id);
    } else if (command === 'toggle-panel') {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
    }
  } catch (e) {
    console.error('Command handling error', e);
  }
});

// Context menus
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId && info.menuItemId.startsWith('move-to-')) {
      const targetId = info.menuItemId.replace('move-to-', '');
      if (tab && tab.id) {
        await BraveSpacesWorkspaces.moveTabToWorkspace(tab.id, targetId);
      }
    }

    if (info.menuItemId === 'add-to-panel') {
      const url = info.linkUrl || info.pageUrl;
      if (url) {
        const title = (tab && tab.title) || new URL(url).hostname;
        const favIconUrl = (tab && tab.favIconUrl) || '';
        await BraveSpacesPanels.addPanel({ title, url, favIconUrl });
      }
    }
  } catch (e) {
    console.error('Context menu action failed', e);
  }
});
