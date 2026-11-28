#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Measure authored WideCharToMultiByte inputs in the pinned Japanese Wine platform."""
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


def authored_cases():
    rows = []

    def add(cp, flags, units, size, capacity, default=None, used=False, guard=0):
        rows.append({'codePage': cp, 'flags': flags, 'units': units, 'size': size,
                     'capacity': capacity, 'default': default, 'usedDefault': used, 'guard': guard})

    sources = [[], [65, 0, 66], [0x732b, 0x304c, 0x30d1], [0xfeff, 65],
               [0xa5, 0x5c, 0xc0, 0x3f], [0xf8f0, 0x80, 0xe000],
               [65, 0x3042, 66], [65, 0xd800, 66], [0xdc00], [0xd83d, 0xde00],
               [0xd800, 0xd801, 0xdc00], [0xdc00, 0, 0xd800], [0xfffd],
               [0x7f, 0x80, 0x7ff, 0x800], [0xdbff, 0xdfff, 0xffff]]
    for cp, flags in [(932, [0, 0x400]), (65001, [0, 0x80])]:
        for source in sources:
            for flag in flags:
                for size in dict.fromkeys([len(source), -1, -2, 0]):
                    for capacity in [0, 1, 2, 3, 4, 7, 16]:
                        add(cp, flag, source, size, capacity, used=(cp == 932))
    for default in [None, [33], [0x82, 0xa0], [0x81, 0], [0x41, 0x42], [0, 0x42]]:
        for source in [[0xd800, 65], [65, 0xd800], [0xa5, 0xc0, 0x3f], [0x3042, 0xd800]]:
            for flags in [0, 0x400]:
                for capacity in [0, 1, 2, 3, 5]:
                    for used in [False, True]:
                        add(932, flags, source, -1, capacity, default, used)
    for cp in [0, 1, 3]:
        for flags in [0, 0x400]:
            for capacity in [0, 1, 3, 8, 16]:
                add(cp, flags, [0xa5, 0x3042, 0xd800, 0x3f], -1, capacity, used=True)
    for cp in [0, 932, 65001]:
        for guard in [1, 2, 4]:  # NULL input, NULL output, identical pointers
            for capacity in [0, 4]:
                add(cp, 0, [65, 0x3042], 2, capacity, used=cp != 65001, guard=guard)
        add(cp, 0, [65], 1, -1, used=cp != 65001)
        for flags in [1, 8, 0x80 if cp != 65001 else 0x400, 0xffffffff]:
            add(cp, flags, [65, 0x3042], 2, 16)
    for default, used in [([33], False), (None, True), ([0x82, 0xa0], True)]:
        for capacity in [0, 16]:
            add(65001, 0, [65, 0xd800], -1, capacity, default, used)
    return rows


def oracle_source(rows):
    declarations = []
    for row in rows:
        units = ','.join(str(unit) for unit in [*row['units'], 0])
        default = ','.join(str(byte) for byte in (row['default'] or [0]))
        declarations.append(
            '{' + f'{row["codePage"]}u,{row["flags"]}u,{row["size"]},{row["capacity"]},'
            + f'{row["guard"]},{len(row["units"]) + 1},{int(row["default"] is not None)},'
            + f'{int(row["usedDefault"])},{{{default}}},{{{units}}}' + '},'
        )
    return r'''// SPDX-License-Identifier: MPL-2.0
using U = unsigned int;
using W = unsigned short;
extern "C" {
__declspec(dllimport) int __stdcall WideCharToMultiByte(U,U,W const*,int,char*,int,char const*,int*) asm("_WideCharToMultiByte");
__declspec(dllimport) U __stdcall GetACP() asm("_GetACP");
__declspec(dllimport) U __stdcall GetOEMCP() asm("_GetOEMCP");
__declspec(dllimport) U __stdcall GetLastError() asm("_GetLastError");
__declspec(dllimport) void __stdcall SetLastError(U) asm("_SetLastError");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
struct Row {
    U cp, flags;
    int size, capacity;
    U guard, count, custom, used;
    unsigned char replacement[2];
    W units[16];
};
static const Row rows[] = {
''' + '\n'.join(declarations) + r'''
};
static void emit(void const* bytes,U size) {
    U written;
    if (!WriteFile(GetStdHandle((U)-11),bytes,size,&written,0) || written!=size) ExitProcess(20);
}
static void record(U index, const Row& row) {
    alignas(4) char output[128];
    W source[64];
    int used[] = {0x11223344, 0x5a5a5a5a, 0x22334455};
    for (U i=0;i<128;i++) output[i]=(char)0xa5;
    for (U i=0;i<64;i++) source[i]=0x5a5a;
    W* input = row.guard&4 ? reinterpret_cast<W*>(output) : source;
    for (U i=0;i<row.count;i++) input[i]=row.units[i];
    SetLastError(0x12345678);
    U value=WideCharToMultiByte(row.cp,row.flags,row.guard&1 ? 0 : input,row.size,
                               row.guard&2 ? 0 : output,row.capacity,
                               row.custom ? (const char*)row.replacement : 0,row.used ? used+1 : 0);
    U header[]={index,value,GetLastError(),(U)used[1]};
    if (used[0]!=0x11223344 || used[2]!=0x22334455) ExitProcess(21);
    emit(header,16);emit(output,128);
}
static void sample(U cp,U flags,W const* source,int size) {
    U result[5]={0,0,0x5a5a5a5a,0xa5a5a5a5,0xa5a5a5a5};
    SetLastError(0x12345678);
    result[0]=WideCharToMultiByte(cp,flags,source,size,(char*)(result+3),8,0,
                                cp==932 ? (int*)(result+2) : 0);
    result[1]=GetLastError();
    emit(result,20);
}
extern "C" void start() {
    U codepages[]={GetACP(),GetOEMCP()};emit(codepages,8);
    for (U i=0;i<sizeof(rows)/sizeof(Row);i++) record(i,rows[i]);
    for (U flags=0;flags<=0x400;flags+=0x400)
        for (U unit=0;unit<65536;unit++) { W value=(W)unit; sample(932,flags,&value,1); }
    const W lows[]={0xdc00,0xdc01,0xdd00,0xdfff};
    for (U flags=0;flags<=0x80;flags+=0x80) {
        for (U unit=0;unit<65536;unit++) { W value=(W)unit; sample(65001,flags,&value,1); }
        for (U high=0xd800;high<=0xdbff;high++) for (U low=0;low<4;low++) {
            W source[]={(W)high,lows[low],65,0};sample(65001,flags,source,4);
        }
    }
    ExitProcess(0);
}
'''


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
    rows = authored_cases()
    (output / 'oracle.cpp').write_text(oracle_source(rows))
    names = ['WideCharToMultiByte', 'GetACP', 'GetOEMCP', 'GetLastError', 'SetLastError',
             'GetStdHandle', 'WriteFile', 'ExitProcess']
    (output / 'kernel32.def').write_text('LIBRARY kernel32.dll\nEXPORTS\n' + '\n'.join(names) + '\n')
    run([compiler / 'lld', '-flavor', 'link', '/lib', f'/def:{output / "kernel32.def"}',
         '/machine:x86', f'/out:{output / "kernel32.lib"}'])
    run([compiler / 'clang++', '--target=i686-pc-windows-msvc', '-O1', '-fno-stack-protector',
         '-fno-exceptions', '-fno-rtti', '-fno-builtin', '-c', output / 'oracle.cpp',
         '-o', output / 'oracle.obj'])
    run([compiler / 'lld', '-flavor', 'link', '/entry:start', '/subsystem:console',
         '/nodefaultlib', '/machine:x86', f'/out:{output / "oracle.exe"}',
         output / 'oracle.obj', output / 'kernel32.lib'])
    (output / 'locale').mkdir(exist_ok=True)
    sandbox = ['docker', 'run', '--rm', '--network', 'none', '--user',
               f'{os.getuid()}:{os.getgid()}', '-v', f'{output}:/work']
    run([*sandbox, '-v', f'{args.locale_sources.resolve()}:/usr/share/i18n:ro', WINE_ID,
         'localedef', '--no-archive', '-i', 'ja_JP', '-f', 'UTF-8', '/work/locale/ja_JP.UTF-8'])
    result = run([*sandbox, '-e', 'LOCPATH=/work/locale', '-e', 'LANG=ja_JP.UTF-8',
                  '-e', 'WINEPREFIX=/work/wine-prefix', '-e', 'WINEARCH=win32',
                  '-e', 'WINEDEBUG=-all', WINE_ID, 'wine', 'Z:\\work\\oracle.exe'])
    (output / 'result.bin').write_bytes(result)
    assert struct.unpack_from('<II', result) == (932, 932)
    at = 8 + len(rows) * 144
    cp932 = result[at:at + 131072 * 20]
    utf8 = result[at + len(cp932):]
    assert len(cp932) == 131072 * 20 and len(utf8) == 139264 * 20
    (output / 'cp932.bin').write_bytes(cp932)
    (output / 'utf8.bin').write_bytes(utf8)
    for index, row in enumerate(rows):
        offset = 8 + index * 144
        ident, value, error, used = struct.unpack_from('<IIII', result, offset)
        assert ident == index
        row.update(result=value, lastError=error, usedWord=used,
                   output=result[offset + 16:offset + 144].hex())
    report = {
        'wineImage': WINE_ID, 'ansiCodePage': 932, 'oemCodePage': 932, 'cases': rows,
        'cp932Mapping': {'cases': 131072, 'sha256': hashlib.sha256(cp932).hexdigest()},
        'utf8Mapping': {'cases': 139264, 'sha256': hashlib.sha256(utf8).hexdigest()},
    }
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.fixture:
        compact = dict(report, cases=[[
            row['codePage'], row['flags'], row['units'], row['size'], row['capacity'],
            row['default'], row['usedDefault'], row['guard'], row['result'], row['lastError'],
            row['usedWord'], bytes.fromhex(row['output']).rstrip(b'\xa5').hex(),
        ] for row in rows])
        args.fixture.write_text(json.dumps(compact, separators=(',', ':')) + '\n')
    print(json.dumps({'cases': len(rows), 'cp932Mapping': report['cp932Mapping'],
                      'utf8Mapping': report['utf8Mapping'], 'report': str(output / 'report.json')}))


if __name__ == '__main__':
    main()
