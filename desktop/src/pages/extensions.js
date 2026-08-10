'use strict';

(async () => {
  await window.umbraPage;
  const bridge = window.umbraInternal;
  if (!bridge) return;

  const listCard = document.getElementById('list');
  const restart = document.getElementById('restart');

  const needsRestart = () => { restart.hidden = false; };

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

  async function render() {
    const extensions = await bridge.extensions();
    listCard.replaceChildren();

    if (!extensions.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No extensions yet.';
      listCard.appendChild(empty);
      return;
    }

    for (const extension of extensions) {
      const row = document.createElement('div');
      row.className = 'ext';

      if (extension.iconUrl) {
        const img = document.createElement('img');
        img.className = 'icon';
        img.src = extension.iconUrl;
        img.alt = '';
        row.appendChild(img);
      }

      const body = document.createElement('div');
      body.className = 'body';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = extension.name;
      body.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = [
        extension.version ? `v${extension.version}` : null,
        extension.manifestVersion ? `manifest v${extension.manifestVersion}` : null,
        extension.description,
      ].filter(Boolean).join(' · ');
      body.appendChild(meta);

      if (extension.error) {
        const bad = document.createElement('div');
        bad.className = 'bad';
        bad.textContent = extension.error;
        body.appendChild(bad);
      }

      const where = document.createElement('div');
      where.className = 'path';
      where.textContent = extension.path;
      body.appendChild(where);

      row.appendChild(body);

      const controls = document.createElement('div');
      controls.className = 'controls';
      controls.appendChild(toggle(extension.enabled, async (next) => {
        await bridge.toggleExtension(extension.path, next);
        needsRestart();
      }));

      const remove = document.createElement('button');
      remove.className = 'action danger';
      remove.textContent = 'Remove';
      remove.onclick = async () => {
        await bridge.removeExtension(extension.path);
        await render();
      };
      controls.appendChild(remove);

      row.appendChild(controls);
      listCard.appendChild(row);
    }
  }

  document.getElementById('add').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await bridge.addExtension();
      if (result?.error) {
        const bad = document.createElement('div');
        bad.className = 'banner';
        bad.style.color = 'var(--danger)';
        bad.textContent = result.error;
        listCard.parentElement.insertBefore(bad, listCard);
        setTimeout(() => bad.remove(), 5000);
      } else if (result?.ok) {
        needsRestart();
      }
      await render();
    } finally {
      button.disabled = false;
    }
  };

  render();
})();
