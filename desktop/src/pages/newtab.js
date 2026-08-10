'use strict';

(async () => {
  const state = await window.umbraPage;
  const bridge = window.umbraInternal;

  document.getElementById('search').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = document.getElementById('q').value.trim();
    if (query && bridge) bridge.search(query);
  });

  const line = document.getElementById('shieldLine');
  line.replaceChildren();
  if (state.stats && state.stats.ready === false) {
    line.textContent = 'Filter lists could not be downloaded — blocking is off.';
  } else {
    const count = document.createElement('b');
    count.textContent = (state.stats?.total ?? 0).toLocaleString();
    line.append(count, ' trackers and ads blocked since Umbra started');
  }

  if (!bridge) return;

  const nav = document.getElementById('links');
  const sites = await bridge.sites();
  for (const site of sites.slice(0, 8)) {
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = site.host;
    link.onclick = (event) => {
      event.preventDefault();
      bridge.navigate('https://' + site.host);
    };
    nav.appendChild(link);
  }
})();
