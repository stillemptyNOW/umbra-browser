/* Umbra fingerprinting defence for the Android WebView.
 *
 * Injected with WebViewCompat.addDocumentStartJavaScript, so it runs before any
 * page script. __UMBRA_SECRET__ is replaced at runtime with a per-install
 * random value; combined with the hostname it gives each site stable but
 * mutually inconsistent readings, which is what breaks cross-site correlation.
 *
 * This is the mobile subset of the desktop defence. WebView exposes fewer knobs
 * than a full Chromium embed, so screen metrics and timer granularity are left
 * alone here — see PRIVACY.md.
 */
(function () {
  'use strict';

  var secret = '__UMBRA_SECRET__';
  var host = location.hostname || 'local';
  var seed = 0;
  var material = secret + '|' + host;
  for (var i = 0; i < material.length; i++) {
    seed = ((seed << 5) - seed + material.charCodeAt(i)) | 0;
  }
  var s = (seed >>> 0) || 0x9e3779b9;

  function rnd() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  }

  function define(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, { get: getter, configurable: true, enumerable: true });
    } catch (e) { /* non-configurable */ }
  }

  function wrap(obj, name, impl) {
    if (!obj) return;
    var orig = obj[name];
    if (typeof orig !== 'function') return;
    var patched = function () {
      return impl.call(this, orig, Array.prototype.slice.call(arguments));
    };
    try {
      Object.defineProperty(patched, 'name', { value: name, configurable: true });
      patched.toString = function () { return 'function ' + name + '() { [native code] }'; };
      obj[name] = patched;
    } catch (e) { /* non-writable */ }
  }

  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  function perturb(data) {
    for (var i = 0; i < data.length; i += 4) {
      if (rnd() < 0.0625) {
        data[i] = clamp(data[i] + (rnd() < 0.5 ? -1 : 1));
        data[i + 1] = clamp(data[i + 1] + (rnd() < 0.5 ? -1 : 1));
        data[i + 2] = clamp(data[i + 2] + (rnd() < 0.5 ? -1 : 1));
      }
    }
    return data;
  }

  /* Export from a noised copy so the visible canvas is never mutated. */
  function noisyClone(canvas) {
    try {
      var w = canvas.width | 0, h = canvas.height | 0;
      if (!w || !h || w * h > 16777216) return canvas;
      var copy = document.createElement('canvas');
      copy.width = w; copy.height = h;
      var ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      var img = ctx.getImageData(0, 0, w, h);
      perturb(img.data);
      ctx.putImageData(img, 0, 0);
      return copy;
    } catch (e) {
      return canvas;
    }
  }

  wrap(HTMLCanvasElement.prototype, 'toDataURL', function (orig, args) {
    return orig.apply(noisyClone(this), args);
  });
  wrap(HTMLCanvasElement.prototype, 'toBlob', function (orig, args) {
    return orig.apply(noisyClone(this), args);
  });
  if (window.CanvasRenderingContext2D) {
    wrap(CanvasRenderingContext2D.prototype, 'getImageData', function (orig, args) {
      var img = orig.apply(this, args);
      try { perturb(img.data); } catch (e) { /* detached */ }
      return img;
    });
  }

  var GL_SPOOF = { 37445: 'Qualcomm', 37446: 'Adreno (TM) 730' };
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function (Ctor) {
    if (!Ctor) return;
    wrap(Ctor.prototype, 'getParameter', function (orig, args) {
      if (args[0] in GL_SPOOF) return GL_SPOOF[args[0]];
      return orig.apply(this, args);
    });
  });

  if (window.AnalyserNode) {
    wrap(AnalyserNode.prototype, 'getFloatFrequencyData', function (orig, args) {
      orig.apply(this, args);
      var a = args[0];
      for (var i = 0; i < a.length; i++) if (rnd() < 0.02) a[i] += (rnd() - 0.5) * 0.0002;
    });
  }
  if (window.AudioBuffer) {
    wrap(AudioBuffer.prototype, 'getChannelData', function (orig, args) {
      var d = orig.apply(this, args);
      for (var i = 0; i < d.length; i++) if (rnd() < 0.02) d[i] += (rnd() - 0.5) * 1e-7;
      return d;
    });
  }

  define(Navigator.prototype, 'hardwareConcurrency', function () { return 4; });
  define(Navigator.prototype, 'deviceMemory', function () { return 4; });
  define(Navigator.prototype, 'webdriver', function () { return false; });
  define(Navigator.prototype, 'connection', function () { return undefined; });
  define(Navigator.prototype, 'getBattery', function () { return undefined; });
  define(Navigator.prototype, 'language', function () { return 'en-US'; });
  define(Navigator.prototype, 'languages', function () { return Object.freeze(['en-US', 'en']); });

  if (navigator.mediaDevices) {
    wrap(navigator.mediaDevices, 'enumerateDevices', function () {
      return Promise.resolve([]);
    });
  }
})();
