// SPDX-License-Identifier: MPL-2.0
// Original complete database wrappers and compiled KCDB/flag-map helpers.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_DATABASE_IDS, NATIVE_DATABASE_LAYOUTS } from '../src/native/database.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { kcsProgram } from '../tests/helpers.mjs';
import {
  compiledDatabase,
  DATABASE_ROWS,
  databaseFixture,
  databaseState,
} from '../tests/fixtures/database-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-database.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Database oracle requires a frozen engine');
const files = new Map(),
  fixture = await databaseFixture(bytes, profile, files),
  original = await NativeEngineProcess.open({ bytes, profile, readFile: async () => null }),
  p = original.process,
  a = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024)),
  b = fixture.machine,
  layout = NATIVE_DATABASE_LAYOUTS[profile],
  handles = new Map(),
  covered = new Set();
new NativeEngineFiles(original, {
  game: {
    read: async () => null,
    readCategory: async (name, category) =>
      category === 'database' ? (files.get(name) ?? null) : null,
  },
  getNativeFeature: async (name) => {
    if (original.features.has(name)) return original.features.get(name);
    if (name === 'data-buffers') return new NativeDataBuffers(original);
    throw new Error(`Raw database fixture has no feature ${name}`);
  },
});
let calls = 0,
  comparisons = 0,
  handle;
const check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  put = (address, bytes) => {
    for (const m of [a, b]) m.bytes(address, bytes.length + 1).set([...bytes, 0]);
  },
  text = (address, value) => put(address, encodeCP932(value)),
  raw = async (id, args) => {
    const bridge = new NativeKCSMemory(p, a),
      argv = p.allocate(args.length * 4),
      out = p.allocate(4);
    try {
      args.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      const control = await original.call(layout.handlers[NATIVE_DATABASE_IDS.indexOf(id)], [
        bridge.pointer,
        0,
        argv,
        out,
      ]);
      return { control, value: p.load(out) };
    } finally {
      bridge.close();
      p.free(out);
      p.free(argv);
    }
  },
  run = async (id, args = [], adjacent = []) => {
    covered.add(id);
    calls++;
    const create = id === 0x365,
      rawArgs = create ? [...args, ...adjacent] : [handles.get(handle) ?? 0, ...args, ...adjacent],
      modelArgs = create ? args : [handle ?? 0, ...args],
      expected = await raw(id, rawArgs),
      actual = await fixture.database.apply(id, modelArgs, b, { id: 1 });
    check(actual.control, expected.control, 'original control code');
    if (create) {
      handle = actual.value;
      handles.set(handle, expected.value);
      check(
        fixture.database.pointer(handle),
        expected.value,
        'exact original constructor allocation identity',
      );
    } else if (expected.control === 1)
      check(actual.value, expected.value, 'original result, including unwritten sentinel');
    else check(expected.value, 0xcccccccc, 'original void wrapper preserves result word');
    if (id === 0x366 && handle) {
      handles.delete(handle);
      handle = 0;
    }
    check(b.memory, a.memory, 'all mapped VM data/stack canaries');
    check(b.shared, a.shared, 'all shared bytes');
    check(
      [...fixture.engine.process.allocations],
      [...p.allocations],
      'all original allocations/lifetimes',
    );
    for (const [h, pointer] of handles)
      check(
        databaseState(fixture.engine.process, fixture.database.pointer(h)),
        databaseState(p, pointer),
        'complete tree/strings/flags/options/dirty',
      );
    return create ? handle : actual.value;
  };

try {
  a.memory.fill(0xa5);
  b.memory.fill(0xa5);
  a.shared.fill(0x5a);
  b.shared.fill(0x5a);
  for (const id of NATIVE_DATABASE_IDS.filter((id) => id !== 0x365)) {
    handle = 0;
    await run(id, [0, 0].slice(0, [1, 3, 2, 2, 1, 1][NATIVE_DATABASE_IDS.indexOf(id) - 1] - 1));
  }
  const samples = [
    DATABASE_ROWS,
    [],
    Array.from({ length: 20 }, (_, i) => ({
      ID: i + 1,
      TITLE_S: 'short' + i,
      TITLE: 'full ' + i,
      IND1: 'line\\n' + i,
      IND24: 'last' + i,
      INDEX: 'entry-' + ((i * 13) % 20),
    })),
    [
      { ID: 1, TITLE_S: 'first', TITLE: 'first duplicate', INDEX: 'same' },
      { ID: 2, TITLE_S: 'second', TITLE: 'second duplicate', INDEX: 'same' },
    ],
    [
      {
        ID: 1,
        TITLE_S: 'S'.repeat(63),
        TITLE: 'T'.repeat(255),
        IND1: 'I'.repeat(127),
        INDEX: 'K'.repeat(255),
      },
    ],
    [
      { ID: 1, TITLE_S: '日本語', TITLE: '日本語の項目', IND1: '全角と半角', INDEX: 'カタカナ' },
      { ID: 2, TITLE_S: 'raw', TITLE: Uint8Array.of(0x81, 0x7f, 0xff), INDEX: 'ｶﾀｶﾅ' },
    ],
    [
      { ID: 1, TITLE_S: 'empty key', TITLE: 'empty', INDEX: '' },
      { ID: 2, TITLE_S: 'case', TITLE: 'case', INDEX: 'Alpha' },
      { ID: 3, TITLE_S: 'case2', TITLE: 'case2', INDEX: 'alpha' },
    ],
  ];
  for (const [trial, rows] of samples.entries()) {
    const name = trial === 5 ? '日本語' : 'authored' + trial;
    files.set(name, compiledDatabase(rows));
    text(256, name);
    text(512, trial & 1 ? 'line-break-token' : '\\n');
    text(768, trial & 1 ? 'suffix' : '\\n');
    text(896, trial & 1 ? 'prefix' : '');
    await run(0x365, [256, 512, 768, 896]);
    const pointer = handles.get(handle),
      before = databaseState(p, pointer),
      size = await run(0x368, [0]),
      buf = p.allocate(size + 32),
      other = fixture.engine.process.allocate(size + 32);
    check(other, buf, 'raw serialization buffer address');
    p.write(buf, new Uint8Array(size + 32).fill(0xa5));
    fixture.engine.process.write(other, new Uint8Array(size + 32).fill(0xa5));
    for (const bit of [0, 1, 7, 31, 32, 255, 0xffffffff, 0x80000000]) {
      const key =
        before.rows[bit % Math.max(1, before.rows.length)]?.key.bytes.slice(0, -1) ??
        encodeCP932('missing');
      put(1280, key);
      await run(0x367, [bit, 1280]);
      await run(0x36d);
      await run(0x368, [buf + 16]);
      check(
        fixture.engine.process.read(buf, size + 32),
        p.read(buf, size + 32),
        'complete raw export and canaries',
      );
      await run(0x36e);
      await run(0x36d);
      await run(0x367, [bit, 1280]);
      await run(0x36d);
    }
    text(1280, 'definitely missing');
    await run(0x367, [2, 1280]);
    await run(0x36d);
    if (before.rows.length) {
      put(1280, before.rows[0].key.bytes.slice(0, -1));
      a.nativeArgumentBase = b.nativeArgumentBase = 4096 + 64;
      for (const machine of [a, b]) machine.store(machine.nativeArgumentBase + 8, 1280);
      await run(0x367, [19], [1280]);
      await run(0x36d);
    }
    await run(0x368, [buf + 16]);
    // The importer normalizes key bytes in place, preserves unknown keys and
    // applies all three DWORDs without setting the object's dirty word.
    for (let i = 0; i < before.rows.length; i++) {
      for (const q of [p, fixture.engine.process]) {
        q.store(buf + 16 + 4 + i * 268 + 256, (0x80000001 + i) >>> 0);
        q.store(buf + 16 + 4 + i * 268 + 260, (0x12340000 + i) >>> 0);
        q.store(buf + 16 + 4 + i * 268 + 264, (0xfedc0000 + i) >>> 0);
      }
    }
    await run(0x369, [buf + 16]);
    check(
      fixture.engine.process.read(buf, size + 32),
      p.read(buf, size + 32),
      'import source mutations and canaries',
    );
    await run(0x36d);
    await run(0x369, [0]);
    await run(0x36d);
    await run(0x368, [buf + 16]);
    check(
      fixture.engine.process.read(buf, size + 32),
      p.read(buf, size + 32),
      'roundtrip all flag words',
    );
    if (before.rows.length) {
      const length = 4 + 3 * 268,
        source = p.allocate(length + 32),
        other = fixture.engine.process.allocate(length + 32);
      check(other, source, 'custom import address');
      const input = new Uint8Array(length + 32).fill(0xa5),
        view = new DataView(input.buffer);
      input.fill(0, 16, 16 + length);
      view.setUint32(16, 3, true);
      [
        before.rows[0].key.bytes.slice(0, -1),
        encodeCP932('unknown import key'),
        before.rows[0].key.bytes.slice(0, -1),
      ].forEach((name, i) => {
        input.set(name, 20 + i * 268);
        [0x40000000 + i, 0x50000000 + i, 0x60000000 + i].forEach((word, j) =>
          view.setUint32(20 + i * 268 + 256 + j * 4, word, true),
        );
      });
      p.write(source, input);
      fixture.engine.process.write(other, input);
      await run(0x369, [source + 16]);
      check(
        fixture.engine.process.read(source, length + 32),
        p.read(source, length + 32),
        'unknown/duplicate import source and canaries',
      );
      p.free(source);
      fixture.engine.process.free(other);
    }
    p.free(buf);
    fixture.engine.process.free(other);
    await run(0x366);
  }
  for (const data of [null, new Uint8Array(), Uint8Array.of(0x42, 0x41, 0x44, 0)]) {
    if (data === null) files.delete('missing');
    else files.set('missing', data);
    text(256, 'missing');
    text(512, '\\n');
    text(768, '\\n');
    text(896, '');
    await run(0x365, [256, 512, 768, 896]);
    check(await run(0x368, [0]), 4, 'failed read/parser retains valid empty database');
    await run(0x366);
  }
  check(
    [...covered].sort((a, b) => a - b),
    [...NATIVE_DATABASE_IDS],
    'all seven wrapper IDs',
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        ids: [...covered],
        scope:
          'Complete original seven main database wrappers, original compiled KCDB/zlib/schema/title/index parser, ordered map/string ownership, name-normalized flag bits, dirty rules, raw PE export/import and full VM/canaries/heap. Shared category/file callbacks are the explicit mounted-resource boundary. Fixtures are authored, including duplicates, empty/long/CP932/raw strings and missing/bad-magic input. Malformed buffers that violate the original unchecked field sizes are not asserted as defined behavior.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original database differential ${comparisons}/${comparisons}; ${calls} complete-wrapper calls`,
  );
} finally {
  await fixture.engine.close();
  await original.close();
}
