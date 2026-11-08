// SPDX-License-Identifier: MPL-2.0
// A Linux-only harness for the fixed, privately supplied x86 interpreter.
// No game startup, Windows services, imports, or proprietary bytes are included.
typedef unsigned int u32;
typedef unsigned char u8;
static u32 vm[348], header[12], result[16], native_table[2048];
static u8 code[8 * 1024 * 1024], memory[8 * 1024 * 1024], shared[1024 * 1024];
static u32 image_header[13];
static int syscall3(int n, int a, void *b, int c) {
  int value;
  __asm__ volatile("int $0x80" : "=a"(value) : "a"(n), "b"(a), "c"(b), "d"(c) : "memory");
  return value;
}
__attribute__((noreturn)) static void finish(int status) {
  syscall3(1, status, (void *)0, 0);
  __builtin_unreachable();
}
static void transfer(int writing, void *buffer, u32 count) {
  u8 *at = buffer;
  while (count) {
    int n = syscall3(writing ? 4 : 3, writing ? 1 : 0, at, count);
    if (n <= 0) finish(91);
    count -= n;
    at += n;
  }
}
static void jump(u32 at, void *destination) {
  *(u8 *)at = 0xe9;
  *(u32 *)(at + 1) = (u32)destination - at - 5;
}
static int log_message(void) { result[12]++; return 0; }
static void fatal_message(void) { finish(90); }
static void *copy_bytes(void *destination, const void *source, u32 count) {
  u8 *d = destination;
  const u8 *s = source;
  for (u32 i = 0; i < count; i++) d[i] = s[i];
  return destination;
}
static u32 __attribute__((stdcall)) native_call(u32 *machine, u32 user, u32 *args, u32 *out) {
  (void)machine;
  (void)user;
  result[13]++;
  result[14] = args[0];
  result[15] = args[1];
  if (header[10] == 1 || header[10] == 3) *out = header[11];
  return header[10];
}
void _start(void) {
  transfer(0, header, sizeof(header));
  if (header[0] > sizeof(code) || header[1] > sizeof(memory) ||
      header[2] > header[1] || header[3] > sizeof(shared) ||
      header[5] > header[1] || header[6] > header[1] || header[7] > header[1]) finish(92);
  transfer(0, code, header[0]);
  transfer(0, memory, header[1]);
  transfer(0, shared, header[3]);
  jump(0x6a7210, copy_bytes);
  jump(0x5cac90, log_message);
  jump(0x5cade0, fatal_message);
  // CRT floating exception notification depends on Windows runtime state.
  // Suppress only notification; the conversion's own result path still runs.
  *(u8 *)0x7a04bd = 0xc3;
  image_header[4] = header[0];
  image_header[8] = header[2];
  vm[2] = (u32)image_header;
  vm[3] = (u32)code;
  vm[4] = header[4];
  vm[5] = (u32)memory;
  vm[6] = header[5];
  vm[7] = header[6];
  vm[8] = header[7];
  vm[9] = header[1];
  vm[10] = (u32)shared;
  vm[11] = header[3];
  vm[13] = header[8];
  vm[14] = (u32)native_table;
  vm[345] = 1;
  for (u32 i = 0; i < 2048; i++) native_table[i] = (u32)native_call;
  result[0] = 0x4f4d564b;
  result[8] = 1;
  while (result[7] < header[9]) {
    if (vm[4] >= header[0] || code[vm[4]] == 59) { result[8] = 0; break; }
    u32 op = code[vm[4]++];
    if (op >= 69 || op == 63 || op == 64 || op == 67 || op == 68) finish(93);
    u32 handler = ((u32 *)0xb49a00)[op];
    result[8] = ((u32 (__attribute__((stdcall)) *)(u32 *))handler)(vm);
    result[7]++;
    if (!result[8]) break;
  }
  result[1] = vm[4];
  result[2] = vm[6];
  result[3] = vm[7];
  result[4] = vm[8];
  result[5] = vm[13];
  result[6] = vm[85];
  result[9] = vm[19];
  transfer(1, result, sizeof(result));
  transfer(1, memory, header[1]);
  transfer(1, shared, header[3]);
  finish(0);
}
