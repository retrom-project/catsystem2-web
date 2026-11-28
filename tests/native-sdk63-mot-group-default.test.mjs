// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const f = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk63-mot-group-default.json', import.meta.url)),
  ),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64')),
  tag = 0x61b;
const open = async (profile, initialize = true) => {
  const startup = bytes(f.inputs.startup);
  return modernParticleMessageWorld(
    profile,
    {
      'startup.xml': startup,
      ...Object.fromEntries(f.inputs.archives.map((r) => [r.name, bytes(r.bytes)])),
    },
    { initialize, startup: parseXML(new TextDecoder().decode(startup)) },
  );
};
async function run(profile, coldAt) {
  let w = await open(profile),
    producer = await w.spawnScript('mot-producer', { initialExecute: false }),
    consumer = await w.spawnScript('mot-consumer', { initialExecute: false }),
    pid = producer.id,
    cid = consumer.id,
    manager,
    phase = 0;
  const trace = [];
  const observe = () => {
    const original = w.runtime.native.bind(w.runtime);
    w.runtime.native = async (table, id, args, m, owner) => {
      const reply = await original(table, id, args, m, owner);
      if (table === 'main' && [298, 300, 586].includes(id)) {
        assert.equal(
          args[0],
          manager ?? producer.machine.load(64),
          'all targets use the same live manager',
        );
        trace.push({
          phase,
          id,
          args: ['manager', ...args.slice(1)],
          receiver: owner.id === pid ? 'producer' : owner.id === cid ? 'consumer' : 'unqualified',
          control: reply.control,
          written: reply.value !== undefined,
        });
      }
      return reply;
    };
  };
  observe();
  const check = async (row) => {
    assert.equal(w.runtime.scheduler.tasks.has(pid), row.producerAlive);
    assert.equal(w.runtime.scheduler.tasks.has(cid), row.consumerAlive);
    assert.equal(w.runtime.handles.records.has(manager), row.manager !== null);
    if (row.phase === 5) return;
    const caller = row.phase < 3 ? producer : consumer,
      m = caller.machine;
    assert.deepEqual(
      [200, 204, 208, 212, 216].map((at) => m.load(at)),
      row.checks,
      'real parsed branch consumes base/working words',
    );
    assert.deepEqual(m.bytes(2048, 144), bytes(row.base));
    assert.deepEqual(m.bytes(2304, 144), bytes(row.output));
    if (!row.manager) return;
    const actual = await w.runtime.services.motion.get(manager),
      expected = row.manager;
    assert.equal(actual.flags, expected.flags);
    assert.deepEqual(actual.base, bytes(expected.base));
    assert.deepEqual(actual.readBank(true), bytes(expected.working));
    assert.deepEqual(
      [...actual.records.values()].map((r) => ({
        handle: r.handle,
        group: r.group,
        start: r.startTick,
        pc: r.instance.machine.pc,
        local: [64, 68].map((at) => r.instance.machine.load(at)),
        flags: r.instance.view.getUint32(1188, true),
        object: Buffer.from(r.instance.object).toString('base64'),
      })),
      expected.records,
      'groups and independently captured defaults feed actual record VMs',
    );
  };
  try {
    for (const row of f.rows) {
      phase = row.phase;
      if (phase === 1 || phase === 2)
        await w.runtime.native(
          'main',
          70,
          [w.nativeTaskID(pid), tag, phase, 0],
          w.main.machine,
          w.main,
        );
      if (phase === 3) {
        await w.runtime.native(
          'main',
          70,
          [w.nativeTaskID(cid), tag, manager, 0],
          w.main.machine,
          w.main,
        );
        await w.runtime.native('main', 67, [w.nativeTaskID(pid)], w.main.machine, w.main);
      }
      if (phase === 4)
        await w.runtime.native(
          'main',
          70,
          [w.nativeTaskID(cid), tag, phase, 0],
          w.main.machine,
          w.main,
        );
      if (phase === 5)
        await w.runtime.native('main', 67, [w.nativeTaskID(cid)], w.main.machine, w.main);
      await w.objects.update(w.root, 700 + phase);
      manager ??= producer.machine.load(64);
      await check(row);
      if (phase === coldAt) {
        const state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
        await w.close({ flushFiles: false });
        w = await open(profile, false);
        await w.restore(state);
        producer = w.runtime.scheduler.tasks.get(pid);
        consumer = w.runtime.scheduler.tasks.get(cid);
        observe();
        await check(row);
      }
    }
    assert.deepEqual(trace, f.calls, 'own receiver/namespace/control2/unwritten output');
    assert.equal(w.runtime.handles.records.has(manager), false);
    assert.equal(
      [...w.runtime.handles.records.values()].filter((r) =>
        ['motion-manager', 'motion-checkpoint'].includes(r.type),
      ).length,
      0,
    );
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await w.close({ flushFiles: false });
  }
}
for (const coldAt of [null, 0, 1, 2, 3, 4, 5])
  test(`SDK63 MOT grouping/default flags/base reader and independent live consumer${coldAt === null ? ' normal' : ' cold ' + coldAt}`, () =>
    run(f.profile, coldAt));
for (const [version, name] of [
  ['23', 'grisaia-jp'],
  ['67', 'bokutomo'],
  ['74', 'sdk-4.01'],
  ['76', 'nekopara-vol3'],
])
  test(`own${version} current MOT group/default consumer bridge follows separately qualified body/context`, () =>
    run(name + '-engine-2.6.1.' + version, null));
