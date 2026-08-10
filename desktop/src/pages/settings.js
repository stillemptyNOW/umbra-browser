'use strict';

/**
 * The settings page is generated from this schema rather than hand-written
 * markup, so a new preference is one line here and nothing else.
 *
 * Row shape: [key, label, help, kind?, options?]
 * kind defaults to a toggle; 'select' and 'text' are the alternatives.
 */
function schema(engines) {
  return [
    {
      title: 'Content blocking',
      rows: [
        ['blockAds', 'Block ads', 'EasyList plus the uBlock Origin filter set.'],
        ['blockTrackers', 'Block trackers', 'EasyPrivacy. Stops third parties following you between sites.'],
        ['blockCosmetics', 'Hide blocked elements', 'Removes the empty space an ad left behind.'],
      ],
    },
    {
      title: 'Network',
      rows: [
        ['httpsOnly', 'HTTPS only', 'Upgrade every navigation, and fall back only when a site genuinely has no HTTPS.'],
        ['stripTrackingParams', 'Strip tracking parameters', 'Removes utm_*, fbclid, gclid and friends from addresses.'],
        ['trimReferrer', 'Trim cross-site referrers', 'Send only the origin, never the full page you came from.'],
        ['sendGpc', 'Send Global Privacy Control', 'A legally recognised do-not-sell signal in several jurisdictions.'],
        ['blockThirdPartyCookies', 'Block third-party cookies', 'Cookies are stripped from requests to other sites.'],
        ['secureDns', 'Encrypted DNS (DoH)', 'Your network operator cannot see which sites you look up.'],
        ['dnsProvider', 'DNS resolver', '', 'select', [
          ['quad9', 'Quad9'], ['cloudflare', 'Cloudflare'], ['mullvad', 'Mullvad'], ['adguard', 'AdGuard'],
        ]],
        ['webrtcPolicy', 'WebRTC IP policy', 'Stops WebRTC revealing your local network addresses.', 'select', [
          ['default', 'Default'], ['public-only', 'Public interface only'], ['disable-udp', 'Disable non-proxied UDP'],
        ]],
      ],
    },
    {
      title: 'Fingerprinting',
      rows: [
        ['fingerprintDefense', 'Protection level',
          'Standard randomises canvas, audio and WebGL per site. Strict adds quantised screen metrics and coarse timers, and breaks more sites.',
          'select', [['off', 'Off'], ['standard', 'Standard'], ['strict', 'Strict']]],
        ['spoofUserAgent', 'Generic user agent', 'Report a plain Chrome build rather than announcing Umbra.'],
        ['spoofLanguage', 'Report en-US only', 'Your real language list is unusual enough to identify you.'],
        ['spoofTimezone', 'Report UTC', 'Hides your time zone. Breaks calendars and clocks.'],
      ],
    },
    {
      title: 'Search and start-up',
      rows: [
        ['searchEngine', 'Search engine', '', 'select',
          engines.filter((e) => e.id !== 'custom').map((e) => [e.id, e.name])],
        ['homepage', 'Home page', 'Where new tabs open.', 'text'],
      ],
    },
    {
      title: 'Permissions',
      rows: [
        ['allowMedia', 'Allow camera and microphone requests', 'Off means sites are refused without being asked about.'],
        ['allowGeolocation', 'Allow location requests', ''],
        ['allowNotifications', 'Allow notification requests', ''],
      ],
    },
    {
      title: 'History',
      rows: [
        ['rememberHistory', 'Remember visited pages', 'Used only for address bar completion. Never leaves this machine.'],
        ['restoreTabs', 'Restore tabs on start-up', ''],
      ],
    },
  ];
}

function toggle(checked, onChange) {
  const button = document.createElement('button');
  button.className = 'switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(!!checked));
  button.onclick = () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    onChange(next);
  };
  return button;
}

(async () => {
  const state = await window.umbraPage;
  const bridge = window.umbraInternal;
  if (!bridge) return;

  const payload = await bridge.readSettings();
  const values = payload.values;
  const set = (key, value) => {
    values[key] = value;
    bridge.setSetting(key, value);
  };

  document.getElementById('sub').textContent =
    `Umbra ${state.version.umbra} · Chromium ${state.version.chromium}`;

  // -- preference sections --------------------------------------------------
  const sections = document.getElementById('sections');
  for (const section of schema(payload.engines)) {
    const heading = document.createElement('h2');
    heading.textContent = section.title;
    sections.appendChild(heading);

    const card = document.createElement('div');
    card.className = 'card';

    for (const [key, label, help, kind, options] of section.rows) {
      const row = document.createElement('div');
      row.className = 'row';

      const text = document.createElement('div');
      text.className = 'txt';
      const name = document.createElement('b');
      name.textContent = label;
      text.appendChild(name);
      if (help) {
        const sub = document.createElement('span');
        sub.textContent = help;
        text.appendChild(sub);
      }
      row.appendChild(text);

      if (kind === 'select') {
        const select = document.createElement('select');
        for (const [id, optionLabel] of options) {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = optionLabel;
          select.appendChild(option);
        }
        select.value = values[key];
        select.onchange = () => set(key, select.value);
        row.appendChild(select);
      } else if (kind === 'text') {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = values[key] || '';
        input.size = 24;
        input.onchange = () => set(key, input.value.trim());
        row.appendChild(input);
      } else {
        row.appendChild(toggle(values[key], (next) => set(key, next)));
      }

      card.appendChild(row);
    }
    sections.appendChild(card);
  }

  // -- themes ---------------------------------------------------------------
  const themeGrid = document.getElementById('themes');
  for (const theme of payload.themes) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (theme.id === values.theme ? ' active' : '');
    chip.title = theme.credit;

    const swatch = document.createElement('div');
    swatch.className = 'sw';
    for (const color of theme.swatch) {
      const block = document.createElement('i');
      block.style.background = color;
      swatch.appendChild(block);
    }
    chip.appendChild(swatch);
    chip.appendChild(document.createTextNode(theme.label));
    chip.onclick = () => {
      set('theme', theme.id);
      location.reload();
    };
    themeGrid.appendChild(chip);
  }

  document.getElementById('themeCredit').textContent =
    'Palettes borrowed, with thanks, from ' +
    payload.themes.filter((t) => t.id !== 'umbra').map((t) => t.credit).join(' · ');

  // -- visited sites --------------------------------------------------------
  const sitesCard = document.getElementById('sites');
  const renderSites = async () => {
    const sites = await bridge.sites();
    sitesCard.replaceChildren();

    if (!sites.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nothing recorded yet.';
      sitesCard.appendChild(empty);
      return;
    }

    for (const site of sites) {
      const row = document.createElement('div');
      row.className = 'row';

      const host = document.createElement('div');
      host.className = 'host';
      host.textContent = site.host;

      const visits = document.createElement('div');
      visits.className = 'visits';
      visits.textContent = `${site.visits} visit${site.visits === 1 ? '' : 's'}`;

      const forget = document.createElement('button');
      forget.className = 'action';
      forget.textContent = 'Forget';
      forget.onclick = () => {
        bridge.forget(site.host);
        renderSites();
      };

      row.append(host, visits, forget);
      sitesCard.appendChild(row);
    }
  };
  renderSites();

  // -- clearing -------------------------------------------------------------
  const clearAll = document.getElementById('clearAll');
  clearAll.onclick = async () => {
    clearAll.disabled = true;
    clearAll.textContent = 'Clearing…';
    await bridge.clearData({ cookies: true, storage: true, cache: true, history: true });
    await renderSites();
    clearAll.textContent = 'Cleared';
    setTimeout(() => {
      clearAll.disabled = false;
      clearAll.textContent = 'Clear now';
    }, 1600);
  };

  const onExit = document.getElementById('clearOnExit');
  onExit.replaceWith(toggle(values.clearOnExit, (next) => set('clearOnExit', next)));
})();
