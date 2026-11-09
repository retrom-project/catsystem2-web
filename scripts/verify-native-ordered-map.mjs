// SPDX-License-Identifier: MPL-2.0
// Complete original map wrappers, formatter, tree ordering and byte canaries.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { nativeOrderedMap } from '../src/native/ordered-map.mjs';
import { nativeDictionary } from '../src/native/dictionary.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { KCSMachine, formatNativeAt, encodeCP932 } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-ordered-map.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Map oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  runtime = new NativeRuntime({ profile, read: async () => null }),
  make = () => {
    const m = new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(8192),
        stackSize: 4096,
      },
      undefined,
      new Uint8Array(4096),
    );
    m.fp = 8192;
    m.allocate(4096);
    return m;
  },
  source = make(),
  model = make(),
  argv = p.allocate(16),
  out = p.allocate(4),
  packed = p.allocate(65536),
  table = NATIVE_PROFILES[profile].tables.main.va,
  services = {
    handles: runtime.handles,
    formatBytes: formatNativeAt,
    dataBuffers: () => ({ process: p }),
  },
  state = (m) => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
let passed = 0,
  operations = 0;
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
async function original(id, args = []) {
  const bridge = new NativeKCSMemory(p, source);
  try {
    p.zero(argv, 16);
    args.forEach((value, i) => p.store(argv + 4 * i, value));
    p.store(out, 0xcccccccc);
    const control = await engine.call(p.load(table + 4 * id), [bridge.pointer, 0, argv, out]);
    return { control, ...(control === 1 ? { value: p.load(out) } : {}) };
  } finally {
    bridge.close();
  }
}
const browser = (id, args) =>
  nativeOrderedMap(id, args, model, services) ?? nativeDictionary(id, args, model, services);
async function operation(id, args, handle, nativeHandle) {
  const actual = browser(id, [handle, ...args]),
    expected = await original(id, [nativeHandle, ...args]);
  compare(await actual, expected, `complete main${id.toString(16)} reply`);
  compare(state(model), state(source), 'all VM domains, aliases and untouched canaries');
  operations++;
}
const put = (at, data) => {
  const raw = typeof data === 'string' ? encodeCP932(data) : data;
  for (const m of [source, model]) m.bytes(at, raw.length + 1).set([...raw, 0]);
};
async function image(handle, nativeHandle) {
  const map = runtime.handles.get(handle, 'dictionary'),
    expected = new Uint8Array(map.size).fill(0xa5);
  map.write(expected);
  compare(
    await original(0x383, [nativeHandle]),
    { control: 1, value: map.size },
    'cross-family packed size',
  );
  p.write(packed, new Uint8Array(map.size).fill(0xa5));
  compare(
    await original(0x384, [nativeHandle, packed]),
    { control: 2 },
    'cross-family raw export control',
  );
  compare(p.read(packed, map.size), expected, 'original tree order and every packed byte/padding');
}
try {
  compare(
    new Set([0x203, 0x2a3, 0x375, 0x37e].map((id) => p.load(table + 4 * id))).size,
    1,
    'all four constructors are the same original function',
  );
  compare(
    new Set([0x204, 0x2a4, 0x376, 0x37f].map((id) => p.load(table + 4 * id))).size,
    1,
    'all four destructors are the same original function',
  );
  const keys = [
    '',
    'z',
    'a',
    'A',
    'aa',
    '猫',
    'ｱ',
    'a'.repeat(15),
    'b'.repeat(16),
    'c'.repeat(255),
    new TextEncoder().encode('UTF-8 猫 中文'),
    Uint8Array.of(0x81, 0xff),
    Uint8Array.of(0xff, 0xfe),
    '%s[G1024]',
    '%s[H1024]',
    '%04d[G512]',
    'same\0ignored',
  ];
  for (const [trial, ctor] of [0x203, 0x2a3, 0x375, 0x37e].entries()) {
    for (const m of [source, model]) {
      m.memory.fill(0xa5);
      m.shared.fill(0xa5);
      m.blocks[0].fill(0xa5);
    }
    put(1024, 'recursive 猫');
    put(0x80000400, 'shared string');
    for (const m of [source, model]) m.store(512, 23);
    const created = await original(ctor),
      nativeHandle = created.value,
      result = browser(ctor, []),
      handle = result.value;
    compare(result.control, created.control, 'cross-family constructor control');
    await image(handle, nativeHandle);
    for (let n = 0; n < 144; n++) {
      const address = [64, 8192 + 64, 0x80000040, source.memory.length + 64][n % 4],
        value = n % 11 === 0 ? 0xffffffff : n % 5;
      put(address, keys[(n * 7 + trial) % keys.length]);
      await operation(
        n % 3 === 0 ? 0x205 : n % 3 === 1 ? 0x380 : 0x2a5,
        [address, value],
        handle,
        nativeHandle,
      );
      await operation(0x2a7, [address, 0x81234567], handle, nativeHandle);
      await operation(
        0x2a8,
        [value, [2048, 8192 + 2048, 0x80000800, source.memory.length + 2048][n % 4]],
        handle,
        nativeHandle,
      );
      if (n % 4 === 0) await operation(0x2a6, [address], handle, nativeHandle);
      if (n % 9 === 0) await image(handle, nativeHandle);
    }
    put(64, 'missing');
    await operation(0x2a7, [64, 0xffffffff], handle, nativeHandle);
    await operation(0x2a8, [0x12345678, 0xffffffff], handle, nativeHandle);
    await image(handle, nativeHandle);
    await operation([0x204, 0x2a4, 0x376, 0x37f][trial], [], handle, nativeHandle);
  }
  for (const [id, args] of [
    [0x2a4, []],
    [0x2a5, [0xffffffff, 9]],
    [0x2a6, [0xffffffff]],
    [0x2a7, [0xffffffff, 0x87654321]],
    [0x2a8, [7, 0xffffffff]],
  ])
    await operation(id, args, 0, 0);
  if (!profile.startsWith('sdk-')) {
    const { value: handle } = browser(0x203, []),
      { value: nativeHandle } = await original(0x203);
    const insert = async (key, value) => {
      put(64, key);
      await operation(0x205, [64, value], handle, nativeHandle);
    };
    for (const [key, value] of [
      ['cat', 8],
      ['CAT_LONG', 7],
      ['Cat', 6],
      ['ab', 2],
      ['a', 1],
      ['Zero', 0],
      ['zero', 3],
      [Uint8Array.of(0x81, 0x41), 9],
      [Uint8Array.of(0x81, 0x82), 10],
    ])
      await insert(key, value);
    put(1024, 'cat');
    const queries = [
      '%s[G1024]_longer',
      'catfish',
      'ca',
      'ABc',
      'ZeRoed',
      '',
      'missing',
      Uint8Array.of(0x81, 0x61, 0x7a),
      Uint8Array.of(0x81, 0x83),
    ];
    const addresses = [64, 8192 + 64, 0x80000040, source.memory.length + 64];
    for (const [i, query] of queries.entries()) {
      const at = addresses[i % addresses.length];
      put(at, query);
      await operation(0x41c, [at], handle, nativeHandle);
    }
    await insert('', 0xfedcba98);
    put(64, 'CAT_LONG');
    await operation(0x41c, [64], handle, nativeHandle);
    await operation(0x41c, [0xffffffff], 0, 0);
    await operation(0x204, [], handle, nativeHandle);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        operations,
        scope:
          'Original complete main2A3..2A8 wrappers and formatter/tree helpers. All four constructors/destructors share one original function; cross-use with raw first-insert and formatted overwrite families, CP932/UTF-8/invalid bytes, empty/NUL keys, reverse byte ordering, removal, explicit defaults, null handles, data/stack/shared/block destinations and all canaries. Only reviewed engine allocation/CRT platform services are supplied.' +
          (profile.startsWith('sdk-')
            ? ''
            : ' Includes game main41C prefix matching through the original formatter and CRT.'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original ordered map differential ${passed}/${passed} (${operations} operations)`);
} finally {
  await engine.close();
}
