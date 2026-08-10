'use strict';

(async () => {
  const state = await window.umbraPage;
  const list = document.getElementById('versions');

  const rows = [
    ['Umbra', state.version.umbra],
    ['Chromium', state.version.chromium],
    ['Electron', state.version.electron],
    ['Trackers blocked', (state.stats?.total ?? 0).toLocaleString()],
  ];

  for (const [key, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = key;
    const definition = document.createElement('dd');
    definition.textContent = value ?? '—';
    list.append(term, definition);
  }

  document.getElementById('source').onclick = () =>
    window.umbraInternal?.openExternal('https://github.com/stillemptyNOW/umbra-browser');
})();
