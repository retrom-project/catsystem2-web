// SPDX-License-Identifier: MPL-2.0
// Authored ABI harness. No CatSystem2 source or binary is embedded here.
// The builder privately appends this image to the hash-checked engine image,
// preserving its original preferred VA for the pure PPF math/RNG routines.
// Screen/exit/resource callbacks are explicit test host services. Z/state
// callbacks fail this bounded oracle rather than claiming native verification.
typedef unsigned int U; typedef unsigned char B;
extern "C" {
__declspec(dllimport) void* __stdcall LoadLibraryA(char const*) asm("_LoadLibraryA");
__declspec(dllimport) void* __stdcall GetProcAddress(void*,char const*) asm("_GetProcAddress");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
__declspec(dllimport) char* __stdcall GetCommandLineA() asm("_GetCommandLineA");
__declspec(dllimport) int __stdcall FreeLibrary(void*) asm("_FreeLibrary");
int _fltused=0;
}
struct Vec {float x,y,z;};struct Vertex{Vec p;U c;float u,v;};struct Particle{Vertex p[4];Vec base,pos,rot,scale;int disp;};
struct Params{U count;float sw,sh,width,height,param[32];};
struct Object{U* table;void* context;void* functions;Particle* particles;U blend;int attach;Vec base,pos;int disp;};
static Particle particles[4];static U table[35];static U host;static B context[4096];static int active=1;
static Params params={4,1280,720,64,64,{1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1}};
#include "ppi-oracle-plist.inc"
void __thiscall screen(void*,void*,U*x,U*y){*x=1280;*y=720;}void __thiscall stop(void*,void*){active=0;}
void __thiscall zshift(void*,void*,U,float){ExitProcess(31);} U __thiscall data(void*,char*,void*out){if(out)for(U i=0;i<sizeof(plist)-1;i++)((B*)out)[i]=plist[i];return sizeof(plist)-1;}
void __thiscall state(void*,void*,U,U){ExitProcess(33);}
#ifdef PPI_RECORD_FPU
static U controlStates[13][3];
void markControl(U index) {
 unsigned short word;
 __asm__ volatile("fnstcw %0" : "=m"(word)); controlStates[index][0]=word;
 __asm__ volatile("fnstsw %0" : "=m"(word)); controlStates[index][1]=word;
 __asm__ volatile("stmxcsr %0" : "=m"(controlStates[index][2]));
}
#else
void markControl(U) {}
#endif
extern "C" void start(){
 char* command=GetCommandLineA();if(*command=='"'){command++;while(*command&&*command!='"')command++;if(*command)command++;}else while(*command&&*command!=' ')command++;while(*command==' ')command++;
 if (*command=='"') { command++; char* end=command; while(*end&&*end!='"')end++; *end=0; }
 void* engine=(void*)0x400000;
#ifdef PPI_FPCW
 unsigned short controlWord=PPI_FPCW;
 __asm__ volatile("fldcw %0" : : "m"(controlWord));
#endif
 markControl(0);
 void* plugin=LoadLibraryA(command);if(!plugin)ExitProcess(2);
 markControl(1);
 U addresses[35]={0x65bdf0,0x65bdd0,0x65c550,0x65c510,0x65bdb0,0x65be90,0x65c5b0,0x65c450,0x65c600,0x65c3a0,0x65c380,0x65c400,0x65c3c0,0x65c420,0x65c470,0x65c4a0,0x65c4d0,0x65c5d0,0x65c520,0x65c370,0x65c560,0x65c0c0,0x65c1f0,0x65c270,0x65c140,0x65c330,0x65c2f0,0x65bff0,0x65c050,0x65be10,0x65beb0,0x65c620,0x65c670,0x65c6e0,0x65c710};for(U i=0;i<35;i++)table[i]=(U)engine+addresses[i]-0x400000;
 table[0]=(U)&screen;table[1]=(U)&stop;table[31]=(U)&zshift;table[32]=(U)&data;table[33]=table[34]=(U)&state;host=(U)table;
 ((void(__cdecl*)(U))((U)engine+0x5c2180-0x400000))(4357);((void(__cdecl*)(U))((U)engine+0x5c1ff0-0x400000))(4357);
 Object* object=((Object*(__cdecl*)(void*))GetProcAddress(plugin,(char*)1))(context);
 markControl(2);
 object->functions=&host;object->particles=particles;object->attach=31;object->base={32,32,0};object->pos={640,360,0};object->disp=1;
 for(U i=0;i<4;i++){particles[i].disp=1;particles[i].scale={1,1,1};for(U j=0;j<4;j++){particles[i].p[j].p={(j&1)?64.f:0.f,(j&2)?64.f:0.f,0};particles[i].p[j].u=(j&1)?1.f:0.f;particles[i].p[j].v=(j&2)?1.f:0.f;particles[i].p[j].c=0xffffffff;}}
 ((void(__thiscall*)(Object*,Params*))object->table[1])(object,&params);
 markControl(3);
 U written;void* output=GetStdHandle((U)-11);WriteFile(output,particles,sizeof(particles),&written,0);
 U frames[6]={0,1,2,15,60,61};U before=0xffffffff;
 for(U i=0;i<6;i++){if(active)((void(__thiscall*)(Object*,Params*,U,U))object->table[2])(object,&params,before,frames[i]);markControl(4+i);WriteFile(output,particles,sizeof(particles),&written,0);before=frames[i];}
 ((void(__thiscall*)(Object*,Params*))object->table[3])(object,&params);
 markControl(10);
 ((void(__cdecl*)(Object*))GetProcAddress(plugin,(char*)2))(object);
 markControl(11);
#ifdef PPI_RECORD_FPU
 FreeLibrary(plugin);markControl(12);
 WriteFile(output,controlStates,sizeof(controlStates),&written,0);
#endif
 ExitProcess(0);
}
