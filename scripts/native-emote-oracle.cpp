// SPDX-License-Identifier: MPL-2.0
// Executes a separately supplied E-mote DLL on a real D3D9 device. Only the
// advertised caps are narrowed to the browser's software-vertex profile.
#define start ppiRasterOracleStart
#include "native-ppi-d3d9-oracle.cpp"
#undef start
extern "C" __declspec(dllimport) void* __stdcall VirtualAlloc(void*, U, U, U) asm("_VirtualAlloc");
U originalDevice[119], deviceTable[119], originalD3D[17], d3dTable[17];
U capturing;
void output(void const* bytes, U size) {
  while (size) { U done; if (!WriteFile(GetStdHandle((U)-11), bytes, size, &done, 0) || !done) ExitProcess(20); bytes = (B const*)bytes + done; size -= done; }
}
void put(U value) { output(&value, 4); }
template<class R, class... A> R member(void* object, U slot, A... args) {
  return ((R(__thiscall*)(void*, A...))(*(U**)object)[slot])(object, args...);
}
U __stdcall caps(void*, U* out) {
  for (U i = 0; i < 76; i++) out[i] = 0;
  out[0] = 1; out[22] = out[23] = 4096; out[34] = 255;
  return 0;
}
U __stdcall format(void*, U adapter, U type, U, U usage, U resource, U fmt) {
  if (adapter || type != 1 || usage || resource != 3) return 0x8876086a;
  return fmt == 21 || fmt == 22 || fmt == 23 || fmt == 25 || fmt == 26 || fmt == 28 || fmt == 50 || fmt == 51 ? 0 : 0x8876086a;
}
U countVertices(U type, U count) {
  if (type == 1) return count;
  if (type == 2) return count * 2;
  if (type == 3 || type == 5 || type == 6) return count + (type == 3 ? 1 : 2);
  if (type == 4) return count * 3;
  ExitProcess(21); return 0;
}
U __stdcall draw(void* device, U type, U count, void const* vertices, U stride) {
  if (capturing) { U fvf = 0; invoke<U>(device, 90, &fvf); put(83); put(type); put(count); put(stride); put(fvf); output(vertices, countVertices(type, count) * stride); }
  return ((U(__stdcall*)(void*, U, U, void const*, U))originalDevice[83])(device, type, count, vertices, stride);
}
U __stdcall drawIndexed(void* device, U type, U minimum, U vertices, U count, void const* indices, U fmt, void const* data, U stride) {
  if (capturing) { U fvf = 0; invoke<U>(device, 90, &fvf); put(84); put(type); put(count); put(stride); put(fvf); put(minimum); put(vertices); put(fmt); output(indices, countVertices(type, count) * (fmt == 101 ? 2 : 4)); output(data, (minimum + vertices) * stride); }
  return ((U(__stdcall*)(void*, U, U, U, U, void const*, U, void const*, U))originalDevice[84])(device, type, minimum, vertices, count, indices, fmt, data, stride);
}
extern "C" void start() {
  void* user = LoadLibraryA("user32.dll");
  void* window = ((void*(__stdcall*)(U, char const*, char const*, U, int, int, int, int, void*, void*, void*, void*))GetProcAddress(user,"CreateWindowExA"))(0,"STATIC","E-mote Oracle",0x80000000,0,0,256,256,0,0,0,0);
  void* d3d = ((void*(__stdcall*)(U))GetProcAddress(LoadLibraryA("d3d9.dll"), "Direct3DCreate9"))(32);
  Present pp = {256,256,21,1,0,0,1,window,1,1,75,1,0,0x80000000};
  void* device = 0; check(invoke<U>(d3d,16,(U)0,(U)1,window,(U)0x22,&pp,&device));
  for (U i=0;i<119;i++) originalDevice[i]=deviceTable[i]=(*(U**)device)[i];
  for (U i=0;i<17;i++) originalD3D[i]=d3dTable[i]=(*(U**)d3d)[i];
  deviceTable[7]=(U)caps; deviceTable[83]=(U)draw; deviceTable[84]=(U)drawIndexed; d3dTable[10]=(U)format;
  *(U**)device=deviceTable; *(U**)d3d=d3dTable;
  float projection[16]={2.f/256,0,0,0,0,-2.f/256,0,0,0,0,1,0,-1,1,0,1};
  float world[16]={32,0,0,0,0,32,0,0,0,0,1,0,128,128,0,1};
  check(invoke<U>(device,44,(U)3,projection)); check(invoke<U>(device,44,(U)256,world));
  void* dll=LoadLibraryA("Z:\\input\\emotedriver.dll"); if(!dll)ExitProcess(22);
  void* (*create)(void*)=(void*(*)(void*))GetProcAddress(dll,"?EmoteCreate@@YAPAVIEmoteDevice@@ABUInitParam@1@@Z"); if(!create)ExitProcess(23);
  void* init[3]={device,0,0};void* emote=create(init);if(!emote)ExitProcess(24);
  U size=word();void* model=VirtualAlloc(0,size,0x3000,4);input(model,size);void* player=0;
  member<void*>(emote,9,model,size,&player); if(!player)ExitProcess(25);
  member<void>(player,6);
  U variables=member<U>(player,31);put(variables);
  for(U i=0;i<variables;i++){char const* name=member<char const*>(player,32,i);U length=0;while(name[length])length++;put(length);output(name,length);}
  member<void>(player,36,"pose",0.f,0.f,0.f);
  member<void>(player,36,"pose",10.f,10.f,0.f);
  for(U frame=0;frame<4;frame++){
    member<void>(player,63,frame==0?0.f:frame==3?3.f:1.f);
    float value=member<float>(player,37,"pose");output(&value,4);
    check(invoke<U>(device,43,(U)0,(void*)0,(U)7,(U)0xff204060,1.f,(U)0));
    check(invoke<U>(device,41));capturing=1;member<void>(player,65);capturing=0;put(0);check(invoke<U>(device,42));
    void* surface=0;check(invoke<U>(device,18,(U)0,(U)0,(U)0,&surface));Locked locked;check(invoke<U>(surface,13,&locked,(void*)0,(U)16));
    for(U y=0;y<256;y++)output((B*)locked.data+y*locked.pitch,256*4);
    check(invoke<U>(surface,14));invoke<U>(surface,2);
  }
  member<void>(player,2);member<void>(emote,2);*(U**)device=originalDevice;*(U**)d3d=originalD3D;invoke<U>(device,2);invoke<U>(d3d,2);ExitProcess(0);
}
