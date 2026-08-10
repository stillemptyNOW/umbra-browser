'use strict';
/**
 * The menu bar is hidden by default, but it is what registers Umbra's keyboard
 * shortcuts — accelerators fire whether the chrome UI or a page has focus.
 */
const { Menu, app, shell } = require('electron');

function buildMenu(windows) {
  const focused = () => windows.focusedWindow();
  const tab = () => focused()?.tabs.active || null;
  const toChrome = (channel, payload) => focused()?.send(channel, payload);

  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [{
          label: 'Umbra',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'Cmd+,', click: () => focused()?.tabs.create({ url: 'umbra://settings' }) },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => focused()?.tabs.create({}) },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => windows.createWindow({}) },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => windows.createWindow({ isPrivate: true }) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => { const c = focused(); if (c?.tabs.activeId != null) c.tabs.close(c.tabs.activeId); } },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => focused()?.win.close() },
        ...(isMac ? [] : [
          { type: 'separator' },
          { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => focused()?.tabs.create({ url: 'umbra://settings' }) },
          { type: 'separator' },
          { role: 'quit' },
        ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: () => { focused()?.setFindOpen(true); toChrome('focus-find'); } },
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: () => toChrome('focus-omnibox') },
        { label: 'Focus Address Bar', accelerator: 'Alt+D', visible: false, click: () => toChrome('focus-omnibox') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => tab()?.reload(false) },
        { label: 'Reload Ignoring Cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => tab()?.reload(true) },
        { label: 'Stop', accelerator: 'Esc', click: () => tab()?.stop() },
        { type: 'separator' },
        { label: 'Back', accelerator: isMac ? 'Cmd+Left' : 'Alt+Left', click: () => tab()?.goBack() },
        { label: 'Forward', accelerator: isMac ? 'Cmd+Right' : 'Alt+Right', click: () => tab()?.goForward() },
        { label: 'Home', accelerator: 'Alt+Home', click: () => tab()?.navigate('umbra://newtab') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(tab(), 0.5) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => zoom(tab(), 0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(tab(), -0.5) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(tab(), 0, true) },
        { type: 'separator' },
        { label: 'Full Screen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: () => { const c = focused(); if (c) c.setFullScreen(!c.fullScreen); } },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'CmdOrCtrl+Shift+I', click: () => tab()?.wc.toggleDevTools() },
        { label: 'Developer Tools', accelerator: 'F12', visible: false, click: () => tab()?.wc.toggleDevTools() },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => focused()?.tabs.cycle(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => focused()?.tabs.cycle(-1) },
        { type: 'separator' },
        ...Array.from({ length: 8 }, (_, i) => ({
          label: `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          click: () => { const c = focused(); const t = c?.tabs.tabs[i]; if (t) c.tabs.activate(t.id); },
        })),
        {
          label: 'Last Tab',
          accelerator: 'CmdOrCtrl+9',
          visible: false,
          click: () => { const c = focused(); const t = c?.tabs.tabs.at(-1); if (t) c.tabs.activate(t.id); },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Umbra', click: () => focused()?.tabs.create({ url: 'umbra://about' }) },
        { label: 'Privacy Report', click: () => focused()?.tabs.create({ url: 'umbra://settings' }) },
        { type: 'separator' },
        { label: 'Source Code', click: () => shell.openExternal('https://github.com/stillemptyNOW/umbra-browser') },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

function zoom(tab, delta, reset = false) {
  if (!tab || tab.wc.isDestroyed()) return;
  tab.wc.setZoomLevel(reset ? 0 : Math.max(-5, Math.min(5, tab.wc.getZoomLevel() + delta)));
}

module.exports = { buildMenu };
