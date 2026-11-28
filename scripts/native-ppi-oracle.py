#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Execute selected frozen PE particle routines in a private ELF32 harness.

This does not initialize the Windows engine. The projection probe selects the
binary's baseline D3DX dispatch table, supplies a fixed screen-size service,
and translates fixture pointers by identity. No game assets are emitted to Git.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess

EXPECTED = 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0'

RNG = r'''.code32
.global _start
_start:
  pushl $4357
  movl $0x5c2180, %eax
  call *%eax
  addl $4, %esp
  pushl $4357
  movl $0x5c1ff0, %eax
  call *%eax
  addl $4, %esp
  movl $integer_results, %edi
  movl $float_results, %ebp
  movl $1024, %ebx
next:
  pushl %ebx
  movl $0x5c21d0, %eax
  call *%eax
  movl %eax, (%edi)
  addl $4, %edi
  movl $0x5c2040, %eax
  call *%eax
  fstps (%ebp)
  addl $4, %ebp
  popl %ebx
  decl %ebx
  jnz next
  movl $4, %eax
  movl $1, %ebx
  movl $integer_results, %ecx
  movl $8192, %edx
  int $0x80
  movl $1, %eax
  xorl %ebx, %ebx
  int $0x80
.align 16
integer_results:
 .space 4096
float_results:
 .space 4096
'''

NUMERIC = r'''.code32
.global _start
_start:
  movl $tri_inputs, %esi
  movl $results, %edi
  movl $15, %ebx
tri_next:
  pushl %ebx
  pushl %edi
  pushl %esi
  pushl $0
  pushl $0
  movl $0x65b9a0, %eax
  call *%eax
  addl $8, %esi
  addl $4, %edi
  popl %ebx
  decl %ebx
  jnz tri_next
  movl $round_inputs, %esi
  movl $8, %ebx
round_next:
  pushl %ebx
  pushl %edi
  pushl %esi
  pushl $0
  pushl $0
  movl $0x6599e0, %eax
  call *%eax
  addl $4, %esi
  addl $4, %edi
  popl %ebx
  decl %ebx
  jnz round_next
  movl $4, %eax
  movl $1, %ebx
  movl $results, %ecx
  movl $92, %edx
  int $0x80
  movl $1, %eax
  xorl %ebx, %ebx
  int $0x80
.align 16
tri_inputs:
 .float -2,8,-1,8,0,8,0.5,8,1,8,2,8,3,8,4,8,5,8,6,8,7,8,8,8,10,8,2,-8,0,0
round_inputs:
 .float -2.5,-1.5,-0.5,0.49,0.5,1.5,2147483648,1e30
results:
 .space 92
'''

PROJECTION = r'''.code32
.global _start
_start:
  movl $0xb32f30,%esi
  movl $0xb32e08,%edi
  movl $74,%ecx
  rep movsl
  movl $identity_stub, %eax
  movl $0x8772a0, %ecx
  movb $0xb8, (%ecx)
  movl %eax, 1(%ecx)
  movw $0xe0ff, 5(%ecx)
  movl $screen_stub, %eax
  movl $0x6767c0, %ecx
  movb $0xb8, (%ecx)
  movl %eax, 1(%ecx)
  movw $0xe0ff, 5(%ecx)
  movl $10000, %eax
  cvtsi2ss %eax,%xmm0
  movss %xmm0, state+824
  movl $54000, %eax
  cvtsi2ss %eax,%xmm0
  movss %xmm0, state+828
  movl $inputs, %esi
  movl $output, %edi
  movl $6, %ebx
next:
  movl (%esi), %eax
  movl %eax, args
  movl %edi, args+4
  leal 4(%edi), %eax
  movl %eax, args+8
  leal 8(%edi), %eax
  movl %eax, args+12
  leal 12(%edi), %eax
  movl %eax, args+16
  pushl %ebx
  pushl $0
  pushl $args
  pushl $state
  pushl $0
  movl $0x65b190, %eax
  call *%eax
  addl $4, %esi
  addl $16, %edi
  popl %ebx
  decl %ebx
  jnz next
  movl $4,%eax
  movl $1,%ebx
  movl $output,%ecx
  movl $96,%edx
  int $0x80
  movl $1,%eax
  xorl %ebx,%ebx
  int $0x80
identity_stub:
  movl 4(%esp),%eax
  ret $4
screen_stub:
  movl 4(%esp),%eax
  movl 8(%esp),%edx
  movl $1280,(%eax)
  movl $720,(%edx)
  ret $8
.align 16
inputs:
 .float 0,100,500,-500,1000,1500
args:
 .space 20
state:
 .space 884
output:
 .space 96
'''


TEXTURE = r'''.code32
.global _start
_start:
  movl $quad, state+784
  movl $0x42800000, state+816
  movl $0x43000000, state+820
  movl $integer_args, %esi
  movl $output, %edi
  movl $2,%ebx
next:
  pushl %ebx
  pushl $0
  pushl %esi
  pushl $state
  pushl $0
  movl $0x65b4a0,%eax
  call *%eax
  movl $quad+20,%ecx
  movl $4,%edx
copy:
  movl (%ecx),%eax
  movl %eax,(%edi)
  movl 4(%ecx),%eax
  movl %eax,4(%edi)
  addl $28,%ecx
  addl $8,%edi
  decl %edx
  jnz copy
  addl $16,%esi
  popl %ebx
  decl %ebx
  jnz next
  movl $4,%eax
  movl $1,%ebx
  movl $output,%ecx
  movl $64,%edx
  int $0x80
  movl $1,%eax
  xorl %ebx,%ebx
  int $0x80
integer_args:
 .long 1,2,3,4
float_args:
 .float 1,2,3,4
state:
 .space 884
quad:
 .space 112
output:
 .space 64
'''

def image_segments(raw):
    pe = struct.unpack_from('<I', raw, 60)[0]
    count = struct.unpack_from('<H', raw, pe + 6)[0]
    optional_size = struct.unpack_from('<H', raw, pe + 20)[0]
    base = struct.unpack_from('<I', raw, pe + 52)[0]
    if base != 0x400000:
        raise ValueError('Unexpected oracle image base')
    result = []
    for i in range(count):
        at = pe + 24 + optional_size + 40 * i
        _, virtual_size, rva, size, offset = struct.unpack_from('<8sIIII', raw, at)
        result.append((base + rva, raw[offset:offset + size], max(virtual_size, size)))
    return result


def write_elf(path, segments, wrapper):
    segments = segments + [(0x10000000, wrapper, len(wrapper))]
    image = bytearray(4096)
    ident = b'\x7fELF\x01\x01\x01' + bytes(9)
    image[:52] = struct.pack('<16sHHIIIIIHHHHHH', ident, 2, 3, 1,
                            0x10000000, 52, 0, 0, 52, 32, len(segments), 0, 0, 0)
    for i, (address, payload, memory_size) in enumerate(segments):
        at = len(image)
        image[52 + 32 * i:84 + 32 * i] = struct.pack('<8I', 1, at, address,
            address, len(payload), memory_size, 7, 4096)
        image.extend(payload)
        image.extend(bytes((-len(image)) % 4096))
    path.write_bytes(image)
    path.chmod(0o755)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    raw = options.exe.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise ValueError('This oracle requires the fixed prepared engine 2.6.1.76')
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    segments = image_segments(raw)
    captures = {}
    for name, assembly, size in [('rng', RNG, 8192), ('numeric', NUMERIC, 92),
                                  ('projection', PROJECTION, 96), ('texture', TEXTURE, 64)]:
        source, obj, wrapper, elf = [output / (name + suffix)
                                    for suffix in ('.s', '.o', '.bin', '.elf')]
        source.write_text(assembly)
        subprocess.run(['as', '--32', '-o', str(obj), str(source)], check=True)
        subprocess.run(['ld', '-m', 'elf_i386', '--oformat', 'binary', '-Ttext',
                        '0x10000000', '-o', str(wrapper), str(obj)], check=True)
        write_elf(elf, segments, wrapper.read_bytes())
        payload = subprocess.run(['qemu-i386', str(elf)], check=True,
                                 capture_output=True).stdout
        if len(payload) != size:
            raise ValueError(f'{name}: expected {size} bytes, received {len(payload)}')
        (output / (name + '-native.bin')).write_bytes(payload)
        captures[name] = payload
    result = {
        'exeSHA256': EXPECTED,
        'execution': 'original x86 routines, baseline D3DX projection, mocked pointer/screen services',
        'random': {
            'seed': 4357, 'countPerStream': 1024,
            'integerSHA256': hashlib.sha256(captures['rng'][:4096]).hexdigest(),
            'floatSHA256': hashlib.sha256(captures['rng'][4096:]).hexdigest(),
        },
        'triangleWaveBits': list(struct.unpack_from('<15I', captures['numeric'])),
        'roundInteger': list(struct.unpack_from('<8i', captures['numeric'], 60)),
        'textureUVs': [list(struct.unpack_from('<8f', captures['texture'], i * 32)) for i in range(2)],
        'projection': [list(struct.unpack_from('<4f', captures['projection'], i * 16))
                       for i in range(6)],
    }
    (output / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
