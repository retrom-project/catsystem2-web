// SPDX-License-Identifier: MPL-2.0
// A small authored x86 DLL, generated as bytes so tests need no MSVC toolchain
// and redistribute no engine/SDK/game code. Its Init calls PPF.frand using x87.
export function nativeParticleFixture({ tls = false, version = 0x20002, color } = {}) {
  const base = 0x30000000,
    bytes = new Uint8Array(0x2400),
    b = new DataView(bytes.buffer),
    reloc = [];
  const u16 = (at, n) => b.setUint16(at, n, true),
    u32 = (at, n) => b.setUint32(at, n, true);
  const ascii = (at, text) => bytes.set(new TextEncoder().encode(text), at);
  u16(0, 0x5a4d);
  u32(60, 0x80);
  u32(0x80, 0x4550);
  u16(0x84, 0x14c);
  u16(0x86, 2);
  u16(0x94, 224);
  u16(0x96, 0x2102);
  const optional = 0x98;
  u16(optional, 0x10b);
  u32(optional + 28, base);
  u32(optional + 32, 4096);
  u32(optional + 36, 512);
  u32(optional + 56, 0x4000);
  u32(optional + 60, 512);
  u32(optional + 92, 16);
  const sections = optional + 224;
  for (const [index, name, rva, size, raw] of [
    [0, '.text', 0x1000, 0x200, 0x200],
    [1, '.data', 0x2000, 0x2000, 0x400],
  ]) {
    const at = sections + index * 40;
    ascii(at, name);
    u32(at + 8, size);
    u32(at + 12, rva);
    u32(at + 16, size);
    u32(at + 20, raw);
    u32(at + 36, 0xe0000060);
  }
  const offset = (rva) => (rva < 0x2000 ? rva - 0xe00 : rva - 0x1c00);
  let cursor = 0x1000;
  const functions = {};
  const emit = (...values) => {
    bytes.set(values, offset(cursor));
    cursor += values.length;
  };
  const absolute = (rva) => {
    reloc.push(cursor);
    u32(offset(cursor), base + rva);
    cursor += 4;
  };
  const fn = (name, callback) => {
    functions[name] = cursor;
    callback();
  };
  fn('make', () => {
    emit(0xa1);
    absolute(0x2140);
    emit(0x83, 0x05);
    absolute(0x2140);
    emit(64, 0x8b, 0x4c, 0x24, 4, 0x89, 0x48, 4, 0xba);
    absolute(0x2100);
    emit(0x89, 0x10, 0xc3);
  });
  fn('release', () => {
    emit(0xff, 0x05);
    absolute(0x2124);
    emit(0xc3);
  });
  fn('version', () =>
    emit(0xb8, version & 255, (version >>> 8) & 255, (version >>> 16) & 255, version >>> 24, 0xc3),
  );
  fn('type', () => emit(0xb8, 1, 0, 0, 0, 0xc3));
  fn('destructor', () => emit(0xc2, 4, 0));
  const random = () =>
    emit(0x8b, 0x4b, 8, 0x8b, 1, 0xff, 0x50, 12, 0x8b, 0x53, 12, 0xd9, 0x5a, 108);
  fn('init', () => {
    emit(0x53, 0x89, 0xcb);
    random();
    if (color !== undefined) {
      emit(0x8b, 0x53, 12);
      for (const offset of [12, 36, 60, 84])
        emit(
          0xc7,
          0x42,
          offset,
          color & 255,
          (color >>> 8) & 255,
          (color >>> 16) & 255,
          color >>> 24,
        );
    }
    if (tls) {
      emit(0x64, 0xa1, 0x2c, 0, 0, 0, 0x8b, 0x0d);
      absolute(0x2a60);
      emit(0x8b, 0x04, 0x88, 0x8b, 0x10, 0x8b, 0x43, 0x0c, 0x89, 0x50, 0x70);
    }
    emit(0x5b, 0xc2, 4, 0);
  });
  fn('exec', () => {
    emit(0x53, 0x89, 0xcb, 0xff, 0x05);
    absolute(0x212c);
    emit(0xa1);
    absolute(0x212c);
    emit(0x8b, 0x53, 12, 0x89, 0x82, 144, 0, 0, 0);
    random();
    emit(0x5b, 0xc2, 12, 0);
  });
  fn('stop', () => {
    emit(0xff, 0x05);
    absolute(0x2128);
    emit(0xc2, 4, 0);
  });
  fn('dllmain', () => {
    emit(0x83, 0x7c, 0x24, 8, 1, 0x75, tls ? 16 : 6);
    if (tls) {
      emit(0xa1);
      absolute(0x2130);
      emit(0xa3);
      absolute(0x2134);
    }
    emit(0xff, 0x05);
    absolute(0x2120);
    emit(0xb8, 1, 0, 0, 0, 0xc2, 12, 0);
  });
  if (tls)
    fn('tls', () => {
      emit(0xff, 0x05);
      absolute(0x2130);
      emit(0xc2, 12, 0);
    });
  u32(optional + 16, functions.dllmain);
  u32(optional + 96, 0x2000);
  u32(optional + 100, 0x100);
  const exp = offset(0x2000);
  u32(exp + 16, 1);
  u32(exp + 20, 4);
  u32(exp + 28, 0x2040);
  ['make', 'release', 'version', 'type'].forEach((name, i) =>
    u32(offset(0x2040) + 4 * i, functions[name]),
  );
  ['destructor', 'init', 'exec', 'stop'].forEach((name, i) => {
    const rva = 0x2100 + 4 * i;
    u32(offset(rva), base + functions[name]);
    reloc.push(rva);
  });
  u32(offset(0x2140), base + 0x2200);
  reloc.push(0x2140);
  if (tls) {
    u32(optional + 168, 0x2a00);
    u32(optional + 172, 24);
    for (const [rva, target] of [
      [0x2a00, 0x2a40],
      [0x2a04, 0x2a44],
      [0x2a08, 0x2a60],
      [0x2a0c, 0x2a70],
      [0x2a70, functions.tls],
    ]) {
      u32(offset(rva), base + target);
      reloc.push(rva);
    }
    u32(offset(0x2a10), 4);
    u32(offset(0x2a40), 0x1234abcd);
  }
  let rel = 0x3000;
  for (const page of [...new Set(reloc.map((at) => at & ~4095))]) {
    const entries = reloc.filter((at) => (at & ~4095) === page).map((at) => 0x3000 + (at & 4095));
    if (entries.length % 2) entries.push(0);
    u32(offset(rel), page);
    u32(offset(rel) + 4, 8 + entries.length * 2);
    entries.forEach((n, i) => u16(offset(rel) + 8 + i * 2, n));
    rel += 8 + entries.length * 2;
  }
  u32(optional + 136, 0x3000);
  u32(optional + 140, rel - 0x3000);
  return bytes;
}
