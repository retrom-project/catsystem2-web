#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Capture original 671DF0's D3D9 state calls, without a Windows/device runtime."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).with_name('native-ppi-oracle.py')
    spec = importlib.util.spec_from_file_location('ppi_native_oracle', source)
    base = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode = True
    spec.loader.exec_module(base)
    raw = args.exe.read_bytes()
    if hashlib.sha256(raw).hexdigest() != base.EXPECTED:
        raise ValueError('This oracle requires the frozen prepared engine 2.6.1.76')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    assembly = ['.code32\n.global _start\n_start:\nmovl $renderer, 0xb90778\nmovl $device, renderer+308\nmovl $2, renderer+348\nmovl $2, renderer+352\n']
    cases = []
    for depth in [0, 1]:
        for mode in range(8):
            for blend in range(6):
                cases.append({'depthStencil': depth, 'steps': [[mode, blend, 1]]})
    for depth in [0, 1]:
        for blend in range(6):
            cases.append({'depthStencil': depth, 'steps': [[0, blend, 1], [0, blend, 0]]})
            cases.append({'depthStencil': depth, 'steps': [[0, blend, 1], [0, (blend + 1) % 6, 0], [1, (blend + 1) % 6, 0]]})
    for index, case in enumerate(cases):
        assembly.append(f'movl $0, count\nmovl $7, renderer+340\nmovl $7, renderer+344\nmovl ${case["depthStencil"]}, renderer+1500\n')
        for mode, blend, force in case['steps']:
            assembly.append(f'pushl ${force}\npushl ${blend}\npushl ${mode}\nmovl $renderer,%ecx\nmovl $0x671df0,%eax\ncall *%eax\n')
        assembly.append('movl $4,%eax\nmovl $1,%ebx\nmovl $count,%ecx\nmovl $4,%edx\nint $0x80\nmovl count,%edx\nshll $4,%edx\nmovl $4,%eax\nmovl $1,%ebx\nmovl $trace,%ecx\nint $0x80\n')
    assembly.append(r'''
  movl $1,%eax
  xorl %ebx,%ebx
  int $0x80
cooperative:
  xorl %eax,%eax
  ret $4
render_state:
  movl count,%eax
  shll $4,%eax
  addl $trace,%eax
  movl $1,(%eax)
  movl $0,4(%eax)
  movl 8(%esp),%edx
  movl %edx,8(%eax)
  movl 12(%esp),%edx
  movl %edx,12(%eax)
  incl count
  xorl %eax,%eax
  ret $12
texture_stage:
  movl $2,%ecx
  jmp common_stage
sampler_state:
  movl $3,%ecx
common_stage:
  movl count,%eax
  shll $4,%eax
  addl $trace,%eax
  movl %ecx,(%eax)
  movl 8(%esp),%edx
  movl %edx,4(%eax)
  movl 12(%esp),%edx
  movl %edx,8(%eax)
  movl 16(%esp),%edx
  movl %edx,12(%eax)
  incl count
  xorl %eax,%eax
  ret $16
.align 16
renderer: .space 2048
device: .long vtable
vtable:
  .space 12
  .long cooperative
  .space 212
  .long render_state
  .space 36
  .long texture_stage
  .long 0
  .long sampler_state
count: .long 0
trace: .space 16384
''')
    asm, obj, binary, elf = [output / ('render-state' + suffix) for suffix in ['.s', '.o', '.bin', '.elf']]
    asm.write_text(''.join(assembly))
    subprocess.run(['as', '--32', '-o', obj, asm], check=True)
    subprocess.run(['ld', '-m', 'elf_i386', '--oformat', 'binary', '-Ttext', '0x10000000', '-o', binary, obj], check=True)
    base.write_elf(elf, base.image_segments(raw), binary.read_bytes())
    result = subprocess.run(['qemu-i386', elf], check=True, capture_output=True).stdout
    (output / 'native.bin').write_bytes(result)
    offset = 0
    for case in cases:
        count = struct.unpack_from('<I', result, offset)[0]
        offset += 4
        case['calls'] = [list(struct.unpack_from('<4I', result, offset + i * 16)) for i in range(count)]
        offset += count * 16
    if offset != len(result):
        raise ValueError('Trailing state-call data')
    manifest = {'engineSHA256': base.EXPECTED, 'handlerVA': '0x00671df0', 'callRecord': ['kind:1=render,2=texture-stage,3=sampler', 'stage', 'state', 'value'], 'cases': cases}
    (output / 'golden.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'cases': len(cases), 'calls': sum(len(case['calls']) for case in cases), 'output': str(output / 'golden.json')}))


if __name__ == '__main__':
    main()
