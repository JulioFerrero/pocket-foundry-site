// Pocket Foundry's app icon, from the badge's gear wheel (art/badge_sprites.py renders it at 48 pixels): the gear over
// a hearth's pixel fire for releases, and over a blueprint, lifted off it by a hard shadow, for betas. Each layer of
// the adaptive icon becomes a vector drawable of its pixels, so it stays sharp at any size; the gear's silhouette
// makes the themed icon and the notification's; the store icon is the release icon, 8x, and this site's icons too.
//   node art/icon.mjs ../pocketfoundry   (the app's repository)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const APP = process.argv[2];
if (!APP) throw new Error('usage: node art/icon.mjs <the app repository>');
const N = 90; // the grid: the gear is 50 pixels of it with its outline, inside the adaptive icon's safe zone
const gear = 'data:image/png;base64,' + (await readFile('art/out/badge-sprites/gear-48.png')).toString('base64');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const layers = await page.evaluate(async ({ gear, N }) => {
  const load = (s) => new Promise((done) => { const i = new Image(); i.onload = () => done(i); i.src = s; });
  const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const pixels = (c) => Array.from(c.getContext('2d').getImageData(0, 0, N, N).data);
  // The badge's sprite treatment (art/badges.mjs): cut out hard, a few levels per colour, a one-pixel dark outline.
  async function cutOut(src, outline, gain) {
    const image = await load(src);
    const size = image.width + 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const o = cv.getContext('2d'); o.drawImage(image, 1, 1);
    const d = o.getImageData(0, 0, size, size);
    const solid = (x, y) => x >= 0 && y >= 0 && x < size && y < size && d.data[(y * size + x) * 4 + 3] >= 120;
    const r = o.createImageData(size, size);
    const level = (v) => Math.min(255, Math.round((v * gain) / 20) * 20);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (solid(x, y)) r.data.set([level(d.data[i]), level(d.data[i + 1]), level(d.data[i + 2]), 255], i);
      else if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) r.data.set(outline, i);
    }
    o.putImageData(r, 0, 0);
    return cv;
  }
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // Doom's fire, in the badge's fire colours: heat along the bottom; every pixel copies the one below it, a step to
  // either side, cooled by 0 or 1 at random, so flames lick up about twice [levels] rows.
  const FIRE = [null, '#3a1006', '#7a2008', '#c2410c', '#f07a14', '#ffb347', '#ffe07a', '#fff6c8'];
  function fire(c, height) {
    const levels = Math.round(N * height / 2);
    const heat = new Array(N * N).fill(0);
    for (let x = 0; x < N; x++) heat[(N - 1) * N + x] = levels;
    for (let step = 0; step < N * 4; step++) {
      for (let y = 1; y < N; y++) for (let x = 0; x < N; x++) {
        const r = Math.floor(rand() * 4) & 3;
        heat[(y - 1) * N + Math.min(N - 1, Math.max(0, x - r + 1))] = Math.max(0, heat[y * N + x] - (r & 1));
      }
    }
    const top = FIRE.length - 1;
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N; x++) {
      const v = heat[y * N + x] / levels;
      if (v <= 0.04) continue;
      c.fillStyle = FIRE[Math.max(1, Math.min(top, Math.ceil(Math.pow(v, 1.15) * top)))];
      c.fillRect(x, y + 1, 1, 1);
    }
    c.fillStyle = FIRE[top]; c.fillRect(0, N - 1, N, 1);
  }
  // The hearth: dark, warmed from below.
  function hearth(c) {
    for (let y = 0; y < N; y++) {
      const warm = Math.max(0, (y / N - 0.3) / 0.7);
      c.fillStyle = `rgb(${12 + Math.round(warm * 46)},${10 + Math.round(warm * 10)},9)`;
      c.fillRect(0, y, N, 1);
    }
  }
  // The blueprint: dark paper, lighter round the gear in dithered steps, and its grid.
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  function blueprint(c) {
    const tones = ['#041427', '#072040', '#0b2d56', '#10396a'];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - N / 2 + 0.5, y - N / 2 + 0.5) / (N * 0.62);
      const t = Math.max(0, Math.min(1, 1 - r)) * (tones.length - 1) + BAYER[y % 4][x % 4] / 16 - 0.5;
      c.fillStyle = tones[Math.max(0, Math.min(tones.length - 1, Math.round(t)))];
      c.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < N; i += 2) {
      c.fillStyle = i % 10 === 0 ? 'rgba(169,216,242,0.30)' : 'rgba(169,216,242,0.07)';
      c.fillRect(i, 0, 1, N); c.fillRect(0, i, N, 1);
    }
  }

  const sprite = await cutOut(gear, [26, 16, 6, 255], 1.45);
  const at = Math.round((N - sprite.width) / 2);
  const releaseBack = canvas(); hearth(releaseBack.getContext('2d')); fire(releaseBack.getContext('2d'), 0.58);
  const releaseFore = canvas(); releaseFore.getContext('2d').drawImage(sprite, at, at);
  const betaBack = canvas(); blueprint(betaBack.getContext('2d'));
  const betaFore = canvas();
  {
    // A hard pixel shadow down and to the right, as sprites lifted off the ground had.
    const s = document.createElement('canvas'); s.width = s.height = sprite.width;
    const sc = s.getContext('2d'); sc.drawImage(sprite, 0, 0); sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = 'rgba(1,8,18,0.85)'; sc.fillRect(0, 0, s.width, s.height);
    const b = betaFore.getContext('2d'); b.drawImage(s, at + 2, at + 3); b.drawImage(sprite, at, at);
  }
  const release = canvas(); release.getContext('2d').drawImage(releaseBack, 0, 0); release.getContext('2d').drawImage(releaseFore, 0, 0);
  // The gear's silhouette, from the render itself (no outline): its brass, the grey hub and the holes in its web left
  // open, and lone pixels either way cleaned up. Themed icons and the notification are one colour.
  const raw = canvas(); raw.getContext('2d').drawImage(await load(gear), at + 1, at + 1);
  const rd = pixels(raw);
  const brass = (x, y) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    const i = (y * N + x) * 4;
    return rd[i + 3] >= 120 && Math.max(rd[i], rd[i + 1], rd[i + 2]) - Math.min(rd[i], rd[i + 1], rd[i + 2]) >= 30;
  };
  const mask = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => brass(x + dx, y + dy)).length;
    mask.push(brass(x, y) ? around >= 2 : around >= 3 && rd[(y * N + x) * 4 + 3] >= 120);
  }
  const silhouette = mask.flatMap((on) => (on ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  return {
    releaseBack: pixels(releaseBack), releaseFore: pixels(releaseFore), betaBack: pixels(betaBack),
    betaFore: pixels(betaFore), release: pixels(release), silhouette,
  };
}, { gear, N });
await browser.close();

const silhouette = layers.silhouette;

const hex = (r, g, b, a) => '#' + (a < 255 ? [a, r, g, b] : [r, g, b]).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
/**
 * A vector drawable of [px] (RGBA rows, [w] wide): one path per colour, of runs along each row. Each run overlaps the
 * next by a hair, so no seam shows between pixels at sizes that aren't whole multiples.
 */
function vector(px, w, { dp = 108, from = [0, 0, w, px.length / 4 / w], note }) {
  const [x0, y0, vw, vh] = from;
  const runs = new Map();
  for (let y = y0; y < y0 + vh; y++) {
    for (let x = x0; x < x0 + vw;) {
      const i = (y * w + x) * 4;
      const a = px[i + 3];
      let end = x + 1;
      while (end < x0 + vw && [0, 1, 2, 3].every((k) => px[(y * w + end) * 4 + k] === px[i + k])) end++;
      if (a > 0) {
        const colour = hex(px[i], px[i + 1], px[i + 2], a);
        const len = end - x;
        runs.set(colour, (runs.get(colour) ?? '') + `M${x - x0},${y - y0}h${len + 0.04}v1.04h-${len + 0.04}z`);
      }
      x = end;
    }
  }
  const paths = [...runs].map(([colour, d]) => `    <path android:fillColor="${colour}" android:pathData="${d}" />`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${note} Made by pocketfoundry-site's art/icon.mjs, from the 88x31 badge's gear wheel. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${dp}dp" android:height="${dp}dp" android:viewportWidth="${vw}" android:viewportHeight="${vh}">
${paths}
</vector>
`;
}

const res = join(APP, 'app/src/main/res/drawable');
const beta = join(APP, 'app/src/beta/res/drawable');
await mkdir(beta, { recursive: true });
const files = {
  [join(res, 'ic_launcher_background.xml')]: vector(layers.releaseBack, N, { note: "The icon's hearth: a pixel fire under the gear." }),
  [join(res, 'ic_launcher_foreground.xml')]: vector(layers.releaseFore, N, { note: "The icon's brass gear wheel." }),
  [join(res, 'ic_launcher_monochrome.xml')]: vector(silhouette, N, { note: 'Themed icons: the gear wheel in one colour.' }),
  [join(beta, 'ic_launcher_background.xml')]: vector(layers.betaBack, N, { note: "Betas' icon: the gear on a blueprint." }),
  [join(beta, 'ic_launcher_foreground.xml')]: vector(layers.betaFore, N, { note: "Betas' icon: the gear wheel and its shadow." }),
};
// The notification's: the silhouette with only its hub open (at 24dp the small holes would be specks), cropped to the
// gear and a pixel round it.
{
  // The open regions inside the gear: the hub is the biggest, the others get filled.
  const inside = new Int32Array(N * N).fill(-1);
  const sizes = [];
  for (let start = 0; start < N * N; start++) {
    if (silhouette[start * 4 + 3] || inside[start] !== -1) continue;
    const id = sizes.length; let size = 0, outside = false; const stack = [start]; inside[start] = id;
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % N, y = Math.floor(i / N);
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) outside = true;
      for (const j of [i - 1, i + 1, i - N, i + N]) {
        if (j < 0 || j >= N * N || Math.abs((j % N) - x) > 1 || silhouette[j * 4 + 3] || inside[j] !== -1) continue;
        inside[j] = id; stack.push(j);
      }
    }
    sizes.push(outside ? -1 : size);
  }
  const hub = sizes.indexOf(Math.max(...sizes));
  const filled = silhouette.slice();
  for (let i = 0; i < N * N; i++) if (inside[i] >= 0 && sizes[inside[i]] > 0 && inside[i] !== hub) filled.splice(i * 4, 4, 255, 255, 255, 255);

  let [left, top, right, bottom] = [N, N, 0, 0];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (silhouette[(y * N + x) * 4 + 3]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  const side = Math.max(right - left, bottom - top) + 3;
  files[join(res, 'ic_notification.xml')] = vector(filled, N, {
    dp: 24, from: [left - 1, top - 1, side, side], note: "The notification's icon: the gear wheel in one colour.",
  });
}
for (const [file, xml] of Object.entries(files)) {
  await writeFile(file, xml);
  console.log(`${file.slice(APP.length + 1)}: ${(xml.length / 1024).toFixed(1)} KB`);
}
// The store's icon (fastlane, read by F-Droid, the README and the website): the middle 64 pixels of the release icon,
// what a launcher shows of it, at 8x.
const icon = join(APP, 'fastlane/metadata/android/en-US/images/icon.png');
await sharp(Buffer.from(layers.release), { raw: { width: N, height: N, channels: 4 } })
  .extract({ left: 13, top: 13, width: 64, height: 64 })
  .resize(512, 512, { kernel: 'nearest' }).png({ compressionLevel: 9 }).toFile(icon);
console.log(`${icon.slice(APP.length + 1)}: 512x512`);
// The site's: the same, for the header's name plate and the browsers' tabs and home screens.
await sharp(icon).toFile('src/assets/icon.png');
await sharp(icon).toFile('public/icon-512.png');
await sharp(icon).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(icon).resize(32, 32).png().toFile('public/favicon-32.png');
console.log('the site: src/assets/icon.png, public/icon-512.png, apple-touch-icon.png, favicon-32.png');
