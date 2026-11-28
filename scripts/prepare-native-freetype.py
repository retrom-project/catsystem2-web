#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Rebuild both reviewed font backends as deterministic JavaScript (no WASM)."""
import argparse
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    '2.4.8': {
        'url': 'https://download.savannah.gnu.org/releases/freetype/freetype-old/freetype-2.4.8.tar.gz',
        'sha256': '4635afebe24efd6cc7e40a30254c2aec61af14636c684e13091a65294a756b42',
        'output': 'native_freetype_248.mjs',
        'license': 'FREETYPE-2.4.8-LICENSE.txt',
    },
    '2.7.1': {
        'url': 'https://download.savannah.gnu.org/releases/freetype/freetype-2.7.1.tar.gz',
        'sha256': '162ef25aa64480b1189cdb261228e6c5c44f212aac4b4621e28cf2157efb59f5',
        'output': 'native_freetype.mjs',
        'license': 'FREETYPE-LICENSE.txt',
    },
}
MODULES = '''base/ftbase base/ftinit base/ftsystem base/ftdebug base/ftglyph
base/ftbbox base/ftbitmap base/ftgasp base/ftmm base/ftstroke base/ftsynth
base/fttype1 base/ftwinfnt truetype/truetype type1/type1 cff/cff cid/type1cid
pfr/pfr type42/type42 winfonts/winfnt pcf/pcf bdf/bdf sfnt/sfnt psaux/psaux
psnames/psnames pshinter/pshinter raster/raster smooth/smooth autofit/autofit
gzip/ftgzip lzw/ftlzw bzip2/ftbzip2'''.split()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / '.local/vendor/freetype')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    environment = run(['bash', '-c', 'source "$1/emsdk_env.sh" >/dev/null 2>&1 && env -0',
                       '_', args.emsdk.resolve()], capture_output=True).stdout
    for entry in environment.split(b'\0'):
        if b'=' in entry:
            key, value = entry.split(b'=', 1)
            os.environ[key.decode()] = value.decode()
    compiler = run(['emcc', '--version'], capture_output=True, text=True).stdout.splitlines()[0]
    if '3.1.74' not in compiler:
        raise ValueError('Expected pinned Emscripten 3.1.74')
    wrapper = ROOT / 'third_party/freetype/native-font.c'
    artifacts = []
    for version, definition in SOURCES.items():
        archive = out / ('freetype-' + version + '.tar.gz')
        if not archive.exists():
            with urllib.request.urlopen(definition['url'], timeout=60) as response:
                archive.write_bytes(response.read())
        if digest(archive) != definition['sha256']:
            raise ValueError('FreeType source identity differs: ' + version)
        source_root = out / '.source'
        source_root.mkdir(exist_ok=True)
        with tarfile.open(archive) as zipped:
            zipped.extractall(source_root, filter='data')
        source = source_root / ('freetype-' + version)
        target = out / definition['output']
        run(['emcc', '-O3', '-DFT2_BUILD_LIBRARY', '-I', source / 'include', wrapper,
             *[source / 'src' / (name + '.c') for name in MODULES],
             '-sWASM=0', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sSINGLE_FILE=1',
             '-sENVIRONMENT=web,node', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=1048576',
             '-sDYNAMIC_EXECUTION=0',
             '-sEXPORTED_FUNCTIONS=["_malloc","_free","_cs2_font_open","_cs2_font_close","_cs2_font_advance","_cs2_font_glyph"]',
             '-ffile-prefix-map=' + str(source) + '=freetype-' + version, '-o', target])
        shutil.copyfile(source / 'docs/FTL.TXT', out / definition['license'])
        bundle = 'freetype-' + version + '-source.tar.gz'
        with (out / bundle).open('wb') as raw:
            with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='') as compressed:
                with tarfile.open(fileobj=compressed, mode='w|') as bundled:
                    paths = [(p, 'freetype-' + version + '/' + str(p.relative_to(source)))
                             for p in sorted(source.rglob('*')) if p.is_file()]
                    paths += [(wrapper, 'catsystem2-web/third_party/freetype/native-font.c'),
                              (Path(__file__), 'catsystem2-web/scripts/prepare-native-freetype.py')]
                    for path, name in paths:
                        info = bundled.gettarinfo(str(path), name)
                        info.uid = info.gid = info.mtime = 0
                        info.uname = info.gname = ''
                        with path.open('rb') as content:
                            bundled.addfile(info, content)
        artifacts += [definition['output'], definition['license'], bundle]
        print(target, flush=True)
    manifest = {
        'inputs': {'sources': SOURCES, 'emscripten': '3.1.74',
                   'wrapperSHA256': digest(wrapper), 'prepareScriptSHA256': digest(Path(__file__))},
        'license': 'FTL',
        'artifacts': {name: {'sha256': digest(out / name), 'bytes': (out / name).stat().st_size}
                      for name in artifacts},
    }
    (out / 'freetype-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
