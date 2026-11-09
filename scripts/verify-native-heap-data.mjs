// SPDX-License-Identifier: MPL-2.0
// Complete original raw heap / CTS wrappers; only KCS pointer translation is supplied.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { nativeHeapData } from '../src/native/heap-data.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-heap-data.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Raw heap oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  handles = new NativeHandles(),
  buffers = new NativeDataBuffers(engine, { handles }),
  table = NATIVE_EXE_PROFILES[profile].tables.main.va,
  args = p.allocate(32, true),
  result = p.allocate(4, true),
  sizeOut = p.allocate(4, true),
  frees = [],
  free = p.free.bind(p),
  services = { handles, dataBuffers: () => buffers },
  modelWords = new Map(),
  machine = { store: (at, word) => modelWords.set(at, word) };
let passed = 0;
p.free = (address) => {
  frees.push(address);
  return free(address);
};
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  invoke = async (id, words) => {
    p.zero(args, 32);
    words.forEach((word, i) => p.store(args + i * 4, word));
    p.store(result, 0xcafebabe);
    const control = await engine.call(p.load(table + id * 4), [0, 0, args, result]);
    return control === 2 ? { control } : { control, value: p.load(result) };
  },
  model = (id, words) => nativeHeapData(id, words, machine, services);
engine.patch(
  profile.startsWith('sdk-') ? 0x8a6910 : 0x8772a0,
  'authored CTS size output VM boundary',
  1,
  ([address]) => address,
  { calleePops: true },
);
try {
  for (let trial = 0; trial < 16; trial++) {
    const file = (await invoke(0xee, [trial])).value,
      modelFile = handles.add('global-file', new NativeGlobalFile(trial));
    for (const size of [0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 31, 33, 255, 1024]) {
      const native = await invoke(0x341, [size]),
        js = await model(0x341, [size]),
        a = native.value,
        b = js.value,
        payload = Uint8Array.from({ length: size }, (_, i) => (i * 47 + size + trial) & 255),
        id = (size + trial) % 13;
      compare(native.control, js.control, 'allocation control');
      compare(p.load(a - 4), p.load(b - 4), 'allocation reference count');
      compare(p.allocations.get(a - 4), p.allocations.get(b - 4), 'allocation extent');
      p.write(a, payload);
      p.write(b, payload);
      compare(
        await invoke(0x343, [file, id, size, a]),
        await model(0x343, [modelFile, id, size, b]),
        'write result',
      );
      p.store(sizeOut, 0xa5a5a5a5);
      modelWords.set(sizeOut, 0xa5a5a5a5);
      const read = await invoke(0x344, [file, id, sizeOut]),
        copied = await model(0x344, [modelFile, id, sizeOut]),
        aSize = p.load(sizeOut),
        bSize = modelWords.get(sizeOut);
      compare(read.control, copied.control, 'read control');
      compare(aSize, bSize, 'read size');
      compare(p.load(read.value - 4), p.load(copied.value - 4), 'read reference count');
      compare(
        p.allocations.get(read.value - 4),
        p.allocations.get(copied.value - 4),
        'read allocation extent',
      );
      compare(
        p.read(read.value, aSize),
        p.read(copied.value, bSize),
        'read payload and first duplicate record',
      );
      p.zero(a, size);
      p.zero(b, size);
      compare(
        p.read(read.value, aSize),
        p.read(copied.value, bSize),
        'copies survive source mutation',
      );
      for (const [aPointer, bPointer] of [
        [a, b],
        [read.value, copied.value],
      ]) {
        const references = [-2147483648, -1, 0, 1, 2, 3, 2147483647][(size + trial) % 7];
        p.store(aPointer - 4, references);
        p.store(bPointer - 4, references);
        frees.length = 0;
        compare(await invoke(0x342, [aPointer]), await model(0x342, [bPointer]), 'release control');
        compare(
          frees.includes(aPointer - 4),
          frees.includes(bPointer - 4),
          'signed release decision',
        );
        if (references > 1) {
          compare(p.load(aPointer - 4), p.load(bPointer - 4), 'retained reference count');
          p.store(aPointer - 4, 1);
          p.store(bPointer - 4, 1);
          await invoke(0x342, [aPointer]);
          await model(0x342, [bPointer]);
        }
      }
    }
    p.store(sizeOut, 0xa5a5a5a5);
    modelWords.set(sizeOut, 0xa5a5a5a5);
    compare(
      await invoke(0x344, [file, 0xffffffff, sizeOut]),
      await model(0x344, [modelFile, 0xffffffff, sizeOut]),
      'missing record result',
    );
    compare(p.load(sizeOut), modelWords.get(sizeOut), 'missing record preserves size output');
    await invoke(0xf6, [file]);
    handles.release(modelFile, 'global-file');
  }
  for (const [id, words] of [
    [0x342, [0]],
    [0x343, [0, 8, 99, 1234]],
    [0x343, [1234, 8, 99, 0]],
    [0x344, [0, 8, 1234]],
  ])
    compare(await invoke(id, words), await model(id, words), 'null path');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Complete main341/342/343/344, original heap headers, CTS constructors/records/read and release, compared with the browser implementation in the same native process. Includes zero lengths, duplicate IDs, copied bytes, signed reference counts and null/missing-record output preservation. KCS output-pointer translation is supplied; allocation failure and invalid pointers are not claimed.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original raw heap differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
