#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Measure authored MultiByteToWideChar inputs in the pinned Japanese Wine platform."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'


def run(command):
    result = subprocess.run([str(value) for value in command], capture_output=True, timeout=60)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        result.check_returncode()
    return result.stdout


def cases():
    rows = []
    ansi = [b'A\0B', '猫がパ'.encode('cp932'), b'\x81', b'A\x81', b'\x81\x30',
            b'\x81\x00B', b'\x80\xa0\xfd\xfe\xff', b'\x1a\x1c\x7f',
            b'\x81\x5f', b'\xed\x40', b'\xfa\x40', b'\x81\xf0', b'\xffA']
    utf8 = [b'A\0B', '猫が😀'.encode('utf8'), b'\xef\xbb\xbfA', b'\xe2\x82',
            b'\xc0\xaf', b'\xed\xa0\x80', b'A\xffB', b'\xf4\x90\x80\x80',
            'e\u0301'.encode('utf8'), b'\xe0\x80\x80', b'\xf5\x80\x80\x80',
            b'\xc2', b'\xe2\x82A']
    for cp, sources, flags in [(932, ansi, list(range(16)) + [16, 0xffffffff]),
                               (65001, utf8, [0, 1, 2, 4, 8, 9, 16])]:
        for source in sources:
            for flag in flags:
                for size in [len(source), -1, 0]:
                    for capacity in ([0, 1, 2, 3, 4, 16] if cp == 65001 else [0, 1, 2, 4, 16]):
                        rows.append({'codePage': cp, 'flags': flag, 'input': source.hex(),
                                     'size': size, 'capacity': capacity})
    for cp in [0, 1, 3, 932, 65001]:
        for flag in [0, 1, 8, 0xffffffff]:
            for guard in [{'nullInput': True}, {'nullOutput': True}, {'alias': True},
                          {'size': -2}, {'capacity': -1}]:
                row = {'codePage': cp, 'flags': flag, 'input': '4182a00042',
                       'size': 3, 'capacity': 16, **guard}
                rows.append(row)
    for cp in [0, 1, 3]:
        for source in ansi[:4]:
            for flag in [0, 1, 8]:
                for capacity in [0, 1, 16]:
                    rows.append({'codePage': cp, 'flags': flag, 'input': source.hex(),
                                 'size': -1, 'capacity': capacity})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    parser.add_argument('--locale-sources', type=Path, default=Path('/usr/share/i18n'))
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    compiler = args.emsdk.resolve() / 'upstream/bin'
    rows = cases()
    declarations, calls = [], []
    for i, row in enumerate(rows):
        data = list(bytes.fromhex(row['input'])) + [0]
        declarations.append(f'static unsigned char s{i}[]={{' + ','.join(map(str, data)) + '};')
        calls.append(f'record({i},{row["codePage"]}u,{row["flags"]}u,s{i},{len(data)},{row["size"]},{row["capacity"]},{int(row.get("nullInput",False))},{int(row.get("nullOutput",False))},{int(row.get("alias",False))});')
    source = r'''// SPDX-License-Identifier: MPL-2.0
typedef unsigned int U;
extern "C" {
__declspec(dllimport) int __stdcall MultiByteToWideChar(U,U,void const*,int,void*,int) asm("_MultiByteToWideChar");
__declspec(dllimport) U __stdcall GetACP() asm("_GetACP");
__declspec(dllimport) U __stdcall GetOEMCP() asm("_GetOEMCP");
__declspec(dllimport) U __stdcall GetLastError() asm("_GetLastError");
__declspec(dllimport) void __stdcall SetLastError(U) asm("_SetLastError");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static unsigned char buffer[128],input[128];
static void emit(void const* p,U n){U done;if(!WriteFile(GetStdHandle((U)-11),p,n,&done,0)||done!=n)ExitProcess(20);}
static void record(U id,U cp,U flags,unsigned char const* s,U n,int size,int capacity,U ni,U no,U alias){
 for(U i=0;i<128;i++){buffer[i]=0xa5;input[i]=0x5a;}
 unsigned char* in=alias?buffer:input;
 for(U i=0;i<n;i++)in[i]=s[i];
 SetLastError(0x12345678);
 U ret=MultiByteToWideChar(cp,flags,ni?0:in,size,no?0:buffer,capacity),error=GetLastError();
 U header[]={id,ret,error};emit(header,12);emit(buffer,128);
}
static void mapping(){
 for(U flags=0;flags<=8;flags+=8){
  for(U a=0;a<256;a++){
   U result[4]={0,0,0xa5a5a5a5,0xa5a5a5a5};unsigned char s[]={(unsigned char)a};
   SetLastError(0x12345678);result[0]=MultiByteToWideChar(932,flags,s,1,result+2,4);result[1]=GetLastError();emit(result,16);
  }
  for(U a=0x81;a<=0xfc;a++)if(a<=0x9f||a>=0xe0)for(U b=0;b<256;b++){
   U result[4]={0,0,0xa5a5a5a5,0xa5a5a5a5};unsigned char s[]={(unsigned char)a,(unsigned char)b};
   SetLastError(0x12345678);result[0]=MultiByteToWideChar(932,flags,s,2,result+2,4);result[1]=GetLastError();emit(result,16);
  }
 }
}
static void utf8_mapping(){
 static unsigned char limits[]={0,0x41,0x7f,0x80,0x8f,0x90,0x9f,0xa0,0xbf,0xc0,0xff};
 for(U flags=0;flags<=8;flags+=8){
  for(U a=0;a<256;a++){
   U r[4]={0,0,0xa5a5a5a5,0xa5a5a5a5};unsigned char s[]={(unsigned char)a};
   SetLastError(0x12345678);r[0]=MultiByteToWideChar(65001,flags,s,1,r+2,4);r[1]=GetLastError();emit(r,16);
  }
  for(U a=0;a<256;a++)for(U b=0;b<256;b++){
   U r[4]={0,0,0xa5a5a5a5,0xa5a5a5a5};unsigned char s[]={(unsigned char)a,(unsigned char)b};
   SetLastError(0x12345678);r[0]=MultiByteToWideChar(65001,flags,s,2,r+2,4);r[1]=GetLastError();emit(r,16);
  }
  for(U a=0xe0;a<=0xf5;a++)for(U b=0;b<11;b++)for(U c=0;c<11;c++){
   U r[4]={0,0,0xa5a5a5a5,0xa5a5a5a5};unsigned char s[]={(unsigned char)a,limits[b],limits[c]};
   SetLastError(0x12345678);r[0]=MultiByteToWideChar(65001,flags,s,3,r+2,4);r[1]=GetLastError();emit(r,16);
  }
  for(U a=0xf0;a<=0xf5;a++)for(U b=0;b<11;b++)for(U c=0;c<11;c++)for(U d=0;d<11;d++){
   U r[4]={0,0,0xa5a5a5a5,0xa5a5a5a5};unsigned char s[]={(unsigned char)a,limits[b],limits[c],limits[d]};
   SetLastError(0x12345678);r[0]=MultiByteToWideChar(65001,flags,s,4,r+2,4);r[1]=GetLastError();emit(r,16);
  }
 }
}
''' + '\n'.join(declarations) + '\nextern "C" void start(){U cp[]={GetACP(),GetOEMCP()};emit(cp,8);' + ''.join(calls) + 'mapping();utf8_mapping();ExitProcess(0);}\n'
    (output / 'oracle.cpp').write_text(source)
    names = ['MultiByteToWideChar', 'GetACP', 'GetOEMCP', 'GetLastError', 'SetLastError', 'GetStdHandle', 'WriteFile', 'ExitProcess']
    (output / 'kernel32.def').write_text('LIBRARY kernel32.dll\nEXPORTS\n' + '\n'.join(names) + '\n')
    run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / "kernel32.def"}', '/machine:x86', f'/out:{output / "kernel32.lib"}'])
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector', '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', output / 'oracle.cpp', '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console', '/nodefaultlib', '/machine:x86', f'/out:{output / "oracle.exe"}', output / 'oracle.obj', output / 'kernel32.lib'])
    (output / 'locale').mkdir(exist_ok=True)
    run(['docker', 'run', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}', '-v', f'{output}:/work', '-v', f'{args.locale_sources.resolve()}:/usr/share/i18n:ro', WINE_ID, 'localedef', '--no-archive', '-i', 'ja_JP', '-f', 'UTF-8', '/work/locale/ja_JP.UTF-8'])
    result = run(['docker', 'run', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'LOCPATH=/work/locale', '-e', 'LANG=ja_JP.UTF-8', '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{output}:/work', WINE_ID, 'wine', 'Z:\\work\\oracle.exe'])
    (output / 'result.bin').write_bytes(result)
    assert struct.unpack_from('<II', result) == (932, 932)
    at = 8 + len(rows) * 140
    cp_size = (256 + 60 * 256) * 2 * 16
    mapping = result[at:at + cp_size]
    assert len(mapping) == (256 + 60 * 256) * 2 * 16
    (output / 'mapping.bin').write_bytes(mapping)
    utf8_mapping = result[at + cp_size:]
    utf8_count = (256 + 65536 + 22 * 11 * 11 + 6 * 11 * 11 * 11) * 2
    assert len(utf8_mapping) == utf8_count * 16
    (output / 'utf8-mapping.bin').write_bytes(utf8_mapping)
    for i, row in enumerate(rows):
        offset = 8 + i * 140
        ident, value, error = struct.unpack_from('<III', result, offset)
        assert ident == i
        row.update(result=value, lastError=error, output=result[offset + 12:offset + 140].hex())
    report = {'wineImage': WINE_ID, 'ansiCodePage': 932, 'oemCodePage': 932, 'cases': rows,
              'mapping': {'cases': (256 + 60 * 256) * 2, 'sha256': hashlib.sha256(mapping).hexdigest()},
              'utf8Mapping': {'cases': utf8_count, 'sha256': hashlib.sha256(utf8_mapping).hexdigest()}}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.fixture:
        compact = dict(report, cases=[
            {**{key: value for key, value in row.items() if key != 'output'},
             'outputPrefix': bytes.fromhex(row['output']).rstrip(b'\xa5').hex()}
            for row in rows
        ])
        args.fixture.write_text(json.dumps(compact, separators=(',', ':')) + '\n')
    print(json.dumps({'cases': len(rows), 'mapping': report['mapping'], 'utf8Mapping': report['utf8Mapping'], 'report': str(output / 'report.json')}))


if __name__ == '__main__':
    main()
