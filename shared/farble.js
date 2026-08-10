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

  /* FNV-1a over secret|host, then murmur3's finaliser. Not an HMAC — the
     desktop build derives its seed with one in the main process, but a
     document-start script has no synchronous crypto and the value must exist
     before the first page script runs. A keyed avalanche hash is what fits;
     the secret never leaves the device, so preimage resistance is not what is
     being relied on. */
  var seed = 0x811c9dc5;
  var material = secret + '|' + host;
  for (var i = 0; i < material.length; i++) {
    seed ^= material.charCodeAt(i);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }

  /* Noise keyed on position, never a running stream: reading the same pixel
     twice must give the same perturbation, or a site can average many reads
     together and recover the original. */
  function noiseAt(index) {
    var h = (seed ^ Math.imul(index, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
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
    var pixels = data.length >> 2;
    for (var p = 0; p < pixels; p++) {
      var noise = noiseAt(p);
      if ((noise & 15) !== 0) continue;
      var i = p << 2;
      data[i] = clamp(data[i] + ((noise >>> 4) & 1 ? 1 : -1));
      data[i + 1] = clamp(data[i + 1] + ((noise >>> 5) & 1 ? 1 : -1));
      data[i + 2] = clamp(data[i + 2] + ((noise >>> 6) & 1 ? 1 : -1));
    }
    return data;
  }

  var exporting = false;

  /* Export from a noised copy so the visible canvas is never mutated. */
  function noisyClone(canvas, factory) {
    try {
      var w = canvas.width | 0, h = canvas.height | 0;
      if (!w || !h || w * h > 16777216) return canvas;
      var copy = factory(w, h);
      var ctx = copy.getContext('2d');
      exporting = true;
      try {
        ctx.drawImage(canvas, 0, 0);
        var img = ctx.getImageData(0, 0, w, h);
        perturb(img.data);
        ctx.putImageData(img, 0, 0);
      } finally {
        exporting = false;
      }
      return copy;
    } catch (e) {
      return canvas;
    }
  }

  function htmlCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function readback(orig, args) {
    var img = orig.apply(this, args);
    if (exporting) return img;
    try { perturb(img.data); } catch (e) { /* detached */ }
    return img;
  }

  wrap(HTMLCanvasElement.prototype, 'toDataURL', function (orig, args) {
    return orig.apply(noisyClone(this, htmlCanvas), args);
  });
  wrap(HTMLCanvasElement.prototype, 'toBlob', function (orig, args) {
    return orig.apply(noisyClone(this, htmlCanvas), args);
  });
  if (window.CanvasRenderingContext2D) {
    wrap(CanvasRenderingContext2D.prototype, 'getImageData', readback);
  }

  /* OffscreenCanvas is a second, worker-friendly readback path, and a popular
     one with fingerprinting scripts for exactly that reason. */
  if (window.OffscreenCanvas) {
    var offscreen = function (w, h) { return new OffscreenCanvas(w, h); };
    wrap(OffscreenCanvas.prototype, 'convertToBlob', function (orig, args) {
      return orig.apply(noisyClone(this, offscreen), args);
    });
    wrap(OffscreenCanvas.prototype, 'transferToImageBitmap', function (orig, args) {
      return orig.apply(noisyClone(this, offscreen), args);
    });
  }
  if (window.OffscreenCanvasRenderingContext2D) {
    wrap(OffscreenCanvasRenderingContext2D.prototype, 'getImageData', readback);
  }

  var GL_SPOOF = { 37445: 'Qualcomm', 37446: 'Adreno (TM) 730' };
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function (Ctor) {
    if (!Ctor) return;
    wrap(Ctor.prototype, 'getParameter', function (orig, args) {
      if (args[0] in GL_SPOOF) return GL_SPOOF[args[0]];
      return orig.apply(this, args);
    });
  });

  function jitterFloats(arr, scale) {
    for (var i = 0; i < arr.length; i++) {
      var noise = noiseAt(i);
      if ((noise & 63) !== 0) continue;
      arr[i] += ((noise >>> 8) / 0xffffff - 0.5) * scale;
    }
    return arr;
  }

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
    /* getChannelData returns the buffer's own storage, so perturbing on every
       call would compound the error. Touch each array once. */
    var jittered = new WeakSet();
    wrap(AudioBuffer.prototype, 'getChannelData', function (orig, args) {
      var d = orig.apply(this, args);
      if (!jittered.has(d)) {
        jittered.add(d);
        jitterFloats(d, 1e-7);
      }
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
