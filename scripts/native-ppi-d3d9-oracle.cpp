// SPDX-License-Identifier: MPL-2.0
// Authored raster oracle using the documented D3D9 COM ABI. No SDK headers,
// engine instructions, C runtime, or game assets are linked into this program.
// stdin contains little-endian probe records prepared by the companion script;
// stdout contains native 8x8 A8R8G8B8 render-target bytes for each probe.
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
struct LineVertex { float x, y, z, w; U color; };
struct Viewport { U x, y, width, height; float minZ, maxZ; };
struct Present {
  U width, height, format, count, mstype, msquality, swap;
  void* window;
  int windowed, depth;
  U depthFormat, flags, hz, interval;
};
struct Locked { int pitch; void* data; };

extern "C" void start() {
  void* user = LoadLibraryA("user32.dll");
  if (!user) ExitProcess(1);
  void* window = ((void*(__stdcall*)(U, char const*, char const*, U, int, int,
                  int, int, void*, void*, void*, void*))
    GetProcAddress(user, "CreateWindowExA"))(
      0, "STATIC", "D3D9 Oracle", 0x80000000, 0, 0, 8, 8, 0, 0, 0, 0);
  if (!window) ExitProcess(2);
  void* dll = LoadLibraryA("d3d9.dll");
  if (!dll) ExitProcess(3);
  void* d3d = ((void*(__stdcall*)(U))GetProcAddress(dll, "Direct3DCreate9"))(32);
  if (!d3d) ExitProcess(4);
  Present pp = {8, 8, 21, 1, 0, 0, 1, window, 1, 1, 75, 1, 0, 0x80000000};
  void* device = 0;
  check(invoke<U>(d3d, 16, (U)0, (U)1, window, (U)0x22, &pp, &device));
  U cases = word(), written;
  bool lineCases = (cases >> 31) != 0;
  cases &= 0x7fffffff;
  check(invoke<U>(device, 89, lineCases ? (U)68 : (U)324)); // XYZRHW | DIFFUSE, optional TEX1.
  check(invoke<U>(device, 67, (U)0, (U)4, (U)4)); // texture alpha * diffuse alpha.
  check(invoke<U>(device, 7, deviceCaps));
  WriteFile(GetStdHandle((U)-11), deviceCaps, sizeof(deviceCaps), &written, 0);
  for (U index = 0; index < cases; index++) {
    U clear = word(), draws = word();
    if (lineCases) {
      Viewport full = {0, 0, 8, 8, 0.f, 1.f};
      check(invoke<U>(device, 47, &full));
    }
    check(invoke<U>(device, 57, (U)194, (U)0));
    check(invoke<U>(device, 43, (U)0, (void*)0, (U)7, clear, 1.f, (U)0));
    check(invoke<U>(device, 41));
    for (U draw = 0; draw < draws; draw++) {
      U states = word();
      for (U i = 0; i < states; i++) {
        U id = word(), value = word();
        check(invoke<U>(device, 57, id, value));
      }
      if (lineCases) {
        Viewport view = {0, 0, 0, 0, 0.f, 1.f};
        U scissor[4], primitive, count, length, format;
        input(&view, 16);
        input(scissor, sizeof(scissor));
        check(invoke<U>(device, 47, &view));
        check(invoke<U>(device, 75, scissor));
        primitive = word(); count = word(); length = word(); format = word();
        LineVertex vertices[16];
        if (!length || length > 16) ExitProcess(13);
        input(vertices, length * sizeof(LineVertex));
        if (format) {
          U minimum = word(), vertexCount = word(), indexCount = word(), indices[16];
          if (indexCount > 16 || (format != 101 && format != 102)) ExitProcess(14);
          input(indices, indexCount * (format == 101 ? 2 : 4));
          check(invoke<U>(device, 84, primitive, minimum, vertexCount, count, indices,
                          format, vertices, (U)sizeof(LineVertex)));
        } else {
          check(invoke<U>(device, 83, primitive, count, vertices, (U)sizeof(LineVertex)));
        }
        continue;
      }
      U samplers = word();
      for (U i = 0; i < samplers; i++) {
        U id = word(), value = word();
        check(invoke<U>(device, 69, (U)0, id, value));
      }
      U width = word(), height = word();
      if (!width || !height || width > 64 || height > 64) ExitProcess(12);
      void* texture = 0;
      check(invoke<U>(device, 23, width, height, (U)1, (U)0, (U)21, (U)1,
                      &texture, (void*)0));
      Locked lock;
      check(invoke<U>(texture, 19, (U)0, &lock, (void*)0, (U)0));
      for (U row = 0; row < height; row++) input((B*)lock.data + row * lock.pitch, width * 4);
      check(invoke<U>(texture, 20, (U)0));
      check(invoke<U>(device, 65, (U)0, texture));
      Vertex vertices[4];
      input(vertices, sizeof(vertices));
      check(invoke<U>(device, 83, (U)5, (U)2, vertices, (U)28));
      check(invoke<U>(device, 65, (U)0, (void*)0));
      invoke<U>(texture, 2);
    }
    check(invoke<U>(device, 42));
    void* surface = 0;
    check(invoke<U>(device, 18, (U)0, (U)0, (U)0, &surface));
    Locked locked;
    check(invoke<U>(surface, 13, &locked, (void*)0, (U)0x10));
    for (U row = 0; row < 8; row++)
      WriteFile(GetStdHandle((U)-11), (B*)locked.data + row * locked.pitch, 32, &written, 0);
    check(invoke<U>(surface, 14));
    invoke<U>(surface, 2);
  }
  invoke<U>(device, 2);
  invoke<U>(d3d, 2);
  ExitProcess(0);
}
