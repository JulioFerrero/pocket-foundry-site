"""
Downloads the Poly Haven textures and HDRI the sprites use (polyhaven.com, all CC0) into art/assets/<id>/.
Run once: python3 art/fetch_assets.py. The renders only read the files.
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
AGENT = {'User-Agent': 'pocketfoundry-site-art'}

TEXTURES = {'rust_coarse_01': '1k', 'weathered_planks': '1k', 'old_planks_02': '2k'}
HDRIS = {'boiler_room': '2k'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT)) as response:
        return response.read()


def save(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = get(url)
    with open(path, 'wb') as f:
        f.write(data)
    print(f'  {os.path.relpath(path, OUT)} ({len(data) // 1024} kB)')


def texture(asset, resolution):
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
    for kind in ('Diffuse', 'nor_gl', 'Rough', 'Displacement', 'AO', 'arm'):
        if kind in files and resolution in files[kind]:
            entry = files[kind][resolution].get('jpg') or files[kind][resolution].get('png')
            save(entry['url'], os.path.join(OUT, asset, os.path.basename(entry['url'])))


def hdri(asset, resolution):
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
    entry = files['hdri'][resolution]['hdr']
    save(entry['url'], os.path.join(OUT, asset, os.path.basename(entry['url'])))


if __name__ == '__main__':
    for asset, resolution in TEXTURES.items():
        print(asset)
        texture(asset, resolution)
    for asset, resolution in HDRIS.items():
        print(asset)
        hdri(asset, resolution)
