#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Build a private Linux ELF carrying the frozen interpreter for differential tests.

Inputs remain read-only. Generated image/ELF must stay outside Git. This runs
selected instruction handlers, not the game's initialization or Windows API.
"""
import argparse
import hashlib
from pathlib import Path
import struct
import subprocess

EXPECTED = 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    options = parser.parse_args()
    raw = options.exe.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise ValueError('Native oracle requires the fixed prepared NEKOPARA3 2.6.1.76 executable')
    pe = struct.unpack_from('<I', raw, 0x3c)[0]
    count, optional_size = struct.unpack_from('<H12xH', raw, pe + 6)
    optional = pe + 24
    base, image_size, headers_size = (struct.unpack_from('<I', raw, optional + n)[0]
                                      for n in (28, 56, 60))
    if base != 0x400000:
        raise ValueError('Unexpected image base')
    image = bytearray(image_size)
    image[:headers_size] = raw[:headers_size]
    for i in range(count):
        at = optional + optional_size + i * 40
        va, size, offset = struct.unpack_from('<III', raw, at + 12)
        image[va:va + size] = raw[offset:offset + size]
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / 'image.bin').write_bytes(image)
    source = Path(__file__).with_suffix('.c').resolve()
    subprocess.run(['gcc', '-m32', '-msse2', '-mfpmath=sse', '-O1', '-ffreestanding',
                    '-fno-pie', '-fno-stack-protector', '-fno-asynchronous-unwind-tables',
                    '-c', str(source), '-o', str(output / 'harness.o')], check=True)
    (output / 'image.S').write_text('.section .original,"awx",@progbits\n.incbin "image.bin"\n')
    subprocess.run(['as', '--32', 'image.S', '-o', 'image.o'], cwd=output, check=True)
    (output / 'link.ld').write_text('''ENTRY(_start)
PHDRS { original PT_LOAD FLAGS(7); harness PT_LOAD FLAGS(7); }
SECTIONS {
 . = 0x400000; .original : { image.o(.original) } :original
 . = 0x20000000; .text : { harness.o(.text*) } :harness
 .rodata : { harness.o(.rodata*) } :harness
 .data : { harness.o(.data*) } :harness
 .bss : { harness.o(.bss*) *(COMMON) } :harness
 /DISCARD/ : { *(.comment*) *(.note*) *(.eh_frame*) }
}
''')
    subprocess.run(['ld', '-m', 'elf_i386', '-T', 'link.ld', 'harness.o', 'image.o',
                    '-o', 'kcs-native-oracle'], cwd=output, check=True)
    (output / 'identity.json').write_text('{"exeSHA256":"' + EXPECTED +
                                         '","execution":"selected x86 VM handlers on Linux"}\n')
    print(output / 'kcs-native-oracle')


if __name__ == '__main__':
    main()
