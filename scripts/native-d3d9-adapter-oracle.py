#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Capture the documented D3D9 CreateDevice floating-point boundary in Wine."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

IMAGE = 'sha256:9a6c60e2c760730b99a8ddbc94da318a8ba667e5f206972436bf3820fe0892b7'


def run(args, **kwargs):
    return subprocess.run([str(value) for value in args], check=True,
                          capture_output=True, timeout=60, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--image', default=IMAGE)
    parser.add_argument('--output', type=Path, default=Path('.local/emote-audit/adapter-oracle'))
    parser.add_argument('--golden', type=Path)
    args = parser.parse_args()
    actual = run(['docker', 'image', 'inspect', args.image, '--format', '{{.Id}}']).stdout.decode().strip()
    if actual != args.image:
        raise ValueError('Use the immutable diagnostic image identity')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_suffix('.cpp').resolve()
    compiler = args.emsdk.resolve() / 'upstream/bin'
    (output / 'kernel32.def').write_text('LIBRARY KERNEL32.dll\nEXPORTS\nLoadLibraryA\nGetProcAddress\nReadFile\nWriteFile\nGetStdHandle\nExitProcess\n')
    run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / "kernel32.def"}', '/machine:x86', f'/out:{output / "kernel32.lib"}'])
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', source, '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', '/base:0x400000', '/dynamicbase:no', '/fixed', f'/out:{output / "oracle.exe"}', output / 'oracle.obj', output / 'kernel32.lib'])
    cases = [[flags, 0x37f | (rounding << 10), 0x1f80 | (sse_rounding << 13) | sticky]
             for flags in [0x20, 0x22, 0x24, 0x26]
             for rounding in range(4) for sse_rounding in range(4) for sticky in [0, 63]]
    cases += [[flags, control, 0x1f80 | sticky]
              for flags in [0x20, 0x22, 0x24, 0x26]
              for control in [0x137f, 0x1f7f] for sticky in [0, 63]]
    inputs = struct.pack('<I', len(cases)) + b''.join(struct.pack('<3I', *row) for row in cases)
    (output / 'input.bin').write_bytes(inputs)
    container = f'catsystem2-adapter-oracle-{os.getpid()}'
    try:
        result = run(['docker', 'run', '-i', '--init', '--rm', '--name', container, '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{output}:/work', args.image, 'xvfb-run', '-a', 'wine', 'Z:\\work\\oracle.exe'], input=inputs)
    finally:
        subprocess.run(['docker', 'stop', '--timeout', '1', container], capture_output=True)
    if len(result.stdout) != 4 + len(cases) * 52 or struct.unpack_from('<I', result.stdout)[0] != len(cases):
        raise ValueError('D3D9 control oracle output is incomplete')
    rows = [list(struct.unpack_from('<13I', result.stdout, 4 + i * 52)) for i in range(len(cases))]
    report = {'image': args.image, 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(), 'cases': rows}
    (output / 'output.bin').write_bytes(result.stdout)
    (output / 'stderr.log').write_bytes(result.stderr)
    (output / 'golden.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.golden:
        args.golden.write_text(json.dumps(report, separators=(',', ':')) + '\n')
    print(json.dumps({'cases': len(rows), 'output': str(output)}))


if __name__ == '__main__':
    main()
