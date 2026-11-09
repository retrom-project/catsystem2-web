// SPDX-License-Identifier: MPL-2.0
// Authored stdcall probe for D3D9 surface containers and color StretchRect.
using Word = unsigned int;
using Byte = unsigned char;
extern "C" {
__declspec(dllimport) void* __stdcall LoadLibraryA(const char*) asm("_LoadLibraryA");
__declspec(dllimport) void* __stdcall GetProcAddress(void*, const char*) asm("_GetProcAddress");
__declspec(dllimport) int __stdcall WriteFile(void*, const void*, Word, Word*, void*) asm("_WriteFile");
__declspec(dllimport) void* __stdcall GetStdHandle(Word) asm("_GetStdHandle");
__declspec(dllimport) void __stdcall ExitProcess(Word) asm("_ExitProcess");
int _fltused = 0;
}

template<class Result, class... Args> Result call(void* object, Word slot, Args... args) {
    auto method = reinterpret_cast<Result(__stdcall*)(void*, Args...)>((*static_cast<Word**>(object))[slot]);
    return method(object, args...);
}

struct Presentation {
    Word width, height, format, count, multisample, quality, swap;
    void* window;
    int windowed, depth;
    Word depthFormat, flags, hz, interval;
};
struct Lock { int pitch; void* data; };
struct Rect { int left, top, right, bottom; };
struct Surface { void* texture; void* pointer; };

enum Kind : Word { texture = 1, target, targetTexture, plain, backbuffer, depth };
void* device;

void require(bool condition) {
    if (!condition) ExitProcess(1);
}

void output(const void* data, Word size) {
    Word written = 0;
    require(WriteFile(GetStdHandle(Word(-11)), data, size, &written, nullptr) && written == size);
}

Surface make(Kind kind, Word format, Word pool) {
    Surface surface = {};
    void* noShare = nullptr;
    switch (kind) {
    case texture:
    case targetTexture:
        require(!call<Word>(device, 23, 4u, 4u, 1u, kind == targetTexture ? 1u : 0u,
                            format, pool, &surface.texture, noShare));
        require(!call<Word>(surface.texture, 18, 0u, &surface.pointer));
        break;
    case target:
        require(!call<Word>(device, 28, 4u, 4u, format, 0u, 0u, 1u, &surface.pointer, noShare));
        break;
    case plain:
        require(!call<Word>(device, 36, 4u, 4u, format, pool, &surface.pointer, noShare));
        break;
    case backbuffer:
        require(!call<Word>(device, 18, 0u, 0u, 0u, &surface.pointer));
        break;
    case depth:
        require(!call<Word>(device, 40, &surface.pointer));
        break;
    }
    return surface;
}

void release(Surface surface) {
    call<Word>(surface.pointer, 2);
    if (surface.texture) call<Word>(surface.texture, 2);
}

void seed(Surface surface, Word format, bool colored) {
    const Rect* entire = nullptr;
    Lock lock;
    Surface staging = surface;
    if (call<Word>(surface.pointer, 13, &lock, entire, 0u)) {
        staging = make(plain, format, 2);
        require(!call<Word>(staging.pointer, 13, &lock, entire, 0u));
    }
    for (Word y = 0; y < 4; ++y) {
        auto row = reinterpret_cast<Word*>(static_cast<Byte*>(lock.data) + y * lock.pitch);
        for (Word x = 0; x < 4; ++x)
            row[x] = colored ? (0x20 + 7*y + 13*x) << 24 | (0x10 + 31*y + 6*x) << 16
                               | (0x08 + 5*y + 37*x) << 8 | (0x17 + 9*y + 28*x) : 0x914a3826;
    }
    require(!call<Word>(staging.pointer, 14));
    if (staging.pointer != surface.pointer) {
        require(!call<Word>(device, 30, staging.pointer, entire, surface.pointer, (const void*)nullptr));
        release(staging);
    }
}

void stretch(Kind src, Kind dst, Word srcFormat, Word dstFormat, Word srcPool, Word dstPool,
             Word filter, Word flags, Rect from = {}, Rect to = {}) {
    const Rect* entire = nullptr;
    Surface a = make(src, srcFormat, srcPool);
    Surface b = flags & 4 ? a : make(dst, dstFormat, dstPool);
    seed(a, srcFormat, true);
    if (!(flags & 4)) seed(b, dstFormat, false);
    Lock lock;
    if (flags & 16) require(!call<Word>(a.pointer, 13, &lock, entire, 0u));
    if (flags & 32) require(!call<Word>(b.pointer, 13, &lock, entire, 0u));
    if (flags & 8) require(!call<Word>(device, 41));
    Word status = call<Word>(device, 34, a.pointer, flags & 1 ? &from : entire,
                              b.pointer, flags & 2 ? &to : entire, filter);
    if (flags & 8) require(!call<Word>(device, 42));
    if (flags & 16) require(!call<Word>(a.pointer, 14));
    if (flags & 32) require(!call<Word>(b.pointer, 14));
    Surface staging = b;
    if (call<Word>(b.pointer, 13, &lock, entire, 16u)) {
        staging = make(plain, dstFormat, 2);
        require(!call<Word>(device, 32, b.pointer, staging.pointer));
        require(!call<Word>(staging.pointer, 13, &lock, entire, 16u));
    }
    Word header[] = {src, dst, srcFormat, dstFormat, srcPool, dstPool, filter, flags, status};
    output(header, sizeof(header));
    output(&from, sizeof(from));
    output(&to, sizeof(to));
    for (Word y = 0; y < 4; ++y) output(static_cast<Byte*>(lock.data) + y * lock.pitch, 16);
    require(!call<Word>(staging.pointer, 14));
    if (staging.pointer != b.pointer) release(staging);
    release(a);
    if (!(flags & 4)) release(b);
}

const Word interfaces[][4] = {
    {0, 0, 0xc0, 0x46000000}, // IUnknown
    {0xd0223b96, 0x43fdbf7a, 0x3ba4bd92, 0xebb9820d}, // Device9
    {0x85c31227, 0x4f003de5, 0x1af13a9b, 0xb5188cc3}, // Texture9
    {0x580ca87e, 0x4d541d3c, 0xd3b71d99, 0xce98c2e3}, // BaseTexture9
    {0x05eec05d, 0x43628f7d, 0xbad199b9, 0x04c757f3}, // Resource9
    {0x0cfbaf3a, 0x429a9ff6, 0x79a2b399, 0x9bb8f86a}, // Surface9
    {0x794950f2, 0x458aadfc, 0xa1105e90, 0x3b500b0b}, // SwapChain9
    {0x12345678, 1, 2, 3},
};

void containers() {
    for (Word kind = texture; kind <= depth; ++kind) {
        auto surface = make(Kind(kind), 22, 0);
        for (Word index = 0; index < 8; ++index) {
            void* canary = reinterpret_cast<void*>(0x12345678);
            void* value = canary;
            Word status = call<Word>(surface.pointer, 11, interfaces[index], &value);
            Word identity = value == nullptr ? 0 : value == canary ? 1 : value == surface.texture
                          ? 2 : value == device ? 3 : value == surface.pointer ? 4 : 5;
            Word remaining = status == 0 && value ? call<Word>(value, 2) : 0;
            Word row[] = {kind, index, status, identity, remaining};
            output(row, sizeof(row));
        }
        release(surface);
    }
}

extern "C" void start() {
    using CreateWindow = void* (__stdcall*)(Word, const char*, const char*, Word, int, int, int, int,
                                             void*, void*, void*, void*);
    auto createWindow = reinterpret_cast<CreateWindow>(GetProcAddress(LoadLibraryA("user32.dll"), "CreateWindowExA"));
    auto window = createWindow(0, "STATIC", "D3D9 Surface Oracle", 0x80000000, 0, 0, 8, 8,
                               nullptr, nullptr, nullptr, nullptr);
    require(window != nullptr);
    auto createD3D = reinterpret_cast<void*(__stdcall*)(Word)>(GetProcAddress(LoadLibraryA("d3d9.dll"), "Direct3DCreate9"));
    auto d3d = createD3D(32);
    Presentation presentation = {8, 8, 22, 1, 0, 0, 3, window, 1, 1, 80, 1, 0, 0};
    require(!call<Word>(d3d, 16, 0u, 1u, window, 0x20u, &presentation, &device));

    containers();
    const Rect all = {0, 0, 4, 4}, sub = {1, 0, 4, 3}, small = {0, 1, 2, 3};
    const Rect skew = {1, 1, 4, 4}, zero = {1, 1, 1, 3}, corner = {0, 0, 2, 2};
    for (Word filter = 0; filter <= 3; ++filter) {
        stretch(texture, target, 22, 21, 0, 0, filter, 0);
        stretch(texture, target, 21, 22, 0, 0, filter, 3, sub, small);
        stretch(texture, target, 21, 21, 0, 0, filter, 3, small, skew);
        stretch(texture, targetTexture, 22, 21, 0, 0, filter, 3, small, all);
    }
    stretch(texture, target, 22, 21, 0, 0, 0, 3, {-1, 0, 4, 4}, all);
    stretch(texture, target, 22, 21, 0, 0, 0, 3, zero, all);
    stretch(texture, target, 22, 21, 0, 0, 0, 3, all, {0, 0, 5, 5});
    stretch(texture, target, 22, 21, 0, 0, 0, 3, all, zero);
    stretch(target, target, 21, 21, 0, 0, 0, 4);
    stretch(target, target, 21, 21, 0, 0, 0, 8);
    stretch(texture, target, 21, 21, 1, 0, 0, 0);
    stretch(plain, target, 22, 21, 2, 0, 0, 0);
    stretch(plain, plain, 22, 21, 0, 0, 0, 0);
    stretch(plain, plain, 22, 21, 0, 0, 0, 3, all, small);
    stretch(texture, texture, 22, 21, 0, 0, 0, 0);
    stretch(texture, plain, 22, 21, 0, 0, 0, 0);
    stretch(plain, texture, 22, 21, 0, 0, 0, 0);
    stretch(target, target, 21, 21, 0, 0, 0, 7, corner, {2, 2, 4, 4});
    stretch(target, target, 21, 21, 0, 0, 0, 7, corner, {1, 1, 3, 3});
    stretch(target, target, 21, 21, 0, 0, 0, 7, all, {1, 1, 3, 3});
    stretch(target, target, 21, 21, 0, 0, 0, 7, corner, corner);
    stretch(target, target, 21, 21, 0, 0, 0, 16);
    stretch(target, target, 21, 21, 0, 0, 0, 32);
    stretch(target, plain, 21, 21, 0, 0, 0, 0);
    stretch(plain, targetTexture, 21, 21, 0, 0, 0, 0);

    call<Word>(device, 2);
    call<Word>(d3d, 2);
    ExitProcess(0);
}
