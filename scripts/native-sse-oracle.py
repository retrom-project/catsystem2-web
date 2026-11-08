#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Capture hardware SSE results and MXCSR flags through an authored Wine host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

IMAGE = 'sha256:9a6c60e2c760730b99a8ddbc94da318a8ba667e5f206972436bf3820fe0892b7'


def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, capture_output=True, timeout=60, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--image', default=IMAGE)
    parser.add_argument('--output', type=Path, default=Path('.local/ppi-audit/sse-oracle'))
    parser.add_argument('--golden', type=Path)
    args = parser.parse_args()
    if run(['docker', 'image', 'inspect', args.image, '--format', '{{.Id}}']).stdout.decode().strip() != args.image:
        raise ValueError('The diagnostic image must have its immutable identity')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    compiler = args.emsdk.resolve()/'upstream/bin'
    source = Path(__file__).with_suffix('.cpp').resolve()
    (output/'kernel32.def').write_text('LIBRARY KERNEL32.dll\nEXPORTS\nGetStdHandle\nReadFile\nWriteFile\nExitProcess\n')
    run([compiler/'lld', '-flavor', 'link', '/lib', f'/def:{output/"kernel32.def"}', '/machine:x86', f'/out:{output/"kernel32.lib"}'])
    run([compiler/'clang++', '--target=i686-pc-windows-msvc', '-msse2', '-O1', '-fno-exceptions', '-fno-rtti', '-fno-stack-protector', '-fno-builtin', '-c', source, '-o', output/'oracle.obj'])
    run([compiler/'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', '/base:0x400000', '/dynamicbase:no', '/fixed', f'/out:{output/"oracle.exe"}', output/'oracle.obj', output/'kernel32.lib'])
    pairs = [(0,0),(0x80000000,0),(1,0),(0x80000001,1),(0x007fffff,0x00800000),(0x00800000,0x3f000000),(0x00800000,0x3f000001),(0x00800000,0x00800000),(0x3f800000,0x40400000),(0x3f800001,0x3f800001),(0x3f800000,0xbf800000),(0x3f800000,1),(0x3f000000,0),(0x7f7fffff,0x40000000),(0xff7fffff,0x40000000),(0x7f800000,0xff800000),(0x7f800000,0),(0x7fc12345,0x3f800000),(0x7fa12345,0x3f800000),(0x3f800000,0x7fc12345),(0xbf000000,0),(0x4effffff,0),(0x4f000000,0),(0xcf000000,0),(0xcf000001,0)]
    pairs += [(1,0x7fc12345),(0x7fc12345,1),(1,0x7fa12345),(0x7fa12345,1),(1,0x7f800000),(0x7f800000,1),(0x80000001,0x7f800000),(1,0x80000000)]
    cases = [[op,a,b,0x1f80|(rounding<<13)|(daz<<6)|(ftz<<15)|sticky] for rounding in range(4) for daz in range(2) for ftz in range(2) for sticky in [0,63] for op in range(7) for a,b in pairs]
    inputs = struct.pack('<I', len(cases))+b''.join(struct.pack('<4I',*case) for case in cases)
    (output/'input.bin').write_bytes(inputs)
    name=f'catsystem2-sse-oracle-{os.getpid()}'
    try:
        native=run(['docker','run','-i','--init','--rm','--name',name,'--network','none','--user',f'{os.getuid()}:{os.getgid()}','-e','WINEPREFIX=/work/wine-prefix','-e','WINEARCH=win32','-e','WINEDEBUG=-all','-v',f'{output}:/work',args.image,'wine','Z:\\work\\oracle.exe'],input=inputs)
    except subprocess.TimeoutExpired:
        subprocess.run(['docker','stop','--timeout','1',name],capture_output=True)
        raise
    (output/'native.bin').write_bytes(native.stdout)
    (output/'stderr.txt').write_bytes(native.stderr)
    if len(native.stdout)!=len(cases)*8:
        raise ValueError('Hardware SSE oracle output size differs')
    records=[[*case,*struct.unpack_from('<2I',native.stdout,i*8)]for i,case in enumerate(cases)]
    golden={'kind':'Authored scalar SSE hardware oracle; masked exceptions','harnessSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'builderSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'wineImage':args.image,'columns':['operation','a','b','inputMXCSR','result','outputMXCSR'],'operations':['addss','subss','mulss','divss','sqrtss','cvtss2si','cvttss2si'],'cases':records}
    destination=args.golden or output/'golden.json'
    destination.write_text(json.dumps(golden,separators=(',',':'))+'\n')
    print(json.dumps({'golden':str(destination),'cases':len(cases)}))


if __name__=='__main__':
    main()
