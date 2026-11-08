#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Build the pinned x86/WASM CPU backend and its corresponding-source bundle."""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
WRAPPER_URL = 'https://github.com/AlexAltea/unicorn.js.git'
WRAPPER_COMMIT = '560284c59c11c8d6c94d537f4354339f069ddcdf'
UNICORN_URL = 'https://github.com/unicorn-engine/unicorn.git'
UNICORN_COMMIT = '8028ec436f2d9376525352dd38ed9ed6b9f6be10'
EMSCRIPTEN_VERSION = '3.1.74'
PATCHES = ['tci-loads.patch', 'tci-helper-temporaries.patch', 'page-protection-cache.patch', 'sse-status.patch', 'host-code-cache.patch', 'count-only-hooks.patch', 'ram-views.patch', 'count-budget-side-exits.patch']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, **options):
    return subprocess.run([str(x) for x in args], check=True, **options)


def checkout(source):
    if not (source / '.git').exists():
        source.mkdir(parents=True, exist_ok=True)
        command(['git', 'init', source], stdout=subprocess.DEVNULL)
        command(['git', '-C', source, 'remote', 'add', 'origin', WRAPPER_URL])
        command(['git', '-C', source, 'fetch', '--depth', '1', 'origin', WRAPPER_COMMIT])
        command(['git', '-C', source, 'checkout', '--detach', WRAPPER_COMMIT])
        command(['git', '-C', source, 'submodule', 'update', '--init', '--depth', '1'])
    for directory, expected in [(source, WRAPPER_COMMIT), (source / 'unicorn', UNICORN_COMMIT)]:
        actual = command(['git', '-C', directory, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
        if actual != expected:
            raise ValueError(f'{directory}: expected pinned commit {expected}, found {actual}')


def apply_patch(source, patch):
    reverse = subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)],
                             cwd=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if reverse.returncode:
        command(['git', 'apply', patch], cwd=source)


def source_archive(source, output):
    # Source files have stable archive names/timestamps. Build products and Git's
    # object database are excluded; all C sources, upstream patches, bindings,
    # QEMU baseline, build scripts, and license files are included.
    with (output / 'corresponding-source.tar.gz').open('wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='') as zipped:
            with tarfile.open(fileobj=zipped, mode='w|') as archive:
                for path in sorted(source.rglob('*')):
                    relative = path.relative_to(source)
                    if any(part in {'.git', '__pycache__', 'build', 'dist'} for part in relative.parts):
                        continue
                    if not path.is_file():
                        continue
                    info = archive.gettarinfo(str(path), 'unicorn-js/' + str(relative))
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    with path.open('rb') as content:
                        archive.addfile(info, content)
                for path in [Path(__file__), *(ROOT / 'third_party/unicorn' / p for p in PATCHES), ROOT / 'third_party/unicorn/README.md']:
                    info = archive.gettarinfo(str(path), 'catsystem2-web/' + str(path.relative_to(ROOT)))
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    with path.open('rb') as content:
                        archive.addfile(info, content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / '.local/vendor/ppi')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--rebuild', action='store_true')
    options = parser.parse_args()
    if options.jobs < 1 or options.jobs > 64:
        raise ValueError('Build jobs must be between1 and64')
    emsdk, output = options.emsdk.resolve(), options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    environment = command(['bash', '-c', 'source "$1/emsdk_env.sh" >/dev/null 2>&1 && env -0', '_', emsdk], capture_output=True).stdout
    for entry in environment.split(b'\0'):
        if b'=' in entry:
            key, value = entry.split(b'=', 1)
            os.environ[key.decode()] = value.decode()
    version = command(['emcc', '--version'], capture_output=True, text=True).stdout.splitlines()[0]
    if EMSCRIPTEN_VERSION not in version:
        raise ValueError(f'The pinned backend requires Emscripten {EMSCRIPTEN_VERSION}: {version}')
    identity = {'wrapper': {'url': WRAPPER_URL, 'commit': WRAPPER_COMMIT},
                'unicorn': {'url': UNICORN_URL, 'commit': UNICORN_COMMIT},
                'emscripten': EMSCRIPTEN_VERSION,
                'patches': {name: digest(ROOT / 'third_party/unicorn' / name) for name in PATCHES},
                'prepareScriptSHA256': digest(Path(__file__))}
    source_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:16]
    source = output / ('.source-' + source_key)
    manifest_path = output / 'manifest.json'
    if not options.rebuild and manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        if previous.get('inputs') == identity and all((output / name).exists() and digest(output / name) == data['sha256'] for name, data in previous['artifacts'].items()):
            print(output / 'unicorn_x86.js')
            return
    checkout(source)
    spec = importlib.util.spec_from_file_location('pinned_unicorn_build', source / 'build.py')
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    os.chdir(source)
    upstream_marker = source / '.upstream-patched'
    if not upstream_marker.exists():
        build.patchUnicorn()
        upstream_marker.write_text(WRAPPER_COMMIT + '\n' + UNICORN_COMMIT + '\n')
    for name in PATCHES:
        apply_patch(source / 'unicorn', ROOT / 'third_party/unicorn' / name)
    # Do not let the upstream script start one compiler per host CPU.
    build.os.cpu_count = lambda: options.jobs
    # Host memory aliases use the reviewed RAM-only API added by ram-views.
    build.EXPORTED_FUNCTIONS.extend(['_uc_mem_host_ptr', '_uc_mem_invalidate'])
    # Preserve stable source paths in diagnostics embedded in the final WASM.
    os.environ['CFLAGS'] = '-ffile-prefix-map=' + str(source) + '=unicorn-js'
    build.generateConstants()
    build.compileUnicorn(['x86'])
    shutil.copyfile(source / 'dist/unicorn_x86.js', output / 'unicorn_x86.js')
    shutil.copyfile(source / 'unicorn/COPYING', output / 'COPYING')
    (output / 'package.json').write_text('{"type":"commonjs"}\n')
    source_archive(source, output)
    artifacts = {name: {'sha256': digest(output / name), 'bytes': (output / name).stat().st_size}
                 for name in ['unicorn_x86.js', 'package.json', 'COPYING', 'corresponding-source.tar.gz']}
    manifest_path.write_text(json.dumps({'inputs': identity, 'artifacts': artifacts,
        'license': 'GPL-2.0; retain upstream component licenses',
        'sourceDistribution': 'Serve corresponding-source.tar.gz with the same public access as unicorn_x86.js.'}, indent=2) + '\n')
    print(output / 'unicorn_x86.js')


if __name__ == '__main__':
    main()
