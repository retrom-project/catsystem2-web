#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Build the engine's pinned zlib 1.2.3 standard-library boundary as deterministic JavaScript."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = 'https://zlib.net/fossils/zlib-1.2.3.tar.gz'
SOURCE_SHA256 = '1795c7d067a43174113fdf03447532f373e1c6c57c08d61d9e4e9be5e244b05e'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command, **kwargs):
    return subprocess.run([str(value) for value in command], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / '.local/vendor/zlib')
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = args.archive.resolve() if args.archive else output / 'zlib-1.2.3.tar.gz'
    if not archive.exists():
        with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
            archive.write_bytes(response.read())
    if digest(archive) != SOURCE_SHA256:
        raise ValueError('zlib archive identity differs from the pinned official source')
    environment = run(['bash', '-c', 'source "$1/emsdk_env.sh" >/dev/null 2>&1 && env -0', '_', args.emsdk.resolve()], capture_output=True).stdout
    for entry in environment.split(b'\0'):
        if b'=' in entry:
            key, value = entry.split(b'=', 1)
            os.environ[key.decode()] = value.decode()
    version = run(['emcc', '--version'], capture_output=True, text=True).stdout.splitlines()[0]
    if '3.1.74' not in version:
        raise ValueError('This artifact pins Emscripten 3.1.74')
    source = output / '.source'
    source.mkdir(exist_ok=True)
    with tarfile.open(archive) as zipped:
        zipped.extractall(source, filter='data')
    source = source / 'zlib-1.2.3'
    files = 'adler32 crc32 inflate inftrees inffast zutil deflate trees'.split()
    wrapper = ROOT / 'third_party/zlib/native-inflate.c'
    target = output / 'native_zlib.mjs'
    run(['emcc', '-O3', '-Wno-deprecated-non-prototype', '-I', source, wrapper, *[source / (name + '.c') for name in files], '-sWASM=0', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sSINGLE_FILE=1', '-sENVIRONMENT=web,node', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=1048576', '-sDYNAMIC_EXECUTION=0', '-sEXPORTED_FUNCTIONS=["_malloc","_free","_cs2_inflate","_cs2_deflate"]', '-ffile-prefix-map=' + str(source) + '=zlib-1.2.3', '-o', target])
    shutil.copyfile(source / 'README', output / 'ZLIB-LICENSE.txt')
    with (output / 'zlib-1.2.3-source.tar.gz').open('wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='') as compressed:
            with tarfile.open(fileobj=compressed, mode='w|') as bundled:
                for path, relative in [*[(path, 'zlib-1.2.3/' + str(path.relative_to(source))) for path in sorted(source.rglob('*')) if path.is_file()], (wrapper, 'catsystem2-web/third_party/zlib/native-inflate.c'), (Path(__file__), 'catsystem2-web/scripts/prepare-native-zlib.py')]:
                    info = bundled.gettarinfo(str(path), relative)
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    with path.open('rb') as content:
                        bundled.addfile(info, content)
    manifest = {'inputs': {'url': SOURCE_URL, 'sha256': SOURCE_SHA256, 'emscripten': '3.1.74', 'wrapperSHA256': digest(wrapper), 'prepareScriptSHA256': digest(Path(__file__))}, 'license': 'Zlib', 'artifacts': {name: {'sha256': digest(output / name), 'bytes': (output / name).stat().st_size} for name in ['native_zlib.mjs', 'ZLIB-LICENSE.txt', 'zlib-1.2.3-source.tar.gz']}}
    (output / 'zlib-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(target)


if __name__ == '__main__':
    main()
