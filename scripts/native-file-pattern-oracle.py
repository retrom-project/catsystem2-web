#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Compare authored DOS filename searches using actual pinned Wine A/W exports."""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess

WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'
NAMES = ['update.INT', 'update1.INT', 'update01.INT', 'update99.INT', 'updateAA.INT',
         'update012.INT', 'update0a.INT', 'update1', 'update', 'a', 'ab', 'abc', 'abcd',
         'a.txt', 'ab.txt', 'abc.txt', 'a.b.txt', 'a.b', 'a.long', 'file', 'FILE.TXT',
         '.hidden', 'a.hidden', 'b.txt', 'long file name.txt']
PATTERNS = ['*', '*.*', '*.', 'update??.INT', 'update?.INT', 'update*.INT', 'update.*',
            'UP*??.i?t', 'a?', 'a??', '?.txt', '??.txt', '*.txt', 'a.*', 'a*.*',
            'a*.txt', 'a?.*', '*.???', 'a*.', '*a*', '????????.???', 'no-match*',
            'update.INT', 'UPDATE01.int', 'a.', '.hidden', 'a.txt.', 'a?b.txt', 'UPDATE??.INT', 'UP*??.INT', 'update*??.INT', 'up*??.i?t', '*.i?t', '*.INT', '*.int', 'UPDATE*.INT']

def run(command):
    return subprocess.run([str(x) for x in command], check=True, capture_output=True, timeout=60)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--fixture',type=Path)
    args=parser.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    directory=output/'files';directory.mkdir(exist_ok=True)
    for name in NAMES:(directory/name).write_bytes(b'authored')
    compiler=args.emsdk.resolve()/'upstream/bin';declarations=[];calls=[];rows=[]
    for wide in [False,True]:
        for pattern in PATTERNS:
            index=len(rows);text='Z:\\work\\files\\'+pattern
            values=[ord(c) for c in text]+[0]
            declarations.append(f'static {"unsigned short" if wide else "char"} f{index}[]={{'+','.join(map(str,values))+'};')
            calls.append(f'record({index},{int(wide)},f{index});')
            rows.append({'wide':wide,'pattern':pattern})
    source='''// SPDX-License-Identifier: MPL-2.0
typedef unsigned int U;
extern "C" {
__declspec(dllimport) U __stdcall FindFirstFileA(void const*,void*) asm("_FindFirstFileA");
__declspec(dllimport) U __stdcall FindFirstFileW(void const*,void*) asm("_FindFirstFileW");
__declspec(dllimport) int __stdcall FindNextFileA(U,void*) asm("_FindNextFileA");
__declspec(dllimport) int __stdcall FindNextFileW(U,void*) asm("_FindNextFileW");
__declspec(dllimport) int __stdcall FindClose(U) asm("_FindClose");
__declspec(dllimport) U __stdcall GetLastError() asm("_GetLastError");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static U found[148],entries[128][148];
static void emit(void const* data,U size){U done;if(!WriteFile(GetStdHandle((U)-11),data,size,&done,0)||done!=size)ExitProcess(20);}
static void record(U id,U wide,void const* pattern){
 U count=0,h=wide?FindFirstFileW(pattern,found):FindFirstFileA(pattern,found);
 if(h!=(U)-1){do{if(count>=128)ExitProcess(21);for(U i=0;i<148;i++)entries[count][i]=found[i];count++;}while(wide?FindNextFileW(h,found):FindNextFileA(h,found));FindClose(h);}
 U header[]={id,wide,count};emit(header,sizeof(header));emit(entries,count*592);
}
'''+ '\n'.join(declarations)+'\nextern "C" void start(){'+''.join(calls)+'ExitProcess(0);}\n'
    (output/'oracle.cpp').write_text(source)
    names=['FindFirstFileA','FindFirstFileW','FindNextFileA','FindNextFileW','FindClose','GetLastError','GetStdHandle','WriteFile','ExitProcess']
    (output/'kernel32.def').write_text('LIBRARY kernel32.dll\nEXPORTS\n'+'\n'.join(names)+'\n')
    run([compiler/'lld','-flavor','link','/lib',f'/def:{output/"kernel32.def"}','/machine:x86',f'/out:{output/"kernel32.lib"}'])
    run([compiler/'clang++','--target=i686-pc-windows-msvc','-O1','-fno-stack-protector','-fno-exceptions','-fno-rtti','-fno-builtin','-c',output/'oracle.cpp','-o',output/'oracle.obj'])
    run([compiler/'lld','-flavor','link','/entry:start','/subsystem:console','/nodefaultlib','/machine:x86',f'/out:{output/"oracle.exe"}',output/'oracle.obj',output/'kernel32.lib'])
    result=run(['docker','run','--rm','--network','none','--user',f'{os.getuid()}:{os.getgid()}',
                '-e','WINEPREFIX=/work/wine-prefix','-e','WINEARCH=win32','-e','WINEDEBUG=-all','-v',f'{output}:/work',WINE_ID,'wine','Z:\\work\\oracle.exe'])
    (output/'result.bin').write_bytes(result.stdout);at=0
    for i,row in enumerate(rows):
        case,wide,count=struct.unpack_from('<III',result.stdout,at);at+=12
        assert case==i and wide==int(row['wide']);matches=[]
        for n in range(count):
            data=result.stdout[at:at+592];at+=592
            if wide:
                units=struct.unpack_from('<260H',data,44);name=''.join(chr(c) for c in units).split('\0')[0]
            else:name=data[44:304].split(b'\0')[0].decode('ascii')
            if name not in ['.','..']:matches.append(name)
        row['matches']=sorted(matches)
    assert at==len(result.stdout)
    aliases={}
    raw=result.stdout;pos=0
    for row in rows:
        _,wide,count=struct.unpack_from('<III',raw,pos);pos+=12
        for n in range(count):
            data=raw[pos:pos+592];pos+=592
            if wide:
                name=''.join(chr(c) for c in struct.unpack_from('<260H',data,44)).split('\0')[0]
                short=''.join(chr(c) for c in struct.unpack_from('<14H',data,564)).split('\0')[0]
            else:
                name=data[44:304].split(b'\0')[0].decode('ascii');short=data[304:318].split(b'\0')[0].decode('ascii')
            if name not in ['.','..']:aliases[name]=short
    report={'wineImage':WINE_ID,'names':NAMES,'aliases':aliases,'cases':rows}
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    if args.fixture:args.fixture.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'report':str(output/'report.json')}))

if __name__=='__main__':main()
