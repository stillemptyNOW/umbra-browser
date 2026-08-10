/**
 * Rasterises the Umbra mark into every icon format the four platform builds
 * need. Run with `npm run icons` from the repository root.
 *
 * Source of truth is brand/umbra-mark.png (the official mark). Its artwork
 * glows against pure black, so the alpha channel is rebuilt from luminance —
 * that turns the black backdrop transparent and lets the mark sit on the
 * themed icon plate at any size without a visible seam.
 *
 * Outputs
 *   brand/generated/           reference PNGs + .ico + .icns
 *   desktop/build/             icons electron-builder picks up by name
 *   android res mipmap-<dpi>   launcher icons + adaptive foreground
 *   ios/Resources/             1024px App Store icon
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import png2icons from 'png2icons';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MARK = join(HERE, 'umbra-mark.png');

const PLATE = '#05040A';
const PLATE_TOP = '#171029';
const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const ANDROID_MIPMAPS = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

const write = async (path, buf) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  console.log('  ' + path.slice(ROOT.length + 1).replace(/\\/g, '/'));
};

// ---------------------------------------------------------------------------
// 1. Trim the black surround, then letterbox back to a square so the vortex
//    ends up dead centre regardless of how the source was framed.
// ---------------------------------------------------------------------------
const trimmed = await sharp(await readFile(MARK))
  .flatten({ background: '#000000' })
  .trim({ background: '#000000', threshold: 10 })
  .png()
  .toBuffer();

const tm = await sharp(trimmed).metadata();
const side = Math.max(tm.width, tm.height);
const square = await sharp(trimmed)
  .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 255 } })
  .modulate({ brightness: 1.18 })
  .png()
  .toBuffer();

/** The mark on its native black, at `size` px square. */
const onBlack = (size) => sharp(square).resize(size, size).png().toBuffer();

/**
 * The mark with the black dropped out. Alpha comes from luminance, which is
 * exactly right here: the artwork is pure glow over pure black, so brightness
 * and coverage are the same thing.
 */
const cutout = async (size) => {
  const base = await onBlack(size);
  // The curve has to be steep: a gentle one leaves the black backdrop at a few
  // percent alpha, which reads as a dark square on any surface that is not
  // itself pure black.
  const alpha = await sharp(base)
    .removeAlpha()
    .greyscale()
    .linear(2.1, -34)
    .png()
    .toBuffer();
  return sharp(base).removeAlpha().joinChannel(alpha).png({ compressionLevel: 9 }).toBuffer();
};

const roundedRect = (size, fill) => {
  const r = Math.round(size * 0.2227); // iOS/Android squircle-ish corner radius
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <defs>
         <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
           <stop offset="0" stop-color="${PLATE_TOP}"/>
           <stop offset="0.6" stop-color="${PLATE}"/>
           <stop offset="1" stop-color="#020106"/>
         </linearGradient>
       </defs>
       <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${fill || 'url(#g)'}"/>
     </svg>`
  );
};

/**
 * Full app icon: the mark screened onto the plate. Screen blending keeps the
 * dim grey arm of the vortex, which an alpha cutout all but erases, while the
 * black backdrop still disappears into the near-black plate.
 */
async function appIcon(size, fill = 0.94) {
  const inner = Math.round(size * fill);
  const off = Math.round((size - inner) / 2);
  const lit = await sharp(roundedRect(size))
    .composite([{ input: await onBlack(inner), top: off, left: off, blend: 'screen' }])
    .png()
    .toBuffer();
  // Screening over the transparent corners lights them up again, so re-clip.
  return sharp(lit)
    .composite([{ input: roundedRect(size, '#ffffff'), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

console.log('umbra icons');

const pngs = new Map();
for (const size of PNG_SIZES) {
  // Small sizes lose the mark against the plate rounding, so let them bleed more.
  const buf = await appIcon(size, size <= 48 ? 1.0 : 0.94);
  pngs.set(size, buf);
  await write(join(HERE, 'generated', `umbra-${size}.png`), buf);
}
await write(join(HERE, 'generated', 'umbra-mark-cutout.png'), await cutout(1024));

const master = pngs.get(1024);
const ico = png2icons.createICO(master, png2icons.BICUBIC, 0, false, true);
const icns = png2icons.createICNS(master, png2icons.BICUBIC, 0);
if (!ico || !icns) throw new Error('png2icons failed to produce a container');

await write(join(HERE, 'generated', 'umbra.ico'), ico);
await write(join(HERE, 'generated', 'umbra.icns'), icns);

// --- desktop (electron-builder looks for build/icon.{png,ico,icns}) ---------
await write(join(ROOT, 'desktop', 'build', 'icon.png'), master);
await write(join(ROOT, 'desktop', 'build', 'icon.ico'), ico);
await write(join(ROOT, 'desktop', 'build', 'icon.icns'), icns);
// Assets the browser chrome and the internal pages use.
//
// mark-glow.png is the mark on its native black, meant to be drawn with
// `mix-blend-mode: screen`. That composites it additively, which is what glow
// artwork actually wants: the black surround vanishes exactly, with none of
// the faint grey haze an alpha cutout leaves on a not-quite-black surface.
const rendererAssets = join(ROOT, 'desktop', 'src', 'renderer', 'assets');
await write(join(rendererAssets, 'mark.png'), await cutout(256));
await write(join(rendererAssets, 'mark-glow.png'), await onBlack(256));
await write(join(rendererAssets, 'favicon.png'), await appIcon(32, 1.0));

// --- android ---------------------------------------------------------------
const androidRes = join(ROOT, 'android', 'app', 'src', 'main', 'res');
for (const [dpi, size] of ANDROID_MIPMAPS) {
  const legacy = await appIcon(size, 0.94);
  await write(join(androidRes, `mipmap-${dpi}`, 'ic_launcher.png'), legacy);
  await write(join(androidRes, `mipmap-${dpi}`, 'ic_launcher_round.png'), legacy);

  // Adaptive foreground: 108dp sheet, only the middle 72dp is guaranteed
  // visible, so the mark is drawn at two thirds and left transparent around.
  const sheet = Math.round(size * 2.25);
  const inner = Math.round(sheet * (2 / 3));
  const pad = Math.round((sheet - inner) / 2);
  const fg = await sharp({
    create: { width: sheet, height: sheet, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: await cutout(inner), top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await write(join(androidRes, `mipmap-${dpi}`, 'ic_launcher_foreground.png'), fg);
}

// --- ios -------------------------------------------------------------------
// App Store icons must be square, fully opaque and free of an alpha channel.
const iosIcon = await sharp(await appIcon(1024, 0.94))
  .flatten({ background: PLATE })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toBuffer();
await write(
  join(ROOT, 'ios', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon.png'),
  iosIcon
);

console.log('done');
