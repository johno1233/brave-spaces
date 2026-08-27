// lib/store.js
// Central chrome.storage.local persistence for Brave Spaces
// All durable state lives here. Service worker can be killed at any time.

const BraveSpacesStore = {
  DEFAULT_STATE: {
    version: 1,
    activeWorkspaceId: "ws_default",
    parkWindowId: null,
    workspaces: [
      {
        id: "ws_default",
        name: "Home",
        emoji: "🏠",
        tabIds: [],
        tabs: [],           // snapshot metadata: {url, title, pinned, index, groupTitle, groupColor}
        groups: []          // {title, color, tabUrls: []}
      }
    ],
    panels: [],
    activePanelId: null
  },

  async getState() {
    const result = await chrome.storage.local.get("braveSpaces");
    let state = result.braveSpaces;

    if (!state || state.version !== 1) {
      console.log("[BraveSpacesStore] No valid state found, seeding defaults");
      state = { ...this.DEFAULT_STATE };
      await this.setState(state);
    }

    return state;
  },

  async setState(newState) {
    // Simple full replace for now; future slices can do targeted updates
    await chrome.storage.local.set({ braveSpaces: newState });
  },

  async updateState(partial) {
    const current = await this.getState();
    // Shallow merge is sufficient at top level for Slice 2+
    // Deep merge for workspaces/panels will be added when we mutate them
    const merged = { ...current, ...partial };
    await this.setState(merged);
    return merged;
  },

  async ensureSeeded() {
    const result = await chrome.storage.local.get("braveSpaces");
    if (!result.braveSpaces || result.braveSpaces.version !== 1) {
      await this.setState({ ...this.DEFAULT_STATE });
      console.log("[BraveSpacesStore] Default state seeded");
    }
  }
};

// Expose for both service worker (importScripts) and side panel contexts
if (typeof self !== "undefined") {
  self.BraveSpacesStore = BraveSpacesStore;
}
if (typeof window !== "undefined") {
  window.BraveSpacesStore = BraveSpacesStore;
}
