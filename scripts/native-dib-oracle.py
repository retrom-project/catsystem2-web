#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Authored Win32 DIB allocation/description cases in the pinned Wine host."""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess

WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'
SIZES = [0, 1, 12, 23, 24, 25, 40, 83, 84, 88, 128]

def run(command):
    return subprocess.run([str(v) for v in command], check=True, capture_output=True, timeout=60)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    args = parser.parse_args(); output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    compiler = args.emsdk.resolve() / 'upstream/bin'
    rows = [{'width':w,'height':h,'bpp':b,'planes':1,'compression':0,'header':40,'nullBits':False}
            for w in [1,3,7] for h in [-3,3] for b in [1,4,8,16,24,32]]
    for change in [{'width':0},{'width':-1},{'height':0},{'planes':0},{'planes':2},{'bpp':0},{'bpp':15},{'bpp':64},
                   {'compression':1},{'compression':2},{'compression':3},{'header':12},{'header':108},{'header':124},{'nullBits':True}]:
        rows.append({'width':3,'height':3,'bpp':32,'planes':1,'compression':0,'header':40,'nullBits':False,**change})
    rows += [dict(width=3,height=-3,bpp=b,planes=1,compression=3,header=40,nullBits=False,masks=m) for b,m in [(16,[0xf800,0x7e0,0x1f]),(32,[0xff0000,0xff00,0xff])]]
    rows += [dict(width=3,height=3,bpp=b,planes=1,compression=0,header=40,nullBits=False,xppm=100,yppm=-200,colorsUsed=3,colorsImportant=2) for b in [8,24,32]]
    source = '''// SPDX-License-Identifier: MPL-2.0
typedef unsigned int U;
extern "C" {
__declspec(dllimport) U __stdcall CreateDIBSection(U,void const*,U,void**,U,U) asm("_CreateDIBSection");
__declspec(dllimport) int __stdcall GetObjectA(U,int,void*) asm("_GetObjectA");
__declspec(dllimport) int __stdcall GetObjectW(U,int,void*) asm("_GetObjectW");
__declspec(dllimport) int __stdcall DeleteObject(U) asm("_DeleteObject");
__declspec(dllimport) U __stdcall GetLastError() asm("_GetLastError");
__declspec(dllimport) void __stdcall SetLastError(U) asm("_SetLastError");
__declspec(dllimport) U __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(U,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static U info[300],buffer[32];
static U sizes[]={0,1,12,23,24,25,40,83,84,88,128};
static void emit(void const* p,U n){U done;if(!WriteFile(GetStdHandle((U)-11),p,n,&done,0)||done!=n)ExitProcess(20);}
static void record(U id,int width,int height,U bpp,U planes,U compression,U header,U nullBits,U maskR,U maskG,U maskB,U xppm,U yppm,U used,U important){
 for(U i=0;i<300;i++)info[i]=0;
 info[0]=header;info[1]=(U)width;info[2]=(U)height;info[3]=(bpp<<16)|planes;info[4]=compression;info[6]=xppm;info[7]=yppm;info[8]=used;info[9]=important;info[10]=maskR;info[11]=maskG;info[12]=maskB;
 void* bits=(void*)0x13579bdf;
 SetLastError(0xb16a5);
 U h=CreateDIBSection(0,info,0,nullBits?0:&bits,0,0),error=GetLastError();
 U result[]={id,h?1u:0u,error,(U)bits==0x13579bdf?0u:((U)bits?2u:1u)};emit(result,sizeof(result));
 for(U wide=0;wide<2;wide++)for(U i=0;i<11;i++){
  for(U j=0;j<32;j++)buffer[j]=0xa5a5a5a5;
  int n=wide?GetObjectW(h,(int)sizes[i],buffer):GetObjectA(h,(int)sizes[i],buffer);
  if(n>=24&&buffer[5])buffer[5]=1;
  U r[]={(U)n};emit(r,4);emit(buffer,128);
 }
 U queried[]={ (U)GetObjectA(h,0,0), (U)GetObjectW(h,0,0) };emit(queried,8);
 U deleted=DeleteObject(h);emit(&deleted,4);
}
extern "C" void start(){
''' + '\n'.join(f'record({i},{r["width"]},{r["height"]},{r["bpp"]},{r["planes"]},{r["compression"]},{r["header"]},{int(r["nullBits"])},{r.get("masks",[0,0,0])[0]}u,{r.get("masks",[0,0,0])[1]}u,{r.get("masks",[0,0,0])[2]}u,{r.get("xppm",0)},{r.get("yppm",0)},{r.get("colorsUsed",0)},{r.get("colorsImportant",0)});' for i,r in enumerate(rows)) + 'ExitProcess(0);}\n'
    (output/'oracle.cpp').write_text(source)
    libs = []
    for dll,names in [('kernel32',['GetLastError','SetLastError','GetStdHandle','WriteFile','ExitProcess']),('gdi32',['CreateDIBSection','GetObjectA','GetObjectW','DeleteObject'])]:
        definition=output/f'{dll}.def';definition.write_text(f'LIBRARY {dll}.dll\nEXPORTS\n'+'\n'.join(names)+'\n')
        lib=output/f'{dll}.lib';libs.append(lib)
        run([compiler/'lld','-flavor','link','/lib',f'/def:{definition}','/machine:x86',f'/out:{lib}'])
    run([compiler/'clang++','--target=i686-pc-windows-msvc','-O1','-fno-stack-protector','-fno-exceptions','-fno-rtti','-fno-builtin','-c',output/'oracle.cpp','-o',output/'oracle.obj'])
    run([compiler/'lld','-flavor','link','/entry:start','/subsystem:console','/nodefaultlib','/machine:x86',f'/out:{output/"oracle.exe"}',output/'oracle.obj',*libs])
    result=run(['docker','run','--rm','--network','none','--user',f'{os.getuid()}:{os.getgid()}',
                '-e','WINEPREFIX=/work/wine-prefix','-e','WINEARCH=win32','-e','WINEDEBUG=-all','-v',f'{output}:/work',WINE_ID,'wine','Z:\\work\\oracle.exe'])
    (output/'result.bin').write_bytes(result.stdout)
    recordSize=16+22*132+12
    if len(result.stdout)!=recordSize*len(rows):raise ValueError(f'Unexpected {len(result.stdout)} bytes for {len(rows)} cases')
    for i,row in enumerate(rows):
        at=i*recordSize;case,success,error,bits=struct.unpack_from('<4I',result.stdout,at);at+=16;assert case==i
        objects=[]
        for wide in [False,True]:
            for size in SIZES:
                returned=struct.unpack_from('<I',result.stdout,at)[0];at+=4
                objects.append({'wide':wide,'size':size,'returned':returned,'bytes':result.stdout[at:at+128].hex()});at+=128
        queryA,queryW,deleted=struct.unpack_from('<3I',result.stdout,at)
        row.update(success=success,error=error,bits=bits,deleted=deleted,queryA=queryA,queryW=queryW,objects=objects)
    report={'wineImage':WINE_ID,'cases':rows}
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    if args.fixture:args.fixture.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'report':str(output/'report.json')}))

if __name__=='__main__':main()
