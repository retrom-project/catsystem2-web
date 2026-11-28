#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Capture original Windows LPB/LV parsers against authored public sidecars."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--driver', type=Path, required=True)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--output', type=Path, default=Path('.local/emote-audit/lip-oracle'))
    parser.add_argument('--golden', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    common = module(root/'native-m2-oracle.py', 'm2_oracle')
    pe_host = module(root/'native-ppi-wine-oracle.py', 'pe_host')
    run = common.run
    for path, identity in [(args.engine, common.ENGINE_SHA256), (args.driver, common.DRIVER_SHA256)]:
        if hashlib.sha256(path.read_bytes()).hexdigest() != identity:
            raise ValueError('The lip oracle requires the frozen reviewed binaries')
    if run(['docker', 'image', 'inspect', common.IMAGE, '--format', '{{.Id}}']).stdout.decode().strip() != common.IMAGE:
        raise ValueError('Use the immutable diagnostic Wine image')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_suffix('.cpp').resolve()
    compiler = args.emsdk.resolve()/'upstream/bin'
    engine = args.engine.read_bytes()
    pe = struct.unpack_from('<I', engine, 60)[0]
    imports = struct.unpack_from('<I', engine, pe+24+104)[0]
    exports = 'LoadLibraryA GetProcAddress ReadFile WriteFile GetStdHandle ExitProcess VirtualProtect GetProcessHeap HeapAlloc HeapFree'.split()
    (out/'kernel32.def').write_text('LIBRARY KERNEL32.dll\nEXPORTS\n'+'\n'.join(exports)+'\n')
    run([compiler/'lld', '-flavor', 'link', '/lib', f'/def:{out/"kernel32.def"}', '/machine:x86', f'/out:{out/"kernel32.lib"}'])
    run([compiler/'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', f'-DENGINE_IMPORT_RVA={imports}', '-c', source, '-o', out/'oracle.obj'])
    run([compiler/'lld', '-flavor', 'link', '/entry:lipStart', '/subsystem:console', '/nodefaultlib', '/machine:x86', '/base:0x4000000', '/dynamicbase:no', '/fixed', f'/out:{out/"host.exe"}', out/'oracle.obj', out/'kernel32.lib'])
    (out/'oracle.exe').write_bytes(pe_host.composite(engine, (out/'host.exe').read_bytes()))
    command = ['docker', 'run', '--init', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{out}:/work', '-v', f'{args.driver.resolve()}:/input/emotedriver.dll:ro', '-w', '/work', common.IMAGE, 'xvfb-run', '-a', 'wine', 'Z:\\work\\oracle.exe']
    result = run(command)
    (out/'native.bin').write_bytes(result.stdout)
    (out/'wine.log').write_bytes(result.stderr)
    fixture = (root.parent/'tests/fixtures/native-lip.mjs').as_uri()
    authored = json.loads(run([args.node, '--input-type=module', '-e', f"import{{nativeLPB,nativeLV}}from'{fixture}';process.stdout.write(JSON.stringify([[...nativeLPB()],[...nativeLV()]]));"]).stdout)
    raw = result.stdout
    data = bytes(authored[0])+bytes(authored[1])
    if raw[:len(data)] != data:
        raise ValueError('Windows and browser authored lip inputs differ')
    words = list(struct.unpack('<'+'I'*((len(raw)-len(data))//4), raw[len(data):]))
    if len(words) != 61:
        raise ValueError(f'Unexpected original lip output length {len(words)}')
    golden = dict(engineSHA256=common.ENGINE_SHA256, wineImage=common.IMAGE,
                  inputsSHA256=hashlib.sha256(data).hexdigest(),
                  sourceSHA256={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__), source, root/'native-m2-oracle.cpp', root/'native-ppi-d3d9-oracle.cpp', root/'native-ppi-wine-oracle.py']},
                  lpb=dict(result=words[0], count=words[1], values=words[2:10], backup=words[10:18]),
                  failures=[words[18+i*5:23+i*5] for i in range(5)],
                  lv=dict(result=words[43], count=words[44], values=words[45:53], backup=words[53:61]))
    destination = args.golden or out/'golden.json'
    destination.write_text(json.dumps(golden, indent=2)+'\n')
    print(json.dumps(dict(output=str(destination), lpb=golden['lpb'], lv=golden['lv'])))


if __name__ == '__main__':
    main()
