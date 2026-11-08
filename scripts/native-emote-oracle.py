#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Run the separately supplied E-mote DLL against an authored PSB on Wine/D3D9."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import zlib

IMAGE = 'sha256:9a6c60e2c760730b99a8ddbc94da318a8ba667e5f206972436bf3820fe0892b7'
DRIVER_SHA256 = '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce'


def run(command, **kwargs):
    return subprocess.run([str(value) for value in command], capture_output=True, check=True, timeout=45, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--driver', type=Path, required=True)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--image', default=IMAGE)
    parser.add_argument('--output', type=Path, default=Path('.local/emote-audit/oracle'))
    parser.add_argument('--golden', type=Path)
    args = parser.parse_args()
    driver = args.driver.resolve()
    if hashlib.sha256(driver.read_bytes()).hexdigest() != DRIVER_SHA256:
        raise ValueError('This oracle pins the reviewed driver identity; do not substitute a DLL')
    if run(['docker', 'image', 'inspect', args.image, '--format', '{{.Id}}']).stdout.decode().strip() != args.image:
        raise ValueError('Use the immutable diagnostic image identity')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    compiler = args.emsdk.resolve() / 'upstream/bin'
    source = Path(__file__).with_suffix('.cpp').resolve()
    fixture = Path('tests/fixtures/emote-psb-fixture.mjs').resolve().as_uri()
    model = run([args.node, '--input-type=module', '-e', f"import{{emotePSBFixture}}from'{fixture}';process.stdout.write(emotePSBFixture());"]).stdout
    (output / 'authored.psb').write_bytes(model)
    (output / 'kernel32.def').write_text('LIBRARY KERNEL32.dll\nEXPORTS\nLoadLibraryA\nGetProcAddress\nReadFile\nWriteFile\nGetStdHandle\nExitProcess\nVirtualAlloc\n')
    run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / "kernel32.def"}', '/machine:x86', f'/out:{output / "kernel32.lib"}'])
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', source, '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', '/base:0x400000', '/dynamicbase:no', '/fixed', f'/out:{output / "oracle.exe"}', output / 'oracle.obj', output / 'kernel32.lib'])
    inputs = struct.pack('<I', len(model)) + model
    (output / 'input.bin').write_bytes(inputs)
    container = f'catsystem2-emote-oracle-{os.getpid()}'
    try:
        native = run(['docker', 'run', '-i', '--init', '--rm', '--name', container, '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{output}:/work', '-v', f'{driver}:/input/emotedriver.dll:ro', args.image, 'xvfb-run', '-a', 'wine', 'Z:\\work\\oracle.exe'], input=inputs).stdout
    except subprocess.TimeoutExpired:
        subprocess.run(['docker', 'stop', '--timeout', '1', container], capture_output=True)
        raise
    (output / 'native.bin').write_bytes(native)
    at = 0

    def take(size):
        nonlocal at
        data = native[at:at + size]
        if len(data) != size:
            raise ValueError('Truncated native oracle output')
        at += size
        return data

    def word():
        return struct.unpack('<I', take(4))[0]

    def vertex_count(primitive, count):
        return count * 3 if primitive == 4 else count + 2 if primitive in [5, 6] else count * 2 if primitive == 2 else count

    golden = {'kind': 'Original E-mote DLL software-vertex oracle, authored PSB', 'driverSHA256': DRIVER_SHA256, 'harnessSHA256': hashlib.sha256(source.read_bytes()).hexdigest(), 'modelSHA256': hashlib.sha256(model).hexdigest(), 'wineImage': args.image, 'width': 256, 'height': 256, 'variables': [], 'frames': []}
    for _ in range(word()):
        golden['variables'].append(take(word()).decode())
    for _ in range(4):
        frame = {'variableBits': word(), 'draws': []}
        while True:
            slot = word()
            if not slot:
                break
            if slot not in [83, 84]:
                raise ValueError('Unknown native DrawUP record')
            draw = dict(zip(['slot', 'type', 'count', 'stride', 'fvf'], [slot, word(), word(), word(), word()]))
            count = vertex_count(draw['type'], draw['count'])
            if slot == 84:
                draw.update(zip(['minimum', 'vertices', 'format'], [word(), word(), word()]))
                draw['indices'] = base64.b64encode(take(count * (2 if draw['format'] == 101 else 4))).decode()
                count = draw['minimum'] + draw['vertices']
            draw['bytes'] = base64.b64encode(take(count * draw['stride'])).decode()
            frame['draws'].append(draw)
        pixels = bytearray(take(256 * 256 * 4))
        for i in range(0, len(pixels), 4):
            pixels[i], pixels[i + 2] = pixels[i + 2], pixels[i]
        frame['rgbaDeflate'] = base64.b64encode(zlib.compress(pixels, 9)).decode()
        golden['frames'].append(frame)
    if at != len(native):
        raise ValueError('Trailing native oracle output')
    destination = args.golden or output / 'golden.json'
    destination.write_text(json.dumps(golden, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'golden': str(destination), 'frames': len(golden['frames']), 'draws': sum(len(f['draws']) for f in golden['frames']), 'driverSHA256': DRIVER_SHA256}))


if __name__ == '__main__':
    main()
