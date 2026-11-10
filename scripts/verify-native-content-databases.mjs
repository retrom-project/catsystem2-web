// SPDX-License-Identifier: MPL-2.0
// All 85 complete original content-database wrappers and their live objects.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import {
  NATIVE_CONTENT_DATABASE_CONTRACTS as SPECS,
  NATIVE_CONTENT_DATABASE_FAMILIES as FAMILIES,
} from '../oracle/content-databases.mjs';
import { NATIVE_RANDOM_LAYOUTS } from '../src/native/random-memory.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from '../tests/helpers.mjs';
import {
  contentFixture,
  contentFiles,
  contentAllocations,
} from '../tests/fixtures/content-databases-fixture.mjs';
const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-content-databases.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Content oracle requires a frozen original image');
const files = contentFiles(),
  fixture = await contentFixture(bytes, profile, files),
  original = await NativeEngineProcess.open({ bytes, profile, readFile: async () => null }),
  p = original.process,
  q = fixture.engine.process,
  a = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024)),
  b = fixture.machine,
  index = profile.startsWith('sdk') ? 1 : 0,
  rawHandles = new Map(),
  live = new Map(),
  covered = new Set(),
  rng = NATIVE_RANDOM_LAYOUTS[profile];
new NativeEngineFiles(original, {
  game: {
    read: async () => null,
    readCategory: async (name, category) =>
      category === 'database' ? (files.get(name) ?? null) : null,
  },
  getNativeFeature: async (name) => {
    if (original.features.has(name)) return original.features.get(name);
    if (name === 'data-buffers') return new NativeDataBuffers(original);
    throw new Error('Raw content fixture missing ' + name);
  },
});
await original.call(rng.integer.seed, [4357]);
await original.call(rng.real.seed, [4357]);
let calls = 0,
  comparisons = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const put = (text, at = 256) => {
  for (const m of [a, b]) m.writeString(text, at);
};
const rawBuffers = [];
function buffer(size) {
  const pa = p.allocate(size),
    pb = q.allocate(size);
  check(pb, pa, 'same raw buffer identity');
  rawBuffers.push([pa, pb]);
  return pa;
}
const serialized = buffer(8192),
  missionSerialized = buffer(8192);
const blockA = a.allocate(512),
  blockB = b.allocate(512);
check(blockB, blockA, 'matching extended VM region');
const readSpec = (id) => SPECS.find((s) => s.id === id);
async function run(id, args = []) {
  const spec = readSpec(id),
    definition = FAMILIES[spec.family],
    create = id === definition.create,
    release = id === definition.release,
    words = Array.from(args);
  covered.add(id);
  calls++;
  while (words.length < spec.words) words.push(b.nativeArgument(words.length));
  const rawArgs = [...words];
  if (!create) rawArgs[0] = rawHandles.get(words[0]) ?? 0;
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(rawArgs.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    rawArgs.forEach((v, i) => p.store(argv + i * 4, v));
    p.store(out, 0xcccccccc);
    control = await original.call(spec.handlers[index], [bridge.pointer, 0, argv, out]);
    value = p.load(out);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
  }
  const reply = await fixture.content.apply(id, args, b, { id: 1 });
  check(reply.control, control, 'control ' + id.toString(16));
  if (create) {
    check(reply.value !== 0, value !== 0, 'constructor success');
    if (value) {
      check(fixture.content.pointer(reply.value), value, 'original owner pointer');
      rawHandles.set(reply.value, value);
      live.set(spec.family, reply.value);
    }
  } else if (control === 1) check(reply.value, value, 'result ' + id.toString(16));
  if (release && words[0]) {
    rawHandles.delete(words[0]);
    live.delete(spec.family);
  }
  check(b.memory, a.memory, 'complete VM memory ' + id.toString(16));
  check(b.shared, a.shared, 'shared memory');
  check(b.blocks, a.blocks, 'extended blocks');
  check(
    contentAllocations(q),
    contentAllocations(p),
    'all live original allocations ' + id.toString(16),
  );
  for (const stream of ['integer', 'real']) {
    check(
      q.read(rng[stream].words, 2496),
      p.read(rng[stream].words, 2496),
      'shared original ' + stream + ' RNG state',
    );
    check(q.load(rng[stream].index), p.load(rng[stream].index), 'shared original RNG cursor');
  }
  return reply.value;
}
function nullArgs(spec) {
  const args = Array(spec.words).fill(0);
  const pointerSets = new Map([
    [0x2ea, [2]],
    [0x2ec, [3]],
    [0x2f2, [1]],
    [0x2f5, [1]],
    [0x2f6, [1, 2]],
    [0x2fb, [1, 2, 3, 4]],
    [0x308, [2]],
    [0x31a, [3]],
    [0x322, [1, 2]],
    [0x323, [2, 3]],
    [0x324, [2]],
    [0x326, [3]],
    [0x32e, [2, 3, 4, 5, 6, 7]],
    [0x330, [1]],
    [0x334, [3]],
  ]);
  for (const [i, n] of (pointerSets.get(spec.id) ?? []).entries()) args[n] = 512 + i * 16;
  return args;
}
try {
  for (const spec of SPECS)
    if (spec.id !== FAMILIES[spec.family].create) await run(spec.id, nullArgs(spec));
  // Question database: actual KCDB data, configuration parser, pool selection,
  // answer strings, counters, enabled members, state export/import and reset.
  const quiz = await run(0x2e6);
  put('questions');
  check(await run(0x2e8, [quiz, 256]), 1, 'loaded question rows');
  check(await run(0x2e9, [quiz]), 3, 'all authored rows');
  put('configurations');
  await run(0x2ee, [quiz, 256]);
  put('alpha');
  await run(0x2ef, [quiz, 256]);
  for (const n of [0, 1, 19, 20, 0xffffffff]) await run(0x306, [quiz, n]);
  await run(0x2fc, [quiz]);
  for (const at of [512, a.data.length + 32, 0x80000020, blockA + 32, 0xffffffff]) {
    await run(0x2ea, [quiz, 0, at]);
    await run(0x2ec, [quiz, 0, 0, at]);
  }
  for (const m of [a, b]) {
    m.nativeArgumentBase = 1280;
    m.store(1292, blockA + 64);
  }
  await run(0x2ec, [quiz, 0, 0]);
  for (const id of [0x2f0, 0x2f1, 0x2f3, 0x2f4, 0x2f8, 0x2f9, 0x2fa, 0x307]) await run(id, [quiz]);
  await run(0x2f2, [quiz, 512]);
  await run(0x2f5, [quiz, 768]);
  await run(0x2f6, [quiz, 1024, 1040]);
  await run(0x2fb, [quiz, 1088, 1104, 1120, 1136]);
  for (let round = 0; round < 6; round++) {
    await run(0x2fd, [quiz]);
    for (const n of [0, 1, 2, 0xffffffff]) {
      for (const id of [0x2eb, 0x303, 0x304]) await run(id, [quiz, n]);
      await run(0x2ea, [quiz, n, 512]);
      for (const answer of [0, 1, 3]) await run(0x2ec, [quiz, n, answer, 768]);
      await run(0x2ed, [quiz, n]);
      await run(0x2fe, [quiz, n]);
    }
    for (const genre of [0, 1, 2]) await run(0x308, [quiz, genre, 1200]);
  }
  await run(0x2ff, [quiz, 0]);
  await run(0x2ff, [quiz, serialized]);
  await run(0x300, [quiz, serialized]);
  await run(0x301, [quiz]);
  await run(0x302, [quiz]);
  await run(0x309, [quiz, 0, 2]);
  await run(0x309, [quiz, 1, 5]);
  await run(0x30a, [quiz]);
  await run(0x305, [quiz]);
  put('beta');
  await run(0x2ef, [quiz, 256]);
  await run(0x2fc, [quiz]);
  await run(0x2fd, [quiz]);
  await run(0x2e7, [quiz]);
  // Name registration and fixed 19-column selection rows.
  const selection = await run(0x30b);
  for (const [number, name] of [
    [100, 'alpha'],
    [101, 'beta'],
    [102, 'gamma'],
    [999, 'alpha'],
  ]) {
    put(name);
    await run(0x30d, [selection, number, 256]);
  }
  put('selections');
  await run(0x30e, [selection, 256]);
  for (const row of [1, 2, 0, 0xffffffff]) {
    await run(0x33d, [selection, row]);
    const count = await run(0x30f, [selection]);
    for (const n of [0, 1, count, 0xffffffff]) await run(0x310, [selection, n]);
    if (count > 1) {
      await run(0x33e, [selection, 100, 1]);
      await run(0x33f, [selection, 0]);
      await run(0x340, [selection, 1]);
    }
  }
  await run(0x30c, [selection]);
  // Shared general KCDB schema, raw fixed-field bytes and numeric truncation.
  put('questions');
  const table = await run(0x317, [256]);
  for (const column of ['ID', 'G_A', 'Q', 'missing']) {
    put(column);
    for (const row of [0, 1, 2, 3, 0xffffffff]) {
      await run(0x319, [table, 256, row]);
      await run(0x31a, [table, 256, row, 512]);
    }
  }
  await run(0x318, [table]);
  for (const source of ['missing', 'badmagic', 'empty', '']) {
    put(source);
    const loaded = await run(0x317, [256]);
    if (loaded) await run(0x318, [loaded]);
  }
  // Mission availability/counters, all query selectors, updates and serialized
  // state. Raw output/input stay PE pointers, not VM address translations.
  put('missions');
  const mission = await run(0x31b, [256]);
  await run(0x335, [mission]);
  for (const level of [0, 1, 2, 10, 20, 0xffffffff]) {
    await run(0x31d, [mission, level]);
    await run(0x31f, [mission, 1]);
    await run(0x32f, [mission]);
    for (const row of [10, 20, 999, 0xffffffff]) {
      await run(0x33a, [mission, row]);
      await run(0x324, [mission, row, 512]);
      await run(0x323, [mission, row, 1024, 1040]);
      await run(0x32e, [mission, row, 1088, 1104, 1120, 1136, 1152, 1168]);
      for (const selector of [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 0xffffffff])
        await run(0x334, [mission, row, selector, 1200]);
      for (const selector of [0, 1, 3, 4, 0xffffffff])
        await run(0x326, [mission, row, selector, 512]);
      for (const ordinal of [0, 1, 19, 20, 0xffffffff]) await run(0x325, [mission, row, ordinal]);
    }
    for (const n of [0, 1, 19, 20, 0xffffffff]) {
      await run(0x32d, [mission, n]);
      await run(0x32c, [mission, n, 5]);
      await run(0x32b, [mission, n, 7]);
      await run(0x327, [mission, n, 1]);
    }
    await run(0x322, [mission, 1200, 1216, 0, 100]);
    await run(0x31e, [mission]);
    await run(0x320, [mission]);
  }
  for (const id of [0x321, 0x329]) await run(id, [mission, 10]);
  await run(0x328, [mission, 0xffffffff]);
  await run(0x32a, [mission, 10, 3]);
  for (const selector of [0, 1, 2, 19, 20, 0xffffffff]) {
    await run(0x331, [mission, selector, 0]);
    await run(0x332, [mission, selector]);
    await run(0x333, [mission, selector]);
  }
  for (const m of [a, b]) {
    m.store(1280, 1);
    m.store(1284, 2);
    m.store(1288, 3);
  }
  await run(0x330, [mission, 1280, 3]);
  await run(0x33b, [mission]);
  await run(0x33c, [mission]);
  await run(0x336, [mission]);
  const size = await run(0x337, [mission, 0]);
  await run(0x337, [mission, missionSerialized]);
  await run(0x338, [mission, missionSerialized, size]);
  await run(0x338, [mission, 0, 0]);
  await run(0x31c, [mission]);
  // Every reviewed mission condition code, not only default/empty CPARAM paths.
  put('conditions');
  const conditional = await run(0x31b, [256]);
  await run(0x335, [conditional]);
  await run(0x31d, [conditional, 5]);
  for (const place of [0, 2, 5]) {
    await run(0x31f, [conditional, place]);
    for (let round = 0; round < 4; round++) {
      await run(0x32f, [conditional]);
      for (const row of [
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 200, 201, 202, 203,
      ])
        for (const selector of [6, 7, 8]) await run(0x334, [conditional, row, selector, 1200]);
      for (const character of [0, 1]) {
        await run(0x32b, [conditional, character, 1]);
        await run(0x32c, [conditional, character, 1]);
        await run(0x327, [conditional, character, 1]);
      }
      if (round === 1) {
        await run(0x321, [conditional, 100]);
        await run(0x321, [conditional, 102]);
      }
      for (const selector of [0, 1, 2, 3, 4, 5]) {
        await run(0x332, [conditional, selector]);
        await run(0x333, [conditional, selector]);
      }
      await run(0x330, [conditional, 1280, 3]);
      await run(0x33b, [conditional]);
    }
  }
  await run(0x31c, [conditional]);
  for (const source of ['missing', 'badmagic', 'empty', '']) {
    put(source);
    const loaded = await run(0x31b, [256]);
    if (loaded) await run(0x31c, [loaded]);
  }
  check(covered.size, 85, 'all four complete object families');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        ids: [...covered].sort((a, b) => a - b),
        scope:
          'All 85 complete original content-database wrappers: compiled KCDB fields, question/configuration pools, 19-column name selection, mission availability/counters/selectors and raw serializers. Full VM/shared/blocks, all live PE allocations and both original MT globals are compared. Authored resources only; unchecked malformed buffers are not defined behavior.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Original content database differential ' +
      comparisons +
      '/' +
      comparisons +
      '; ' +
      calls +
      ' complete-wrapper calls',
  );
} finally {
  for (const [handle, pointer] of rawHandles) {
    const family = fixture.handles.get(handle, 'content-database').family;
    await original.call(FAMILIES[family].destroy[index], [], pointer);
    p.free(pointer);
  }
  for (const [pa, pb] of rawBuffers) {
    p.free(pa);
    q.free(pb);
  }
  await fixture.engine.close();
  await original.close();
}
