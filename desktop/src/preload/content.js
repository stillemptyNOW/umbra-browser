'use strict';
/**
 * Runs in every frame Umbra loads, before any page script.
 *
 * Preloads execute in an isolated world, so patching `window` here would not
 * affect the page. webFrame.executeJavaScript evaluates in the frame's *main*
 * world instead, and calling it at preload time lands before the document's
 * own scripts run — which is the whole point.
 */
const { ipcRenderer, webFrame, contextBridge } = require('electron');

let cfg;
try {
  cfg = ipcRenderer.sendSync('umbra:page-config', location.href);
} catch {
  cfg = { defense: 'off', seed: 1 };
}

/**
 * Fingerprinting defence, injected as source text.
 *
 * Must be entirely self-contained: it is stringified and evaluated in another
 * world, so it cannot close over anything in this file.
 *
 * The approach is Brave's "farbling" rather than blanket blocking. Returning
 * constant, obviously-fake values is itself a strong signal; returning values
 * that are plausible but differ per site breaks cross-site correlation, which
 * is what actually matters. The seed is derived from the profile secret and
 * the site's registrable domain, so a site sees stable values on every visit
 * while two different sites never agree.
 */
function umbraDefense(cfg) {
  'use strict';
  if (!cfg || cfg.defense === 'off') return;

  const strict = cfg.defense === 'strict';

  // xorshift32 — deterministic, seeded per site.
  let s = (cfg.seed >>> 0) || 0x9e3779b9;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  const define = (obj, prop, getter) => {
    try {
      Object.defineProperty(obj, prop, { get: getter, configurable: true, enumerable: true });
    } catch { /* frozen or non-configurable; skip */ }
  };

  /** Replace a method while keeping name, arity and a native-looking toString. */
  const wrap = (obj, name, impl) => {
    if (!obj) return;
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    const patched = function (...args) { return impl.call(this, orig, args); };
    try {
      Object.defineProperty(patched, 'name', { value: name, configurable: true });
      Object.defineProperty(patched, 'length', { value: orig.length, configurable: true });
      patched.toString = () => 'function ' + name + '() { [native code] }';
      obj[name] = patched;
    } catch { /* non-writable; skip */ }
  };

  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  // -- canvas ---------------------------------------------------------------
  // Perturb roughly one channel in sixteen by a single least-significant bit:
  // invisible to a human, fatal to a hash.
  const perturb = (data) => {
    for (let i = 0; i < data.length; i += 4) {
      if (rnd() < 0.0625) {
        data[i] = clamp255(data[i] + (rnd() < 0.5 ? -1 : 1));
        data[i + 1] = clamp255(data[i + 1] + (rnd() < 0.5 ? -1 : 1));
        data[i + 2] = clamp255(data[i + 2] + (rnd() < 0.5 ? -1 : 1));
      }
    }
    return data;
  };

  /** Export from a noised copy so the visible canvas is never mutated. */
  const noisyClone = (canvas) => {
    try {
      const w = canvas.width | 0;
      const h = canvas.height | 0;
      if (!w || !h || w * h > 16777216) return canvas;
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const img = ctx.getImageData(0, 0, w, h);
      perturb(img.data);
      ctx.putImageData(img, 0, 0);
      return copy;
    } catch {
      return canvas;
    }
  };

  wrap(HTMLCanvasElement.prototype, 'toDataURL', function (orig, args) {
    return orig.apply(noisyClone(this), args);
  });
  wrap(HTMLCanvasElement.prototype, 'toBlob', function (orig, args) {
    return orig.apply(noisyClone(this), args);
  });
  if (window.CanvasRenderingContext2D) {
    wrap(CanvasRenderingContext2D.prototype, 'getImageData', function (orig, args) {
      const img = orig.apply(this, args);
      try { perturb(img.data); } catch { /* detached buffer */ }
      return img;
    });
  }
  if (window.OffscreenCanvas) {
    wrap(OffscreenCanvas.prototype, 'convertToBlob', function (orig, args) {
      return orig.apply(this, args);
    });
  }

  // -- webgl ----------------------------------------------------------------
  const GL_VENDOR = 0x9245;   // UNMASKED_VENDOR_WEBGL
  const GL_RENDERER = 0x9246; // UNMASKED_RENDERER_WEBGL
  const GL_SPOOF = {
    [GL_VENDOR]: 'Google Inc.',
    [GL_RENDERER]: 'ANGLE (Unknown, Unknown Device, OpenGL 4.6)',
  };
  for (const Ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctor) continue;
    wrap(Ctor.prototype, 'getParameter', function (orig, args) {
      const p = args[0];
      if (p in GL_SPOOF) return GL_SPOOF[p];
      return orig.apply(this, args);
    });
    wrap(Ctor.prototype, 'readPixels', function (orig, args) {
      const out = orig.apply(this, args);
      const buf = args[6];
      if (buf && buf.length) {
        for (let i = 0; i < buf.length; i += 4) {
          if (rnd() < 0.03) buf[i] = clamp255(buf[i] + (rnd() < 0.5 ? -1 : 1));
        }
      }
      return out;
    });
    if (strict) {
      wrap(Ctor.prototype, 'getSupportedExtensions', function () {
        return ['ANGLE_instanced_arrays', 'OES_texture_float', 'WEBGL_debug_renderer_info'];
      });
    }
  }

  // -- audio ----------------------------------------------------------------
  const jitterFloats = (arr, scale) => {
    for (let i = 0; i < arr.length; i++) {
      if (rnd() < 0.02) arr[i] += (rnd() - 0.5) * scale;
    }
    return arr;
  };
  if (window.AnalyserNode) {
    wrap(AnalyserNode.prototype, 'getFloatFrequencyData', function (orig, args) {
      orig.apply(this, args);
      jitterFloats(args[0], 0.0002);
    });
    wrap(AnalyserNode.prototype, 'getFloatTimeDomainData', function (orig, args) {
      orig.apply(this, args);
      jitterFloats(args[0], 0.0002);
    });
  }
  if (window.AudioBuffer) {
    wrap(AudioBuffer.prototype, 'getChannelData', function (orig, args) {
      const data = orig.apply(this, args);
      return jitterFloats(data, 0.0000001);
    });
  }

  // -- navigator ------------------------------------------------------------
  // Fixed, extremely common values: the goal is to join the largest crowd.
  define(Navigator.prototype, 'hardwareConcurrency', () => 4);
  define(Navigator.prototype, 'deviceMemory', () => 8);
  define(Navigator.prototype, 'maxTouchPoints', () => 0);
  define(Navigator.prototype, 'webdriver', () => false);
  define(Navigator.prototype, 'plugins', () => Object.create(PluginArray.prototype));
  define(Navigator.prototype, 'mimeTypes', () => Object.create(MimeTypeArray.prototype));
  define(Navigator.prototype, 'connection', () => undefined);
  define(Navigator.prototype, 'getBattery', () => undefined);

  if (cfg.spoofLanguage) {
    define(Navigator.prototype, 'language', () => 'en-US');
    define(Navigator.prototype, 'languages', () => Object.freeze(['en-US', 'en']));
  }

  if (navigator.userAgentData) {
    wrap(navigator.userAgentData, 'getHighEntropyValues', function (_orig, args) {
      const want = args[0] || [];
      const answer = {
        brands: navigator.userAgentData.brands,
        mobile: false,
        platform: navigator.userAgentData.platform,
        architecture: 'x86',
        bitness: '64',
        model: '',
        platformVersion: '',
        uaFullVersion: '',
        fullVersionList: navigator.userAgentData.brands,
        wow64: false,
      };
      const out = { brands: answer.brands, mobile: answer.mobile, platform: answer.platform };
      for (const k of want) if (k in answer) out[k] = answer[k];
      return Promise.resolve(out);
    });
  }

  if (navigator.mediaDevices) {
    wrap(navigator.mediaDevices, 'enumerateDevices', function () {
      // Device ids and labels are a persistent hardware fingerprint.
      return Promise.resolve([]);
    });
  }

  if (window.navigator.storage) {
    wrap(navigator.storage, 'estimate', function (orig, args) {
      return orig.apply(this, args).then((e) => ({
        quota: Math.round((e.quota || 0) / 1e8) * 1e8,
        usage: Math.round((e.usage || 0) / 1e6) * 1e6,
      }));
    });
  }

  if (strict && window.speechSynthesis) {
    wrap(speechSynthesis, 'getVoices', function () { return []; });
  }

  // -- screen ---------------------------------------------------------------
  // Report the viewport instead of the physical display: window size is
  // already observable, display size and taskbar geometry are not.
  const quantise = (v) => (strict ? Math.round(v / 50) * 50 : v);
  define(Screen.prototype, 'width', () => quantise(window.innerWidth));
  define(Screen.prototype, 'height', () => quantise(window.innerHeight));
  define(Screen.prototype, 'availWidth', () => quantise(window.innerWidth));
  define(Screen.prototype, 'availHeight', () => quantise(window.innerHeight));
  define(Screen.prototype, 'availLeft', () => 0);
  define(Screen.prototype, 'availTop', () => 0);
  define(Screen.prototype, 'colorDepth', () => 24);
  define(Screen.prototype, 'pixelDepth', () => 24);
  define(window, 'screenX', () => 0);
  define(window, 'screenY', () => 0);
  define(window, 'screenLeft', () => 0);
  define(window, 'screenTop', () => 0);
  if (strict) define(window, 'devicePixelRatio', () => 1);

  // -- time -----------------------------------------------------------------
  // Sub-millisecond timers drive cache- and CPU-timing side channels.
  const grain = strict ? 1 : 0.1;
  if (window.performance) {
    wrap(performance, 'now', function (orig, args) {
      return Math.floor(orig.apply(this, args) / grain) * grain;
    });
  }
  if (cfg.spoofTimezone) {
    wrap(Date.prototype, 'getTimezoneOffset', function () { return 0; });
    if (window.Intl && Intl.DateTimeFormat) {
      const OrigDTF = Intl.DateTimeFormat;
      wrap(OrigDTF.prototype, 'resolvedOptions', function (orig, args) {
        const o = orig.apply(this, args);
        o.timeZone = 'UTC';
        return o;
      });
    }
  }

  // -- misc -----------------------------------------------------------------
  if (window.chrome) {
    try {
      delete window.chrome.loadTimes;
      delete window.chrome.csi;
    } catch { /* non-configurable */ }
  }
}

if (cfg.defense && cfg.defense !== 'off') {
  webFrame
    .executeJavaScript(`(${umbraDefense.toString()})(${JSON.stringify(cfg)});`)
    .catch(() => { /* CSP or a hostile page; page just runs undefended */ });
}

// ---------------------------------------------------------------------------
// Bridge for Umbra's own internal pages (umbra://newtab and friends).
// Never exposed to the open web.
// ---------------------------------------------------------------------------
if (cfg.internal) {
  contextBridge.exposeInMainWorld('umbraInternal', {
    getState: () => ipcRenderer.invoke('umbra:internal-state'),
    readSettings: () => ipcRenderer.invoke('umbra:settings-get'),
    setSetting: (key, value) => ipcRenderer.send('umbra:settings-set', { key, value }),
    clearData: (what) => ipcRenderer.invoke('umbra:clear-data', what),
    sites: () => ipcRenderer.invoke('umbra:sites-list'),
    forget: (host) => ipcRenderer.send('umbra:site-forget', host),
    search: (query) => ipcRenderer.send('umbra:internal-search', query),
    navigate: (url) => ipcRenderer.send('umbra:internal-navigate', url),
    openSettings: () => ipcRenderer.send('umbra:internal-settings'),
    openExternal: (url) => ipcRenderer.send('umbra:open-external', url),
  });
}
