#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Authored USER32 RECT cases in the pinned isolated Wine environment."""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess

WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'
RECTS = [[0, 0, 0, 0], [0, 0, 1, 1], [-9, -7, 5, 8], [10, 20, -10, 50],
         [0, 10, 20, -10], [-2147483648, -2147483648, 2147483647, 2147483647],
         [2147483647, 2147483647, -2147483648, -2147483648], [0, 0, -1, -1],
         [-1, -1, 0, 0], [1, 0, 1, 17], [0, 9, 12, 9]]


def run(command):
    return subprocess.run([str(x) for x in command], check=True, capture_output=True, timeout=60)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    compiler = args.emsdk.resolve() / 'upstream/bin'
    rows = [{'operation': op, 'a': a, 'b': [0, 0, 0, 0], 'alias': 0}
            for op in ['SetRectEmpty', 'IsRectEmpty'] for a in RECTS]
    rows += [{'operation': op, 'a': a, 'b': b, 'alias': alias}
             for op in ['UnionRect', 'IntersectRect'] for a in RECTS for b in RECTS
             for alias in [0, 1, 2]]
    calls = []
    for i, row in enumerate(rows):
        calls.append('record(' + ','.join([str(i), str(['SetRectEmpty', 'IsRectEmpty', 'UnionRect', 'IntersectRect'].index(row['operation'])), str(row['alias'])] +
                                        [f'{x & 0xffffffff}u' for x in row['a'] + row['b']]) + ');')
    source = '''// SPDX-License-Identifier: MPL-2.0
typedef unsigned int U;
extern "C" {
__declspec(dllimport) U __stdcall SetRectEmpty(void*) asm("_SetRectEmpty");
__declspec(dllimport) U __stdcall IsRectEmpty(void const*) asm("_IsRectEmpty");
__declspec(dllimport) U __stdcall UnionRect(void*,void const*,void const*) asm("_UnionRect");
__declspec(dllimport) U __stdcall IntersectRect(void*,void const*,void const*) asm("_IntersectRect");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static void record(U id,U op,U alias,U a0,U a1,U a2,U a3,U b0,U b1,U b2,U b3){
 U a[]={a0,a1,a2,a3},b[]={b0,b1,b2,b3},out[]={0xa5a5a5a5,a0,a1,a2,a3,0x5a5a5a5a};
 U *pa=alias==1?out+1:a,*pb=alias==2?out+1:b;
 if(alias==2)for(U i=0;i<4;i++)out[i+1]=b[i];
 U result=op==0?SetRectEmpty(out+1):op==1?IsRectEmpty(out+1):op==2?UnionRect(out+1,pa,pb):IntersectRect(out+1,pa,pb);
 U record[]={id,result,out[0],out[1],out[2],out[3],out[4],out[5]},done;
 if(!WriteFile(GetStdHandle((U)-11),record,sizeof(record),&done,0)||done!=sizeof(record))ExitProcess(20);
}
extern "C" void start(){
''' + ''.join(calls) + 'ExitProcess(0);}\n'
    (output / 'oracle.cpp').write_text(source)
    libraries = []
    for dll, names in [('kernel32', ['GetStdHandle', 'WriteFile', 'ExitProcess']),
                       ('user32', ['SetRectEmpty', 'IsRectEmpty', 'UnionRect', 'IntersectRect'])]:
        (output / f'{dll}.def').write_text(f'LIBRARY {dll}.dll\nEXPORTS\n' + '\n'.join(names) + '\n')
        library = output / f'{dll}.lib'
        run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / (dll + ".def")}', '/machine:x86', f'/out:{library}'])
        libraries.append(library)
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', output / 'oracle.cpp', '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', f'/out:{output / "oracle.exe"}', output / 'oracle.obj', *libraries])
    result = run(['docker', 'run', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{output}:/work', WINE_ID, 'wine', 'Z:\\work\\oracle.exe'])
    (output / 'result.bin').write_bytes(result.stdout)
    assert len(result.stdout) == len(rows) * 32, len(result.stdout)
    for i, row in enumerate(rows):
        words = struct.unpack_from('<8I', result.stdout, i * 32)
        assert words[0] == i
        row.update(result=words[1], output=list(words[2:]))
    report = {'wineImage': WINE_ID, 'cases': rows}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.fixture:
        args.fixture.write_text(json.dumps(report, separators=(',', ':')) + '\n')
    print(json.dumps({'cases': len(rows), 'report': str(output / 'report.json')}))


if __name__ == '__main__':
    main()
