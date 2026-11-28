// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const f = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk63-mot-typed-css.json', import.meta.url)),
  ),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64')),
  tag = 0x6c5;
const mask = (source) => {
  const b = new Uint8Array(source),
    view = new DataView(b.buffer);
  for (let at = 8; at + f.layout.size <= b.length; ) {
    const size = view.getUint32(at, true);
    if (size < f.layout.size || at + size > b.length) break;
    const end = b.indexOf(0, at + 4);
    assert(end >= at + 4 && end < at + 4 + f.layout.nameBytes);
    b.fill(0, end + 1, at + 4 + f.layout.nameBytes);
    at += size;
  }
  return b;
};
async function open(saved, writes, initialize = true) {
  const startup = bytes(f.inputs.startup);
  return modernParticleMessageWorld(
    f.profile,
    {
      'startup.xml': startup,
      ...Object.fromEntries(f.inputs.archives.map((r) => [r.name, bytes(r.bytes)])),
    },
    {
      initialize,
      startup: parseXML(new TextDecoder().decode(startup)),
      storage: {
        read: async (n) => saved.get(n)?.slice() ?? null,
        write: async (name, b) => {
          assert(['mot-typed63.css', 'mot-refresh63.css'].includes(name));
          saved.set(name, b.slice());
          writes.push({ path: name, data: b.slice() });
          return true;
        },
      },
    },
  );
}
async function compareFiles(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i].path, expected[i].path);
    const a = await NativeGlobalFile.fromFile(actual[i].data),
      b = await NativeGlobalFile.fromFile(bytes(expected[i].data));
    assert.equal(a.tag, b.tag);
    assert.deepEqual(
      a.records.map((r) => r.id),
      b.records.map((r) => r.id),
    );
    for (let j = 0; j < a.records.length; j++)
      assert.deepEqual(
        mask(a.records[j].bytes),
        mask(b.records[j].bytes),
        'typed CSS copies full envelope capacity with bounded unknown name padding',
      );
  }
}
for (const coldAt of [null, 0, 1, 2, 3, 4, 5])
  test(`SDK63 typed MOT snapshot/CSS/independent live reader${coldAt === null ? ' normal' : ' cold ' + coldAt}`, async () => {
    const saved = new Map(),
      writes = [],
      trace = [];
    let w = await open(saved, writes),
      writer = await w.spawnScript('css-writer', { initialExecute: false }),
      reader = await w.spawnScript('css-reader', { initialExecute: false }),
      wid = writer.id,
      rid = reader.id,
      phase = 0;
    const observe = () => {
      const original = w.runtime.native.bind(w.runtime);
      w.runtime.native = async (table, id, args, m, owner) => {
        const r = await original(table, id, args, m, owner);
        if (table === 'main' && [314, 315, 316, 317, 387, 388].includes(id))
          trace.push({
            phase,
            id,
            control: r.control,
            written: r.value !== undefined,
            ...([315, 388].includes(id)
              ? { result: 'owned-checkpoint' }
              : r.value !== undefined
                ? { value: r.value }
                : {}),
          });
        return r;
      };
    };
    observe();
    const check = async (row) => {
      assert.equal(w.runtime.scheduler.tasks.has(wid), row.writerAlive);
      assert.equal(w.runtime.scheduler.tasks.has(rid), row.readerAlive);
      await compareFiles(writes, row.writes);
      if (phase === 5) return;
      for (const [name, t] of [
        ['writer', writer],
        ['reader', reader],
      ]) {
        assert.deepEqual(
          [200, 204, 208, 212, 216].map((at) => t.machine.load(at)),
          row[name].checks,
        );
        assert.deepEqual(
          t.machine.bytes(2048, 144),
          bytes(row[name].output),
          'actual parsed branch/MOT output including owned extra data',
        );
      }
      for (const [name, t, at] of [
        ['source', writer, 64],
        ['target', reader, 80],
      ])
        if (row[name]) {
          const manager = await w.runtime.services.motion.get(t.machine.load(at)),
            expected = row[name];
          assert.equal(manager.flags, expected.flags);
          assert.deepEqual(manager.base, bytes(expected.base));
          assert.deepEqual(manager.readBank(true), bytes(expected.working));
          assert.deepEqual(
            [...manager.records.values()].map((r) => ({
              handle: r.handle,
              group: r.group,
              start: r.startTick,
              delay: r.instance.delay,
              local: [64, 68].map((at) => r.instance.machine.load(at)),
              registers: Buffer.from(r.instance.shared.subarray(156, 1180)).toString('base64'),
            })),
            expected.records,
          );
        }
      for (const [name, t, at, managerAt] of [
        ['capture', writer, 72, 64],
        ['restored7', reader, 84, 80],
        ['restored8', reader, 92, 80],
      ])
        if (row[name]) {
          const actual = w.runtime.handles.get(t.machine.load(at), 'motion-checkpoint');
          assert.equal(actual.owner, t.machine.load(managerAt));
          assert.equal(actual.bytes.length, row[name].capacity);
          assert.deepEqual(mask(actual.bytes), mask(bytes(row[name].bytes)));
        }
    };
    try {
      for (const row of f.rows) {
        phase = row.phase;
        for (const t of phase === 1
          ? [writer]
          : phase === 2
            ? [reader]
            : phase === 3
              ? [writer, reader]
              : phase === 4
                ? [reader]
                : [])
          await w.runtime.native(
            'main',
            70,
            [w.nativeTaskID(t.id), tag, phase, 0],
            w.main.machine,
            w.main,
          );
        if (phase === 5)
          for (const id of [wid, rid])
            await w.runtime.native('main', 67, [w.nativeTaskID(id)], w.main.machine, w.main);
        await w.objects.update(w.root, 700 + phase);
        await check(row);
        if (phase === coldAt) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
          await w.close({ flushFiles: false });
          w = await open(saved, writes, false);
          await w.restore(state);
          writer = w.runtime.scheduler.tasks.get(wid);
          reader = w.runtime.scheduler.tasks.get(rid);
          observe();
          await check(row);
        }
      }
      assert.deepEqual(trace, f.calls);
      assert.equal(
        [...w.runtime.handles.records.values()].filter((r) =>
          ['motion-manager', 'motion-checkpoint', 'global-file'].includes(r.type),
        ).length,
        0,
      );
      assert.equal(w.nativeEngine, undefined);
    } finally {
      await w.close({ flushFiles: false });
    }
  });
test('SDK63 actual original CSS bytes restore a fresh loaded reader and outlive its file owner', async () => {
  const saved = new Map([['mot-typed63.css', bytes(f.savedFiles[0].data)]]),
    writes = [],
    w = await open(saved, writes);
  try {
    const reader = await w.spawnScript('css-reader', { initialExecute: false });
    await w.objects.update(w.root, 700);
    await w.runtime.native(
      'main',
      70,
      [w.nativeTaskID(reader.id), tag, 2, 0],
      w.main.machine,
      w.main,
    );
    await w.objects.update(w.root, 701);
    const m = reader.machine,
      env = m.load(84),
      file = m.load(76),
      manager = m.load(80);
    assert.deepEqual(m.bytes(2048, 144), bytes(f.rows[2].reader.output));
    const record = w.runtime.handles.get(env, 'motion-checkpoint');
    assert.deepEqual(
      record.bytes,
      bytes(f.rows[2].restored7.bytes),
      'opaque original filename padding retained by actual typed reader',
    );
    saved.clear();
    await w.runtime.native('main', 246, [file], m, reader);
    assert.deepEqual(record.bytes, bytes(f.rows[2].restored7.bytes));
    assert.equal((await w.runtime.native('main', 307, [manager, 304, 0], m, reader)).value, 1);
    await w.runtime.native('main', 317, [env], m, reader);
    await w.runtime.native('main', 295, [manager], m, reader);
    assert.equal(writes.length, 0);
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await w.close({ flushFiles: false });
  }
});
