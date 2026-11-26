#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Prepare optional private load/failure probes; production retains six exports."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--sources', type=Path, default=ROOT / '.local/vendor/freetype')
    parser.add_argument('--output', type=Path, default=ROOT / '.local/vendor/freetype-tests')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    frozen = output / '.source/catsystem2-web'
    wrapper = frozen / 'third_party/freetype/native-font.c'
    probe = frozen / 'tests/fixtures/freetype-outline-probe.c'
    builder = frozen / 'scripts/prepare-native-freetype-tests.py'
    for destination, source in [(wrapper, ROOT / 'third_party/freetype/native-font.c'),
                                (probe, ROOT / 'tests/fixtures/freetype-outline-probe.c'),
                                (builder, Path(__file__))]:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
    production = runpy.run_path(str(ROOT / 'scripts/prepare-native-freetype.py'))
    sources, modules = production['SOURCES'], production['MODULES']
    environment = subprocess.run(
        ['bash', '-c', 'source "$1/emsdk_env.sh" >/dev/null 2>&1 && env -0',
         '_', args.emsdk.resolve()], check=True, capture_output=True).stdout
    for entry in environment.split(b'\0'):
        if b'=' in entry:
            key, value = entry.split(b'=', 1)
            os.environ[key.decode()] = value.decode()
    compiler = subprocess.run(['emcc', '--version'], check=True,
                              capture_output=True, text=True).stdout.splitlines()[0]
    if '3.1.74' not in compiler:
        raise ValueError('Expected pinned Emscripten 3.1.74')
    artifacts = {}
    for version, definition in sources.items():
        archive = args.sources / ('freetype-' + version + '.tar.gz')
        if digest(archive) != definition['sha256']:
            raise ValueError('FreeType archive identity differs: ' + version)
        with tarfile.open(archive) as bundle:
            bundle.extractall(output / '.source', filter='data')
        source = output / '.source' / ('freetype-' + version)
        name = 'native_freetype_probe_' + version.replace('.', '') + '.mjs'
        target = output / name
        command = ['emcc', '-O3', '-DFT2_BUILD_LIBRARY', '-DCS2_FONT_OUTLINE_CACHE=1',
                   '-I', source / 'include', probe,
                   *[source / 'src' / (module + '.c') for module in modules],
                   '-sWASM=0', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sSINGLE_FILE=1',
                   '-sENVIRONMENT=web,node', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=1048576',
                   '-sDYNAMIC_EXECUTION=0',
                   '-sEXPORTED_FUNCTIONS=["_malloc","_free","_cs2_font_open","_cs2_font_close","_cs2_font_advance","_cs2_font_glyph","_cs2_font_probe_stat","_cs2_font_probe_control"]',
                   '-ffile-prefix-map=' + str(source) + '=freetype-' + version,
                   '-ffile-prefix-map=' + str(frozen) + '=catsystem2-web', '-o', target]
        subprocess.run([str(value) for value in command], check=True)
        shutil.copyfile(source / 'docs/FTL.TXT', output / definition['license'])
        artifacts[version] = {'path': name, 'sha256': digest(target),
                              'bytes': target.stat().st_size}
        print(target, flush=True)
    manifest = {'license': 'FTL',
                'inputs': {'sources': sources, 'compiler': compiler,
                           'wrapperSHA256': digest(wrapper), 'probeSHA256': digest(probe),
                           'builderSHA256': digest(builder)},
                'artifacts': artifacts}
    (output / 'freetype-test-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
