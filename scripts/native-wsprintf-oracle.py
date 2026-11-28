#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Authored USER32 wsprintf ABI cases under the pinned private Wine host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'

def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, capture_output=True, timeout=60, **kwargs)

def cases():
    result = []
    numbers = ['%d', '%u', '%x', '%X', '%#x', '%#08X', '%08d', '%-08d', '%.0d', '%.4d', '%10.4d', '%010.4d', '%hd', '%hu', '%ld', '%Ix', '%p', '%#p', '%12p', '%o', '%f', '%+d', '% d', '%I64x', '%I64d', '%I64u', '%I32x', '%Iu', '%#8x', '%#010.12x', '%01025d']
    for wide in [False, True]:
        for fmt in numbers:
            for value in [0, 7, 0xffffffff, 0x80000000]:
                result.append({'wide':wide,'format':fmt,'args':[value,0x12345678]})
        for fmt in ['%s', '%S', '%hs', '%ls', '%hS', '%lS', '%ws', '%wS', '%.0s', '%.1s', '%8.3s', '%08.3s', '%-08.3s']:
            source_wide = (fmt in ['%ls', '%ws', '%lS', '%wS'] if wide else fmt in ['%ls', '%ws', '%lS']) if any(c in fmt for c in ['h', 'l', 'w']) else (wide if 's' in fmt else not wide)
            result.append({'wide':wide,'format':fmt,'args':[{'text':'authored text','wide':source_wide}]})
        for fmt in ['%c', '%C', '%hc', '%hC', '%lc', '%lC', '%wc', '%wC', '%4c', '%-04c']:
            for value in [0, 65]:
                result.append({'wide':wide,'format':fmt,'args':[value]})
        result += [{'wide':wide,'format':'save%04d.dat','args':[123]}, {'wide':wide,'format':'save%04d.dat','args':[0xffffffff]},
                   {'wide':wide,'format':'%q / %% / %d','args':[7]}, {'wide':wide,'format':'[%s]','args':[0]}]
    for wide in [False, True]:
        for count in [1022, 1023, 1024, 1025]:
            result.append({'wide':wide,'format':'x'*count,'args':[]})
            result.append({'wide':wide,'format':'a%0'+str(count)+'d-z','args':[7]})
            result.append({'wide':wide,'format':'%#0'+str(count)+'x-z','args':[7]})
            result.append({'wide':wide,'format':'%s!','args':[{'text':'q'*count,'wide':wide}]})
        for fmt in ['%8q:%d', '%08q:%d', '%-8q:%d', '%4%:%d', '%#x:%u', '%I64d:%x', '%#-8x', '%0-8x']:
            result.append({'wide':wide,'format':fmt,'args':[0xffffffff,0x80000000,123]})
    result.append({'wide':True,'format':'%ls','args':[{'text':'猫の名前','wide':True}]})
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--fixture',type=Path,help='Write authored inputs and full-buffer digests for public regression tests')
    args=parser.parse_args(); output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    compiler=args.emsdk.resolve()/'upstream/bin'; rows=cases(); declarations=[];calls=[]
    def array(name,text,wide):
        data=list(struct.unpack('<'+'H'*(len(text.encode('utf-16le'))//2),text.encode('utf-16le'))) if wide else list(text.encode('ascii'))
        declarations.append(f'static {"unsigned short" if wide else "char"} {name}[]={{'+','.join(map(str,data+[0]))+'};')
        return name
    for i,row in enumerate(rows):
        fmt=array(f'f{i}',row['format'],row['wide']);words=[]
        for j,value in enumerate(row['args']):
            words.append('(U)'+array(f'a{i}_{j}',value['text'],value['wide']) if isinstance(value,dict) else str(value)+'u')
        words += ['0u']*(4-len(words));calls.append(f'record({i},{int(row["wide"])},(void*){fmt},'+','.join(words)+');')
    source='''// SPDX-License-Identifier: MPL-2.0
typedef unsigned int U;
extern "C" {
__declspec(dllimport) int __cdecl wsprintfA(char*,char const*,...) asm("_wsprintfA");
__declspec(dllimport) int __cdecl wsprintfW(unsigned short*,unsigned short const*,...) asm("_wsprintfW");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static U buffer[1024];
static void emit(void const* bytes,U length){U done; if(!WriteFile(GetStdHandle((U)-11),bytes,length,&done,0)||done!=length)ExitProcess(20);}
static void record(U id,U wide,void const* format,U a,U b,U c,U d){
 for(U i=0;i<1024;i++)buffer[i]=0xa5a5a5a5;
 int result=wide?wsprintfW((unsigned short*)buffer,(unsigned short const*)format,a,b,c,d):wsprintfA((char*)buffer,(char const*)format,a,b,c,d);
 U header[3]={id,wide,(U)result};emit(header,sizeof(header));emit(buffer,sizeof(buffer));
}
'''+ '\n'.join(declarations)+'\nextern "C" void start(){'+''.join(calls)+'ExitProcess(0);}\n'
    (output/'oracle.cpp').write_text(source)
    for dll,names in [('kernel32',['GetStdHandle','WriteFile','ExitProcess']),('user32',['wsprintfA','wsprintfW'])]:
        (output/f'{dll}.def').write_text(f'LIBRARY {dll}.dll\nEXPORTS\n'+'\n'.join(names)+'\n')
        run([compiler/'lld','-flavor','link','/lib',f'/def:{output/f"{dll}.def"}','/machine:x86',f'/out:{output/f"{dll}.lib"}'])
    run([compiler/'clang++','--target=i686-pc-windows-msvc','-O1','-fno-stack-protector','-fno-exceptions','-fno-rtti','-fno-builtin','-c',output/'oracle.cpp','-o',output/'oracle.obj'])
    run([compiler/'lld','-flavor','link','/entry:start','/subsystem:console','/nodefaultlib','/machine:x86',f'/out:{output/"oracle.exe"}',output/'oracle.obj',output/'kernel32.lib',output/'user32.lib'])
    result=run(['docker','run','--rm','--network','none','--user',f'{os.getuid()}:{os.getgid()}',
                '-e','WINEPREFIX=/work/wine-prefix','-e','WINEARCH=win32','-e','WINEDEBUG=-all','-v',f'{output}:/work',WINE_ID,'wine','Z:\\work\\oracle.exe'])
    (output/'result.bin').write_bytes(result.stdout)
    if len(result.stdout)!=len(rows)*4108:raise ValueError(f'Unexpected record bytes {len(result.stdout)} for {len(rows)} cases')
    for i,row in enumerate(rows):
        at=i*4108;case,wide,count=struct.unpack_from('<IIi',result.stdout,at);assert case==i and wide==int(row['wide'])
        data=result.stdout[at+12:at+4108];row.update(result=count,sha256=hashlib.sha256(data).hexdigest(),output=data.hex())
    (output/'report.json').write_text(json.dumps({'wineImage':WINE_ID,'cases':rows},ensure_ascii=False,indent=2)+'\n')
    if args.fixture:
        args.fixture.write_text(json.dumps({'wineImage':WINE_ID,'cases':[{k:v for k,v in row.items() if k!='output'} for row in rows]},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'report':str(output/'report.json')}))

if __name__=='__main__':main()
