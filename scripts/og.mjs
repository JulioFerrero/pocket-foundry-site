// Draws public/og.png (1200x630), the picture links to the site show: the name plate, the heading and How it works'
// sprites, with the site's fonts and strings. Run after art/encode_sprites.mjs. No version: it would go stale.
//   node scripts/og.mjs
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const strings = JSON.parse(await readFile('src/i18n/en.json', 'utf8'));
const file = (path) => pathToFileURL(resolve(path)).href;
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Chakra Petch'; font-weight: 700; src: url(${file('src/assets/fonts/chakra-petch-700.woff2')}); }
@font-face { font-family: Barlow; font-weight: 600; src: url(${file('src/assets/fonts/barlow-600.woff2')}); }
@font-face { font-family: Tech; src: url(${file('src/assets/fonts/share-tech-mono-400.woff2')}); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; position: relative; color: #eef6ff; background:
  linear-gradient(rgba(169,216,242,.13) 1px, transparent 1px) 0 0 / 50px 50px, linear-gradient(90deg, rgba(169,216,242,.13) 1px, transparent 1px) 0 0 / 50px 50px,
  linear-gradient(rgba(169,216,242,.06) 1px, transparent 1px) 0 0 / 10px 10px, linear-gradient(90deg, rgba(169,216,242,.06) 1px, transparent 1px) 0 0 / 10px 10px, #0d325a; }
img.sprite { position: absolute; }
.install { left: 70px; bottom: 6px; width: 300px; }
.import { left: 380px; bottom: 30px; width: 360px; }
.play { right: 30px; bottom: 40px; width: 470px; }
.frame { position: absolute; inset: 18px; border: 1px solid rgba(169,216,242,.6); outline: 1px solid rgba(169,216,242,.25); outline-offset: 4px; }
.text { position: absolute; left: 64px; top: 64px; width: 560px; }
.brand { display: inline-flex; align-items: center; gap: 14px; padding: 6px 20px 6px 8px; font: 700 30px/1 'Chakra Petch'; letter-spacing: .04em; text-transform: uppercase; color: #1c1403;
  background: linear-gradient(#e6bb52, #bd8f2b); border: 2px solid; border-color: #fbe7a1 #6b4a10 #6b4a10 #fbe7a1; box-shadow: 0 0 0 2px #121416, 5px 5px 0 rgba(2,10,20,.5); text-shadow: 0 1px 0 rgba(255,240,190,.6); }
.brand img { width: 52px; height: 52px; border: 1px solid #6b4a10; }
h1 { margin-top: 44px; font: 700 66px/1.06 'Chakra Petch'; letter-spacing: .03em; text-transform: uppercase; color: #f7e9bd; text-shadow: 0 -1px 0 rgba(255,255,255,.25), 2px 4px 0 #041222; }
dl { position: absolute; right: 52px; top: 70px; display: flex; gap: 12px; }
dl div { display: flex; flex-direction: row-reverse; align-items: baseline; gap: 10px; padding: 8px 16px; background: #0a1d33; border: 2px solid; border-color: #121416 #8a929b #8a929b #121416; box-shadow: 0 0 0 4px #41464d, 0 0 0 5px #121416; margin-right: 8px; }
dt { font: 20px Tech; color: #9dbfdd; } dd { font: 600 26px Barlow; color: #f3ead0; }
</style>
${['play', 'import', 'install'].map((name) => `<img class="sprite ${name}" src="${file(`public/sprites/${name}-still-440.webp`)}">`).join('')}
<div class="frame"></div>
<div class="text"><div class="brand"><img src="${file('public/icon-512.png')}">${strings.site.name}</div><h1>${strings.home.heading}</h1></div>
<dl><div><dt>${strings.resources.licence}</dt><dd>${strings.site.licence}</dd></div><div><dt>${strings.resources.price}</dt><dd>${strings.resources.free}</dd></div></dl>`;

const folder = await mkdtemp(join(tmpdir(), 'og-'));
await writeFile(join(folder, 'og.html'), html);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(file(join(folder, 'og.html')));
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
await rm(folder, { recursive: true });
console.log('og -> public/og.png');
