#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Build and execute original PPI DLL probes under a pinned private Wine host.

Only a frozen engine binary is accepted. Generated composite PE files contain
fixture bytes and must stay in ignored local storage. The main image reserves
the engine's preferred VA before Wine creates its process heaps; an EXE loaded
as a data module cannot do so because this frozen engine has no PE relocations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

EXPECTED = 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0'
WINE_IMAGE = 'retrom-diagnostic-wine:8-debian12'
WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, capture_output=True,
                          timeout=60, **kwargs)


def composite(engine, harness):
    image, stub = bytearray(engine), bytearray(harness)
    pe, hp = (struct.unpack_from('<I', data, 60)[0] for data in (image, stub))
    opt, ho = pe + 24, hp + 24
    section = opt + struct.unpack_from('<H', image, pe + 20)[0]
    hs = ho + struct.unpack_from('<H', stub, hp + 20)[0]
    count, hc = struct.unpack_from('<H', image, pe + 6)[0], struct.unpack_from('<H', stub, hp + 6)[0]
    if section + (count + hc) * 40 > struct.unpack_from('<I', image, opt + 60)[0]:
        raise ValueError('Composite PE section headers exceed reserved headers')
    delta = struct.unpack_from('<I', stub, ho + 28)[0] - struct.unpack_from('<I', image, opt + 28)[0]
    sections = [struct.unpack_from('<8sIIII', stub, hs + 40 * i) for i in range(hc)]

    def raw(rva):
        return next(offset + rva - va for _, vs, va, size, offset in sections if va <= rva < va + max(vs, size))

    cursor = raw(struct.unpack_from('<I', stub, ho + 104)[0])
    while any(stub[cursor:cursor + 20]):
        lookup, stamp, chain, name, iat = struct.unpack_from('<5I', stub, cursor)
        source, target, index = raw(lookup or iat), raw(iat), 0
        while (value := struct.unpack_from('<I', stub, source + 4 * index)[0]):
            if not value & 0x80000000:
                for address in (source + 4 * index, target + 4 * index):
                    struct.pack_into('<I', stub, address, value + delta)
            index += 1
        struct.pack_into('<5I', stub, cursor, lookup + delta if lookup else 0, stamp, chain, name + delta, iat + delta)
        cursor += 20
    # Original imports/TLS/entry are deliberately not initialized: this is a
    # bounded PPF oracle, not a native boot of the complete game engine.
    for index in range(16):
        struct.pack_into('<II', image, opt + 96 + index * 8, 0, 0)
    for index in (1, 12):
        va, size = struct.unpack_from('<II', stub, ho + 96 + index * 8)
        struct.pack_into('<II', image, opt + 96 + index * 8, va + delta if va else 0, size)
    for field in (16, 56):
        struct.pack_into('<I', image, opt + field, struct.unpack_from('<I', stub, ho + field)[0] + delta)
    struct.pack_into('<H', image, opt + 70, 0)
    struct.pack_into('<H', image, pe + 6, count + hc)
    for index in range(hc):
        record = bytearray(stub[hs + 40 * index:hs + 40 * (index + 1)])
        name, vs, va, size, source = struct.unpack_from('<8sIIII', record)
        offset = (len(image) + 511) & ~511
        image.extend(bytes(offset - len(image)))
        image.extend(stub[source:source + size])
        struct.pack_into('<8sIIII', record, 0, (b'h' + name[1:])[:8], vs, va + delta, size, offset)
        image[section + 40 * (count + index):section + 40 * (count + index + 1)] = record
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, required=True)
    parser.add_argument('--plugins', type=Path, required=True)
    parser.add_argument('--plugin', action='append', help='One basename; repeat to select several. Default: all .ppi files.')
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('.local/ppi-audit/wine'))
    parser.add_argument('--control-word', type=lambda value: int(value, 0))
    parser.add_argument('--record-controls', action='store_true')
    args = parser.parse_args()
    engine = args.exe.read_bytes()
    if hashlib.sha256(engine).hexdigest() != EXPECTED:
        raise ValueError('Frozen native oracle engine hash mismatch')
    image_id = run(['docker', 'image', 'inspect', WINE_IMAGE, '--format', '{{.Id}}']).stdout.decode().strip()
    if image_id != WINE_ID:
        raise ValueError(f'Wine oracle image mismatch: {image_id}')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    repository = Path(__file__).resolve().parent.parent
    plist = (repository / 'tests/fixtures/ppi-native.plist').read_bytes()
    (output / 'ppi-oracle-plist.inc').write_text('static char plist[]={' + ','.join(map(str, plist + b'\0')) + '};\n')
    (output / 'kernel32.def').write_text('LIBRARY KERNEL32.dll\nEXPORTS\n' + '\n'.join([
        'LoadLibraryA', 'GetProcAddress', 'WriteFile', 'GetStdHandle', 'ExitProcess', 'GetCommandLineA', 'FreeLibrary']) + '\n')
    compiler = args.emsdk.resolve() / 'upstream/bin'
    run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / "kernel32.def"}', '/machine:x86', f'/out:{output / "kernel32.lib"}'])
    defines = []
    if args.control_word is not None:
        if args.control_word < 0 or args.control_word > 0xffff:
            raise ValueError('The x87 control word must fit a WORD')
        defines.append(f'-DPPI_FPCW={args.control_word}')
    if args.record_controls:
        defines.append('-DPPI_RECORD_FPU=1')
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', *defines,
         '-I', output, '-c', repository / 'scripts/native-ppi-wine-oracle.cpp', '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', '/base:0xC00000',
         '/dynamicbase:no', '/fixed', f'/out:{output / "harness.exe"}', output / 'oracle.obj', output / 'kernel32.lib'])
    (output / 'oracle.exe').write_bytes(composite(engine, (output / 'harness.exe').read_bytes()))
    names = args.plugin or sorted(p.name for p in args.plugins.glob('*.ppi'))
    results = []
    for name in names:
        if Path(name).name != name:
            raise ValueError('The selected plug-in must be a basename')
        result = run(['docker', 'run', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}',
                      '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all',
                      '-v', f'{output}:/work', '-v', f'{args.plugins.resolve()}:/plugins:ro', WINE_ID,
                      'wine', 'Z:\\work\\oracle.exe', f'Z:\\plugins\\{name}'])
        expected_length = 4144 + (13 * 12 if args.record_controls else 0)
        if len(result.stdout) != expected_length:
            raise ValueError(f'{name}: expected {expected_length} bytes, received {len(result.stdout)}')
        (output / f'{name}.bin').write_bytes(result.stdout)
        record = {'name': name, 'pluginSHA256': hashlib.sha256((args.plugins / name).read_bytes()).hexdigest(),
                  'recordSHA256': hashlib.sha256(result.stdout[:4144]).hexdigest(), 'bytes': 4144}
        if args.record_controls:
            record['controls'] = [list(struct.unpack_from('<3I', result.stdout, 4144 + index * 12)) for index in range(13)]
        results.append(record)
    manifest = {'engineSHA256': EXPECTED, 'wineImage': WINE_ID, 'frames': ['Init', 0, 1, 2, 15, 60, 61],
                'particles': 4, 'recordBytes': 148, 'plistSHA256': hashlib.sha256(plist).hexdigest(), 'plugins': results}
    if args.control_word is not None:
        manifest['controlWord'] = args.control_word
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'plugins': len(results), 'manifest': str(output / 'manifest.json')}))


if __name__ == '__main__':
    main()
