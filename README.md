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

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to main, once a day and by hand.
