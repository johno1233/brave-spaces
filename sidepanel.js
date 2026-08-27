// Slice 10: Polish (empty states, error toasts, ignore internal URLs, duplicate park prevention)
// + all previous functionality
console.log('Brave Spaces sidepanel loaded (Slice 10)');

let currentMenu = null;
let currentPanelForError = null;
let toastTimeout = null;

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2800);
}

function createToastContainer() {
  const c = document.createElement('div');
  c.id = 'toast-container';
  c.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:6px;';
  document.body.appendChild(c);
  return c;
}

function hideCurrentMenu() {
  if (currentMenu) {
    currentMenu.remove();
    currentMenu = null;
  }
}

function showWorkspaceMenu(event, workspaceId, workspace) {
  hideCurrentMenu();

  const menu = document.createElement('div');
  menu.className = 'ws-menu-popup';
  menu.innerHTML = `
    <div class="ws-menu-item" data-action="rename">Rename</div>
    <div class="ws-menu-item" data-action="delete">Delete</div>
  `;

  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.zIndex = '1000';

  document.body.appendChild(menu);
  currentMenu = menu;

  menu.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    hideCurrentMenu();

    if (action === 'rename') {
      const currentLabel = `${workspace.emoji} ${workspace.name}`;
      const newLabel = prompt('Rename workspace (emoji + name):', currentLabel);
      if (!newLabel) return;

      let newEmoji = workspace.emoji;
      let newName = newLabel.trim();
      if (newLabel.length > 1) {
        const first = newLabel.trim().charAt(0);
        if (/\p{Emoji}/u.test(first)) {
          newEmoji = first;
          newName = newLabel.trim().slice(1).trim() || newName;
        }
      }
      await BraveSpacesWorkspaces.renameWorkspace(workspaceId, newName, newEmoji);
      await renderWorkspaces();
    }

    if (action === 'delete') {
      await BraveSpacesWorkspaces.deleteWorkspace(workspaceId);
      await renderWorkspaces();
    }
  });

  setTimeout(() => {
    document.addEventListener('click', function onDocClick(ev) {
      if (!menu.contains(ev.target)) {
        hideCurrentMenu();
        document.removeEventListener('click', onDocClick);
      }
    }, { once: true });
  }, 0);
}

async function renderWorkspaces() {
  const container = document.getElementById('workspaces');
  if (!container) return;

  container.innerHTML = '';

  try {
    const state = await BraveSpacesStore.getState();
    const workspaces = state.workspaces || [];
    const activeId = state.activeWorkspaceId;

    if (workspaces.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 6px;color:#777;font-size:11px;';
      empty.textContent = 'No workspaces yet.';
      container.appendChild(empty);
      return;
    }

    workspaces.forEach(ws => {
      const item = document.createElement('div');
      item.className = 'workspace-item';
      if (ws.id === activeId) item.classList.add('active');
      item.dataset.id = ws.id;

      const tabCount = (ws.tabs && ws.tabs.length) || (ws.tabIds && ws.tabIds.length) || 0;

      item.innerHTML = `
        <span class="emoji">${ws.emoji || '📁'}</span>
        <span class="name">${ws.name || 'Untitled'}</span>
        <span class="count">(${tabCount})</span>
        <span class="ws-menu-btn" title="More">⋯</span>
      `;

      item.addEventListener('click', async (e) => {
        if (e.target.classList.contains('ws-menu-btn')) return;
        try {
          await BraveSpacesWorkspaces.switchToWorkspace(ws.id);
          await renderWorkspaces();
        } catch (err) {
          console.error('Workspace switch failed', err);
          showToast('Failed to switch workspace', 'error');
        }
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const menuBtn = item.querySelector('.ws-menu-btn');
        showWorkspaceMenu({ currentTarget: menuBtn || item }, ws.id, ws);
      });

      const menuBtn = item.querySelector('.ws-menu-btn');
      if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showWorkspaceMenu({ currentTarget: menuBtn }, ws.id, ws);
        });
      }

      container.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load workspaces', err);
  }
}

function renderPanelRail(panels, activeId) {
  const container = document.getElementById('panel-rail');
  if (!container) return;
  container.innerHTML = '';

  if (!panels || panels.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:4px 6px;color:#777;font-size:11px;';
    empty.textContent = 'No panels yet';
    container.appendChild(empty);
    return;
  }

  panels.forEach(panel => {
    const icon = document.createElement('div');
    icon.className = 'rail-icon';
    if (panel.id === activeId) icon.classList.add('active');
    icon.dataset.id = panel.id;
    icon.title = panel.title;

    if (panel.favIconUrl) {
      const img = document.createElement('img');
      img.src = panel.favIconUrl;
      img.onerror = () => {
        icon.textContent = panel.title ? panel.title[0].toUpperCase() : 'P';
      };
      icon.appendChild(img);
    } else {
      icon.textContent = panel.title ? panel.title[0].toUpperCase() : 'P';
    }

    icon.addEventListener('click', async () => {
      await BraveSpacesPanels.setActivePanel(panel.id);
      await loadActivePanel();
      renderPanelRail(panels, panel.id);
    });

    icon.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (confirm(`Remove panel "${panel.title}"?`)) {
        await BraveSpacesPanels.removePanel(panel.id);
        await renderAll();
      }
    });

    container.appendChild(icon);
  });
}

function showPanelError(panel) {
  const iframe = document.getElementById('guest');
  const errorDiv = document.getElementById('panel-error');
  const errorBtn = document.getElementById('error-popout-btn');

  if (!errorDiv || !iframe) return;

  currentPanelForError = panel;

  iframe.style.display = 'none';
  errorDiv.style.display = 'flex';

  if (errorBtn) {
    errorBtn.onclick = () => {
      if (currentPanelForError && currentPanelForError.url) {
        chrome.windows.create({
          url: currentPanelForError.url,
          type: 'popup',
          width: 420,
          height: 800
        });
      }
    };
  }
}

function hidePanelError() {
  const iframe = document.getElementById('guest');
  const errorDiv = document.getElementById('panel-error');
  if (errorDiv) errorDiv.style.display = 'none';
  if (iframe) iframe.style.display = 'block';
}

async function loadActivePanel() {
  const iframe = document.getElementById('guest');
  const titleEl = document.getElementById('panel-title');
  const uaBtn = document.getElementById('ua-toggle');

  hidePanelError();

  const panel = await BraveSpacesPanels.getActivePanel();

  if (!panel || !panel.url) {
    iframe.src = 'about:blank';
    titleEl.textContent = '';
    uaBtn.textContent = '💻';
    return;
  }

  titleEl.textContent = panel.title || new URL(panel.url).hostname;

  uaBtn.textContent = panel.mobileUa ? '📱' : '💻';
  uaBtn.onclick = async () => {
    const updated = await BraveSpacesPanels.toggleMobileUa(panel.id);
    iframe.src = updated.url || panel.url;
    await loadActivePanel();
  };

  iframe.src = panel.url;

  iframe.onerror = () => {
    showPanelError(panel);
  };

  iframe.onload = () => {
    try {
      // Basic empty check (cross-origin will throw, which is normal)
    } catch (e) {}
  };

  document.getElementById('popout-btn').onclick = () => {
    chrome.windows.create({
      url: panel.url,
      type: 'popup',
      width: 420,
      height: 800
    });
  };

  document.getElementById('back-btn').onclick = () => {
    try {
      iframe.contentWindow.history.back();
    } catch (e) {
      showToast('Back not available for this page', 'info');
    }
  };
}

async function renderAll() {
  await renderWorkspaces();

  const state = await BraveSpacesStore.getState();
  const panels = await BraveSpacesPanels.getPanels();
  const activeId = state.activePanelId;

  renderPanelRail(panels, activeId);
  await loadActivePanel();
}

async function initButtons() {
  document.getElementById('add-workspace').addEventListener('click', async () => {
    const name = prompt('New workspace name:', 'Work') || 'New Workspace';
    const emoji = prompt('Emoji:', '💼') || '📁';
    await BraveSpacesWorkspaces.createWorkspace(name, emoji);
    await renderWorkspaces();
  });

  const addCurrent = async () => {
    const newP = await BraveSpacesPanels.addCurrentPage();
    if (newP) {
      showToast('Panel added', 'info');
      await renderAll();
    } else {
      showToast('Cannot add internal pages (chrome://, brave://, etc.)', 'error');
    }
  };

  document.getElementById('add-panel').addEventListener('click', addCurrent);
  document.getElementById('add-current-btn').addEventListener('click', addCurrent);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.braveSpaces) {
      renderAll();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await renderAll();
  await initButtons();

  const state = await BraveSpacesStore.getState();
  if (state.activePanelId) {
    await loadActivePanel();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCurrentMenu();
  });
});
