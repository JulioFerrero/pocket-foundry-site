// The 88x31 buttons, the 90s web's kind, made the way those were: pixel by pixel, a few colours, dithered gradients,
// one-pixel bevels and a small thing moving in each. Drawn frame by frame on a canvas in headless Chrome: the titles
// in the Silkscreen pixel font snapped to whole pixels, the small print in a 3x5 font drawn here, the gear wheel and
// the monkey head pre-rendered in Blender (art/badge_sprites.py). ffmpeg makes each loop a GIF with one palette and
// no dithering of its own. Each also gets a still PNG, its best frame, for people who turn animations off.
//   node art/badges.mjs   ->   public/badges/<name>.gif and <name>.png
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const font = (await readFile('node_modules/@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff2')).toString('base64');
const sprite = async (name, count) => {
  const list = [];
  for (let i = 1; i <= count; i++) {
    list.push('data:image/png;base64,' + (await readFile(`art/out/badge-sprites/${name}/${String(i).padStart(2, '0')}.png`)).toString('base64'));
  }
  return list;
};
const sprites = { gear: await sprite('gear', 12), monkey: await sprite('monkey', 24) };

// Each button: how many frames its loop has, how long a frame lasts (hundredths of a second, a GIF's unit), and
// which frame is the still.
const BADGES = {
  'pocket-foundry': { frames: 36, delay: 8, still: 20 },
  'no-emulation': { frames: 24, delay: 8, still: 0 },
  gpl: { frames: 16, delay: 10, still: 0 },
  android: { frames: 42, delay: 16, still: 0 },
  obtainium: { frames: 24, delay: 10, still: 4 },
  fps: { frames: 44, delay: 2, still: 40 },  // 50 frames a second, as fast as a GIF goes: the button keeps its word
  blender: { frames: 24, delay: 10, still: 20 },
  'no-tracking': { frames: 24, delay: 8, still: 3 },
};

const page = await (await chromium.launch({ channel: 'chrome' })).newPage();
await page.setContent(`<style>@font-face { font-family: Pixel; src: url(data:font/woff2;base64,${font}); }</style>
  <canvas id="c" width="88" height="31"></canvas>`);
await page.evaluate(() => document.fonts.load('8px Pixel'));

const frames = await page.evaluate(
  async ({ BADGES, sprites }) => {
    const W = 88;
    const H = 31;
    const canvas = document.getElementById('c');
    const c = canvas.getContext('2d', { willReadFrequently: true });

    // ---- pixels -------------------------------------------------------------------------------------------------
    const rect = (x, y, w, h, colour) => {
      c.fillStyle = colour;
      c.fillRect(x, y, w, h);
    };
    const px = (x, y, colour) => rect(x, y, 1, 1, colour);
    /** The same grain every time: a number from 0 to 1 for a pixel. */
    const grain = (x, y, seed = 0) => {
      const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
      return n - Math.floor(n);
    };
    const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    /** A gradient down a rectangle through [stops], in those colours only, ordered-dithered between them. */
    function dither(x0, y0, w, h, stops) {
      for (let y = y0; y < y0 + h; y++) {
        const t = ((y - y0) / Math.max(1, h - 1)) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(t));
        // Flat bands of each colour, dithered only where one gives way to the next.
        const mix = Math.min(1, Math.max(0, (t - i - 0.5) * 2.4 + 0.5));
        for (let x = x0; x < x0 + w; x++) px(x, y, mix * 16 > BAYER[y & 3][x & 3] + 0.5 ? stops[i + 1] : stops[i]);
      }
    }
    /** A one-pixel bevel round a rectangle: [light] above and left, [dark] below and right. */
    function bevel(light, dark, x = 0, y = 0, w = W, h = H) {
      rect(x, y, w, 1, light);
      rect(x, y, 1, h, light);
      rect(x, y + h - 1, w, 1, dark);
      rect(x + w - 1, y, 1, h, dark);
    }
    /** Speckle: some pixels of a rectangle a little darker, some a little lighter. */
    function grit(x0, y0, w, h, amount = 0.1, seed = 0) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const n = grain(x, y, seed);
          if (n < amount) px(x, y, 'rgba(0,0,0,0.16)');
          else if (n > 1 - amount * 0.6) px(x, y, 'rgba(255,255,255,0.10)');
        }
      }
    }
    function rivet(x, y, light, mid, dark) {
      rect(x, y, 2, 2, mid);
      px(x, y, light);
      px(x + 1, y + 1, dark);
      px(x + 2, y + 1, 'rgba(0,0,0,0.35)');
      px(x + 1, y + 2, 'rgba(0,0,0,0.35)');
      px(x + 2, y + 2, 'rgba(0,0,0,0.35)');
    }
    /** A filled polygon with hard edges: every pixel whose centre is inside. */
    function poly(points, colour) {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
        for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
          let inside = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i];
            const [xj, yj] = points[j];
            if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) px(x, y, colour);
        }
      }
    }
    /** A little picture from rows of letters, each letter a colour of [palette]; a dot is nothing. */
    function stamp(rows, x, y, palette) {
      rows.forEach((row, dy) => [...row].forEach((letter, dx) => {
        if (palette[letter]) px(x + dx, y + dy, palette[letter]);
      }));
    }

    // ---- lettering ----------------------------------------------------------------------------------------------
    // The small print: capitals three pixels wide and five tall (M, N and W wider), drawn here.
    const TINY = {
      A: '.#./#.#/###/#.#/#.#', B: '##./#.#/##./#.#/##.', C: '.##/#../#../#../.##', D: '##./#.#/#.#/#.#/##.',
      E: '###/#../##./#../###', F: '###/#../##./#../#..', G: '.##/#../#.#/#.#/.##', H: '#.#/#.#/###/#.#/#.#',
      I: '#/#/#/#/#', J: '..#/..#/..#/#.#/.#.', K: '#.#/#.#/##./#.#/#.#', L: '#../#../#../#../###',
      M: '#...#/##.##/#.#.#/#...#/#...#', N: '#..#/##.#/#.##/#..#/#..#', O: '.#./#.#/#.#/#.#/.#.',
      P: '##./#.#/##./#../#..', Q: '.#./#.#/#.#/.#./..#', R: '##./#.#/##./#.#/#.#', S: '.##/#../.#./..#/##.',
      T: '###/.#./.#./.#./.#.', U: '#.#/#.#/#.#/#.#/###', V: '#.#/#.#/#.#/#.#/.#.',
      W: '#...#/#...#/#.#.#/##.##/#...#', X: '#.#/#.#/.#./#.#/#.#', Y: '#.#/#.#/.#./.#./.#.',
      Z: '###/..#/.#./#../###',
      0: '###/#.#/#.#/#.#/###', 1: '.#./##./.#./.#./###', 2: '###/..#/###/#../###', 3: '###/..#/.##/..#/###',
      4: '#.#/#.#/###/..#/..#', 5: '###/#../###/..#/###', 6: '###/#../###/#.#/###', 7: '###/..#/..#/.#./.#.',
      8: '###/#.#/###/#.#/###', 9: '###/#.#/###/..#/###',
      ' ': '../../../../..', '.': './././././#', ':': './#/./#/.', '-': '.../.../###/.../...', '+': '.../.#./###/.#./...',
      '%': '#..#/..#./.##./.#../#..#', '>': '#../.#./..#/.#./#..', '!': '#/#/#/./#', '/': '..#/..#/.#./#../#..',
      _: '.../.../.../.../###',
    };
    /** The pixels of [s], from the top left of its ink: in the small print, or in Silkscreen at [size] (8 or 16). */
    function letters(s, size = 0) {
      const points = [];
      if (!size) {
        let x = 0;
        for (const letter of s) {
          const rows = TINY[letter].split('/');
          rows.forEach((row, dy) => [...row].forEach((dot, dx) => dot === '#' && points.push([x + dx, dy])));
          x += rows[0].length + 1;
        }
        return { points, width: x - 1, height: 5 };
      }
      const scratch = document.createElement('canvas');
      scratch.width = 160;
      scratch.height = 40;
      const t = scratch.getContext('2d');
      t.font = `${size}px Pixel`;
      t.textBaseline = 'top';
      t.fillStyle = '#fff';
      t.fillText(s, 4, 4);
      const image = t.getImageData(0, 0, 160, 40);
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 160; x++) if (image.data[(y * 160 + x) * 4 + 3] >= 110) points.push([x, y]);
      }
      const left = Math.min(...points.map((p) => p[0]));
      const top = Math.min(...points.map((p) => p[1]));
      for (const p of points) {
        p[0] -= left;
        p[1] -= top;
      }
      return { points, width: Math.max(...points.map((p) => p[0])) + 1, height: Math.max(...points.map((p) => p[1])) + 1 };
    }
    /**
     * Lettering at x, y (the top left of its ink; x 'centre' centres it between [left] and [right]). [fill] is a
     * colour, a list of colours down its rows, or a function of a pixel; [shadow] a colour one pixel down and
     * right; [glow] a colour one pixel all round. Returns where it ended up.
     */
    function write(s, x, y, fill, { size = 0, shadow, glow, left = 0, right = W } = {}) {
      const ink = letters(s, size);
      if (x === 'centre') x = Math.round(left + (right - left - ink.width) / 2);
      if (glow) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) for (const [a, b] of ink.points) px(x + a + dx, y + b + dy, glow);
      if (shadow) for (const [a, b] of ink.points) px(x + a + 1, y + b + 1, shadow);
      for (const [a, b] of ink.points) {
        const colour = typeof fill === 'function' ? fill(a, b, x + a, y + b)
          : Array.isArray(fill) ? fill[Math.min(fill.length - 1, Math.floor((b / ink.height) * fill.length))] : fill;
        px(x + a, y + b, colour);
      }
      return { x, y, width: ink.width, height: ink.height };
    }

    // ---- sprites from Blender ---------------------------------------------------------------------------------------
    // Cut out hard (a pixel is there or is not) and given a one-pixel dark outline, as a sprite sheet's were.
    async function cutOut(src, outline, gain = 1) {
      const image = await new Promise((done) => {
        const i = new Image();
        i.onload = () => done(i);
        i.src = src;
      });
      const size = image.width + 2;
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const o = out.getContext('2d');
      o.drawImage(image, 1, 1);
      const data = o.getImageData(0, 0, size, size);
      const solid = (x, y) => x >= 0 && y >= 0 && x < size && y < size && data.data[(y * size + x) * 4 + 3] >= 120;
      const result = o.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          if (solid(x, y)) {
            // A few levels of each colour only: flatter, more like a hand-made sprite, and a smaller GIF.
            const level = (v) => Math.min(255, Math.round((v * gain) / 20) * 20);
            result.data.set([level(data.data[i]), level(data.data[i + 1]), level(data.data[i + 2]), 255], i);
          } else if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
            result.data.set(outline, i);
          }
        }
      }
      o.putImageData(result, 0, 0);
      return out;
    }
    const gear = await Promise.all(sprites.gear.map((src) => cutOut(src, [26, 16, 6, 255], 1.45)));
    const monkey = await Promise.all(sprites.monkey.map((src) => cutOut(src, [24, 24, 26, 255])));

    // ---- the buttons ------------------------------------------------------------------------------------------------
    const draw = {
      // An iron plate, riveted; the brass gear wheel turning over the foundry's fire; a glint crossing the name.
      'pocket-foundry'(f) {
        dither(0, 0, W, H, ['#858f98', '#6a747d', '#4c545c']);
        grit(1, 1, 86, 29, 0.05, 1);
        bevel('#c3ccd4', '#15181b');
        rect(1, 29, 86, 1, 'rgba(0,0,0,0.25)');
        rect(1, 1, 86, 1, 'rgba(255,255,255,0.18)');
        // The hearth: a sunk square, embers glowing at the bottom of it, flickering.
        rect(2, 2, 27, 27, '#0e0b0a');
        rect(2, 2, 27, 1, '#000000');
        rect(2, 2, 1, 27, '#000000');
        rect(29, 2, 1, 28, '#aab3bb');
        const flicker = Math.floor(f / 3) % 4;
        for (let y = 19; y < 29; y++) {
          for (let x = 3; x < 29; x++) {
            const level = (y - 19) / 9 + (grain(x, y, flicker) - 0.5) * 0.5 + [0, 0.08, -0.04, 0.05][flicker];
            const colour = level > 1.02 ? '#ffc35a' : level > 0.8 ? '#f07a14' : level > 0.55 ? '#a8380a' : level > 0.3 ? '#4a1a08' : null;
            if (colour) px(x, y, colour);
          }
        }
        c.drawImage(gear[f % 12], 1, 1);
        // Sparks thrown off to the right, twice a loop.
        for (const [start, vx, vy, y0] of [[2, 1.5, -1.1, 19], [5, 1.1, -1.5, 22], [20, 1.3, -1.3, 20], [23, 1.7, -0.8, 23], [25, 0.9, -1.6, 18]]) {
          const age = f - start;
          if (age < 0 || age > 5) continue;
          const x = Math.round(27 + vx * age);
          const y = Math.round(y0 + vy * age + 0.22 * age * age);
          px(x, y, ['#fff6c8', '#ffe07a', '#ffb347', '#ff8a2a', '#c2410c', '#7a2a0a'][age]);
        }
        rivet(83, 3, '#dfe6ec', '#9aa4ad', '#4b535b');
        rivet(83, 25, '#dfe6ec', '#9aa4ad', '#4b535b');
        // The glint: a slanted band of light that crosses the letters once a loop.
        const band = (f - 10) * 6 + 30;
        const lit = (x, y) => x + y >= band && x + y < band + 5;
        write('POCKET', 33, 6, (a, b, x, y) => (lit(x, y) ? '#fffbe6' : b < 2 ? '#ffe9a3' : b < 4 ? '#f2c14e' : '#c98f22'), { size: 8, shadow: '#1c1408' });
        write('FOUNDRY', 33, 17, (a, b, x, y) => (lit(x, y) ? '#ffffff' : b < 2 ? '#f4f7f9' : b < 4 ? '#d3dae0' : '#a3adb6'), { size: 8, shadow: '#15181b' });
      },

      // A warning plate, and under it a transport belt carrying gear wheels and plates: the real thing, running.
      'no-emulation'(f) {
        dither(0, 0, W, 17, ['#ffd84f', '#f5bd2e', '#dfa01c']);
        grit(1, 1, 86, 15, 0.03, 2);
        bevel('#fff3b8', '#3a2600');
        for (const x0 of [2, 81]) {
          for (let y = 2; y < 15; y++) for (let x = x0; x < x0 + 5; x++) px(x, y, (x + y) % 6 < 3 ? '#17140c' : '#ffd84f');
        }
        write('NO EMULATION', 'centre', 3, '#17140c', { size: 8, shadow: '#ffe98f' });
        write('100% NATIVE CODE', 'centre', 10, '#4f3604');
        // The belt, seen from above: steel rails, rubber, yellow chevrons, two pixels along each frame.
        rect(1, 16, 86, 1, '#3a2600');
        rect(1, 17, 86, 1, '#9aa3ab');
        rect(1, 18, 86, 1, '#4a5158');
        rect(1, 19, 86, 9, '#24282c');
        for (let x = 1; x < 87; x++) if ((x + 86 - f * 2) % 4 === 0) px(x, 18, '#262a2e');
        rect(1, 28, 86, 1, '#5a626a');
        rect(1, 29, 86, 1, '#17191c');
        const shift = (f * 2) % 48;
        for (let x = -8 + (shift % 8); x < W; x += 8) {
          for (let i = 0; i < 4; i++) {
            for (const y of [20 + i, 26 - i]) {
              if (x + i >= 1 && x + i < 86) rect(x + i, y, 2, 1, i === 3 ? '#c99a1e' : '#8a6814');
            }
          }
        }
        const things = [
          [['.b.b.b.', 'bbbbbbb', '.bbkbb.', 'bbkkkbb', '.mmkmm.', 'mmmmmmm', '.d.d.d.'], { b: '#ffd46a', m: '#d9a63a', d: '#8a6418', k: '#2a2010' }],
          [['..lllll', '.lllllm', 'lllllmm', 'mmmmmmd', 'ddddddd', '.kkkkkk'], { l: '#ffb48a', m: '#d9774a', d: '#8a3f1c', k: 'rgba(0,0,0,0.45)' }],
          [['..lllll', '.lllllm', 'lllllmm', 'mmmmmmd', 'ddddddd', '.kkkkkk'], { l: '#eef2f5', m: '#a9b3bc', d: '#5b646c', k: 'rgba(0,0,0,0.45)' }],
        ];
        for (let i = -1; i < 7; i++) {
          const x = -17 + shift + i * 16;
          if (x < -7 || x > W) continue;
          const [rows, palette] = things[(((i - Math.floor(0)) % 3) + 3) % 3];
          stamp(rows, x, rows.length === 7 ? 20 : 21, palette);
        }
        rect(0, 16, 1, 15, '#fff3b8');
        rect(87, 16, 1, 15, '#3a2600');
        rect(0, 30, 88, 1, '#3a2600');
      },

      // A blueprint: the licence drawn in white line on the grid, selected by a marquee of marching ants.
      gpl(f) {
        dither(0, 0, W, H, ['#1f63a3', '#164a7e', '#103b68']);
        for (let x = 3; x < W; x += 4) rect(x, 1, 1, 29, x % 12 === 3 ? 'rgba(185,220,246,0.20)' : 'rgba(185,220,246,0.09)');
        for (let y = 3; y < H; y += 4) rect(1, y, 86, 1, y % 12 === 3 ? 'rgba(185,220,246,0.20)' : 'rgba(185,220,246,0.09)');
        bevel('#b9dcf6', '#b9dcf6');
        bevel('#0b2a4a', '#0b2a4a', 1, 1, 86, 29);
        const title = write('GPL-3.0', 'centre', 5, (a, b) => (b < 5 ? '#ffffff' : '#d5ebfb'), { size: 16, shadow: '#082340' });
        // The ants: a dashed box round the title, its dashes walking clockwise.
        const [x0, y0, x1, y1] = [title.x - 3, 3, title.x + title.width + 2, 17];
        const path = [];
        for (let x = x0; x < x1; x++) path.push([x, y0]);
        for (let y = y0; y < y1; y++) path.push([x1, y]);
        for (let x = x1; x > x0; x--) path.push([x, y1]);
        for (let y = y1; y > y0; y--) path.push([x0, y]);
        path.forEach(([x, y], i) => px(x, y, (((i - f) % 4) + 4) % 4 < 2 ? '#ffffff' : '#0b2a4a'));
        // A dimension line under it, the way a drawing gives a measure.
        const note = write('FREE SOFTWARE', 'centre', 22, '#9fd4f7', { shadow: '#082340' });
        for (const [from, to, tip] of [[x0, note.x - 3, x0], [note.x + note.width + 2, x1, x1]]) {
          rect(from, 24, to - from + 1, 1, '#6fb2df');
          rect(tip, 22, 1, 5, '#b9dcf6');
        }
        px(x0 + 1, 23, '#6fb2df'); px(x0 + 1, 25, '#6fb2df'); px(x1 - 1, 23, '#6fb2df'); px(x1 - 1, 25, '#6fb2df');
      },

      // A circuit board, and a phone on it counting the versions up: 10, 11, 12 ... and on.
      android(f) {
        dither(0, 0, W, H, ['#2f8a4c', '#226b39', '#174f29']);
        // Traces and vias, in the lighter green of copper under the mask, and gold where it is bare.
        const trace = '#3fa35e';
        const run = (points) => {
          for (let i = 0; i < points.length - 1; i++) {
            let [x, y] = points[i];
            const [tx, ty] = points[i + 1];
            for (;;) {
              px(x, y, trace);
              if (x === tx && y === ty) break;
              x += Math.sign(tx - x);
              y += Math.sign(ty - y);
            }
          }
        };
        run([[19, 3], [40, 3], [43, 6], [60, 6]]);
        run([[66, 3], [84, 3]]);
        run([[20, 27], [34, 27], [37, 24], [60, 24], [63, 27], [72, 27]]);
        run([[19, 14], [24, 14]]);
        run([[75, 12], [84, 12]]);
        run([[84, 3], [84, 12]]);
        for (const [x, y] of [[61, 5], [66, 2], [73, 26], [84, 13]]) {
          rect(x, y, 3, 3, '#f2d675');
          px(x + 1, y + 1, '#174f29');
          px(x + 2, y + 2, '#b08d2c');
        }
        bevel('#8fe0a6', '#0a2814');
        // The phone.
        rect(4, 3, 13, 25, '#111417');
        for (const [x, y] of [[4, 3], [16, 3], [4, 27], [16, 27]]) px(x, y, '#1d5a31');
        rect(4, 4, 1, 23, '#4b535b');
        rect(5, 3, 11, 1, '#4b535b');
        rect(17, 5, 1, 23, 'rgba(0,0,0,0.35)');
        rect(6, 28, 11, 1, 'rgba(0,0,0,0.35)');
        rect(6, 6, 9, 18, '#164a7e');
        rect(6, 6, 9, 1, '#2a6fb0');
        px(10, 4, f % 6 < 3 ? '#7dff9a' : '#1f7a3c');
        rect(9, 25, 3, 1, '#4b535b');
        const second = Math.floor(f / 6);
        const slide = f % 6 === 0 ? 1 : 0;  // each number drops in from a pixel above
        write(String(10 + second), 7, 8 - slide, '#ffffff');
        // An arrow climbing the screen.
        const climb = 20 - (f % 6);
        for (const [dx, dy] of [[2, 0], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [2, 3], [2, 4]]) {
          const y = climb + dy;
          if (y >= 15 && y < 24) px(8 + dx, y, '#7dff9a');
        }
        write('ANDROID', 21, 7, (a, b) => (b < 3 ? '#ffffff' : '#d2f7d6'), { size: 8, shadow: '#0a2814' });
        write('10 AND UP', 21, 17, '#b6f2bf', { size: 8, shadow: '#0a2814' });
        // Chevrons lighting one after another, upwards.
        for (let i = 0; i < 3; i++) {
          const on = Math.floor(f / 2) % 3 === 2 - i;
          const y = 16 + i * 3;
          const colour = on ? '#ffffff' : '#49a865';
          px(81, y, colour);
          rect(80, y + 1, 3, 1, colour);
          px(79, y + 2, colour); px(83, y + 2, colour);
        }
      },

      // A cluster of obtainium crystals, twinkling, and an arrow that says where to get the app.
      obtainium(f) {
        dither(0, 0, W, H, ['#7450b8', '#4f3288', '#2c1b52']);
        grit(1, 1, 86, 29, 0.04, 5);
        bevel('#c3a8ff', '#120a26');
        // The rock they grow from.
        poly([[2, 28], [4, 23], [9, 21], [20, 21], [25, 24], [27, 28]], '#1c1233');
        poly([[4, 28], [6, 24], [10, 23], [19, 23], [23, 26], [24, 28]], '#2a1c47');
        // Three crystals: each a lit face, a shaded face, and a bright edge between.
        const crystal = (tip, left, right, footLeft, footRight, ridge, foot) => {
          poly([tip, left, footLeft, foot, ridge], '#d9a8ff');
          poly([tip, ridge, foot, footRight, right], '#8a3fd1');
          poly([tip, left, ridge], '#f3dcff');
          poly([tip, ridge, right], '#b266f0');
        };
        crystal([7, 9], [4, 13], [9, 14], [6, 24], [11, 24], [6.5, 14], [8.5, 24]);
        crystal([22, 11], [19, 14], [25, 15], [18, 24], [23, 24], [21.5, 15.5], [20.5, 24]);
        crystal([14.5, 2], [10, 8], [19, 8], [10, 25], [19, 25], [13.5, 9], [13.5, 25]);
        for (let y = 9; y < 25; y++) px(13, y, '#fbf0ff');
        px(18, 12, '#5a1f9a'); px(18, 16, '#5a1f9a'); px(17, 20, '#5a1f9a');
        // Twinkles: four-pointed stars that open and close, each in its own time.
        for (const [x, y, start] of [[11, 6, 0], [23, 13, 8], [5, 17, 15], [17, 20, 19]]) {
          const age = (f - start + 24) % 24;
          const size = [1, 2, 3, 2, 1][age] ?? 0;
          if (!size) continue;
          for (let i = 1; i < size; i++) {
            for (const [dx, dy] of [[i, 0], [-i, 0], [0, i], [0, -i]]) px(x + dx, y + dy, i === 1 ? '#ffffff' : '#e9ccff');
          }
          px(x, y, '#ffffff');
        }
        write('GET IT WITH', 30, 7, '#e6d6ff', { shadow: '#1c1038' });
        write('OBTAINIUM', 30, 16, (a, b) => (b < 2 ? '#ffffff' : b < 4 ? '#eadcff' : '#c9a6ff'), { size: 8, shadow: '#120a26' });
        // The download arrow, dropping into its tray.
        const drop = [0, 0, 1, 2, 3, 3, 2, 1][Math.floor(f / 1.5) % 8];
        const gold = '#ffd76a';
        rect(81, 2 + drop, 2, 3, gold);
        rect(79, 5 + drop, 6, 1, gold);
        rect(80, 6 + drop, 4, 1, gold);
        rect(81, 7 + drop, 2, 1, '#d9a63a');
        rect(78, 12, 8, 1, gold);
        px(78, 11, gold); px(85, 11, gold);
        rect(79, 13, 8, 1, 'rgba(0,0,0,0.4)');
      },

      // An amber monitor, scan lines and all. The loop runs at 50 frames a second, the most a GIF can do.
      fps(f) {
        rect(0, 0, W, H, '#0a0703');
        for (let y = 1; y < 30; y += 2) rect(1, y, 86, 1, '#130d04');
        // The beam's bright band rolling down the tube.
        const beam = f - 6;
        for (let i = 0; i < 4; i++) if (beam + i >= 1 && beam + i < 30) rect(1, beam + i, 86, 1, ['#1c1305', '#2a1c07', '#3a270a', '#241806'][i]);
        const amber = (a, b, x, y) => (y >= beam && y < beam + 4 ? '#fff0b8' : y % 2 ? '#ffb92e' : '#e89b12');
        write('BEST VIEWED AT', 'centre', 3, (a, b, x, y) => (y >= beam && y < beam + 4 ? '#ffd76a' : y % 2 ? '#c98a14' : '#a8700c'));
        write('60 FPS', 'centre', 10, amber, { size: 16, glow: '#4a2f05' });
        // A runner along the bottom: one tick to the next every frame, smooth as promised.
        for (let x = 4; x < 84; x += 2) px(x, 25, '#4a2f05');
        const at = 4 + ((f * 2) % 80);
        for (let i = 0; i < 5; i++) {
          const x = at - i * 2;
          px(x < 4 ? x + 80 : x, 25, ['#fff0b8', '#ffb92e', '#c98a14', '#8a5c0c', '#63420a'][i]);
        }
        // The tube's glass: a plastic bezel with rounded corners, and the corners of the picture dimmed.
        bevel('#5d5a52', '#1d1b17');
        for (const [x, y] of [[1, 1], [86, 1], [1, 29], [86, 29]]) px(x, y, '#3a3832');
        for (const [x, y] of [[2, 1], [1, 2], [85, 1], [86, 2], [1, 28], [2, 29], [86, 28], [85, 29]]) px(x, y, '#000000');
      },

      // Blender's viewport, the monkey head looking about in it, and a render bar that never quite finishes.
      blender(f) {
        dither(0, 0, W, H, ['#ffa238', '#ee8312', '#bd6208']);
        grit(1, 1, 86, 29, 0.025, 7);
        bevel('#ffdba3', '#4a2200');
        rect(2, 2, 27, 27, '#3b3b3b');
        for (const y of [18, 21, 25]) rect(2, y, 27, 1, '#484848');
        for (const [x0, x1] of [[9, 4], [15, 15], [21, 26]]) {
          for (let y = 18; y < 29; y++) px(Math.round(x0 + ((x1 - x0) * (y - 18)) / 10), y, '#484848');
        }
        rect(2, 23, 27, 1, '#b5434f');
        for (let y = 18; y < 29; y++) px(15, y, '#6f9d2e');
        bevel('#7a3d04', '#ffc680', 1, 1, 29, 29);
        c.drawImage(monkey[f], 1, 0);
        write('RENDERED IN', 33, 5, '#fff6dc', { shadow: '#8a4506' });
        write('BLENDER', 33, 13, (a, b) => (b < 3 ? '#ffffff' : '#ffeccb'), { size: 8, shadow: '#4a2200' });
        // The render bar: tiles filling one by one, stuck at 99%, then starting again.
        rect(33, 22, 51, 5, '#4a2200');
        rect(34, 23, 49, 3, '#2a1300');
        const done = Math.min(12, Math.floor(f * 0.62));
        for (let i = 0; i < done; i++) rect(34 + i * 4, 23, 3, 3, i === done - 1 && f < 20 ? '#ffffff' : '#ffd76a');
        px(84, 27, 'rgba(0,0,0,0.3)');
      },

      // A radar that sweeps and finds nothing: nobody is following you here.
      'no-tracking'(f) {
        dither(0, 0, W, H, ['#22323c', '#17232b', '#0e171d']);
        grit(1, 1, 86, 29, 0.08, 9);
        bevel('#5f7f8f', '#04080b');
        const [cx, cy, radius] = [15, 15, 12.5];
        const sweep = (f / 24) * Math.PI * 2;
        for (let y = 2; y < 29; y++) {
          for (let x = 2; x < 29; x++) {
            const [dx, dy] = [x - cx, y - cy];
            const d = Math.hypot(dx, dy);
            if (d > radius + 1) continue;
            if (d > radius) { px(x, y, dy + dx < 0 ? '#03070a' : '#6f8f9f'); continue; }
            const lag = (((sweep - Math.atan2(dy, dx)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const ring = Math.abs(d - 6) < 0.5 || Math.abs(d - 11.5) < 0.6 || dx === 0 || dy === 0;
            let colour = ring ? '#0f4a5c' : '#04161d';
            if (d > 0.5) {
              if (lag < 0.2) colour = '#d6fbff';
              else if (lag < 0.6) colour = ring ? '#8ff0ff' : '#3fc4de';
              else if (lag < 1.2) colour = ring ? '#3fc4de' : (x + y) % 2 ? '#1d7f97' : '#125a6c';
              else if (lag < 2.0) colour = ring ? '#1d7f97' : (x + y) % 2 ? '#0b3b48' : '#04161d';
            } else colour = '#d6fbff';
            px(x, y, colour);
          }
        }
        write('NO TRACKING', 32, 4, '#ffffff', { shadow: '#04080b' });
        write('NO COOKIES', 32, 11, '#8ff0ff', { shadow: '#04080b' });
        // The read-out: a lamp that blinks green, and what the sweep found.
        rect(32, 19, 52, 8, '#04080b');
        bevel('#04080b', '#3a515e', 31, 18, 54, 10);
        const lamp = f % 12 < 8;
        rect(34, 21, 3, 3, lamp ? '#5dff8f' : '#14522a');
        if (lamp) px(34, 21, '#d9ffe5');
        write('0 FOUND', 40, 20, '#5dff8f');
        if (f % 12 < 6) rect(70, 20, 3, 5, '#5dff8f');
      },
    };

    const out = {};
    for (const [name, { frames }] of Object.entries(BADGES)) {
      out[name] = [];
      for (let f = 0; f < frames; f++) {
        c.clearRect(0, 0, W, H);
        draw[name](f);
        out[name].push(canvas.toDataURL('image/png'));
      }
    }
    return out;
  },
  { BADGES, sprites },
);
await page.context().browser().close();

await mkdir('public/badges', { recursive: true });
let total = 0;
for (const [name, list] of Object.entries(frames)) {
  const { delay, still } = BADGES[name];
  const dir = `art/out/badges/${name}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [i, url] of list.entries()) await writeFile(`${dir}/${String(i).padStart(2, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
  await writeFile(`public/badges/${name}.png`, Buffer.from(list[still].split(',')[1], 'base64'));
  // GIF: one palette for the whole loop, no dithering, so the pixels stay as drawn; only what changed is stored.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(100 / delay), '-i', `${dir}/%02d.png`,
    '-vf', 'split[a][b];[a]palettegen=stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', `public/badges/${name}.gif`]);
  const size = (await readFile(`public/badges/${name}.gif`)).length;
  total += size;
  console.log(`public/badges/${name}.gif  ${list.length} frames  ${(size / 1024).toFixed(1)} kB`);
}
console.log(`all eight: ${(total / 1024).toFixed(1)} kB`);
