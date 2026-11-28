#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Run authored D3D9 raster probes; retain the exact diagnostic image identity."""
import argparse
import base64
import hashlib
import json
import os
import random
import struct
from pathlib import Path
import subprocess

DEFAULT_IMAGE = 'sha256:9a6c60e2c760730b99a8ddbc94da318a8ba667e5f206972436bf3820fe0892b7'
CASES = ['normal', 'add1', 'add2', 'multiply', 'invert', 'double', 'perspective-diffuse',
         'wrap', 'mirror', 'clamp', 'border', 'mirror-once', 'half-texel-linear', 'perspective-uv', 'perspective-alpha',
         'fog-linear', 'fog-exp', 'fog-exp2', 'fog-vertex', 'srgb-read', 'srgb-write', 'srgb-read-write',
         'srgb-write-blend', 'anisotropic-minify', 'w-buffer', 'flat-shading', 'wireframe',
         'point-fill', 'cull-clockwise', 'cull-counterclockwise', 'wrap-interpolation',
         'scissor-default', 'pretransformed-lighting', 'point-size', 'wireframe-antialias',
         'srgb-linear-sampling', 'wireframe-alpha', 'wireframe-antialias-alpha', 'point-alpha']


def fbits(value):
    return struct.unpack('<I', struct.pack('<f', value))[0]


def probes():
    result = []
    blend = [[5, 6], [5, 2], [2, 6], [1, 3], [10, 1], [9, 2]]
    for mode, name in enumerate(CASES):
        states = {7: 0, 8: 3, 9: 2, 14: 1, 15: 1, 16: 0, 19: 2, 20: 1, 22: 1, 23: 4,
                  24: 1, 25: 7, 26: 0, 27: 1, 28: 0, 34: 0, 35: 0, 36: 0,
                  37: fbits(1), 38: fbits(1), 48: 0, 52: 0, 137: 0, 140: 0,
                  128: 0, 145: 1, 146: 2, 147: 2, 148: 0, 154: fbits(1),
                  168: 15, 171: 1, 174: 0, 176: 0, 185: 0, 193: 0xffffffff, 194: 0, 206: 0}
        samplers = {1: 2, 2: 2, 3: 1, 4: 0, 5: 2, 6: 2, 7: 0, 8: 0, 9: 0, 10: 1, 11: 0, 12: 0, 13: 0}
        vertices = [dict(x=x, y=y, z=.5, w=1, color=0xffffffff, u=u, v=v)
                    for x, y, u, v in [(0, 0, 0, 0), (8, 0, 1, 0), (0, 8, 0, 1), (8, 8, 1, 1)]]
        texture = {'width': 1, 'height': 1, 'rgba': [255, 255, 255, 255]}
        if mode < 6:
            states[19], states[20] = blend[mode]
            for vertex in vertices:
                vertex['color'] = 0x804080c0
        if mode in [6, 13, 14]:
            for vertex, w in zip(vertices, [1, .5, .25, .125]):
                vertex['w'] = w
        if mode in [6, 14]:
            colors = [0xffff0000, 0xff00ff00, 0xff0000ff, 0xffffffff] if mode == 6 else [0x00ffffff, 0x40ffffff, 0x80ffffff, 0xffffffff]
            for vertex, color in zip(vertices, colors):
                vertex['color'] = color
        if 7 <= mode <= 13:
            pixels = []
            for i in range(8):
                if mode == 12:
                    pixels += [255 if i == 0 else 0, 0, 0, 255]
                elif mode == 13:
                    pixels += [i * 36, i * 36, i * 36, 255]
                else:
                    pixels += [255, 0, 0, 255] if i < 4 else [0, 0, 255, 255]
            texture = {'width': 8, 'height': 1, 'rgba': pixels}
            samplers.update({1: mode - 6 if mode <= 11 else 2, 4: 0xff00ff00,
                             5: 2 if mode == 12 else 1, 6: 2 if mode == 12 else 1})
        if 7 <= mode <= 11:
            for vertex in vertices:
                vertex.update(u=1.25, v=.5)
        if 15 <= mode <= 18:
            states.update({28: 1, 34: 0xff204060, 35: [3, 1, 2, 0][mode - 15],
                           36: fbits(.1), 37: fbits(.9), 38: fbits(2), 140: 3 if mode == 18 else 0})
            for i, vertex in enumerate(vertices):
                vertex.update(z=[.1, .9, .1, .9][i], color=0xffc08040)
        if 19 <= mode <= 22:
            samplers[11] = 1 if mode in [19, 21] else 0
            states[194] = 0 if mode == 19 else 1
            texture = {'width': 1, 'height': 1, 'rgba': [64, 128, 192, 255]}
            if mode == 22:
                states[19], states[20] = 5, 6
                for vertex in vertices:
                    vertex['color'] = 0x80ffffff
        if mode == 23:
            samplers.update({1: 1, 2: 1, 5: 3, 6: 3, 10: 8})
            texture = {'width': 32, 'height': 4, 'rgba': sum(([255 if x % 4 == 0 else 0, 255 if y % 2 else 0, (x * 31) % 256, 255] for y in range(4) for x in range(32)), [])}
            for vertex in vertices:
                vertex['u'] *= 4
        if mode == 24:
            states[7] = 2
            for vertex in vertices:
                vertex.update(z=.25, w=.5, color=0xffff0000)
        if mode == 25:
            states[9] = 1
            for vertex, color in zip(vertices,[0xffff0000,0xff00ff00,0xff0000ff,0xffffffff]):
                vertex['color'] = color
        if mode in [26,27,33,34,36,37,38]:
            states[8] = 1 if mode in [27,33,38] else 2
            for vertex in vertices:
                vertex['x'] = 1 if vertex['x'] == 0 else 7
                vertex['y'] = 1 if vertex['y'] == 0 else 7
            if mode == 33:
                states[154] = fbits(4)
            if mode in [34,37]:
                states[176] = 1
            if mode in [36,37,38]:
                states[19],states[20] = 5,6
                for vertex in vertices:
                    vertex['color'] = 0x804080c0
        if mode in [28,29]:
            states[22] = mode-26
        if mode == 30:
            states[128] = 1
            texture = {'width':8,'height':1,'rgba':sum(([i*36]*3+[255] for i in range(8)),[])}
            for vertex in vertices:
                vertex['u'] = .1 if vertex['u'] == 0 else .9
        if mode == 31:
            states[174] = 1
        if mode == 32:
            states.update({137:1,145:0,146:0,147:0,148:1})
        if mode == 35:
            samplers[11] = 1
            texture = {'width':2,'height':1,'rgba':[0,0,0,255,255,255,255,255]}
        draw = {'vertices': vertices, 'texture': texture, 'renderStates': list(states.items()), 'samplerStates': list(samplers.items())}
        draws = [draw]
        if mode == 24:
            draws.append({**draw, 'vertices': [{**v, 'z': .75, 'w': 1, 'color': 0xff0000ff} for v in vertices]})
        result.append({'name': name, 'clear': 0xff204060, 'draws': draws})
    return result


def probe_bytes(cases):
    output = bytearray(struct.pack('<I', len(cases)))
    for case in cases:
        output += struct.pack('<II', case['clear'], len(case['draws']))
        for draw in case['draws']:
            for key in ['renderStates', 'samplerStates']:
                output += struct.pack('<I', len(draw[key]))
                for pair in draw[key]:
                    output += struct.pack('<II', *pair)
            texture = draw['texture']
            output += struct.pack('<II', texture['width'], texture['height'])
            pixels = texture['rgba']
            output += bytes(sum(([pixels[i + 2], pixels[i + 1], pixels[i], pixels[i + 3]] for i in range(0, len(pixels), 4)), []))
            for v in draw['vertices']:
                output += struct.pack('<ffffIff', v['x'], v['y'], v['z'], v['w'], v['color'], v['u'], v['v'])
    return output


LINE_RENDER_STATES = {7: 0, 8: 3, 9: 2, 14: 1, 15: 0, 16: 0, 19: 2, 20: 1, 22: 1,
                      23: 4, 24: 0, 25: 8, 26: 0, 27: 0, 28: 0, 52: 0, 137: 0, 140: 0,
                      168: 15, 171: 1, 174: 0, 176: 0, 185: 0, 193: 0xffffffff, 194: 0,
                      206: 0}


def line_probes():
    cases = []

    def draw(coordinates, *, colors=None, rhw=None, depth=None, states=None, primitive=2,
             viewport=None, scissor=None, index_format=0):
        vertices = [
            [x, y, depth[i] if depth else .5, rhw[i] if rhw else 1,
             colors[i] if colors else 0xff4080c0]
            for i, (x, y) in enumerate(coordinates)
        ]
        result = {'primitive': primitive, 'vertices': vertices,
                  'count': len(vertices) // 2 if primitive == 2 else len(vertices) - 1}
        if states:
            result['states'] = list(states.items())
        if viewport:
            result['viewport'] = viewport
        if scissor:
            result['scissor'] = scissor
        if index_format:
            result.update({'count': 2, 'indices': [1, 3, 2, 1], 'indexFormat': index_format,
                           'minimum': 1, 'vertexCount': len(vertices) - 1})
        return result

    def case(name, *draws, rounding=False):
        cases.append({'name': name, 'clear': 0xff182c3e, 'draws': draws,
                      **({'channelRounding': 1} if rounding else {})})

    samples = [
        ('horizontal', [(1, 2), (7, 2)]),
        ('horizontal-reversed', [(7, 2), (1, 2)]),
        ('vertical', [(2, 1), (2, 7)]),
        ('vertical-reversed', [(2, 7), (2, 1)]),
        ('diagonal', [(1, 1), (7, 7)]),
        ('diagonal-reversed', [(7, 7), (1, 1)]),
        ('opposite-diagonal', [(1, 7), (7, 1)]),
        ('opposite-diagonal-reversed', [(7, 1), (1, 7)]),
        ('x-major', [(1, 2), (7, 5)]),
        ('y-major', [(2, 1), (5, 7)]),
        ('half-row', [(1, 2.5), (7, 2.5)]),
        ('half-column', [(2.5, 1), (2.5, 7)]),
        ('quarter', [(1.125, 1.375), (6.625, 4.75)]),
        ('vertical-quarter', [(2.375, -2.625), (2.375, 7.75)]),
        ('partial', [(-4, 2), (10, 5)]),
        ('degenerate', [(3, 3), (3, 3)]),
        ('subpixel', [(2.1, 2.1), (2.2, 2.2)]),
    ]
    for name, coordinates in samples:
        case(name, draw(coordinates))
    blend = {19: 5, 20: 6, 27: 1}
    case('overlap-blend', draw([(1, 3), (7, 3), (3, 1), (3, 7)],
                              colors=[0x804080c0] * 4, states=blend), rounding=True)
    colors = [0xffff0000, 0xff0000ff]
    case('gouraud', draw([(1, 2), (7, 2)], colors=colors), rounding=True)
    case('gouraud-rhw', draw([(1, 2), (7, 2)], colors=colors, rhw=[1, .25]), rounding=True)
    case('gouraud-diagonal', draw([(1, 1), (7, 4)], colors=colors), rounding=True)
    case('flat-shade', draw([(1, 1), (7, 4)], colors=colors, states={9: 1}))
    case('gouraud-reversed', draw([(7, 4), (1, 1)], colors=colors), rounding=True)
    case('depth', draw([(1, 3), (7, 3)], depth=[.2, .8], states={7: 1}),
         draw([(1, 3), (7, 3)], colors=[0xff00ff00] * 2, depth=[.5, .5], states={7: 1}))
    case('line-strip', draw([(1, 1), (6, 4), (1, 7), (1, 1)], primitive=3))
    case('line-antialias', draw([(1, 1), (6, 4)], colors=[0x804080c0] * 2,
                               states=blend | {176: 1}), rounding=True)
    case('viewport', draw([(-1, 4), (9, 4)], viewport=[2, 1, 4, 5]))
    case('scissor', draw([(-1, 4), (9, 4)], scissor=[2, 2, 6, 5], states={174: 1}))
    for index_format in [101, 102]:
        case(f'indexed-{index_format}',
             draw([(0, 0), (1, 1), (1, 6), (6, 6)], index_format=index_format))
    rng = random.Random(0x4c9220)
    for index in range(96):
        case(f'random-{index:03d}',
             draw([(rng.randrange(-32, 161) / 16, rng.randrange(-32, 161) / 16)
                   for _ in range(2)]))
    return cases


def line_probe_bytes(cases):
    output = bytearray(struct.pack('<I', 0x80000000 | len(cases)))
    for case in cases:
        output += struct.pack('<II', case['clear'], len(case['draws']))
        for draw in case['draws']:
            states = LINE_RENDER_STATES | dict(draw.get('states', []))
            output += struct.pack('<I', len(states))
            for pair in states.items():
                output += struct.pack('<II', *pair)
            vertices = draw['vertices']
            index_format = draw.get('indexFormat', 0)
            output += struct.pack('<4I4i4I', *draw.get('viewport', [0, 0, 8, 8]),
                                  *draw.get('scissor', [0, 0, 8, 8]), draw['primitive'],
                                  draw['count'], len(vertices), index_format)
            for vertex in vertices:
                output += struct.pack('<ffffI', *vertex)
            if index_format:
                indices = draw['indices']
                output += struct.pack('<III', draw['minimum'], draw['vertexCount'], len(indices))
                output += struct.pack('<' + ('H' if index_format == 101 else 'I') * len(indices),
                                      *indices)
    return output


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, capture_output=True, timeout=45, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--image', default=DEFAULT_IMAGE, help='Explicit immutable diagnostic Docker image ID')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--lines', action='store_true', help='Probe untextured XYZRHW line draws')
    args = parser.parse_args()
    image = run(['docker', 'image', 'inspect', args.image, '--format', '{{.Id}}']).stdout.decode().strip()
    if image != args.image:
        raise ValueError('Pass the immutable SHA-256 image ID, not a mutable tag')
    output = (args.output or Path('.local/ppi-audit/d3d9-lines' if args.lines else '.local/ppi-audit/d3d9')).resolve()
    output.mkdir(parents=True, exist_ok=True)
    compiler = args.emsdk.resolve() / 'upstream/bin'
    source = Path(__file__).with_suffix('.cpp')
    (output / 'kernel32.def').write_text('LIBRARY KERNEL32.dll\nEXPORTS\nLoadLibraryA\nGetProcAddress\nReadFile\nWriteFile\nGetStdHandle\nExitProcess\n')
    run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / "kernel32.def"}', '/machine:x86', f'/out:{output / "kernel32.lib"}'])
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', source, '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', '/base:0x400000',
         '/dynamicbase:no', '/fixed', f'/out:{output / "oracle.exe"}', output / 'oracle.obj', output / 'kernel32.lib'])
    cases = line_probes() if args.lines else probes()
    inputs = line_probe_bytes(cases) if args.lines else probe_bytes(cases)
    (output / 'probe.bin').write_bytes(inputs)
    container = f'catsystem2-d3d9-oracle-{os.getpid()}'
    try:
        result = run(['docker', 'run', '-i', '--init', '--rm', '--name', container, '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}',
                      '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all',
                      '-v', f'{output}:/work', image, 'xvfb-run', '-a', 'wine', 'Z:\\work\\oracle.exe'], input=inputs)
    except subprocess.TimeoutExpired:
        subprocess.run(['docker', 'stop', '--timeout', '1', container], capture_output=True)
        raise
    expected = len(cases) * 256 + 512
    if len(result.stdout) != expected:
        raise ValueError(f'Expected {expected} BGRA bytes, received {len(result.stdout)}')
    caps, pixels = result.stdout[:512], result.stdout[512:]
    (output / 'device-caps.bin').write_bytes(caps)
    (output / 'native.bgra').write_bytes(pixels)
    golden = {'kind': 'Authored D3D9 XYZRHW raster golden', 'width': 8, 'height': 8, 'format': 'RGBA8', 'wineImage': image,
              'harnessSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'deviceCaps': {'rasterCaps': struct.unpack_from('<I', caps, 36)[0], 'textureFilterCaps': struct.unpack_from('<I', caps, 64)[0],
                             'maxAnisotropy': struct.unpack_from('<I', caps, 108)[0]}, 'cases': []}
    if args.lines:
        golden['kind'] = 'Authored D3D9 untextured XYZRHW lines'
        golden['lineRenderStates'] = list(LINE_RENDER_STATES.items())
    for index, case in enumerate(cases):
        name = case['name']
        bgra = pixels[index * 256:(index + 1) * 256]
        rgba = bytearray(bgra)
        for at in range(0, 256, 4):
            rgba[at], rgba[at + 2] = bgra[at + 2], bgra[at]
        row = {'name': name, 'probe': case, 'rgbaBase64': base64.b64encode(rgba).decode(), 'rgbaSHA256': hashlib.sha256(rgba).hexdigest()}
        if case.get('channelRounding'):
            row['channelRounding'] = case['channelRounding']
        if name == 'anisotropic-minify':
            row['hardwareDependent'] = 'Device-specific anisotropic kernel; compare footprint energy rather than bitwise driver pixels.'
        if name.startswith('wireframe'):
            row['lineEndpointCoverage'] = 'D3D9/OpenGL endpoint and antialias join coverage depends on device rasterization; interior line pixels remain exact.'
        golden['cases'].append(row)
    (output / 'golden.json').write_text(json.dumps(golden, indent=2) + '\n')
    (output / 'source.json').write_text(json.dumps({'image': image, 'harnessSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
                                                 'emsdk': '3.1.74', 'source': source.name}, indent=2) + '\n')
    print(json.dumps({'cases': len(cases), 'output': str(output / 'golden.json')}))


if __name__ == '__main__':
    main()
