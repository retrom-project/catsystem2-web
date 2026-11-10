// SPDX-License-Identifier: MPL-2.0
// Original complete main wrappers versus the browser resource dispatcher.
// Original parsers/query/selection/heap execute in both processes. The adapter's
// KCS formatting, opaque handles and mounted files remain declared boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { KCSMachine, readKCS, formatNativeAt } from '../src/kcs.mjs';
import {
  NATIVE_GALLERY_TABLE_LAYOUTS,
  nativeGalleryTable,
  nativeGalleryTableCodec,
} from '../src/native/gallery-tables.mjs';
import {
  galleryTableFiles,
  galleryTableOperations,
} from '../tests/fixtures/gallery-table-fixture.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-gallery-tables.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (p) => NATIVE_ENGINE_IMAGES[p].sha256 === sha256,
  );
if (!profile) throw new Error('Gallery-table oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  original = await NativeEngineProcess.open({ profile, bytes, trace: true }),
  model = await NativeEngineProcess.open({ profile, bytes, trace: true }),
  files = galleryTableFiles(),
  layout = NATIVE_GALLERY_TABLE_LAYOUTS[profile],
  handles = new NativeHandles(),
  heap = new NativeDataBuffers(model, { handles }),
  services = {
    handles,
    dataBuffers: async () => heap,
    formatBytes: formatNativeAt,
    diagnostic: () => modelDiagnostics++,
  },
  program = await readKCS(kcsProgram([[59]])),
  a = new KCSMachine(program, {}, new Uint8Array(64)),
  b = new KCSMachine(program, {}, new Uint8Array(64)),
  p = original.process,
  argv = p.allocate(24),
  out = p.allocate(4),
  results = [];
let comparisons = 0,
  step = 0,
  diagnostics = 0,
  modelDiagnostics = 0;
handles.registerType('gallery-table', nativeGalleryTableCodec);
for (const engine of [original, model])
  new NativeEngineFiles(engine, {
    game: { readCategory: async (name) => files.get(name) ?? null },
  });
original.patch(sdk ? 0x4a82f0 : 0x5cac90, 'gallery-table missing-file diagnostic', 0, () => {
  diagnostics++;
  return 0;
});
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const state = (process, pointer) => {
  if (!pointer) return null;
  const data = process.load(pointer);
  if (!data) return { size: 0, bytes: null };
  const size = process.allocations.get(data - 4) - 4;
  return { refs: process.load(data - 4), size, bytes: [...process.read(data, size)] };
};
const totalHeap = (process) =>
  [...process.allocations.values()].reduce((sum, size) => sum + size, 0);
try {
  for (const variants of [true, false])
    for (const name of variants
      ? ['variants0', 'variants1', 'variants2', 'wrong-size', 'missing', 'empty', 'variants1', '']
      : ['names0', 'names1', 'names2', 'names3', 'missing', 'empty', 'names1', '']) {
      let pointer = 0,
        handle = 0;
      for (const [id, ...values] of galleryTableOperations(name, variants)) {
        step++;
        const initial = Uint8Array.from(
          { length: a.memory.length },
          (_, i) => (step * 17 + i * 31) & 255,
        );
        a.memory.set(initial);
        b.memory.set(initial);
        a.writeString(name ?? '', 64);
        b.writeString(name ?? '', 64);
        const loading = id === 0x195 || id === 0x19c,
          releasing = id === 0x196 || id === 0x19d,
          rawArgs = loading ? [64] : [pointer, ...values],
          modelArgs = loading ? [64] : [handle, ...values],
          baselineA = totalHeap(p),
          baselineB = totalHeap(model.process),
          bridge = new NativeKCSMemory(p, a);
        let control, reply;
        rawArgs.forEach((v, i) => p.store(argv + i * 4, v));
        p.store(out, 0x3adacafe);
        try {
          control = await original.call(layout.handlers[id - 0x195], [
            bridge.pointer,
            0,
            argv,
            out,
          ]);
          reply = await nativeGalleryTable(id, modelArgs, b, services);
        } finally {
          bridge.close();
        }
        check(control, reply.control, `control ${id.toString(16)}`);
        if (loading) {
          pointer = p.load(out);
          handle = reply.value;
          check(!!pointer, !!handle, 'load presence');
        } else if (control === 1) check(p.load(out), reply.value, `word ${id.toString(16)}`);
        else check(p.load(out), 0x3adacafe, 'void output');
        check(a.memory, b.memory, `VM bytes ${id.toString(16)}`);
        check(
          p.read(layout.path, 260),
          model.process.read(layout.path, 260),
          'shared filename bytes',
        );
        check(diagnostics, modelDiagnostics, 'diagnostic count');
        if (!releasing)
          check(
            state(p, pointer),
            state(model.process, handle ? handles.get(handle, 'gallery-table').pointer : 0),
            'table bytes and heap references',
          );
        else if (pointer) check(p.allocations.has(pointer), false, 'descriptor release');
        const deltaA = totalHeap(p) - baselineA,
          deltaB = totalHeap(model.process) - baselineB;
        check(deltaA, deltaB, 'settled heap allocation bytes');
        results.push({
          variants,
          name,
          id,
          values,
          control,
          result: reply.value,
          heapDelta: [deltaA, deltaB],
        });
      }
    }
  for (const id of [0x196, 0x197, 0x198, 0x199, 0x19a, 0x19b, 0x19d, 0x19e, 0x19f, 0x1a0]) {
    const reply = await nativeGalleryTable(id, [0, 0, 0, 0, 0, 0], b, {});
    check(reply.control, [0x196, 0x19d].includes(id) ? 2 : 1, 'null control');
    if (reply.control === 1) check(reply.value, 0, 'null result');
  }
} finally {
  await original.close();
  await model.close();
}
await fs.writeFile(
  output,
  JSON.stringify(
    {
      profile,
      sha256,
      comparisons,
      operations: results.length,
      boundaries: [
        'adapter KCS formatting and handles',
        'mounted category files',
        'platform CRT/heap',
      ],
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Native gallery tables passed ${comparisons} comparisons over ${results.length} operations`,
);
