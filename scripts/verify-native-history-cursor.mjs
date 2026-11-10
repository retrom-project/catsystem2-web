// SPDX-License-Identifier: MPL-2.0
// Executes all six original wrappers, their rotating windows, independent CST
// parsers and destructors. Mounted files and VM pointer conversion are explicit
// boundaries; no history, cursor, reader or text helper is substituted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { nativeHistoryCursor } from '../src/native/history-cursor.mjs';
import {
  historyCursorFixture,
  historyCursorScenarios,
} from '../tests/fixtures/history-cursor-fixture.mjs';

import { NATIVE_HISTORY_CURSOR_HANDLERS } from '../oracle/history-cursor-handlers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-history-cursor.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (p) => NATIVE_ENGINE_IMAGES[p].sha256 === sha256,
  );
if (!profile) throw new Error('History-cursor oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ profile, bytes, trace: true }),
  p = engine.process,
  historyCtor = sdk ? 0x5dbfa0 : 0x72d010,
  historyDtor = sdk ? 0x5dbfc0 : 0x72d030,
  historyImport = sdk ? 0x5dc610 : 0x72d680,
  handlers = NATIVE_HISTORY_CURSOR_HANDLERS[profile],
  parameters = p.allocate(16, true),
  out = p.allocate(4, true),
  vmBytes = p.allocate(4096, true),
  source = p.allocate(8, true),
  history = p.allocate(8, true),
  results = [];
let fixture,
  comparisons = 0,
  uninitializedReaderWords = 0;
new NativeEngineFiles(engine, { game: { readCategory: (name) => fixture.services.read(name) } });
engine.patch(
  sdk ? 0x8a6910 : 0x8772a0,
  'history-cursor VM pointer boundary',
  1,
  ([address]) => (address < 4096 ? vmBytes + address : 0),
  { calleePops: true },
);
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const readerState = (row, initialized) => {
  const r = row.reader;
  return {
    body: r.body ? [...r.body.bytes] : null,
    blockCount: r.blockCount,
    offsetsOffset: r.offsetsOffset,
    stringsOffset: r.stringsOffset,
    ...(initialized ? { stringsSize: r.stringsSize, block: r.block, line: r.line } : {}),
    filename: r.filename,
    fileValue: r.fileValue,
  };
};
const rawReaderState = (pointer, initialized) => {
  const body = p.load(pointer + 12);
  return {
    body: body ? [...p.read(body, p.load(body) + 16)] : null,
    blockCount: p.load(pointer + 4),
    offsetsOffset: body ? p.load(pointer + 20) - body : 0,
    stringsOffset: body ? p.load(pointer + 24) - body : 0,
    ...(initialized
      ? {
          stringsSize: p.load(pointer + 28),
          block: p.load(pointer + 32),
          line: p.load(pointer + 36),
        }
      : {}),
    filename: p.string(pointer + 40),
    fileValue: p.load(pointer + 300),
  };
};
async function importPath() {
  const bytes = fixture.scene.history.encode('path', true),
    pointer = p.allocate(bytes.length, true);
  p.write(pointer, bytes);
  try {
    await engine.call(historyImport, [0, 0, pointer, bytes.length], history);
  } finally {
    p.free(pointer);
  }
}
try {
  for (let scenario = 0; scenario < historyCursorScenarios.length; scenario++)
    for (const capacity of scenario ? [1, 2, 3, 5, 8] : [0, 1, 2, 3, 5]) {
      fixture = historyCursorFixture();
      for (const [name, block] of historyCursorScenarios[scenario])
        fixture.scene.history.appendPath(name, block);
      await engine.call(historyCtor, [], history);
      await importPath();
      p.store(source, 0);
      p.store(source + 4, history);
      let raw = 0,
        handle = 0,
        step = 0;
      const readers = new Map(),
        modelReaders = new Map(),
        initializedReaders = new Set();
      const state = () => {
        const cursor = fixture.handles.get(handle, 'history-cursor'),
          count = p.load(raw + 4),
          array = p.load(raw + 12),
          initialized = cursor.rows.map((row) => {
            if (row.reader.body) initializedReaders.add(row.reader);
            const known = initializedReaders.has(row.reader);
            if (!known) uninitializedReaderWords += 3;
            return known;
          }),
          actual = {
            capacity: count,
            lastPath: p.load(raw + 8) | 0,
            rows: Array.from({ length: count }, (_, i) => {
              const at = array + i * 20,
                reader = p.load(at + 12);
              return {
                path: p.load(at) | 0,
                block: p.load(at + 4) | 0,
                lastBlock: p.load(at + 8) | 0,
                valid: p.load(at + 16),
                identity: readers.get(reader),
                reader: rawReaderState(reader, initialized[i]),
              };
            }),
          },
          expected = {
            capacity: cursor.capacity,
            lastPath: cursor.lastPath,
            rows: cursor.rows.map((row, i) => ({
              path: row.path,
              block: row.block,
              lastBlock: row.lastBlock,
              valid: row.valid,
              identity: modelReaders.get(row.reader),
              reader: readerState(row, initialized[i]),
            })),
          };
        check(
          actual,
          expected,
          `scenario ${scenario} capacity ${capacity} step ${step} complete readers`,
        );
      };
      const call = async (id, values = []) => {
        step++;
        fixture.memory.set(Uint8Array.from({ length: 4096 }, (_, i) => (i * 31 + step * 17) & 255));
        p.write(vmBytes, fixture.memory);
        const modelArgs = id === 0x17b ? [fixture.sceneHandle, capacity] : [handle, ...values],
          rawArgs = id === 0x17b ? [source, capacity] : [raw, ...values];
        rawArgs.forEach((v, i) => p.store(parameters + i * 4, v));
        p.store(out, 0x3adacafe);
        const control = await engine.call(handlers[id - 0x17b], [0, 0, parameters, out]),
          reply = await nativeHistoryCursor(id, modelArgs, fixture.machine, fixture.services);
        check(control, reply.control, `control ${id.toString(16)}`);
        if (id === 0x17b) {
          raw = p.load(out);
          handle = reply.value;
          const cursor = fixture.handles.get(handle, 'history-cursor');
          for (let i = 0; i < capacity; i++) {
            readers.set(p.load(p.load(raw + 12) + i * 20 + 12), i);
            modelReaders.set(cursor.rows[i].reader, i);
          }
        } else if (control === 1) check(p.load(out), reply.value, `result ${id.toString(16)}`);
        else check(p.load(out), 0x3adacafe, 'void preserves output');
        check(p.read(vmBytes, 4096), fixture.memory, `VM bytes ${id.toString(16)}`);
        if (id !== 0x17c) state();
        results.push({ scenario, capacity, step, id, values, control, result: reply.value });
      };
      try {
        await call(0x17b);
        for (const index of [...Array(capacity).keys(), capacity, capacity + 1]) {
          await call(0x180, [index, 64, 128]);
          await call(0x17e, [index, 256, 512]);
          for (const ordinal of [0, 1, 2, 0xffffffff]) await call(0x17f, [index, 768, ordinal]);
          await call(0x17e, [index, 0xffffffff, 0]);
        }
        if (capacity) {
          for (const direction of [0, 0, 1, 0xffffffff, 0, 1, 1, 1, 0, 0, 0, 0]) {
            await call(0x17d, [direction]);
            await call(0x17e, [0, 256, 512]);
          }
          if (fixture.scene.history.path.length) {
            fixture.scene.history.path[0].value = 1;
            await importPath();
            await call(0x17e, [0, 256, 512]);
            await call(0x17d, [0]);
          }
        }
        const array = p.load(raw + 12);
        await call(0x17c);
        check(p.allocations.has(raw), false, 'descriptor freed');
        check(p.allocations.has(array), false, 'slot array freed');
        for (const reader of readers.keys())
          check(p.allocations.has(reader), false, 'reader freed');
      } finally {
        await engine.call(historyDtor, [], history);
      }
    }
} finally {
  await engine.close();
}
await fs.writeFile(
  output,
  JSON.stringify(
    {
      profile,
      sha256,
      comparisons,
      operations: results.length,
      uninitializedReaderWords,
      exclusions: [
        'Reader stringsSize/block/line before its first successful load are not initialized by the original constructor and are not compared.',
      ],
      boundaries: ['mounted category files', 'VM pointer conversion', 'platform CRT/heap'],
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Native history cursor passed ${comparisons} comparisons over ${results.length} operations`,
);
