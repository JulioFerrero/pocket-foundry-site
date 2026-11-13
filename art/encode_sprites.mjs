// How it works' sprites for the page: each loop (art/out/sprite-<name>/, from art/sprites.py) as a small video that
// keeps its transparency, VP9 in WebM (Chrome, Firefox) and HEVC with alpha in MP4 (Safari), and a still of the same
// moment, which the page shows first and keeps for people who turn animations off. Animated WebP came out ten times
// bigger. node art/encode_sprites.mjs  ->  public/sprites/<name>.webm, <name>.mp4, <name>-still-<width>.webp
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import sharp from 'sharp';

const FPS = 12;
const STILL = 0.22; // the moment the stills show, as art/sprites.py
await mkdir('public/sprites', { recursive: true });
for (const name of ['install', 'import', 'play']) {
  const dir = `art/out/sprite-${name}`;
  const frames = (await readdir(dir)).filter((file) => file.endsWith('.png')).sort();
  const still = `${dir}/${frames[Math.round(STILL * frames.length) % frames.length]}`;
  for (const width of [440, 220]) {
    await sharp(still).resize({ width }).webp({ quality: 82, alphaQuality: 90 }).toFile(`public/sprites/${name}-still-${width}.webp`);
    await rm(`public/sprites/${name}-${width}.webp`, { force: true }); // the animated WebPs this replaced
  }
  const input = ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', `${dir}/%04d.png`];
  execFileSync('ffmpeg', [...input, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32', '-row-mt', '1',
    '-an', `public/sprites/${name}.webm`]);
  execFileSync('ffmpeg', [...input, '-pix_fmt', 'bgra', '-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.75', '-q:v', '58',
    '-tag:v', 'hvc1', '-movflags', '+faststart', '-an', `public/sprites/${name}.mp4`]);
  const size = async (file) => Math.round((await stat(file)).size / 1024);
  console.log(`${name}: webm ${await size(`public/sprites/${name}.webm`)} kB, mp4 ${await size(`public/sprites/${name}.mp4`)} kB`);
}
