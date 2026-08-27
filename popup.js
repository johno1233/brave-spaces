// Slice 1: Tiny popup fallback
document.getElementById('open-sidepanel').addEventListener('click', async () => {
  try {
    await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
    window.close();
  } catch (e) {
    console.error('Failed to open side panel', e);
    alert('Could not open side panel. Use the extension icon in the toolbar.');
  }
});
