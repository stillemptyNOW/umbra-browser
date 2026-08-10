'use strict';
/* Umbra browser chrome. Runs in its own renderer with no Node access; every
   privileged action goes through the `umbra` bridge. */

const $ = (id) => document.getElementById(id);

const state = {
  tabs: [],
  activeId: null,
  isPrivate: false,
  maximized: false,
  fullScreen: false,
  platform: '',
  stats: { total: 0, tab: 0, ready: false },
  settings: {},
  theme: null,
  themes: [],
  version: {},
};

/** What is currently borrowing the full-window chrome overlay. */
let overlayKind = null;
let suggestions = [];
let suggestIndex = -1;
let omniDirty = false;
let findVisible = false;

const activeTab = () => state.tabs.find((t) => t.id === state.activeId) || null;

// ---------------------------------------------------------------- utilities

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/** Address-bar text: drop the https:// noise, keep everything that matters. */
function pretty(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'umbra:') return '';
    const rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
    return u.protocol === 'https:' ? u.host + rest : `${u.protocol}//${u.host}${rest}`;
  } catch {
    return url;
  }
}

// -------------------------------------------------------------------- theme

function applyTheme(theme) {
  if (!theme) return;
  state.theme = theme;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
}

// --------------------------------------------------------------------- tabs

function renderTabs() {
  const strip = $('tabs');
  strip.replaceChildren();

  for (const tab of state.tabs) {
    const node = el('div', 'tab' + (tab.active ? ' active' : ''));
    node.draggable = true;
    node.dataset.id = String(tab.id);
    node.setAttribute('role', 'tab');
    node.title = tab.title;

    if (tab.loading) {
      node.appendChild(el('div', 'spinner'));
    } else if (tab.favicon) {
      const img = el('img', 'favicon');
      img.src = tab.favicon;
      img.onerror = () => img.replaceWith(icon('globe', 'favicon fallback'));
      node.appendChild(img);
    } else {
      node.appendChild(icon('globe', 'favicon fallback'));
    }

    node.appendChild(el('span', 'label', tab.title));

    if (tab.audible || tab.muted) {
      const sound = el('button', 'close');
      sound.appendChild(icon(tab.muted ? 'mute' : 'sound'));
      sound.title = tab.muted ? 'Unmute tab' : 'Mute tab';
      sound.style.opacity = '0.7';
      sound.onclick = (e) => { e.stopPropagation(); umbra.tabs.mute(tab.id, !tab.muted); };
      node.appendChild(sound);
    }

    const close = el('button', 'close');
    close.appendChild(icon('close'));
    close.title = 'Close tab';
    close.onclick = (e) => { e.stopPropagation(); umbra.tabs.close(tab.id); };
    node.appendChild(close);

    node.onmousedown = (e) => {
      if (e.button === 1) { e.preventDefault(); umbra.tabs.close(tab.id); }
      else if (e.button === 0) umbra.tabs.activate(tab.id);
    };

    wireTabDrag(node, tab);
    strip.appendChild(node);
  }
}

function wireTabDrag(node, tab) {
  node.ondragstart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/umbra-tab', String(tab.id));
    node.classList.add('dragging');
  };
  node.ondragend = () => {
    node.classList.remove('dragging');
    for (const n of document.querySelectorAll('.tab')) {
      n.classList.remove('drop-before', 'drop-after');
    }
  };
  node.ondragover = (e) => {
    if (!e.dataTransfer.types.includes('text/umbra-tab')) return;
    e.preventDefault();
    const before = e.offsetX < node.offsetWidth / 2;
    node.classList.toggle('drop-before', before);
    node.classList.toggle('drop-after', !before);
  };
  node.ondragleave = () => node.classList.remove('drop-before', 'drop-after');
  node.ondrop = (e) => {
    e.preventDefault();
    const dragged = Number(e.dataTransfer.getData('text/umbra-tab'));
    if (!dragged || dragged === tab.id) return;
    const target = state.tabs.findIndex((t) => t.id === tab.id);
    const before = e.offsetX < node.offsetWidth / 2;
    umbra.tabs.move(dragged, before ? target : target + 1);
  };
}

// ----------------------------------------------------------------- toolbar

function renderToolbar() {
  const tab = activeTab();

  $('back').disabled = !tab?.canGoBack;
  $('forward').disabled = !tab?.canGoForward;

  const reload = $('reload');
  reload.title = tab?.loading ? 'Stop' : 'Reload';
  reload.replaceChildren(icon(tab?.loading ? 'close' : 'reload'));

  const omni = $('omni');
  if (!omniDirty && document.activeElement !== omni) {
    omni.value = tab ? pretty(tab.url) : '';
  }

  const lock = $('lock');
  lock.className = 'lock';
  if (!tab || !tab.url) {
    lock.replaceChildren(icon('search'));
  } else if (tab.secure) {
    lock.classList.add('secure');
    lock.replaceChildren(icon('lock'));
    lock.title = 'Connection is encrypted';
  } else {
    lock.classList.add('insecure');
    lock.replaceChildren(icon('unlock'));
    lock.title = 'Connection is not encrypted';
  }

  const shield = $('shield');
  const count = tab?.blocked || 0;
  shield.classList.toggle('armed', state.settings.blockAds !== false);
  shield.classList.toggle('zero', count === 0);
  $('blockCount').textContent = String(count);
  shield.title = `${count} blocked on this page`;

  $('privateBadge').hidden = !state.isPrivate;
  document.body.classList.toggle('mac', state.platform === 'darwin');

  const maxBtn = document.querySelector('[data-wc="maximize"]');
  if (maxBtn) {
    maxBtn.replaceChildren(icon(state.maximized ? 'restore' : 'max'));
    maxBtn.setAttribute('aria-label', state.maximized ? 'Restore' : 'Maximize');
  }

  const engine = state.settings.searchEngine || 'duckduckgo';
  const engineName = (state.engines || []).find((e) => e.id === engine)?.name || 'DuckDuckGo';
  $('omni').placeholder = `Search with ${engineName} or enter an address`;
}

// ---------------------------------------------------------------- overlay

/** The chrome view only covers the toolbar strip until we ask for the window. */
function setOverlay(kind) {
  overlayKind = kind;
  const overlay = $('overlay');
  overlay.hidden = kind === null;
  $('panel').hidden = kind !== 'panel';
  $('suggest').hidden = kind !== 'suggest';
  umbra.ui.expand(kind !== null);
}

function closeOverlay() {
  if (overlayKind === null) return;
  suggestions = [];
  suggestIndex = -1;
  setOverlay(null);
}

$('overlay').addEventListener('mousedown', (e) => {
  if (e.target === $('overlay')) {
    closeOverlay();
    $('omni').blur();
  }
});

function openPanel(anchor, build) {
  const panel = $('panel');
  panel.replaceChildren();
  build(panel);
  setOverlay('panel');

  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  // Prefer right-aligning to the anchor, but never run off the window.
  const width = Math.min(panel.offsetWidth || 320, window.innerWidth - 20);
  const left = Math.min(Math.max(10, rect.right - width), window.innerWidth - width - 10);
  panel.style.left = `${left}px`;
}

function toggleRow(parent, { label, sub, checked, onChange }) {
  const row = el('div', 'row');
  const text = el('div', 'label');
  text.appendChild(document.createTextNode(label));
  if (sub) text.appendChild(el('span', 'sub', sub));
  row.appendChild(text);

  const sw = el('button', 'switch');
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(!!checked));
  sw.onclick = () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    onChange(next);
  };
  row.appendChild(sw);
  parent.appendChild(row);
  return row;
}

function menuItem(parent, { label, hint, iconName, onClick }) {
  const item = el('button', 'item');
  if (iconName) item.appendChild(icon(iconName));
  item.appendChild(document.createTextNode(label));
  if (hint) item.appendChild(el('span', 'hint', hint));
  item.onclick = () => { closeOverlay(); onClick(); };
  parent.appendChild(item);
  return item;
}

const separator = (parent) => parent.appendChild(el('div', 'sep'));

// ------------------------------------------------------------ shield panel

function buildShieldPanel(panel) {
  const tab = activeTab();
  const blocked = tab?.blocked || 0;

  const stat = el('div', 'stat');
  stat.appendChild(el('div', 'big', String(blocked)));
  const cap = el('div', 'cap');
  cap.appendChild(document.createTextNode('trackers and ads blocked here'));
  const total = el('b');
  total.textContent = `${state.stats.total} this session`;
  cap.appendChild(el('br'));
  cap.appendChild(total);
  stat.appendChild(cap);
  panel.appendChild(stat);

  const note = el('div', 'row');
  if (!state.stats.ready) {
    note.appendChild(el('div', 'label',
      state.stats.error || 'Filter lists unavailable — nothing is being blocked.'));
    note.style.color = 'var(--warn)';
    panel.appendChild(note);
  } else if (state.stats.source === 'bundled') {
    note.appendChild(el('div', 'label', 'Using the filters compiled into this build.'));
    note.style.color = 'var(--faint)';
    panel.appendChild(note);
  }

  separator(panel);
  panel.appendChild(el('h4', null, 'Protections'));

  const set = (key) => (value) => { umbra.settings.write(key, value); };

  toggleRow(panel, { label: 'Block ads and trackers', checked: state.settings.blockAds, onChange: (v) => { set('blockAds')(v); set('blockTrackers')(v); } });
  toggleRow(panel, { label: 'Hide blocked elements', sub: 'Cosmetic filtering', checked: state.settings.blockCosmetics, onChange: set('blockCosmetics') });
  toggleRow(panel, { label: 'HTTPS only', checked: state.settings.httpsOnly, onChange: set('httpsOnly') });
  toggleRow(panel, { label: 'Block third-party cookies', checked: state.settings.blockThirdPartyCookies, onChange: set('blockThirdPartyCookies') });
  toggleRow(panel, { label: 'Strip tracking parameters', checked: state.settings.stripTrackingParams, onChange: set('stripTrackingParams') });

  separator(panel);
  panel.appendChild(el('h4', null, 'Fingerprinting'));

  const modes = ['off', 'standard', 'strict'];
  const current = state.settings.fingerprintDefense || 'standard';
  for (const mode of modes) {
    const item = el('button', 'item');
    item.appendChild(icon(mode === current ? 'check' : 'globe'));
    item.appendChild(document.createTextNode(
      mode === 'off' ? 'Off' : mode === 'standard' ? 'Standard — randomise per site' : 'Strict — may break sites'
    ));
    item.onclick = () => { umbra.settings.write('fingerprintDefense', mode); closeOverlay(); };
    panel.appendChild(item);
  }

  separator(panel);
  menuItem(panel, { label: 'All privacy settings', iconName: 'shield', onClick: () => umbra.tabs.create({ url: 'umbra://settings' }) });
}

// -------------------------------------------------------------- main menu

function buildMenuPanel(panel) {
  const tab = activeTab();

  menuItem(panel, { label: 'New tab', hint: 'Ctrl+T', iconName: 'plus', onClick: () => umbra.tabs.create({}) });
  menuItem(panel, { label: 'New window', hint: 'Ctrl+N', onClick: () => umbra.ui.newWindow(false) });
  menuItem(panel, { label: 'New private window', hint: 'Ctrl+Shift+N', iconName: 'shield', onClick: () => umbra.ui.newWindow(true) });

  separator(panel);

  const zoom = el('div', 'row');
  zoom.appendChild(el('div', 'label', 'Zoom'));
  const minus = el('button', 'icon-btn sm');
  minus.appendChild(icon('close'));
  minus.style.transform = 'rotate(45deg)';
  minus.onclick = () => umbra.nav.zoom(-0.5);
  const plus = el('button', 'icon-btn sm');
  plus.appendChild(icon('plus'));
  plus.onclick = () => umbra.nav.zoom(0.5);
  const reset = el('button', 'icon-btn sm');
  reset.textContent = '100%';
  reset.style.width = 'auto';
  reset.style.padding = '0 8px';
  reset.onclick = () => umbra.nav.zoom(0);
  zoom.append(minus, reset, plus);
  panel.appendChild(zoom);

  menuItem(panel, { label: 'Find in page', hint: 'Ctrl+F', iconName: 'search', onClick: () => showFind(true) });

  separator(panel);
  panel.appendChild(el('h4', null, 'Theme'));

  const grid = el('div', 'themes');
  for (const theme of state.themes) {
    const chip = el('button', 'theme-chip' + (theme.id === state.settings.theme ? ' active' : ''));
    const swatch = el('div', 'swatch');
    for (const color of theme.swatch) {
      const i = el('i');
      i.style.background = color;
      swatch.appendChild(i);
    }
    chip.appendChild(swatch);
    chip.appendChild(document.createTextNode(theme.label));
    chip.title = theme.credit;
    chip.onclick = () => { umbra.settings.write('theme', theme.id); closeOverlay(); };
    grid.appendChild(chip);
  }
  panel.appendChild(grid);

  separator(panel);
  menuItem(panel, { label: 'Settings', hint: 'Ctrl+,', onClick: () => umbra.tabs.create({ url: 'umbra://settings' }) });
  menuItem(panel, { label: 'Clear browsing data', onClick: () => clearData() });
  menuItem(panel, { label: 'Developer tools', hint: 'F12', onClick: () => umbra.nav.devtools() });
  separator(panel);
  menuItem(panel, {
    label: `About Umbra ${state.version.umbra || ''}`.trim(),
    hint: `Chromium ${(state.version.chromium || '').split('.')[0]}`,
    onClick: () => umbra.tabs.create({ url: 'umbra://about' }),
  });

  if (tab && tab.url) {
    separator(panel);
    menuItem(panel, { label: 'Copy page address', onClick: () => umbra.copy(tab.url) });
  }
}

async function clearData() {
  await umbra.data.clear({ cookies: true, storage: true, cache: true, history: true });
  umbra.nav.reload(true);
}

// -------------------------------------------------------------- suggestions

async function updateSuggestions(query) {
  const text = query.trim();
  if (!text) {
    if (overlayKind === 'suggest') closeOverlay();
    return;
  }

  const history = await umbra.data.suggest(text);
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^\s/?#]+\.[a-z]{2,}/i.test(text);

  suggestions = [
    looksLikeUrl
      ? { kind: 'url', title: text, url: text }
      : { kind: 'search', title: text, url: null },
    ...history.map((h) => ({ kind: 'history', title: h.title, url: h.url })),
  ].slice(0, 8);
  suggestIndex = 0;
  renderSuggestions();
}

function renderSuggestions() {
  const box = $('suggest');
  box.replaceChildren();

  if (!suggestions.length) {
    if (overlayKind === 'suggest') closeOverlay();
    return;
  }

  suggestions.forEach((s, i) => {
    const row = el('div', 'sug' + (i === suggestIndex ? ' sel' : ''));
    row.appendChild(icon(s.kind === 'search' ? 'search' : s.kind === 'history' ? 'reload' : 'globe'));
    row.appendChild(el('span', 't', s.title || s.url));
    if (s.url && s.kind !== 'url') row.appendChild(el('span', 'u', pretty(s.url)));
    else if (s.kind === 'search') row.appendChild(el('span', 'u', '— search'));
    row.onmousedown = (e) => { e.preventDefault(); commit(s); };
    box.appendChild(row);
  });

  setOverlay('suggest');
  const rect = $('omnibox').getBoundingClientRect();
  box.style.top = `${rect.bottom + 4}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
}

function commit(suggestion) {
  const input = suggestion ? (suggestion.url || suggestion.title) : $('omni').value;
  omniDirty = false;
  closeOverlay();
  $('omni').blur();
  umbra.nav.go(input);
}

// -------------------------------------------------------------------- find

function showFind(open) {
  findVisible = open;
  $('findbar').hidden = !open;
  umbra.ui.find(open ? 'open' : 'close');
  if (open) {
    const input = $('findInput');
    input.focus();
    input.select();
    if (input.value) umbra.ui.find('search', input.value);
  } else {
    $('findCount').textContent = '';
  }
}

// ------------------------------------------------------------------- events

$('newtab').onclick = () => umbra.tabs.create({});
$('back').onclick = () => umbra.nav.back();
$('forward').onclick = () => umbra.nav.forward();
$('reload').onclick = () => (activeTab()?.loading ? umbra.nav.stop() : umbra.nav.reload(false));

$('shield').onclick = (e) => {
  e.stopPropagation();
  if (overlayKind === 'panel') closeOverlay();
  else openPanel($('shield'), buildShieldPanel);
};

$('menuBtn').onclick = (e) => {
  e.stopPropagation();
  if (overlayKind === 'panel') closeOverlay();
  else openPanel($('menuBtn'), buildMenuPanel);
};

for (const button of document.querySelectorAll('[data-wc]')) {
  button.onclick = () => umbra.ui.windowControl(button.dataset.wc);
}

const omni = $('omni');

omni.addEventListener('focus', () => {
  const tab = activeTab();
  if (tab?.url) omni.value = tab.url;
  omni.select();
});

omni.addEventListener('blur', () => {
  omniDirty = false;
  renderToolbar();
});

omni.addEventListener('input', () => {
  omniDirty = true;
  updateSuggestions(omni.value);
});

omni.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commit(suggestIndex >= 0 ? suggestions[suggestIndex] : null);
  } else if (e.key === 'ArrowDown' && suggestions.length) {
    e.preventDefault();
    suggestIndex = (suggestIndex + 1) % suggestions.length;
    renderSuggestions();
  } else if (e.key === 'ArrowUp' && suggestions.length) {
    e.preventDefault();
    suggestIndex = (suggestIndex - 1 + suggestions.length) % suggestions.length;
    renderSuggestions();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    omniDirty = false;
    closeOverlay();
    omni.blur();
  }
});

$('findInput').addEventListener('input', (e) => {
  const text = e.target.value;
  if (text) umbra.ui.find('search', text);
  else $('findCount').textContent = '';
});

$('findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    umbra.ui.find('next', e.target.value, !e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    showFind(false);
  }
});

$('findNext').onclick = () => umbra.ui.find('next', $('findInput').value, true);
$('findPrev').onclick = () => umbra.ui.find('next', $('findInput').value, false);
$('findClose').onclick = () => showFind(false);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlayKind) closeOverlay();
});

window.addEventListener('resize', () => {
  if (overlayKind === 'suggest') renderSuggestions();
  else if (overlayKind === 'panel') closeOverlay();
});

// ------------------------------------------------------------- main process

umbra.on('tabs', (payload) => {
  Object.assign(state, payload);
  renderTabs();
  renderToolbar();
});

umbra.on('settings', (payload) => {
  state.settings = payload.values;
  state.version = payload.version || state.version;
  applyTheme(payload.theme);
  renderToolbar();
  if (overlayKind === 'panel') closeOverlay();
});

umbra.on('find-result', (result) => {
  $('findCount').textContent = result.matches
    ? `${result.activeMatchOrdinal}/${result.matches}`
    : 'No matches';
});

umbra.on('focus-omnibox', () => {
  omni.focus();
  omni.select();
});

umbra.on('focus-find', () => showFind(true));

umbra.settings.read().then((payload) => {
  state.settings = payload.values;
  state.themes = payload.themes;
  state.engines = payload.engines;
  applyTheme(payload.theme);
  renderToolbar();
});
