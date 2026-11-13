# The site's pictures

Pre-rendered the way late-90s games made theirs: 3D models lit once in an offline renderer (Blender's Cycles), with
CC0 textures from [Poly Haven](https://polyhaven.com). Every picture can be made again, and changed, from here.
Blender 5.3, ffmpeg (Homebrew) and Node; run from the project's root.

1. `python3 art/fetch_assets.py`: the textures and the HDRI, into `art/assets/` (not in git).
2. `blender -b -P art/sprites.py -- --sprite install|import|play`: a How it works sprite (a chest of gear wheels, a
   transport belt, a steel furnace) as a still in `art/out/sprite-<name>.png`. `--frames 24` renders its loop instead
   (about 20 s a frame on an M3 Pro), `--preview` or `--draft` a quick small one. The models and materials are in
   `art/factory.py`, all original. One render at a time: two at once run out of GPU memory; `PF_CPU=1` renders on
   the processor instead.
3. `node art/encode_sprites.mjs`: the loops as transparent videos (VP9 WebM, HEVC MP4 for Safari) and their stills,
   in `public/sprites/`.
4. `blender -b -P art/badge_sprites.py` (the buttons' gear wheel and monkey head), then `node art/badges.mjs`: the
   88x31 buttons in `public/badges/`, animated GIFs and stills.
5. `node scripts/og.mjs`: the share image, from the sprites.
