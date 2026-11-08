// SPDX-License-Identifier: MPL-2.0
// Authored host harness. The separately mounted EXE is loaded without entry,
// TLS callbacks or automatic imports; only reviewed M2/CRT regions are called.
// Its preferred VA is reserved by the private composite host image.
#define start nativeM2RasterReferenceEntry
#include "native-ppi-d3d9-oracle.cpp"
#undef start
extern "C" {
__declspec(dllimport) int __stdcall VirtualProtect(void*,U,U,U*) asm("_VirtualProtect");
__declspec(dllimport) void* __stdcall GetProcessHeap() asm("_GetProcessHeap");
__declspec(dllimport) void* __stdcall HeapAlloc(void*,U,U) asm("_HeapAlloc");
__declspec(dllimport) int __stdcall HeapFree(void*,U,void*) asm("_HeapFree");
}
static U originalDevice[119], deviceTable[119], d3dTable[17], capture;
void output(void const* data,U size){while(size){U n=0;if(!WriteFile(GetStdHandle((U)-11),data,size,&n,0)||!n)ExitProcess(30);data=(B const*)data+n;size-=n;}}
void put(U value){output(&value,4);}
void diagnostic(char const* text){U n=0;while(text[n])n++;U done;WriteFile(GetStdHandle((U)-12),text,n,&done,0);}
extern "C" void blocked(){diagnostic("Unreachable engine platform import called\n");ExitProcess(31);}
U __stdcall caps(void*,U*out){for(U i=0;i<76;i++)out[i]=0;out[0]=1;out[22]=out[23]=4096;out[34]=255;return 0;}
U __stdcall format(void*,U a,U type,U,U usage,U resource,U fmt){if(a||type!=1||usage||resource!=3)return 0x8876086a;return fmt==21||fmt==22||fmt==23||fmt==25||fmt==26||fmt==28||fmt==50||fmt==51?0:0x8876086a;}
U vertices(U type,U count){if(type==1)return count;if(type==2)return count*2;if(type==3)return count+1;if(type==4)return count*3;if(type==5||type==6)return count+2;ExitProcess(32);return 0;}
U __stdcall draw(void* device,U type,U count,void const* data,U stride){if(capture){U fvf=0;invoke<U>(device,90,&fvf);put(83);put(type);put(count);put(stride);put(fvf);output(data,vertices(type,count)*stride);}return((U(__stdcall*)(void*,U,U,void const*,U))originalDevice[83])(device,type,count,data,stride);}
U __stdcall drawIndexed(void* device,U type,U minimum,U countVertices,U count,void const* indices,U fmt,void const* data,U stride){if(capture){U fvf=0;invoke<U>(device,90,&fvf);put(84);put(type);put(count);put(stride);put(fvf);put(minimum);put(countVertices);put(fmt);output(indices,vertices(type,count)*(fmt==101?2:4));output(data,(minimum+countVertices)*stride);}return((U(__stdcall*)(void*,U,U,U,U,void const*,U,void const*,U))originalDevice[84])(device,type,minimum,countVertices,count,indices,fmt,data,stride);}
void patch(U address,void* function){U old; if(!VirtualProtect((void*)address,5,0x40,&old))ExitProcess(33);B*code=(B*)address;code[0]=0xe9;*(U*)(code+1)=(U)function-address-5;U ignored;VirtualProtect(code,5,old,&ignored);}
void* __cdecl allocate(U size){return HeapAlloc(*(void**)0xb91b6c,0,size?size:1);}
void __cdecl release(void* pointer){if(pointer&&!HeapFree(*(void**)0xb91b6c,0,pointer))ExitProcess(34);}
static int equal(char const*a,char const*b){while(*a&&*a==*b){a++;b++;}return*a==*b;}
void loadEngine(){
 U base=0x400000;U*desc=(U*)(base+ENGINE_IMPORT_RVA);
 for(;desc[3];desc+=5){char const*dll=(char const*)(base+desc[3]);void*module=0;
  int steam=equal(dll,"steam_api.dll")||equal(dll,"steam_api64.dll");
  if(!steam)module=LoadLibraryA(equal(dll,"emotedriver.dll")?"Z:\\input\\emotedriver.dll":dll);
  if(!steam&&!module){diagnostic("Missing Windows library: ");diagnostic(dll);diagnostic("\n");ExitProcess(36);}
  U*lookup=(U*)(base+(desc[0]?desc[0]:desc[4])),*iat=(U*)(base+desc[4]);
  for(;*lookup;lookup++,iat++){char const*name=(*lookup&0x80000000)?(char const*)(*lookup&65535):(char const*)(base+*lookup+2);void*address=steam?(void*)blocked:GetProcAddress(module,name);
   if(!address){diagnostic("Missing Windows import\n");ExitProcess(37);}U old;if(!VirtualProtect(iat,4,4,&old))ExitProcess(38);*iat=(U)address;U ignored;VirtualProtect(iat,4,old,&ignored);
  }
 }
 *(void**)0xb91b6c=GetProcessHeap();patch(0x79ea57,(void*)allocate);patch(0x5cac7e,(void*)allocate);patch(0x6f81d0,(void*)release);
 U helpers[]={0x7a8807,0x7ab2e1,0x7ab24e,0x79f8fb,0x7ad3bb};for(U i=0;i<5;i++)((void(__cdecl*)())helpers[i])();
}
template<class R,class... A>R engine(U address,void*object,A...args){return((R(__thiscall*)(void*,A...))address)(object,args...);}
extern "C" void start(){
 loadEngine();
 void*user=LoadLibraryA("user32.dll");void*window=((void*(__stdcall*)(U,char const*,char const*,U,int,int,int,int,void*,void*,void*,void*))GetProcAddress(user,"CreateWindowExA"))(0,"STATIC","M2 region oracle",0x80000000,0,0,64,64,0,0,0,0);
 void*d3d=((void*(__stdcall*)(U))GetProcAddress(LoadLibraryA("d3d9.dll"),"Direct3DCreate9"))(32);Present pp={64,64,21,1,0,0,1,window,1,1,75,1,0,0x80000000};void*device=0;check(invoke<U>(d3d,16,(U)0,(U)1,window,(U)0x22,&pp,&device));
 for(U i=0;i<119;i++)originalDevice[i]=deviceTable[i]=(*(U**)device)[i];for(U i=0;i<17;i++)d3dTable[i]=(*(U**)d3d)[i];deviceTable[7]=(U)caps;deviceTable[83]=(U)draw;deviceTable[84]=(U)drawIndexed;d3dTable[10]=(U)format;*(U**)device=deviceTable;*(U**)d3d=d3dTable;
 ((U(__cdecl*)(void*,char const*,U,U))0x57cd60)(device,"m2view.cnf",0,1);void*manager=*(void**)0xb9bd94;if(!manager)ExitProcess(39);engine<U>(0x57d0e0,manager,(U)64,(U)64);engine<U>(0x57ee30,manager,(U)1);engine<U>(0x57f3e0,manager,(U)0);
 engine<U>(0x57d160,manager,(U)123,(U)0);U loaded=engine<U>(0x57d270,manager,(U)123,(U)0,"aa01,1,1,1,1,0,1,0:0",(U)0);put(loaded);if(!loaded)ExitProcess(40);
 for(U frame=0;frame<4;frame++){capture=1;U result=engine<U>(0x57def0,manager,(U)123,frame,(U)0,(U)0,(U)1);capture=0;put(0);put(result);void*texture=engine<void*>(0x57e200,manager,(U)123);if(!texture)ExitProcess(41);void*surface=0;check(invoke<U>(texture,18,(U)0,&surface));U desc[8];check(invoke<U>(surface,12,desc));put(desc[6]);put(desc[7]);void*copy=0;check(invoke<U>(device,36,desc[6],desc[7],desc[0],(U)2,&copy,(void*)0));check(invoke<U>(device,32,surface,copy));Locked locked;check(invoke<U>(copy,13,&locked,(void*)0,(U)16));for(U y=0;y<desc[7];y++)output((B*)locked.data+y*locked.pitch,desc[6]*4);check(invoke<U>(copy,14));invoke<U>(copy,2);invoke<U>(surface,2);}
 ((void(__cdecl*)())0x57cdf0)();*(U**)device=originalDevice;invoke<U>(device,2);invoke<U>(d3d,2);ExitProcess(0);
}
