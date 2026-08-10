'use strict';
/**
 * Keyboard shortcuts, handled from before-input-event on every web contents.
 *
 * The application menu was supposed to do this. It does not: Umbra's windows
 * are BaseWindows, and neither Menu.setApplicationMenu nor win.setMenu makes
 * their accelerators fire on Windows — Ctrl+T, Ctrl+W and the rest were dead
 * in the shipped build. before-input-event is also simply the more correct
 * place: it fires wherever focus happens to be, including inside a page.
 *
 * The menu is still built, for macOS (where it does work) and so the shortcuts
 * are discoverable.
 */

/** Which modifiers a binding needs, exactly. Extra modifiers do not match. */
function matches(input, spec) {
  return (
    input.key.toLowerCase() === spec.key &&
    !!spec.ctrl === (input.control || input.meta) &&
    !!spec.shift === input.shift &&
    !!spec.alt === input.alt
  );
}

/**
 * Bindings are checked in order; the first match wins and the key event is
 * swallowed so the page never sees it.
 */
function bindings(controller) {
  const tabs = controller.tabs;
  const active = () => tabs.active;
  const zoom = (delta, reset = false) => {
    const tab = active();
    if (!tab || tab.wc.isDestroyed()) return;
    tab.wc.setZoomLevel(reset ? 0 : Math.max(-5, Math.min(5, tab.wc.getZoomLevel() + delta)));
  };

  const list = [
    { key: 't', ctrl: true, run: () => tabs.create({}) },
    { key: 't', ctrl: true, shift: true, run: () => tabs.create({}) },
    { key: 'n', ctrl: true, run: () => controller.newWindow(false) },
    { key: 'n', ctrl: true, shift: true, run: () => controller.newWindow(true) },
    { key: 'w', ctrl: true, run: () => { if (tabs.activeId != null) tabs.close(tabs.activeId); } },
    { key: 'w', ctrl: true, shift: true, run: () => controller.win.close() },
    { key: 'r', ctrl: true, run: () => active()?.reload(false) },
    { key: 'r', ctrl: true, shift: true, run: () => active()?.reload(true) },
    { key: 'f5', run: () => active()?.reload(false) },
    { key: 'l', ctrl: true, run: () => controller.send('focus-omnibox') },
    { key: 'd', alt: true, run: () => controller.send('focus-omnibox') },
    { key: 'f', ctrl: true, run: () => { controller.setFindOpen(true); controller.send('focus-find'); } },
    { key: ',', ctrl: true, run: () => tabs.create({ url: 'umbra://settings' }) },
    { key: 'f12', run: () => active()?.wc.toggleDevTools() },
    { key: 'i', ctrl: true, shift: true, run: () => active()?.wc.toggleDevTools() },
    { key: 'tab', ctrl: true, run: () => tabs.cycle(1) },
    { key: 'tab', ctrl: true, shift: true, run: () => tabs.cycle(-1) },
    { key: 'arrowleft', alt: true, run: () => active()?.goBack() },
    { key: 'arrowright', alt: true, run: () => active()?.goForward() },
    { key: '=', ctrl: true, run: () => zoom(0.5) },
    { key: '+', ctrl: true, shift: true, run: () => zoom(0.5) },
    { key: '-', ctrl: true, run: () => zoom(-0.5) },
    { key: '0', ctrl: true, run: () => zoom(0, true) },
    { key: 'f11', run: () => controller.setFullScreen(!controller.fullScreen) },
  ];

  // Ctrl+1..8 select a tab, Ctrl+9 the last one — as everywhere else.
  for (let i = 1; i <= 8; i++) {
    list.push({
      key: String(i),
      ctrl: true,
      run: () => {
        const tab = tabs.tabs[i - 1];
        if (tab) tabs.activate(tab.id);
      },
    });
  }
  list.push({
    key: '9',
    ctrl: true,
    run: () => {
      const tab = tabs.tabs.at(-1);
      if (tab) tabs.activate(tab.id);
    },
  });

  return list;
}

/**
 * Attach to a web contents. Safe to call for the chrome UI and for every tab;
 * the bindings are rebuilt per window, not per contents.
 */
function attach(webContents, controller) {
  // macOS has a real application menu that already delivers these, and
  // handling them twice would open two tabs per keystroke.
  if (process.platform === 'darwin') return;

  const table = bindings(controller);

  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    for (const binding of table) {
      if (matches(input, binding)) {
        event.preventDefault();
        binding.run();
        return;
      }
    }
  });
}

module.exports = { attach };
