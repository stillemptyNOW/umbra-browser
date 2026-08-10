'use strict';
/* Shared bootstrap for Umbra's internal pages: pull the live theme out of the
   browser and paint it onto the document before anything else renders.

   Internal pages run under `script-src 'self'`, so every page's logic lives in
   its own file — no inline <script> blocks anywhere. */

window.umbraPage = (async () => {
  const fallback = { theme: null, settings: {}, stats: {}, version: {} };
  const bridge = window.umbraInternal;

  try {
    if (!bridge) return fallback;
    const state = await bridge.getState();
    const root = document.documentElement;
    if (state.theme) {
      for (const [key, value] of Object.entries(state.theme.colors)) {
        root.style.setProperty(`--${key}`, value);
      }
      root.style.colorScheme = state.theme.dark ? 'dark' : 'light';
    }
    return state;
  } catch (err) {
    console.error('[umbra] internal page bootstrap failed:', err);
    return fallback;
  } finally {
    // Pages start hidden to avoid a flash of the wrong theme. Whatever happens
    // above, they must not stay that way.
    document.body.style.visibility = 'visible';
  }
})();
