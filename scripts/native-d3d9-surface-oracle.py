#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Run authored D3D9 container and color surface transfer probes in pinned Wine."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

IMAGE = 'sha256:9a6c60e2c760730b99a8ddbc94da318a8ba667e5f206972436bf3820fe0892b7'


def run(args):
    return subprocess.run([str(value) for value in args], check=True, capture_output=True, timeout=90)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('.local/fes-audit/d3d9-surface'))
    parser.add_argument('--golden', type=Path)
    args = parser.parse_args()
    actual = run(['docker', 'image', 'inspect', IMAGE, '--format', '{{.Id}}']).stdout.decode().strip()
    if actual != IMAGE:
        raise ValueError('Use the immutable diagnostic image identity')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_suffix('.cpp')
    compiler = args.emsdk.resolve() / 'upstream/bin'
    definition = output / 'kernel32.def'
    definition.write_text('LIBRARY KERNEL32.dll\nEXPORTS\nLoadLibraryA\nGetProcAddress\nWriteFile\nGetStdHandle\nExitProcess\n')
    library = output / 'kernel32.lib'
    executable = output / 'oracle.exe'
    obj = output / 'oracle.obj'
    run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{definition}', '/machine:x86', f'/out:{library}'])
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector',
         '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', source, '-o', obj])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib',
         '/machine:x86', '/base:0x400000', '/dynamicbase:no', '/fixed', f'/out:{executable}', obj, library])
    container = f'catsystem2-surface-oracle-{os.getpid()}'
    try:
        result = run(['docker', 'run', '--init', '--rm', '--name', container, '--network', 'none',
                      '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'WINEPREFIX=/work/wine-prefix',
                      '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{output}:/work',
                      IMAGE, 'xvfb-run', '-a', 'wine', r'Z:\work\oracle.exe'])
    finally:
        subprocess.run(['docker', 'stop', '--timeout', '1', container], capture_output=True)
    (output / 'output.bin').write_bytes(result.stdout)
    (output / 'stderr.log').write_bytes(result.stderr)
    if len(result.stdout) != 48 * 20 + 37 * 132:
        raise ValueError('D3D9 surface oracle output is incomplete')
    containers = list(struct.iter_unpack('<5I', result.stdout[:960]))
    stretch = []
    for row in struct.iter_unpack('<9I8i16I', result.stdout[960:]):
        flags = row[7]
        stretch.append([*row[:9], row[9:13] if flags & 1 else None,
                        row[13:17] if flags & 2 else None, row[17:]])
    report = dict(image=IMAGE, sourceSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  containers=containers, stretch=stretch)
    golden = json.dumps(report, separators=(',', ':')) + '\n'
    (output / 'golden.json').write_text(golden)
    if args.golden:
        args.golden.write_text(golden)
    print(json.dumps({'containers': len(containers), 'stretch': len(stretch), 'output': str(output)}))


if __name__ == '__main__':
    main()
