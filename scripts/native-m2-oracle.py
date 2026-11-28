#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Execute the original M2 wrapper and driver on Wine with authored PSB/PSZ media."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import zlib

IMAGE = 'sha256:9a6c60e2c760730b99a8ddbc94da318a8ba667e5f206972436bf3820fe0892b7'
ENGINE_SHA256 = 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0'
DRIVER_SHA256 = '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce'


def run(command, **kwargs):
    return subprocess.run([str(part) for part in command], check=True, capture_output=True, timeout=60, **kwargs)


def decode(raw):
    at = 0
    def take(count):
        nonlocal at
        data = raw[at:at+count]
        if len(data) != count:
            raise ValueError('Truncated native wrapper oracle output')
        at += count
        return data
    def word():
        return struct.unpack('<I', take(4))[0]
    loaded = word()
    frames = []
    for _ in range(4):
        draws = []
        while True:
            slot = word()
            if not slot:
                break
            if slot not in [83, 84]:
                raise ValueError('Invalid original DrawUP record')
            kind, count, stride, fvf = [word() for _ in range(4)]
            draw = dict(slot=slot, type=kind, count=count, stride=stride, fvf=fvf)
            vertices = count*3 if kind == 4 else count+2 if kind in [5, 6] else count*2 if kind == 2 else count+1 if kind == 3 else count
            if slot == 84:
                minimum, size, fmt = [word() for _ in range(3)]
                draw.update(minimum=minimum, vertices=size, format=fmt)
                draw['indices'] = base64.b64encode(take(vertices*(2 if fmt == 101 else 4))).decode()
                vertices = minimum+size
            draw['bytes'] = base64.b64encode(take(vertices*stride)).decode()
            draws.append(draw)
        result, width, height = word(), word(), word()
        pixels = bytearray(take(width*height*4))
        for i in range(0, len(pixels), 4):
            pixels[i], pixels[i+2] = pixels[i+2], pixels[i]
        frames.append(dict(result=result, width=width, height=height, draws=draws, rgbaDeflate=base64.b64encode(zlib.compress(pixels, 9)).decode()))
    if at != len(raw):
        raise ValueError('Trailing native wrapper output')
    return dict(loaded=loaded, frames=frames)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--driver', type=Path, required=True)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--image', default=IMAGE)
    parser.add_argument('--output', type=Path, default=Path('.local/emote-audit/wrapper-oracle'))
    parser.add_argument('--golden', type=Path)
    args = parser.parse_args()
    for source, identity in [(args.engine, ENGINE_SHA256), (args.driver, DRIVER_SHA256)]:
        if hashlib.sha256(source.read_bytes()).hexdigest() != identity:
            raise ValueError('This oracle requires the frozen source identity')
    if run(['docker', 'image', 'inspect', args.image, '--format', '{{.Id}}']).stdout.decode().strip() != args.image:
        raise ValueError('Use the immutable diagnostic image identity')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    fixture = Path('tests/fixtures/native-m2-fixture.mjs').resolve().as_uri()
    sources = json.loads(run([args.node, '--input-type=module', '-e', f"import{{nativeM2Files}}from'{fixture}';process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(nativeM2Files()).map(([k,v])=>[k,[...v]]))));"]).stdout)
    sources = {key: bytes(value) for key, value in sources.items()}
    compiler = args.emsdk.resolve() / 'upstream/bin'
    source = Path(__file__).with_suffix('.cpp').resolve()
    engine_bytes = args.engine.read_bytes()
    pe = struct.unpack_from('<I', engine_bytes, 60)[0]
    import_rva = struct.unpack_from('<I', engine_bytes, pe+24+104)[0]
    composite_source = Path(__file__).with_name('native-ppi-wine-oracle.py')
    spec = importlib.util.spec_from_file_location('private_pe_host', composite_source)
    composite_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(composite_module)
    exports = 'LoadLibraryA GetProcAddress ReadFile WriteFile GetStdHandle ExitProcess VirtualProtect GetProcessHeap HeapAlloc HeapFree'.split()
    (output/'kernel32.def').write_text('LIBRARY KERNEL32.dll\nEXPORTS\n'+'\n'.join(exports)+'\n')
    run([compiler/'lld', '-flavor', 'link', '/lib', f'/def:{output/"kernel32.def"}', '/machine:x86', f'/out:{output/"kernel32.lib"}'])
    run([compiler/'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', f'-DENGINE_IMPORT_RVA={import_rva}', '-c', source, '-o', output/'oracle.obj'])
    run([compiler/'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', '/base:0x4000000', '/dynamicbase:no', '/fixed', f'/out:{output/"harness.exe"}', output/'oracle.obj', output/'kernel32.lib'])
    (output/'oracle.exe').write_bytes(composite_module.composite(engine_bytes, (output/'harness.exe').read_bytes()))
    golden = dict(builderSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), compositeSHA256=hashlib.sha256(composite_source.read_bytes()).hexdigest(), engineImportRVA=import_rva, kind='Original engine M2 wrapper and original E-mote driver, authored model', engineSHA256=ENGINE_SHA256, driverSHA256=DRIVER_SHA256, harnessSHA256=hashlib.sha256(source.read_bytes()).hexdigest(), modelSHA256=hashlib.sha256(sources['authored.psb']).hexdigest(), wineImage=args.image, variants={})
    for variant in ['psb', 'psz']:
        directory = output/variant
        directory.mkdir(exist_ok=True)
        for name, data in sources.items():
            if name == 'authored.psb':
                # Only the selected basename resource may exist. Leaving an
                # uncompressed side file could conceal a fallback in the PSZ
                # path being compared.
                (directory/name).unlink(missing_ok=True)
            else:
                (directory/name).write_bytes(data)
        model = sources['authored.psb']
        if variant == 'psz':
            compressed = zlib.compress(model)
            model = b'PSZ\0'+struct.pack('<III', len(compressed), len(model), 0)+compressed
        (directory/'authored').write_bytes(model)
        container = f'catsystem2-m2-oracle-{os.getpid()}-{variant}'
        command = ['docker', 'run', '--init', '--rm', '--name', container, '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{output}:/work', '-v', f'{args.engine.resolve()}:/input/engine.exe:ro', '-v', f'{args.driver.resolve()}:/input/emotedriver.dll:ro', '-w', f'/work/{variant}', args.image, 'xvfb-run', '-a', 'wine', 'Z:\\work\\oracle.exe']
        try:
            native = run(command)
        except subprocess.CalledProcessError as error:
            (directory/'stderr.txt').write_bytes(error.stderr)
            (directory/'native.bin').write_bytes(error.stdout)
            raise
        except subprocess.TimeoutExpired:
            subprocess.run(['docker', 'stop', '--timeout', '1', container], capture_output=True)
            raise
        (directory/'native.bin').write_bytes(native.stdout)
        (directory/'stderr.txt').write_bytes(native.stderr)
        golden['variants'][variant] = decode(native.stdout)
    if golden['variants']['psb'] != golden['variants']['psz']:
        raise ValueError('The original PSB and PSZ wrapper paths differ')
    destination = args.golden or output/'golden.json'
    destination.write_text(json.dumps(golden, indent=2)+'\n')
    print(json.dumps(dict(golden=str(destination), frames=4, draws=sum(len(frame['draws']) for frame in golden['variants']['psb']['frames']))))


if __name__ == '__main__':
    main()
