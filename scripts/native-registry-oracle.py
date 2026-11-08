#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Measure authored registry A/W calls in the pinned isolated Wine prefix."""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'


def run(command):
    try:
        return subprocess.run([str(x) for x in command], check=True, capture_output=True, timeout=60)
    except subprocess.CalledProcessError as error:
        sys.stderr.buffer.write(error.stderr)
        raise


def cases():
    rows = []
    for wide in [False, True]:
        sources = [
            (1, b'ABCD\0\0\xa5\xa5', n) for n in range(7)
        ] + [
            (1, b'A\0B\0\0\0\xa5\xa5', n) for n in range(7)
        ] + [
            (1, '猫犬'.encode('utf-16le' if wide else 'cp932') + b'\0\0\0\0', n)
            for n in range(7)
        ] + [(4, b'\x78\x56\x34\x12\0\0\0\0', n) for n in [0, 1, 3, 4, 5]]
        for kind, data, size in sources:
            for query_wide in [False, True]:
                for capacity in [0, 1, 3, 4, 5, 6, 8, 16]:
                    rows.append({'setWide': wide, 'queryWide': query_wide, 'type': kind,
                                 'data': data.hex(), 'size': size, 'capacity': capacity})
        for query_wide in [False, True]:
            for kind in [1, 2, 3, 7]:
                for capacity in [0, 4, 16]:
                    rows.append({'setWide': wide, 'queryWide': query_wide, 'type': kind,
                                 'data': '410000004200000000000000', 'size': 8,
                                 'capacity': capacity})
    # lpData=NULL with a size pointer queries length without a destination.
    for wide in [False, True]:
        for query_wide in [False, True]:
            rows.append({'setWide': wide, 'queryWide': query_wide, 'type': 1,
                         'data': '41420000a5a5', 'size': 2, 'capacity': 0,
                         'nullData': True})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    parser.add_argument('--platform-fixture', type=Path)
    parser.add_argument('--locale-sources', type=Path, default=Path('/usr/share/i18n'))
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    compiler = args.emsdk.resolve() / 'upstream/bin'
    rows = cases()
    declarations, calls, platform_calls, platform_rows = [], [], [], []
    for i, row in enumerate(rows):
        declarations.append(f'static unsigned char d{i}[]={{' +
                            ','.join(str(x) for x in bytes.fromhex(row['data'])) + '};')
        calls.append(f'record({i},{int(row["setWide"])},{int(row["queryWide"])},'
                     f'{row["type"]},d{i},{row["size"]},{row["capacity"]},'
                     f'{int(row.get("nullData", False))});')
    for wide in [False, True]:
        for path in ['Software\\RetromRegistryOracle\\Paths\\Plain',
                     'software\\RETROMREGISTRYORACLE\\paths\\plain',
                     'Software\\RetromRegistryOracle\\Paths\\Plain\\',
                     'Software\\RetromRegistryOracle\\Paths\\\\Repeated',
                     'Software\\RetromRegistryOracle\\Paths\\..',
                     'Software\\RetromRegistryOracle\\Paths\\with/slash',
                     '\\Software\\RetromRegistryOracle\\Paths\\Leading', '']:
            i = len(platform_rows)
            values = list(path.encode('ascii')) + [0]
            declarations.append(f'static {"unsigned short" if wide else "char"} p{i}[]={{' + ','.join(map(str, values)) + '};')
            platform_calls.append(f'path_record({i},{int(wide)},p{i});')
            platform_rows.append({'api': 'path', 'wide': wide, 'path': path})
        for access in [0, 1, 2, 4, 0x20019, 0x20006, 0xf003f]:
            i = len(platform_rows)
            platform_calls.append(f'permission_record({i},{int(wide)},{access});')
            platform_rows.append({'api': 'permission', 'wide': wide, 'access': access})
    source = '''// SPDX-License-Identifier: MPL-2.0
typedef unsigned int U;
extern "C" {
__declspec(dllimport) U __stdcall RegCreateKeyExW(U,void const*,U,void const*,U,U,void*,U*,U*) asm("_RegCreateKeyExW");
__declspec(dllimport) U __stdcall RegCreateKeyExA(U,void const*,U,void const*,U,U,void*,U*,U*) asm("_RegCreateKeyExA");
__declspec(dllimport) U __stdcall RegOpenKeyExA(U,void const*,U,U,U*) asm("_RegOpenKeyExA");
__declspec(dllimport) U __stdcall RegOpenKeyExW(U,void const*,U,U,U*) asm("_RegOpenKeyExW");
__declspec(dllimport) U __stdcall RegDeleteTreeW(U,void const*) asm("_RegDeleteTreeW");
__declspec(dllimport) U __stdcall RegSetValueExA(U,void const*,U,U,void const*,U) asm("_RegSetValueExA");
__declspec(dllimport) U __stdcall RegSetValueExW(U,void const*,U,U,void const*,U) asm("_RegSetValueExW");
__declspec(dllimport) U __stdcall RegQueryValueExA(U,void const*,U,U*,void*,U*) asm("_RegQueryValueExA");
__declspec(dllimport) U __stdcall RegQueryValueExW(U,void const*,U,U*,void*,U*) asm("_RegQueryValueExW");
__declspec(dllimport) U __stdcall RegCloseKey(U) asm("_RegCloseKey");
__declspec(dllimport) U __stdcall GetACP() asm("_GetACP");
__declspec(dllimport) U __stdcall RtlMultiByteToUnicodeN(void*,U,U*,void const*,U) asm("_RtlMultiByteToUnicodeN");
__declspec(dllimport) U __stdcall RtlUnicodeToMultiByteN(void*,U,U*,void const*,U) asm("_RtlUnicodeToMultiByteN");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static unsigned short path[]={83,111,102,116,119,97,114,101,92,82,101,116,114,111,109,82,101,103,105,115,116,114,121,79,114,97,99,108,101,0};
static unsigned char narrow[]={118,97,108,117,101,0};
static unsigned short wideName[]={118,97,108,117,101,0};
static U key;
static unsigned char buffer[64];
static void emit(void const* data,U size){U done;if(!WriteFile(GetStdHandle((U)-11),data,size,&done,0)||done!=size)ExitProcess(20);}
static void record(U id,U sw,U qw,U type,void const* data,U size,U capacity,U nullData){
 U set=sw?RegSetValueExW(key,wideName,0,type,data,size):RegSetValueExA(key,narrow,0,type,data,size);
 U outputType=0x13579bdf,outputSize=capacity;
 for(U i=0;i<64;i++)buffer[i]=0xa5;
 U query=qw?RegQueryValueExW(key,wideName,0,&outputType,nullData?0:buffer,&outputSize):RegQueryValueExA(key,narrow,0,&outputType,nullData?0:buffer,&outputSize);
 U header[]={id,set,query,outputType,outputSize};emit(header,sizeof(header));emit(buffer,sizeof(buffer));
}
static void nls(){
 for(U a=0;a<256;a++){
  U output=0xa5a5a5a5,size=0;unsigned char bytes[]={(unsigned char)a};
  RtlMultiByteToUnicodeN(&output,4,&size,bytes,1);U record[]={size,output};emit(record,8);
 }
 for(U a=0x81;a<=0xfc;a++)if(a<=0x9f||a>=0xe0)for(U b=0;b<256;b++){
  U output=0xa5a5a5a5,size=0;unsigned char bytes[]={(unsigned char)a,(unsigned char)b};
  RtlMultiByteToUnicodeN(&output,4,&size,bytes,2);U record[]={size,output};emit(record,8);
 }
 for(U a=0;a<65536;a++){
  U output=0xa5a5a5a5,size=0;unsigned short input=(unsigned short)a;
  RtlUnicodeToMultiByteN(&output,4,&size,&input,2);U record[]={size,output};emit(record,8);
 }
}
static void path_record(U id,U wide,void const* path){
 U handle=0xa5a5a5a5,disp=0x13579bdf,opened=0xa5a5a5a5;
 U ret=wide?RegCreateKeyExW(0x80000001,path,0,0,0,0xF003F,0,&handle,&disp):RegCreateKeyExA(0x80000001,path,0,0,0,0xF003F,0,&handle,&disp);
 U close=ret?0xffffffff:RegCloseKey(handle),second=ret?0xffffffff:RegCloseKey(handle);
 U open=wide?RegOpenKeyExW(0x80000001,path,0,0x20019,&opened):RegOpenKeyExA(0x80000001,path,0,0x20019,&opened);
 U result[]={id,ret,(U)(handle==0xa5a5a5a5?2:!!handle),disp,open,(U)(opened==0xa5a5a5a5?2:!!opened),close,second};emit(result,sizeof(result));
 if(!open)RegCloseKey(opened);
}
static void permission_record(U id,U wide,U access){
 U h=0,word=0x78563412;
 U opened=RegOpenKeyExW(key,0,0,access,&h);
 U type=0x13579bdf,size=4,output=0xa5a5a5a5;
 U query=wide?RegQueryValueExW(h,wideName,0,&type,&output,&size):RegQueryValueExA(h,narrow,0,&type,&output,&size);
 U set=wide?RegSetValueExW(h,wideName,0,4,&word,4):RegSetValueExA(h,narrow,0,4,&word,4);
 U result[]={id,opened,query,set,type,size,output,RegCloseKey(h)};emit(result,sizeof(result));
}
''' + '\n'.join(declarations) + '''
extern "C" void start(){
 U acp=GetACP();emit(&acp,4);
 RegDeleteTreeW(0x80000001,path);
 U created,ret=RegCreateKeyExW(0x80000001,path,0,0,0,0xF003F,0,&key,&created);
 if(ret)ExitProcess(21);
''' + ''.join(calls) + '''
 U word=0x78563412;RegSetValueExW(key,wideName,0,4,&word,4);
 nls();
''' + ''.join(platform_calls) + 'RegCloseKey(key);ExitProcess(0);}\n'
    (output / 'oracle.cpp').write_text(source)
    libraries = []
    for dll, names in [
        ('kernel32', ['GetACP', 'GetStdHandle', 'WriteFile', 'ExitProcess']),
        ('advapi32', ['RegCreateKeyExA', 'RegCreateKeyExW', 'RegOpenKeyExA', 'RegOpenKeyExW', 'RegDeleteTreeW', 'RegSetValueExA', 'RegSetValueExW',
                      'RegQueryValueExA', 'RegQueryValueExW', 'RegCloseKey']),
        ('ntdll', ['RtlMultiByteToUnicodeN', 'RtlUnicodeToMultiByteN']),
    ]:
        (output / f'{dll}.def').write_text(f'LIBRARY {dll}.dll\nEXPORTS\n' + '\n'.join(names) + '\n')
        library = output / f'{dll}.lib'
        run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / (dll + ".def")}',
             '/machine:x86', f'/out:{library}'])
        libraries.append(library)
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector',
         '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', output / 'oracle.cpp',
         '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console',
         '/nodefaultlib', '/machine:x86', f'/out:{output / "oracle.exe"}', output / 'oracle.obj',
         *libraries])
    locale = output / 'locale'
    locale.mkdir(exist_ok=True)
    run(['docker', 'run', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}',
         '-v', f'{output}:/work', '-v', f'{args.locale_sources.resolve()}:/usr/share/i18n:ro',
         WINE_ID, 'localedef', '--no-archive', '-i', 'ja_JP', '-f', 'UTF-8',
         '/work/locale/ja_JP.UTF-8'])
    result = run(['docker', 'run', '--rm', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}',
                  '-e', 'LOCPATH=/work/locale', '-e', 'LANG=ja_JP.UTF-8', '-e', 'WINEPREFIX=/work/wine-prefix',
                  '-e', 'WINEARCH=win32', '-e', 'WINEDEBUG=-all', '-v', f'{output}:/work',
                  WINE_ID, 'wine', 'Z:\\work\\oracle.exe'])
    (output / 'result.bin').write_bytes(result.stdout)
    start = 4 + 84 * len(rows)
    end = start + (256 + 60 * 256 + 65536) * 8
    assert len(result.stdout) == end + 32 * len(platform_rows), len(result.stdout)
    (output / 'nls.bin').write_bytes(result.stdout[start:end])
    acp = struct.unpack_from('<I', result.stdout)[0]
    if acp != 932:
        raise ValueError(f'Japanese registry oracle requires ACP932, got {acp}')
    for i, row in enumerate(rows):
        at = 4 + i * 84
        case, set_result, query, kind, size = struct.unpack_from('<5I', result.stdout, at)
        assert case == i
        row.update(setResult=set_result, result=query, outputType=kind, outputSize=size,
                   output=result.stdout[at + 20:at + 84].hex())
    report = {'wineImage': WINE_ID, 'ansiCodePage': acp, 'cases': rows}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.fixture:
        args.fixture.write_text(json.dumps(report, separators=(',', ':')) + '\n')
    for i, row in enumerate(platform_rows):
        values = struct.unpack_from('<8I', result.stdout, end + i * 32)
        assert values[0] == i
        row['result'] = list(values[1:])
    platform = {'wineImage': WINE_ID, 'cases': platform_rows}
    (output / 'platform.json').write_text(json.dumps(platform, indent=2) + '\n')
    if args.platform_fixture:
        args.platform_fixture.write_text(json.dumps(platform, indent=2) + '\n')
    print(json.dumps({'cases': len(rows), 'ansiCodePage': acp, 'report': str(output / 'report.json')}))


if __name__ == '__main__':
    main()
