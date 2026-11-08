// SPDX-License-Identifier: MPL-2.0
// Execute all nine original dictionary wrappers. Only allocation, byte-copy
// and KCS string/pointer translation are supplied at their reviewed boundaries.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Binary } from '../src/binary.mjs';
import { NativeDictionary, nativeDictionary } from '../src/native/dictionary.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

const [exe, output] = process.argv.slice(2);
if (!exe || !output)
  throw new Error('Usage: node scripts/verify-native-dictionary.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(exe)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_PROFILES).find(([, profile]) => profile.sha256 === sha256);
if (!profile) throw new Error('Dictionary oracle requires a frozen engine image');
const sdk = profile[0].startsWith('sdk'),
  b = new Binary(bytes),
  pe = b.u32(60),
  optional = pe + 24,
  image = new Uint8Array(b.u32(optional + 56));
image.set(b.range(0, b.u32(optional + 60)));
for (let n = 0; n < b.u16(pe + 6); n++) {
  const at = optional + b.u16(pe + 20) + n * 40;
  image.set(b.range(b.u32(at + 20), b.u32(at + 16)), b.u32(at + 12));
}
const u = await loadUnicorn(),
  p = new PE32Process(u),
  table = profile[1].tables.main.va;
p.map(0x400000, image.length);
p.write(0x400000, image);
function patch(address, name, count, fn, pops = false) {
  const target = p.trap(
      name,
      pops ? count : 0,
      pops
        ? fn
        : () => {
            const sp = p.cpu.reg_read_i32(u.X86_REG_ESP) >>> 0;
            return fn(Array.from({ length: count }, (_, i) => p.load(sp + 4 + i * 4)));
          },
    ),
    jump = new Uint8Array(5);
  jump[0] = 0xe9;
  new DataView(jump.buffer).setInt32(1, target - address - 5, true);
  p.write(address, jump);
}
for (const address of sdk ? [0x636cc0, 0x4a7bc0, 0x4a7efa] : [0x79ea57, 0x5cac7e])
  patch(address, 'allocator', 1, ([size]) => p.allocate(size, true));
for (const address of sdk ? [0x49c240, 0x4a7c70, 0x664230] : [0x6f81d0, 0x79ecbc])
  patch(address, 'release', 1, ([pointer]) => {
    p.free(pointer);
  });
for (const address of sdk ? [0x576df0] : [0x6a7210, 0x79d9c0, 0x79f2a0])
  patch(address, 'byte copy', 3, ([out, input, size]) => {
    p.write(out, p.read(input, size));
    return out;
  });
const vm = p.allocate(1400, true),
  memory = p.allocate(65536, true),
  words = p.allocate(16, true),
  result = p.allocate(4, true);
p.store(vm + 20, memory);
p.store(vm + 36, 65536);
patch(
  sdk ? 0x8a6510 : 0x876ea0,
  'KCS formatting boundary',
  2,
  ([offset, out]) => {
    const value = p.stringBytes(memory + offset, false, true);
    p.write(out, value);
    return 1;
  },
  true,
);
patch(
  sdk ? 0x8a6910 : 0x8772a0,
  'KCS pointer translation boundary',
  1,
  ([offset]) => (offset < 65536 ? memory + offset : 0),
  true,
);
let passed = 0,
  familyShift = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
const call = (id, args = []) => {
  args.forEach((value, i) => p.store(words + i * 4, value));
  p.store(result, 0xdeadbeef);
  const control = p.call(p.load(table + (id + familyShift) * 4), [vm, 0, words, result]);
  check(control, [0x37e, 0x381, 0x383, 0x386].includes(id) ? 1 : 2, `control/${id}`);
  return p.load(result);
};
const source = (text, offset = 32) => {
  p.write(memory + offset, Uint8Array.from([...encodeCP932(text), 0]));
  return offset;
};
try {
  for (familyShift of [-9, 0]) {
    const handle = call(0x37e),
      dictionary = new NativeDictionary(),
      out = p.allocate(65536, true);
    const compareImage = (label) => {
      check(call(0x383, [handle]), dictionary.size, `${label}/size`);
      const expected = new Uint8Array(dictionary.size).fill(0xa5);
      dictionary.write(expected);
      p.write(out, new Uint8Array(dictionary.size).fill(0xa5));
      call(0x384, [handle, out]);
      check(p.read(out, expected.length), expected, `${label}/image`);
    };
    compareImage('empty');
    const keys = [
      '',
      'z',
      'a',
      'A',
      '猫',
      'ｱ',
      'aa',
      'a'.repeat(15),
      'b'.repeat(16),
      'c'.repeat(255),
    ];
    for (let i = 0; i < 80; i++) keys.push(`key_${(i * 37) % 43}`);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i],
        value = Math.imul(i - 33, 982451653) >>> 0;
      call(0x380, [handle, source(key), value]);
      dictionary.set(encodeCP932(key), value);
      check(call(0x381, [handle, source(key)]), dictionary.get(encodeCP932(key)), `get/${i}`);
      compareImage(`set/${i}`);
    }
    check(call(0x381, [handle, source('missing')]), 0, 'missing');
    for (let i = 0; i < dictionary.entries.size + 2; i++) {
      p.write(memory + 4096, new Uint8Array(512).fill(0xa5));
      const entry = dictionary.ordered()[i],
        ok = call(0x386, [handle, i, 4096]);
      check(ok, Number(!!entry), `enumerate/${i}`);
      if (entry) check(p.stringBytes(memory + 4096), entry.key, `enumerate-key/${i}`);
      else check(p.read(memory + 4096, 1)[0], 0xa5, 'enumerate preserves output on miss');
    }
    const second = new NativeDictionary();
    second.set(encodeCP932('new'), 123);
    second.set(encodeCP932('a'), 999);
    const imported = new Uint8Array(second.size);
    second.write(imported);
    p.write(out, imported);
    call(0x385, [handle, out]);
    dictionary.importFrom(
      { load: (at, size = 4) => (size === 1 ? p.read(at, 1)[0] : p.load(at)) },
      out,
    );
    compareImage('import merges without replacing');
    call(0x382, [handle]);
    dictionary.entries.clear();
    compareImage('clear');
    call(0x37f, [handle]);
    call(0x37f, [0]);
    for (const [id, args] of [
      [0x380, [0, 0, 9]],
      [0x381, [0, 0]],
      [0x382, [0]],
      [0x383, [0]],
      [0x384, [0, out]],
      [0x385, [0, out]],
      [0x386, [0, 0, 4096]],
    ]) {
      const value = call(id, args);
      if ([0x381, 0x383, 0x386].includes(id)) check(value, 0, `null/${id}`);
    }
  }
  const runtime = new NativeRuntime({ profile: profile[0], read: async () => null }),
    machine = {
      load: (at, width = 4) => (width === 1 ? p.read(memory + at, 1)[0] : p.load(memory + at)),
    },
    legacy = (id, args = []) => {
      args.forEach((value, i) => p.store(words + i * 4, value));
      p.store(result, 0xdeadbeef);
      check(
        p.call(p.load(table + id * 4), [vm, 0, words, result]),
        [0x203, 0x206].includes(id) ? 1 : 2,
        `legacy-control/${id}`,
      );
      return p.load(result);
    },
    js = (id, args = []) => nativeDictionary(id, args, machine, { handles: runtime.handles }),
    handle = legacy(0x203),
    browserHandle = js(0x203).value,
    keys = [
      Uint8Array.of(),
      ...['a', 'A', '猫', '$str0', 'a'.repeat(15), 'b'.repeat(16), 'long'.repeat(80)].map(
        encodeCP932,
      ),
      Uint8Array.of(0x81, 0xff),
      Uint8Array.of(0xff, 0xfe),
      Uint8Array.of(0x81, 0xff),
    ];
  for (let n = 0; n < 150; n++) {
    const key = keys[n % keys.length],
      value = Math.imul(n - 99, 982451653) >>> 0;
    p.write(memory, Uint8Array.from([...key, 0]));
    legacy(0x205, [handle, 0, value]);
    js(0x205, [browserHandle, 0, value]);
    check(
      legacy(0x206, [handle, 0]),
      js(0x206, [browserHandle, 0]).value,
      `legacy-first-value/${n}`,
    );
    check(
      p.load(handle + 4),
      runtime.handles.get(browserHandle, 'dictionary').entries.size,
      'legacy duplicate insertion count',
    );
  }
  source('absent', 0);
  check(legacy(0x206, [handle, 0]), 0xffffffff, 'legacy miss -1');
  check(js(0x206, [browserHandle, 0]).value, 0xffffffff, 'browser legacy miss -1');
  check(legacy(0x206, [0, 0xffffffff]), 0xffffffff, 'legacy NULL handle miss -1');
  legacy(0x205, [0, 0xffffffff, 7]);
  legacy(0x204, [handle]);
  legacy(0x204, [0]);
  await writeFile(
    output,
    JSON.stringify(
      {
        profile: profile[0],
        sha256,
        passed,
        scope:
          'Original legacy main203..206 and main375..37D/main37E..386 including ordering, overwritten keys, raw padding, merging import, enumeration and null handles; allocation/copy/KCS format and pointer boundaries supplied',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native dictionary differential passed ${passed}/${passed}`);
} finally {
  p.close();
}
