# pocketfoundry.dev

The website of [Pocket Foundry](https://github.com/JulioFerrero/pocket-foundry): Astro, static, English for now
(every string is a key in `src/i18n/en.json`).

- `npm run dev`: the site on http://localhost:4321.
- `npm run data`: the latest release, the phones tables, the guide and the screenshots, from the app's
  repository (`APP_REPO=../pocket-foundry npm run data` reads a local checkout). The build only reads what it
  writes, and the deploy runs it first.
- `npm run build`: the site in `dist/`.
- `art/`: the sprites, the 88x31 buttons and the share image. See `art/README.md`.
- `scripts/subset-fonts.py`: the fonts cut down to the characters the site shows (see its first lines). Rerun it when
  the text gains new characters.

## Licence

GPL-3.0-only, like the app (`LICENSE`). The fonts in `src/assets/fonts/` are cut-down copies of Barlow, Chakra Petch
and Share Tech Mono (renamed PF Tech Mono, as its reserved name asks), under the SIL Open Font License 1.1; their
licences are next to them. The textures the art uses are Poly Haven's, CC0, and aren't in the repository.

Three of the 88x31 buttons in `public/badges/` redraw other people's marks in pixels (`art/badges.mjs`):

- `gpl`: the GPLv3 logo by José Obed, in the public domain, and the GNU head, copyright © 1992 Etienne Suvasa, under
  the [Creative Commons Attribution-ShareAlike 2.0](https://creativecommons.org/licenses/by-sa/2.0/) licence (or the
  Free Art License, or the GNU FDL 1.3), both from [gnu.org/graphics](https://www.gnu.org/graphics/). The head here
  is a redrawing at 25 pixels, so `gpl.gif` and `gpl.png` are under CC BY-SA 2.0 as well. The GNU head is also a
  trademark of the GNU Project; it is here to say the site and the app are under the GNU GPL.
- `obtainium`: the gem of [Obtainium](https://github.com/ImranR98/Obtainium)'s icon, by ImranR98 and its
  contributors, GPL-3.0.

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to main, once a day and by hand.
