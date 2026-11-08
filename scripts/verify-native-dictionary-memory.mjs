// SPDX-License-Identifier: MPL-2.0
// Explicitly distinguish the raw PE heap serialization ABI from VM enumeration.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { nativeDictionary } from '../src/native/dictionary.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-dictionary-memory.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Dictionary memory oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  runtime = new NativeRuntime({ profile, read: async () => null }),
  memory = p.allocate(65536, true),
  args = p.allocate(16, true),
  out = p.allocate(4, true),
  table = NATIVE_PROFILES[profile].tables.main.va,
  machine = {
    load: (at, size = 4) => (size === 1 ? p.read(memory + at, 1)[0] : p.load(memory + at)),
    region: (at) => {
      if (at >= 65536) throw new Error('unmapped VM');
      return at;
    },
    writeStringBytes: (bytes, at) => p.write(memory + at, Uint8Array.from([...bytes, 0])),
    bytes: () => {
      throw new Error('Raw dictionary serialization must not address KCS bytes');
    },
  },
  services = {
    handles: runtime.handles,
    dataBuffers: () => ({ process: p }),
    format: (at) => p.string(memory + at),
  };
let passed = 0;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  original = async (id, words = []) => {
    words.forEach((word, i) => p.store(args + i * 4, word));
    p.store(out, 0xcafebabe);
    const control = await engine.call(p.load(table + id * 4), [0, 0, args, out]);
    return control === 2 ? { control } : { control, value: p.load(out) };
  },
  model = (id, words = []) => nativeDictionary(id, words, machine, services);
engine.patch(
  profile.startsWith('sdk') ? 0x8a6510 : 0x876ea0,
  'authored dictionary formatting boundary',
  2,
  ([at, out]) => {
    p.write(out, p.stringBytes(memory + at, false, true));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  profile.startsWith('sdk') ? 0x8a6910 : 0x8772a0,
  'authored dictionary VM pointer boundary',
  1,
  ([at]) => (at < 65536 ? memory + at : 0),
  { calleePops: true },
);
try {
  for (const shift of [-9, 0])
    for (let trial = 0; trial < 24; trial++) {
      const a = (await original(0x37e + shift)).value,
        b = model(0x37e + shift).value;
      for (let entry = 0; entry < 20; entry++) {
        p.write(
          memory,
          Uint8Array.from([
            ...encodeCP932(entry % 4 === 0 ? '猫' : `key_${(entry * 7 + trial) % 13}`),
            0,
          ]),
        );
        const value = Math.imul(trial - entry, 982451653) >>> 0;
        compare(
          await original(0x380 + shift, [a, 0, value]),
          model(0x380 + shift, [b, 0, value]),
          'set',
        );
      }
      const size = await original(0x383 + shift, [a]);
      compare(size, model(0x383 + shift, [b]), 'packed size');
      const first = p.allocate(size.value),
        second = p.allocate(size.value);
      p.write(first, new Uint8Array(size.value).fill(0xa5));
      p.write(second, new Uint8Array(size.value).fill(0xa5));
      compare(
        await original(0x384 + shift, [a, first]),
        await model(0x384 + shift, [b, second]),
        'raw export control',
      );
      compare(
        p.read(first, size.value),
        p.read(second, size.value),
        'all raw bytes and caller padding',
      );
      await original(0x382 + shift, [a]);
      model(0x382 + shift, [b]);
      compare(
        await original(0x385 + shift, [a, first]),
        await model(0x385 + shift, [b, second]),
        'raw import control',
      );
      compare(
        await original(0x383 + shift, [a]),
        model(0x383 + shift, [b]),
        'size after raw import',
      );
      for (let index = 0; index < 17; index++) {
        p.write(memory + 1024, new Uint8Array(128).fill(0xa5));
        const value = await original(0x386 + shift, [a, index, 1024]),
          originalBytes = p.read(memory + 1024, 128);
        p.write(memory + 1024, new Uint8Array(128).fill(0xa5));
        compare(value, model(0x386 + shift, [b, index, 1024]), 'VM enumeration result');
        compare(
          originalBytes,
          p.read(memory + 1024, 128),
          'VM enumeration destination and canaries',
        );
      }
      for (const id of [0x384 + shift, 0x385 + shift]) {
        compare(await original(id, [a, 0]), await model(id, [b, 0]), 'null raw pointer');
        compare(await original(id, [0, first]), await model(id, [0, second]), 'null dictionary');
      }
      await original(0x37f + shift, [a]);
      model(0x37f + shift, [b]);
      p.free(first);
      p.free(second);
    }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Both original nine-wrapper dictionary families and browser dispatch, with real high PE heap addresses for export/import and separate VM offsets for enumeration. Includes padding, overwrite, raw import, null paths and full output canaries. Formatting and VM pointer translation are explicit boundaries.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original dictionary memory differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
