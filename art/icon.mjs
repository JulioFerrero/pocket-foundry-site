// Pocket Foundry's app icon, from the badge's gear wheel (art/badge_sprites.py renders it at 48 pixels): the gear over
// a hearth's pixel fire for releases, and over a blueprint, lifted off it by a hard shadow, for betas. Each layer of
// the adaptive icon becomes a vector drawable of its pixels, so it stays sharp at any size. The themed icon is the
// same gear without pixels, projected from the sprite's model: launchers show it big and flat, where the pixel
// silhouette was hard to look at. The notification's is the pixel silhouette; the store icon is the release icon,
// 8x, and this site's icons too, with its tab icon animated: the gear turning over a burning fire.
//   node art/icon.mjs ../pocketfoundry   (the app's repository)
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const APP = process.argv[2];
if (!APP) throw new Error('usage: node art/icon.mjs <the app repository>');
const N = 90; // the grid: the gear is 50 pixels of it with its outline, inside the adaptive icon's safe zone
// The gear's 48-pixel turn; its first frame is the icon's pose.
const SPRITES = 'art/out/badge-sprites/gear-48';
const gears = await Promise.all((await readdir(SPRITES)).sort().map(async (f) => 'data:image/png;base64,' + (await readFile(join(SPRITES, f))).toString('base64')));
const gear = gears[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const layers = await page.evaluate(async ({ gears, N }) => {
  const gear = gears[0];
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
  const flicker = () => Math.floor(rand() * 4) & 3;
  // Doom's fire, in the badge's fire colours: heat along the bottom; each step every pixel copies the one below it, a
  // step to either side, cooled by 0 or 1 at random ([pick] gives each pixel's 0-3), so flames lick up about twice
  // [levels] rows.
  const FIRE = [null, '#3a1006', '#7a2008', '#c2410c', '#f07a14', '#ffb347', '#ffe07a', '#fff6c8'];
  function flames(height) {
    const levels = Math.round(N * height / 2);
    const heat = new Array(N * N).fill(0);
    for (let x = 0; x < N; x++) heat[(N - 1) * N + x] = levels;
    const step = (pick) => {
      for (let y = 1; y < N; y++) for (let x = 0; x < N; x++) {
        const r = pick(y * N + x);
        heat[(y - 1) * N + Math.min(N - 1, Math.max(0, x - r + 1))] = Math.max(0, heat[y * N + x] - (r & 1));
      }
    };
    const draw = (c) => {
      const top = FIRE.length - 1;
      for (let y = 0; y < N - 1; y++) for (let x = 0; x < N; x++) {
        const v = heat[y * N + x] / levels;
        if (v <= 0.04) continue;
        c.fillStyle = FIRE[Math.max(1, Math.min(top, Math.ceil(Math.pow(v, 1.15) * top)))];
        c.fillRect(x, y + 1, 1, 1);
      }
      c.fillStyle = FIRE[top]; c.fillRect(0, N - 1, N, 1);
    };
    return { step, draw };
  }
  function fire(c, height) {
    const f = flames(height);
    for (let step = 0; step < N * 4; step++) f.step(flicker);
    f.draw(c);
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
  // The release icon turning, for the site's tab: the fire's random numbers repeat each loop, so once it has burnt in
  // (more steps than the fire is rows tall) it loops as exactly as the gear does.
  const STEPS = 2; // fire steps a frame
  const randoms = Array.from({ length: gears.length * STEPS }, () => Array.from({ length: N * N }, flicker));
  const loop = flames(0.58);
  let tick = 0;
  const burn = () => { const r = randoms[tick++ % randoms.length]; loop.step((i) => r[i]); };
  while (tick < randoms.length * 4) burn();
  const turning = [];
  for (const src of gears) {
    for (let s = 0; s < STEPS; s++) burn();
    const frame = canvas(); const c = frame.getContext('2d');
    hearth(c); loop.draw(c); c.drawImage(await cutOut(src, [26, 16, 6, 255], 1.45), at, at);
    turning.push(pixels(frame));
  }
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
    betaFore: pixels(betaFore), release: pixels(release), silhouette, turning,
  };
}, { gears, N });
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

/**
 * The themed icon: the sprite's gear without its pixels. art/badge_sprites.py's model (eight blunt teeth extruded 0.3,
 * a steel hub standing 0.17 above the web, four holes) through its camera (orthographic, 28 degrees off straight down,
 * scale 2.2, aimed 0.1 up) in the icon's pose (turned -30 degrees), projected to flat shapes where icon.mjs puts the
 * 48-pixel sprite. Change one and change the other. One colour, so the 3D is in tones: the web solid, the hub's top
 * lighter, the side walls lighter still.
 */
function gearIn3D({ wall = 0.5, hubTop = 0.7, ring = 64 } = {}) {
  const tilt = (28 * Math.PI) / 180, scale = 2.2, aim = 0.1 * Math.sin(tilt), turn = -Math.PI / 6;
  const project = ([x, y, z]) => {
    const up = y * Math.cos(tilt) + z * Math.sin(tilt);
    return [(21 + 24 + (x * 48) / scale) * 1.2, (21 + 24 - ((up - aim) * 48) / scale) * 1.2];
  };
  const turned = ([x, y]) => [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)];
  const shape = (points) => `M${points.map((p) => p.map((v) => +v.toFixed(3)).join(',')).join('L')}Z`;
  const circle = ([cx, cy], r, z, from = 0, to = 2 * Math.PI) => Array.from({ length: ring + 1 }, (_, k) => {
    const a = from + ((to - from) * k) / ring;
    return project([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
  });
  const outline = [];
  for (let i = 0; i < 8; i++) for (const [o, r] of [[-0.3, 0.72], [-0.2, 1], [0.2, 1], [0.3, 0.72]]) {
    const a = ((i + o) / 8) * 2 * Math.PI;
    outline.push(turned([Math.cos(a) * r, Math.sin(a) * r]));
  }
  // The side walls that face the camera: drawn first, the web over them. All wind the same way, so one path fills
  // their union at one tone.
  const walls = outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length];
    return q[0] - p[0] > 0 ? shape([project([...p, 0.3]), project([...q, 0.3]), project([...q, 0]), project([...p, 0])]) : '';
  }).join('');
  const holes = [0, 1, 2, 3].map((i) => {
    const a = ((i + 0.5) / 4) * 2 * Math.PI;
    return shape(circle(turned([Math.cos(a) * 0.5, Math.sin(a) * 0.5]), 0.13, 0.3));
  }).join('');
  // The hub: its outline is cut out of the web (even-odd, with the holes), then filled by its top and its front side.
  const front = circle([0, 0], 0.26, 0.3, Math.PI, 2 * Math.PI);
  const hub = shape([...front, ...circle([0, 0], 0.26, 0.47, 0, Math.PI)]);
  const side = shape([...front, ...circle([0, 0], 0.26, 0.47, 2 * Math.PI, Math.PI)]);
  const path = (d, alpha, more = '') => `    <path android:fillColor="#FFFFFF"${alpha < 1 ? ` android:fillAlpha="${alpha}"` : ''}${more} android:pathData="${d}" />`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Themed icons: the gear wheel in one colour, its 3D in tones. Made by pocketfoundry-site's art/icon.mjs. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
${path(walls, wall)}
${path(shape(outline.map(([x, y]) => project([x, y, 0.3]))) + hub + holes, 1, ' android:fillType="evenOdd"')}
${path(side, wall)}
${path(shape(circle([0, 0], 0.26, 0.47)), hubTop)}
</vector>
`;
}

const res = join(APP, 'app/src/main/res/drawable');
const beta = join(APP, 'app/src/beta/res/drawable');
await mkdir(beta, { recursive: true });
const files = {
  [join(res, 'ic_launcher_background.xml')]: vector(layers.releaseBack, N, { note: "The icon's hearth: a pixel fire under the gear." }),
  [join(res, 'ic_launcher_foreground.xml')]: vector(layers.releaseFore, N, { note: "The icon's brass gear wheel." }),
  [join(res, 'ic_launcher_monochrome.xml')]: gearIn3D(),
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
// What a launcher shows of an icon: its middle 64 pixels, here at 8x.
const shown = (px) => sharp(Buffer.from(px), { raw: { width: N, height: N, channels: 4 } })
  .extract({ left: 13, top: 13, width: 64, height: 64 })
  .resize(512, 512, { kernel: 'nearest' }).png({ compressionLevel: 9 });
// The store's icon (fastlane, read by F-Droid, the README and the website): the release icon, shown.
const icon = join(APP, 'fastlane/metadata/android/en-US/images/icon.png');
await shown(layers.release).toFile(icon);
console.log(`${icon.slice(APP.length + 1)}: 512x512`);
// The site's: the same, for the header's name plate and the browsers' tabs and home screens.
await sharp(icon).toFile('src/assets/icon.png');
await sharp(icon).toFile('public/icon-512.png');
await sharp(icon).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(icon).resize(32, 32).png().toFile('public/favicon-32.png');
// The tab icon's frames side by side, each made like favicon-32.png, for the site's layout to play.
const frames = await Promise.all(layers.turning.map(async (px) => sharp(await shown(px).toBuffer()).resize(32, 32).png().toBuffer()));
await sharp({ create: { width: 32 * frames.length, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(frames.map((input, i) => ({ input, left: 32 * i, top: 0 }))).png({ compressionLevel: 9 }).toFile('public/favicon-frames.png');
console.log('the site: src/assets/icon.png, public/icon-512.png, apple-touch-icon.png, favicon-32.png, favicon-frames.png');
