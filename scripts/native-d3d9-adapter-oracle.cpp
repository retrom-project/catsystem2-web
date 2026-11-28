// SPDX-License-Identifier: MPL-2.0
// Authored raster oracle using the documented D3D9 COM ABI. No SDK headers,
// engine instructions, C runtime, or game assets are linked into this program.
// Captures CreateDevice floating-point control-word side effects. Inputs and
// outputs are fixed-size little-endian records; no proprietary engine is used.
typedef unsigned int U;
typedef unsigned char B;
extern "C" {
__declspec(dllimport) void* __stdcall LoadLibraryA(char const*) asm("_LoadLibraryA");
__declspec(dllimport) void* __stdcall GetProcAddress(void*, char const*) asm("_GetProcAddress");
__declspec(dllimport) int __stdcall ReadFile(void*, void*, U, U*, void*) asm("_ReadFile");
__declspec(dllimport) int __stdcall WriteFile(void*, void const*, U, U*, void*) asm("_WriteFile");
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
int _fltused = 0;
}
U deviceCaps[128];

template<class R, class... A> R invoke(void* object, U slot, A... args) {
  return ((R(__stdcall*)(void*, A...))(*(U**)object)[slot])(object, args...);
}
void check(U code) {
  if (!(code & 0x80000000)) return;
  char out[] = "D3D9 HRESULT 00000000\n";
  char hex[] = "0123456789abcdef";
  for (U i = 0; i < 8; i++) out[13 + i] = hex[(code >> (28 - i * 4)) & 15];
  U written;
  WriteFile(GetStdHandle((U)-12), out, sizeof(out) - 1, &written, 0);
  ExitProcess(10);
}
void input(void* data, U length) {
  while (length) {
    U got = 0;
    if (!ReadFile(GetStdHandle((U)-10), data, length, &got, 0) || !got) ExitProcess(11);
    data = (B*)data + got;
    length -= got;
  }
}
U word() { U value; input(&value, 4); return value; }
struct Vertex { float x, y, z, w; U color; float u, v; };
struct Present {
  U width, height, format, count, mstype, msquality, swap;
  void* window;
  int windowed, depth;
  U depthFormat, flags, hz, interval;
};
struct Locked { int pitch; void* data; };

extern "C" void start() {
  void* user = LoadLibraryA("user32.dll");
  void* window = ((void*(__stdcall*)(U, char const*, char const*, U, int, int,
                  int, int, void*, void*, void*, void*))
    GetProcAddress(user, "CreateWindowExA"))(
      0, "STATIC", "D3D9 Control Oracle", 0x80000000, 0, 0, 8, 8, 0, 0, 0, 0);
  if (!window) ExitProcess(2);
  void* dll = LoadLibraryA("d3d9.dll");
  void* d3d = ((void*(__stdcall*)(U))GetProcAddress(dll, "Direct3DCreate9"))(32);
  if (!d3d) ExitProcess(4);
  const U count = word();
  U written;
  WriteFile(GetStdHandle((U)-11), &count, 4, &written, 0);
  for (U i = 0; i < count; ++i) {
    U row[13]; input(row, 12);
    Present pp = {8, 8, 22, 1, 0, 0, 3, window, 1, 1, 80, 1, 0, 0};
    void* device = 0;
    unsigned short cw = (unsigned short)row[1];
    __asm__ volatile("fldcw %0" : : "m"(cw));
    __asm__ volatile("ldmxcsr %0" : : "m"(row[2]));
    row[3] = invoke<U>(d3d, 16, (U)0, (U)1, window, row[0], &pp, &device);
    __asm__ volatile("fnstcw %0" : "=m"(cw)); row[4] = cw;
    __asm__ volatile("stmxcsr %0" : "=m"(row[5]));
    if (device) {
      cw = (unsigned short)row[1];
      __asm__ volatile("fldcw %0" : : "m"(cw));
      __asm__ volatile("ldmxcsr %0" : : "m"(row[2]));
      invoke<U>(device, 7, deviceCaps);
      __asm__ volatile("fnstcw %0" : "=m"(cw)); row[6] = cw;
      __asm__ volatile("stmxcsr %0" : "=m"(row[7]));
      cw = (unsigned short)row[1];
      __asm__ volatile("fldcw %0" : : "m"(cw));
      __asm__ volatile("ldmxcsr %0" : : "m"(row[2]));
      row[8] = invoke<U>(device, 16, &pp);
      __asm__ volatile("fnstcw %0" : "=m"(cw)); row[9] = cw;
      __asm__ volatile("stmxcsr %0" : "=m"(row[10]));
      cw = (unsigned short)row[1];
      __asm__ volatile("fldcw %0" : : "m"(cw));
      __asm__ volatile("ldmxcsr %0" : : "m"(row[2]));
      invoke<U>(device, 2);
      __asm__ volatile("fnstcw %0" : "=m"(cw)); row[11] = cw;
      __asm__ volatile("stmxcsr %0" : "=m"(row[12]));
    }
    WriteFile(GetStdHandle((U)-11), row, sizeof(row), &written, 0);
  }
  invoke<U>(d3d, 2);
  ExitProcess(0);
}
