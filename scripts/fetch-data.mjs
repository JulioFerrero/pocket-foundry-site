// Pulls what the site shows from the app's repository: the newest release, the phones tables, the playing guide and
// the screenshots. The build only reads what this writes, so it never needs the network.
//   npm run data                              from GitHub (main)
//   APP_REPO=../pocket-foundry npm run data   from a local checkout
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const REPO = 'JulioFerrero/pocket-foundry';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const BLOB = `https://github.com/${REPO}/blob/main`;
const local = process.env.APP_REPO;

async function source(path, binary = false) {
  if (local) return readFile(join(local, path), binary ? undefined : 'utf8');
  const response = await fetch(`${RAW}/${path}`);
  if (!response.ok) throw new Error(`${path}: GitHub answered ${response.status}`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.text();
}

async function release() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    // The deploy passes its token: GitHub's shared runners soon use up the anonymous limit.
    headers: {
      Accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  });
  if (!response.ok) throw new Error(`latest release: GitHub answered ${response.status}`);
  const json = await response.json();
  const apk = json.assets.find((asset) => asset.name.endsWith('.apk'));
  return {
    version: json.tag_name.replace(/^v/, ''),
    url: json.html_url,
    apk: apk?.browser_download_url ?? json.html_url,
    date: json.published_at,
  };
}

/** The rows of the first pipe table after [heading], as arrays of cells. */
function table(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) throw new Error(`no "${heading}" in phones.md`);
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|')) {
      if (rows.length) break;
      continue;
    }
    rows.push(line.slice(1, -1).split('|').map((cell) => cell.trim()));
  }
  return rows.slice(2); // header and separator
}

const issues = (cell) => [...cell.matchAll(/\[#(\d+)\]/g)].map((match) => Number(match[1]));
const plain = (cell) =>
  cell
    .replace(/\(\[#\d+\]\([^)]*\)(, \[#\d+\]\([^)]*\))*\)/g, '')
    .replace(/\[#\d+\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function guide(markdown) {
  return markdown
    .replace(/\n\| \| \|\n\|---\|---\|\n\|[^\n]*\n?$/s, '\n') // the screenshots table at the end
    .replace(/\]\(phones\.md(#[^)]*)?\)/g, '](/phones/)')
    .replace(/\]\(\.\.\/README\.md(#[^)]*)?\)/g, `](https://github.com/${REPO}$1)`)
    .replace(/\]\((?!https?:|\/|#)([^)]+)\)/g, `](${BLOB}/docs/$1)`)
    .trimEnd() + '\n';
}

const SCREENS = ['1-playing', '2-home', '3-importing', '5-driver']; // the ones Home shows
const shots = 'fastlane/metadata/android/en-US/images/phoneScreenshots';

const phonesMd = await source('docs/phones.md');
const gpus = table(phonesMd, '## What each GPU gets').map(([gpu, driver]) => ({ gpu: plain(gpu), driver: plain(driver) }));
const phones = table(phonesMd, '## Reported working').map(([phone, gpu, driver, fps]) => ({
  phone: plain(phone),
  gpu: plain(gpu),
  driver: plain(driver),
  notes: plain(fps),
  issues: issues(fps),
}));

await mkdir('src/data', { recursive: true });
await mkdir('src/content', { recursive: true });
await mkdir('src/assets/screens', { recursive: true });
await mkdir('public', { recursive: true });
await writeFile('src/data/release.json', JSON.stringify(await release(), null, 2) + '\n');
await writeFile('src/data/gpus.json', JSON.stringify(gpus, null, 2) + '\n');
await writeFile('src/data/phones.json', JSON.stringify(phones, null, 2) + '\n');
await writeFile('src/content/guide.en.md', guide(await source('docs/playing.md')));
for (const name of SCREENS) {
  await writeFile(`src/assets/screens/${name}.jpg`, await source(`${shots}/${name}.jpg`, true));
}
const icon = await source('fastlane/metadata/android/en-US/images/icon.png', true);
await sharp(icon).resize(32, 32).png().toFile('public/favicon-32.png');
await sharp(icon).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(icon).resize(512, 512).png().toFile('public/icon-512.png');
console.log(`${phones.length} phones, ${gpus.length} GPU rows, release ${JSON.parse(await readFile('src/data/release.json', 'utf8')).version}`);
