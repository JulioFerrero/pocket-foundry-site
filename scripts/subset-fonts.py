"""
The site's fonts, cut down to the characters it shows (ASCII, a few dashes, quotes, dots and arrows): a third of
fontsource's Latin files, so the text paints sooner. Needs fonttools and brotli:
  python3 -m venv /tmp/fonts && /tmp/fonts/bin/pip install fonttools brotli
  /tmp/fonts/bin/python scripts/subset-fonts.py
"""
from fontTools import subset

FONTS = {
    'barlow-400': 'node_modules/@fontsource/barlow/files/barlow-latin-400-normal.woff2',
    'barlow-600': 'node_modules/@fontsource/barlow/files/barlow-latin-600-normal.woff2',
    'chakra-petch-700': 'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-700-normal.woff2',
    'share-tech-mono-400': 'node_modules/@fontsource/share-tech-mono/files/share-tech-mono-latin-400-normal.woff2',
}
# Share Tech Mono's licence reserves the name "Share" for the original, so the cut-down copy has a name of its own.
RENAME = {'share-tech-mono-400': ('Share Tech Mono', 'PF Tech Mono')}
# ASCII; no-break space; middle dot, multiplication sign; en and em dash; curly quotes; ellipsis; right arrow.
UNICODES = list(range(0x20, 0x7F)) + [0xA0, 0xB7, 0xD7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2192]

for name, source in FONTS.items():
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['kern', 'liga', 'calt', 'tnum']
    options.name_IDs = ['*']
    font = subset.load_font(source, options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    if name in RENAME:
        old, new = RENAME[name]
        for record in font['name'].names:
            text = record.toUnicode()
            record.string = text.replace(old, new).replace(old.replace(' ', ''), new.replace(' ', ''))
    out = f'src/assets/fonts/{name}.woff2'
    subset.save_font(font, out, options)
    print(out)
