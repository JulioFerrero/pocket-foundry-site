// The 88x31 buttons, the 90s web's kind, made the way those were: pixel by pixel, a few colours, dithered gradients,
// one-pixel bevels and a small thing moving in each. Drawn frame by frame on a canvas in headless Chrome: the titles
// in the Silkscreen pixel font snapped to whole pixels, the small print in a 3x5 font drawn here, the gear wheel and
// the monkey head pre-rendered in Blender (art/badge_sprites.py). Other people's marks (the GPLv3 logo, the GNU head,
// Obtainium's gem) are redrawn pixel by pixel over the originals, as rows of letters here; the site's README says
// whose they are and under what terms. ffmpeg makes each loop a GIF with one palette and no dithering of its own,
// looping for ever. Each also gets a still PNG, its best frame, for people who turn animations off.
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
const sprites = { gear: await sprite('gear', 24), monkey: await sprite('monkey', 24) };

// Each button: how many frames its loop has, how long a frame lasts (hundredths of a second, a GIF's unit), and
// which frame is the still. A loop's last frame has to lead into its first: whatever moves is back where it began.
const BADGES = {
  // 48 frames: two of the gear's quarter turns, so its last frame leads into its first.
  'pocket-foundry': { frames: 48, delay: 8, still: 20 },
  'no-emulation': { frames: 24, delay: 8, still: 0 },
  gpl: { frames: 40, delay: 8, still: 0 },
  android: { frames: 42, delay: 16, still: 0 },
  obtainium: { frames: 32, delay: 10, still: 0 },
  fps: { frames: 44, delay: 2, still: 40 },  // 50 frames a second, as fast as a GIF goes: the button keeps its word
  blender: { frames: 24, delay: 10, still: 20 },
  'built-on': { frames: 60, delay: 10, still: 12 },
  'own-copy': { frames: 32, delay: 8, still: 9 },
  'view-source': { frames: 24, delay: 10, still: 0 },
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
        // The sprite is a quarter turn in 24 frames, the least that brings the teeth and the web's four holes back at
        // once. Twelve frames on, so the still keeps the pose the app's icon has.
        c.drawImage(gear[(f + 12) % 24], 1, 1);
        // Sparks thrown off to the right, three times a loop; the last is out before the loop ends.
        const sparks = [[2, 1.5, -1.1, 19], [5, 1.1, -1.5, 22], [20, 1.3, -1.3, 20], [23, 1.7, -0.8, 23], [25, 0.9, -1.6, 18], [37, 1.2, -1.4, 21], [40, 1.6, -0.9, 19]];
        for (const [start, vx, vy, y0] of sparks) {
          const age = f - start;
          if (age < 0 || age > 5) continue;
          const x = Math.round(27 + vx * age);
          const y = Math.round(y0 + vy * age + 0.22 * age * age);
          px(x, y, ['#fff6c8', '#ffe07a', '#ffb347', '#ff8a2a', '#c2410c', '#7a2a0a'][age]);
        }
        rivet(83, 3, '#dfe6ec', '#9aa4ad', '#4b535b');
        rivet(83, 25, '#dfe6ec', '#9aa4ad', '#4b535b');
        // The glint: a slanted band of light that crosses the letters once a loop, off them at both of its ends.
        const band = (f - 10) * 6 + 30;
        const lit = (x, y) => x + y >= band && x + y < band + 5;
        write('POCKET', 33, 6, (a, b, x, y) => (lit(x, y) ? '#fffbe6' : b < 2 ? '#ffe9a3' : b < 4 ? '#f2c14e' : '#c98f22'), { size: 8, shadow: '#1c1408' });
        write('FOUNDRY', 33, 17, (a, b, x, y) => (lit(x, y) ? '#ffffff' : b < 2 ? '#f4f7f9' : b < 4 ? '#d3dae0' : '#a3adb6'), { size: 8, shadow: '#15181b' });
      },

      // A warning plate, and under it a transport belt carrying gear wheels and plates: the real thing, running.
      // The plate is flat, with no dither, grain or letter shadow, and its second line is yellow on black: at 88
      // pixels anything else behind five-pixel letters reads as mud.
      'no-emulation'(f) {
        rect(0, 0, W, 9, '#ffd43b');
        bevel('#fff3b8', '#3a2600');
        for (const x0 of [2, 81]) {
          for (let y = 2; y < 8; y++) for (let x = x0; x < x0 + 5; x++) px(x, y, (x + y) % 6 < 3 ? '#17140c' : '#ffd43b');
        }
        write('NO EMULATION', 'centre', 2, '#17140c', { size: 8 });
        rect(1, 9, 86, 7, '#17140c');
        write('100% NATIVE CODE', 'centre', 10, '#ffd43b');
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

      // The GPLv3 logo (José Obed's, public domain) on a red plate, and the GNU head (Etienne Suvasa's) on its white
      // paper: both redrawn here a pixel at a time over the originals from gnu.org/graphics. A light crosses the
      // logo, and the gnu blinks.
      gpl(f) {
        dither(0, 0, W, H, ['#8a0808', '#740505', '#5a0202']);
        grit(1, 1, 86, 29, 0.04, 3);
        bevel('#e2695a', '#240000');
        rect(2, 2, 27, 27, '#fbf9f3');
        bevel('#240000', '#c9897e', 1, 1, 29, 29);
        const GNU = [
          '...kkkkkk.........kkkk...',
          '.kkggggggkk......kkggggk.',
          'kgggkkkkkk.......kkkkgggk',
          'kggk......kkkkkkkk....kgk',
          'kggk....kggggkkkkkkk..kgk',
          'kggk..kggkkkkwkwkkk...kgk',
          'kggkkkkkkkkwwkwwkkkkkkggk',
          'kggkkkkkkwwwwwwwwk.kkkggk',
          '.kgkkk...kwkkkwwkkk.kkgk.',
          '..kkk....kwwkwwwkwk.kkk..',
          '...kk....kwwwwwwwwkk.....',
          '....k....kwwwwwwwkwwkk...',
          '....k...kwwwwkkkwkkkk....',
          '...kkkkkwwwwkwkwwwwk.....',
          '...kk..kwwwwkwwwwwwk.....',
          '.....d..kwwwwkwwwwkk.....',
          '.....d..kwwwwwkwwwk......',
          '......d..kwwwwwkkkk......',
          '......d..kwwwwwwwk.......',
          '.......d..kwwwwkkk.......',
          '........d.kwwwwk.........',
          '...........kwkwk.........',
          '............kwgk.........',
          '.............kk..........',
        ];
        stamp(GNU, 3, 4, { k: '#17151a', d: '#77747a', g: '#b4b1b5', w: '#ffffff' });
        if (f === 30 || f === 31) { px(15, 13, '#ffffff'); px(19, 13, '#ffffff'); }
        // The logo, 52 pixels of its 3693: r its red, w the white of its letters, the v and the 3.
        const LOGO = [
          '...............................................rrrr.',
          '....rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrwwrwwwwwr',
          '....rrrrrrrrrrrrrrrrrrrrrrrwrrrrrrrrrrrrwwrrwwwwwwwr',
          '....rrwwwwwwrrwwwwwwwrwwrrrwrrrrrrrrrrwwrrrwwwwwwwwr',
          '....rwwrrrrwwrwwrrrrwwwwrrwwrrrrrrrrwwrrrwwrrrwwwwr.',
          '...rrwwrrrrwwrwwrrrrwwwwrrwwrrrrrrwwrrrrwwrrrrwwwr..',
          '...rwwrrrrrrrwwrrrrwwwwrrrwwrrrrrwwrrrrwrrrrrwwwr...',
          '...rwwrrrrrrrwwrrrrwwwwrrrwwrrrrwwrrrrrrrrrrwwwrrr..',
          '...rwwrrrrrrrwwrrrrwwwwrrrwwrrrwwrrrrrrrrrrwwwwwwr..',
          '..rrwwrrwwwwrwwwwwwwrwwrrrwwrrwwrrrrrrrrrrwwwwwwwr..',
          '..rwwrrrrwwrwwrrrrrrwwrrrrwwrwwrrrrrrrrrrwrrrrwwwr..',
          '..rwwrrrrwwrwwrrrrrrwwrrrrwwrwwrrrrrrrrrrrrrrwwwr...',
          '..rwwrrrrwwrwwrrrrrrwwrrrrwwrwwrrrrrrrrrrrrrwwwr....',
          '..rwwrrrrwwrwwrrrrrrwwrrrrrwrwwrrrrrrrrrrrwwwwr.....',
          '.rrrwwwwwwrrwwrrrrrrwwwwwwrwrwwrrrrrrrrrrwwwwr......',
          '.rrrrrrrrrrrrrrrrrrrrrrrrrrwrwwrrrrrrrrwwwwwr.......',
          '.rrrrrrrrrrrrrrrrrrrrrrrrrrrrwwwwwwwwwwwwwrr........',
          '.rrrrrrrrrrrrrrrrrrrrrrrrrrrrwwwwwwwwwwwrr..........',
          'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrwwwwwwwwwrr............',
          'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrwwwwwrrr..............',
          '..............................rrrrr.................',
        ];
        const band = (f - 4) * 6 + 20;
        LOGO.forEach((row, dy) => [...row].forEach((letter, dx) => {
          const [x, y] = [33 + dx, 2 + dy];
          const lit = x + y >= band && x + y < band + 5;
          if (letter === 'r') px(x, y, lit ? '#ff5340' : '#cf0000');
          else if (letter === 'w') px(x, y, '#ffffff');
        }));
        write('FREE SOFTWARE', 'centre', 24, '#ffd9d2', { shadow: '#240000', left: 33, right: 85 });
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

      // Obtainium's own mark, the gem with the arrow cut into it (from its icon, GPL-3.0 like the app), on the black
      // of its "get it on" badge. A gleam crosses the gem and leaves a twinkle.
      obtainium(f) {
        dither(0, 0, W, H, ['#2a2140', '#1a142b', '#0c0a15']);
        grit(1, 1, 86, 29, 0.04, 5);
        bevel('#9384b8', '#040308');
        const GEM = [
          '..............ppp......',
          '............ppppppq....',
          '...........pppppqqqqq..',
          '......ppp..ppppqqqqqqqq',
          '...pppppp..ppqqqqqqqqqq',
          '..ppppppp...qqqqqqqqqqq',
          '..pppppppp..qqqqqqqqqq.',
          '..pppppppq......qqqqii.',
          '.ppppppqqq.....qqqqii..',
          '.pppppqq.......qqiiii..',
          'ppppqqqqq.....qqiiiii..',
          'pppqqqqqqq....iiiiii...',
          'pqqqqqqqqqqq..iiiiii...',
          '..qqqqqqqqqiiiiiiii....',
          '....qqqqqqiiiiiiiii....',
          '......qqiiiiiiiiiii....',
          '........iiiiiiiiii.....',
          '.........iiiiiiiii.....',
          '...........iiiiii......',
          '.............iiii......',
          '...............ii......',
        ];
        const band = (f - 3) * 4;
        const [x0, y0] = [4, 5];
        GEM.forEach((row, dy) => [...row].forEach((letter, dx) => {
          if (letter === '.') return;
          px(x0 + dx + 1, y0 + dy + 1, 'rgba(0,0,0,0.5)');
        }));
        GEM.forEach((row, dy) => [...row].forEach((letter, dx) => {
          if (letter === '.') return;
          const lit = dx + dy >= band && dx + dy < band + 4;
          px(x0 + dx, y0 + dy, lit ? { p: '#e9d2ff', q: '#b98af0', i: '#7d54d6' }[letter] : { p: '#a463e6', q: '#7240c4', i: '#4428a8' }[letter]);
        }));
        // Twinkles: four-pointed stars that open and close, after the gleam has passed.
        for (const [x, y, start] of [[24, 8, 14], [6, 9, 20], [19, 24, 23]]) {
          const size = [1, 2, 3, 2, 1][f - start] ?? 0;
          if (!size) continue;
          for (let i = 1; i < size; i++) {
            for (const [dx, dy] of [[i, 0], [-i, 0], [0, i], [0, -i]]) px(x + dx, y + dy, i === 1 ? '#ffffff' : '#e9ccff');
          }
          px(x, y, '#ffffff');
        }
        write('GET IT WITH', 32, 7, '#d8cdf0', { shadow: '#040308' });
        write('OBTAINIUM', 32, 16, (a, b) => (b < 2 ? '#ffffff' : b < 4 ? '#eadcff' : '#c9a6ff'), { size: 8, shadow: '#040308' });
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

      // A terminal that types what the app stands on, one name after another.
      'built-on'(f) {
        rect(0, 0, W, H, '#0b0f12');
        rect(1, 1, 86, 8, '#28323a');
        rect(1, 1, 86, 1, '#3d4a54');
        rect(1, 9, 86, 1, '#000000');
        bevel('#7b8892', '#000000');
        write('BUILT ON', 4, 3, '#dbe4ea');
        for (const [i, colour] of ['#ff6b5e', '#ffc94a', '#5dff8f'].entries()) rect(74 + i * 4, 4, 2, 2, colour);
        // Twenty frames a name: typed a letter a frame, held, then the line cleared.
        const NAMES = ['TERMUX:X11', 'MESA ZINK', 'LIBHYBRIS'];
        const which = Math.floor(f / 20);
        const at = f % 20;
        const typed = at >= 18 ? '' : NAMES[which].slice(0, at + 1);
        write('>', 4, 15, '#5dff8f', { size: 8 });
        let x = 12;
        if (typed.trim()) x = 12 + write(typed.trimEnd(), 12, 15, '#e4ffe9', { size: 8 }).width + 1 + (typed.endsWith(' ') ? 4 : 0);
        if (at < NAMES[which].length || at >= 18 || at % 4 < 2) rect(x, 15, 4, 5, '#5dff8f');
        for (let i = 0; i < 3; i++) rect(4 + i * 5, 25, 3, 2, i === which ? '#5dff8f' : '#1f4a2e');
      },

      // Proposal. The game is the player's own: a gear wheel dropping into a wooden chest, as an import does.
      'own-copy'(f) {
        dither(0, 0, W, H, ['#4a443d', '#38332e', '#25211e']);
        grit(1, 1, 86, 29, 0.05, 11);
        bevel('#9a9288', '#0c0a09');
        rect(2, 2, 27, 27, '#14110f');
        bevel('#0c0a09', '#6e675e', 1, 1, 29, 29);
        // The chest, seen from in front and a little above: open, its lid standing behind.
        const land = f >= 14 && f < 17 ? 1 : 0;
        const CHEST = [
          '..dddddddddddddddd..',
          '.dmmmmmmmmmmmmmmmmd.',
          '.dmllllllllllllllmd.',
          '.dmmmmmmmmmmmmmmmmd.',
          'kkkkkkkkkkkkkkkkkkkk',
          'kxxxxxxxxxxxxxxxxxxk',
          'kkkkkkkkkkkkkkkkkkkk',
          'dllllllllsslllllllld',
          'dmmmmmmmmssmmmmmmmmd',
          'dmmmmmmmmmmmmmmmmmmd',
          'dlllllllllllllllllld',
          'dmmmmmmmmmmmmmmmmmmd',
          'dmmmmmmmmmmmmmmmmmmd',
          'dddddddddddddddddddd',
        ];
        const wood = { l: '#c98a4a', m: '#a0652e', d: '#5a3414', k: '#2a1808', x: '#0c0806', s: '#c9d0d6' };
        const GEAR = ['.b.b.b.', 'bbbbbbb', '.bbkbb.', 'bbkkkbb', '.mmkmm.', 'mmmmmmm', '.d.d.d.'];
        const brass = { b: '#ffd46a', m: '#d9a63a', d: '#8a6418', k: '#2a2010' };
        // The gear falls from above the square into the chest's mouth, faster as it goes, and is gone.
        const fall = f < 14 ? Math.round(-6 + 0.105 * f * f) : null;
        stamp(CHEST.slice(0, 4), 5, 9 + land, wood);
        if (fall !== null) {
          c.save();
          c.beginPath();
          c.rect(2, 2, 27, 13 + 2);
          c.clip();
          stamp(GEAR, 12, fall, brass);
          c.restore();
        }
        stamp(CHEST.slice(4), 5, 13 + land, wood);
        if (f >= 14 && f < 18) for (const [dx, dy] of [[-2, -1], [3, -2], [8, -1]]) px(12 + dx + (f - 14) * Math.sign(dx - 2), 13 + dy - (f - 14), '#ffe9a3');
        write('BRING YOUR OWN', 31, 6, '#e8e0d2', { shadow: '#0c0a09' });
        write('FACTORIO', 31, 15, (a, b) => (b < 2 ? '#ffc56a' : b < 4 ? '#ff9f1c' : '#d97a08'), { size: 8, shadow: '#0c0a09' });
      },

      // Proposal. The 90s' own button: a grey window, and the page's source scrolling by in an editor.
      'view-source'(f) {
        rect(0, 0, W, H, '#c0c0c0');
        bevel('#ffffff', '#3c3c3c');
        rect(1, 29, 86, 1, '#808080');
        rect(86, 1, 1, 29, '#808080');
        rect(3, 3, 25, 25, '#10104a');
        bevel('#3c3c3c', '#ffffff', 2, 2, 27, 27);
        // Lines of code as coloured dashes, moving up a pixel a frame; the pattern is 24 rows, the loop 24 frames.
        const CODE = [[0, 3, '#ff8a8a'], [4, 9, '#ffe98f'], [2, 5, '#8ad1ff'], [8, 8, '#e6e6e6'], [2, 12, '#e6e6e6'], [4, 6, '#9dff9d'], [2, 4, '#8ad1ff'], [0, 4, '#ff8a8a']];
        for (let row = 0; row < 16; row++) {
          const y = 4 + row * 3 - f;
          const [indent, length, colour] = CODE[row % 8];
          for (const yy of [y, y + 24]) if (yy >= 4 && yy < 27) rect(5 + indent, yy, Math.min(length, 21 - indent), 1, colour);
        }
        write('VIEW', 33, 4, '#10104a', { size: 8 });
        write('SOURCE', 33, 12, '#10104a', { size: 8 });
        write('ON GITHUB', 33, 21, '#5a5a5a');
      },
    };

    // Chrome keeps a canvas on the graphics card until it is first read back, and blends a translucent pixel a level
    // off from how the processor does: the very first frame came out a shade different from the rest of its loop.
    // So one frame is drawn and read before any is kept.
    draw[Object.keys(BADGES)[0]](0);
    canvas.toDataURL('image/png');
    c.getImageData(0, 0, W, H);
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
console.log(`on the site: ${(total / 1024).toFixed(1)} kB`);
