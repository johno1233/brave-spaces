// lib/panels.js
// Panel logic (Slice 8 + 10 polish)
// CRUD, add current page, active panel management.
// Persists via BraveSpacesStore. Ignores internal URLs in Slice 10.

function shouldIgnoreUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://') ||
         url.startsWith('brave://') ||
         url.startsWith('about:') ||
         url === 'about:blank' ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('edge://');
}

async function addPanel(panelData) {
  const state = await BraveSpacesStore.getState();

  if (!state.panels) state.panels = [];

  if (shouldIgnoreUrl(panelData.url)) {
    console.warn('Ignoring internal or invalid URL for panel:', panelData.url);
    return null;
  }

  const newPanel = {
    id: panelData.id || 'p_' + Date.now().toString(36),
    title: panelData.title || 'Untitled',
    url: panelData.url,
    mobileUa: !!panelData.mobileUa,
    width: panelData.width || 380,
    favIconUrl: panelData.favIconUrl || ''
  };

  // Avoid exact duplicate URLs
  state.panels = state.panels.filter(p => p.url !== newPanel.url);
  state.panels.push(newPanel);
  state.activePanelId = newPanel.id;

  await BraveSpacesStore.setState(state);
  return newPanel;
}

async function removePanel(id) {
  const state = await BraveSpacesStore.getState();
  if (!state.panels) return;

  state.panels = state.panels.filter(p => p.id !== id);

  if (state.activePanelId === id) {
    state.activePanelId = state.panels.length > 0 ? state.panels[0].id : null;
  }

  await BraveSpacesStore.setState(state);
}

async function setActivePanel(id) {
  const state = await BraveSpacesStore.getState();
  const panel = (state.panels || []).find(p => p.id === id);
  if (panel) {
    state.activePanelId = id;
    await BraveSpacesStore.setState(state);
  }
}

async function getActivePanel() {
  const state = await BraveSpacesStore.getState();
  if (!state.activePanelId || !state.panels) return null;
  return state.panels.find(p => p.id === state.activePanelId) || null;
}

async function getPanels() {
  const state = await BraveSpacesStore.getState();
  return state.panels || [];
}

async function addCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;

    if (shouldIgnoreUrl(tab.url)) {
      console.warn('Ignoring internal page for panel');
      // We can show a toast from sidepanel, but here just return null
      return null;
    }

    const hostname = new URL(tab.url).hostname;
    const panelData = {
      title: tab.title || hostname,
      url: tab.url,
      mobileUa: false,
      width: 380,
      favIconUrl: tab.favIconUrl || ''
    };

    return await addPanel(panelData);
  } catch (e) {
    console.error('addCurrentPage failed', e);
    return null;
  }
}

async function toggleMobileUa(panelId) {
  const state = await BraveSpacesStore.getState();
  const panel = (state.panels || []).find(p => p.id === panelId);
  if (!panel) return null;

  panel.mobileUa = !panel.mobileUa;
  await BraveSpacesStore.setState(state);
  return panel;
}

// Expose
const PanelsAPI = {
  addPanel,
  removePanel,
  setActivePanel,
  getActivePanel,
  getPanels,
  addCurrentPage,
  toggleMobileUa,
  shouldIgnoreUrl
};

if (typeof window !== 'undefined') {
  window.BraveSpacesPanels = PanelsAPI;
}
if (typeof self !== 'undefined') {
  self.BraveSpacesPanels = PanelsAPI;
}
