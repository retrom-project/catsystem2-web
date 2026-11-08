#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Authored GDI bitmap selection, fill and copy cases against pinned Wine."""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess

WINE_ID = 'sha256:81080f23de3472eb80c335daad91f187fdd1d78e678a0a630fee90677d3359a8'

def run(command):
    return subprocess.run([str(v) for v in command], check=True, capture_output=True, timeout=60)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    args = parser.parse_args(); output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    rows = []
    for height in [-4, 4]:
        for depth in [24, 32]:
            for rect in [[0,0,5,4],[1,1,3,2],[-2,-1,4,3],[3,2,8,7],[1,1,1,3],[3,3,1,1]]:
                rows.append(dict(height=height, depth=depth, operation='fill', rect=rect, color=0x123456))
            for mode in [1,3]:
                for params in [[0,0,4,3,0,0,4,3],[1,1,3,2,0,0,4,3],[-1,-1,5,4,0,0,4,3],
                               [0,0,5,4,0,0,4,3],[0,0,2,2,0,0,4,3],
                               [4,0,-4,3,0,0,4,3],[0,0,4,3,4,0,-4,3],
                               [0,3,4,-3,0,0,4,3],[0,0,4,3,0,3,4,-3],
                               [0,0,4,3,-1,-1,4,3],[0,0,0,3,0,0,4,3]]:
                    rows.append(dict(height=height, depth=depth, operation='stretch', mode=mode, params=params, rop=0xcc0020))
            for rop in [0xcc0020,0x660046,0x8800c6,0xee0086,0x330008,0x550009,0x000042,0xff0062]:
                rows.append(dict(height=height, depth=depth, operation='blit', params=[1,1,4,3,0,0,4,3], rop=rop))
    source = r'''// SPDX-License-Identifier: MPL-2.0
typedef unsigned int U;
extern "C" {
__declspec(dllimport) U __stdcall CreateDIBSection(U,void const*,U,void**,U,U) asm("_CreateDIBSection");
__declspec(dllimport) U __stdcall CreateCompatibleDC(U) asm("_CreateCompatibleDC");
__declspec(dllimport) U __stdcall SelectObject(U,U) asm("_SelectObject");
__declspec(dllimport) U __stdcall GetCurrentObject(U,U) asm("_GetCurrentObject");
__declspec(dllimport) int __stdcall DeleteObject(U) asm("_DeleteObject");
__declspec(dllimport) int __stdcall DeleteDC(U) asm("_DeleteDC");
__declspec(dllimport) int __stdcall GetObjectA(U,int,void*) asm("_GetObjectA");
__declspec(dllimport) U __stdcall CreateSolidBrush(U) asm("_CreateSolidBrush");
__declspec(dllimport) int __stdcall FillRect(U,int const*,U) asm("_FillRect");
__declspec(dllimport) int __stdcall SetStretchBltMode(U,int) asm("_SetStretchBltMode");
__declspec(dllimport) int __stdcall StretchBlt(U,int,int,int,int,U,int,int,int,int,U) asm("_StretchBlt");
__declspec(dllimport) int __stdcall BitBlt(U,int,int,int,int,U,int,int,U) asm("_BitBlt");
__declspec(dllimport) U __stdcall GetLastError() asm("_GetLastError");
__declspec(dllimport) void __stdcall SetLastError(U) asm("_SetLastError");
__declspec(dllimport) U __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall WriteFile(U,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static U info[16],object[8];
static void emit(void const*p,U n){U done;if(!WriteFile(GetStdHandle((U)-11),p,n,&done,0)||done!=n)ExitProcess(20);}
static void record(U id,int height,U depth,U op,int mode,int a,int b,int c,int d,int e,int f,int g,int h,U rop){
 for(U i=0;i<16;i++)info[i]=0;
 info[0]=40;info[1]=4;info[2]=(U)-3;info[3]=(32<<16)|1;
 void*sp=0;U sb=CreateDIBSection(0,info,0,&sp,0,0);
 info[1]=5;info[2]=(U)height;info[3]=(depth<<16)|1;
 void*dp=0;U db=CreateDIBSection(0,info,0,&dp,0,0);
 if(!sb||!db)ExitProcess(21);
 unsigned char*s=(unsigned char*)sp,*t=(unsigned char*)dp;
 U stride=((5*depth+31)/32)*4,bytes=stride*4;
 for(U y=0;y<3;y++)for(U x=0;x<4;x++){U i=(y*4+x)*4;s[i]=(unsigned char)(x*23+y*71+3);s[i+1]=(unsigned char)(x*31+y*17+5);s[i+2]=(unsigned char)(x*47+y*11+7);s[i+3]=(unsigned char)(x*19+y*29+13);}
 for(U i=0;i<bytes;i++)t[i]=0xa5;
 U sc=CreateCompatibleDC(0),dc=CreateCompatibleDC(0),other=CreateCompatibleDC(0);
 U stock=GetCurrentObject(sc,7),so=SelectObject(sc,sb),od=SelectObject(dc,db);
 U conflict=SelectObject(other,sb);int previous=SetStretchBltMode(dc,mode),returned;
 SetLastError(0xb16a5);
 if(op==0){int rc[]={a,b,c,d};U brush=CreateSolidBrush(rop);returned=FillRect(dc,rc,brush);DeleteObject(brush);}
 else if(op==1)returned=StretchBlt(dc,a,b,c,d,sc,e,f,g,h,rop);
 else returned=BitBlt(dc,a,b,c,d,sc,e,f,rop);
 U head[]={id,stock?1u:0u,so==stock?1u:0u,od?1u:0u,conflict?1u:0u,(U)previous,(U)returned,GetLastError(),bytes};emit(head,sizeof(head));emit(t,bytes);
 U deleted=DeleteObject(db),queried=(U)GetObjectA(db,24,object),old=SelectObject(dc,od),again=DeleteObject(db);
 U tail[]={deleted,queried,old==db?1u:0u,again,GetLastError()};emit(tail,sizeof(tail));
 SelectObject(sc,so);DeleteObject(sb);DeleteDC(sc);DeleteDC(dc);DeleteDC(other);
}
extern "C" void start(){
'''
    for i,row in enumerate(rows):
        params = row.get('params',row.get('rect',[])+[0]*4)
        source += f'record({i},{row["height"]},{row["depth"]},{["fill","stretch","blit"].index(row["operation"])},{row.get("mode",3)},{",".join(map(str,params))},{row.get("rop",row.get("color"))}u);\n'
    source += 'ExitProcess(0);}\n'; (output/'oracle.cpp').write_text(source)
    compiler=args.emsdk.resolve()/'upstream/bin'; libs=[]
    for dll,names in [('kernel32',['GetLastError','SetLastError','GetStdHandle','WriteFile','ExitProcess']),
                      ('gdi32',['CreateDIBSection','CreateCompatibleDC','SelectObject','GetCurrentObject','DeleteObject','DeleteDC','GetObjectA','CreateSolidBrush','SetStretchBltMode','StretchBlt','BitBlt']),('user32',['FillRect'])]:
        definition=output/f'{dll}.def';definition.write_text(f'LIBRARY {dll}.dll\nEXPORTS\n'+'\n'.join(names)+'\n')
        lib=output/f'{dll}.lib';libs.append(lib)
        run([compiler/'lld','-flavor','link','/lib',f'/def:{definition}','/machine:x86',f'/out:{lib}'])
    run([compiler/'clang++','--target=i686-pc-windows-msvc','-O1','-fno-stack-protector','-fno-exceptions','-fno-rtti','-fno-builtin','-c',output/'oracle.cpp','-o',output/'oracle.obj'])
    run([compiler/'lld','-flavor','link','/entry:start','/subsystem:console','/nodefaultlib','/machine:x86',f'/out:{output/"oracle.exe"}',output/'oracle.obj',*libs])
    result=run(['docker','run','--rm','--network','none','--user',f'{os.getuid()}:{os.getgid()}',
      '-e','WINEPREFIX=/work/wine-prefix','-e','WINEARCH=win32','-e','WINEDEBUG=-all','-v',f'{output}:/work',WINE_ID,'wine','Z:\\work\\oracle.exe'])
    (output/'result.bin').write_bytes(result.stdout);at=0
    for i,row in enumerate(rows):
        head=struct.unpack_from('<9I',result.stdout,at);at+=36;assert head[0]==i
        row['returned']=list(head[1:8]);row['pixels']=result.stdout[at:at+head[8]].hex();at+=head[8]
        row['deletion']=list(struct.unpack_from('<5I',result.stdout,at));at+=20
    if at!=len(result.stdout):raise ValueError(f'Unexpected {len(result.stdout)} bytes, consumed {at}')
    report={'wineImage':WINE_ID,'sourceWidth':4,'sourceHeight':-3,'destinationWidth':5,'cases':rows}
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    if args.fixture:args.fixture.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'report':str(output/'report.json')}))

if __name__=='__main__':main()
