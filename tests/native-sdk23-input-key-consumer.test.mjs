// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { NativeInput } from '../src/native/input.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-input-key-consumer.json', import.meta.url)),
);
const at = [
  ['plane', 64],
  ['base', 68],
  ['waiter1', 72],
  ['waiter2', 76],
];
async function make(initialize = true) {
  const w = await modernParticleMessageWorld(
    golden.profile,
    {
      'startup.xml': Buffer.from(golden.startupXML),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['input-g2.kcs', Buffer.from(golden.program, 'base64')],
        ['input-waiter.kcs', Buffer.from(golden.receiverProgram, 'base64')],
      ]),
    },
    { initialize, startup: parseXML(golden.startupXML) },
  );
  w.graphics.createLogicalDevice();
  if (initialize) w.inputBindings = new NativeInputBindings(w.input, w.configuration);
  return w;
}
function compare(w, t, row) {
  const identities = new Map(at.map(([name, offset]) => [t.machine.load(offset), name])),
    worldNames = new Map(
      at.map(([name, offset]) => [w.resolveTaskID(t.machine.load(offset), t.id), name]),
    ),
    nativeName = (id) => identities.get(id) ?? (id === 0xffffffff ? 'system' : id),
    input = w.inputFor(t.id),
    current = {
      outputs: Array.from({ length: 12 }, (_, i) => t.machine.load(128 + i * 4)),
      regions: input.ordered().map((r) => ({
        owner: worldNames.get(r.owner),
        priority: r.priority | 0,
        bounds: r.bounds,
        active: Number(r.active),
        enabled: Number(r.enabled),
      })),
      source: input.source,
      waiters: at
        .filter(([name]) => name.startsWith('waiter'))
        .map(([name, offset]) => {
          const owner = w.runtime.scheduler.tasks.get(
              w.resolveTaskID(t.machine.load(offset), t.id),
            ),
            m = owner.machine;
          if (m.waiting?.kind !== 'message') return { name, ready: false };
          const count = m.load(64);
          assert(count <= 24);
          return {
            name,
            ready: true,
            count,
            packets: Array.from({ length: count }, (_, i) =>
              Array.from({ length: 4 }, (_, j) => m.load(128 + 32 * i + j * 4)),
            ).map((a) => [
              nativeName(a[0]),
              a[1],
              a[1] === 0xffff0006 ? a[2] : nativeName(a[2]),
              a[3],
            ]),
          };
        }),
    };
  for (const key of Object.keys(current))
    assert.deepEqual(current[key], row[key], 'original ' + key + ' at phase ' + row.phase);
}
async function step(w, t, i) {
  const phase = golden.phases[i],
    pending = golden.callsByPhase[i].slice(),
    native = w.runtime.native;
  w.runtime.native = async function (table, id, args, machine, task, ...rest) {
    const reply = await Reflect.apply(native, this, [table, id, args, machine, task, ...rest]);
    if (task.id === t.id) {
      const expected = pending.shift();
      assert.equal(table, 'main');
      assert.equal(id, expected?.id);
      assert.equal(reply.control, expected.control);
    }
    return reply;
  };
  try {
    if (i === 0) await w.objects.update(t.id, 100);
    else {
      w.input.pointer(3, 3);
      if (phase.edge !== undefined) w.inputBindings.mouse(0, phase.edge);
      w.inputBindings.sample();
      await w.objects.tick(100 + i);
    }
  } finally {
    w.runtime.native = native;
  }
  assert.equal(pending.length, 0);
  compare(w, t, golden.rows[i]);
}
test('SDK23 configured mouse edges reach independent Script VMs through live Base/Plane callbacks and eight cold continuations', async () => {
  const w = await make();
  try {
    const t = await w.spawnScript('input-g2', { initialExecute: false });
    await w.runtime.native('main', 209, [512], t.machine, t);
    const floor = t.machine.sp;
    for (let i = 0; i < golden.rows.length; i++) {
      await step(w, t, i);
      assert.equal(t.machine.sp, floor + 4);
      if (golden.coldAfter.includes(i)) {
        const fresh = await make(false);
        try {
          await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
          const restored = fresh.runtime.scheduler.tasks.get(t.id);
          assert.notEqual(fresh.inputBindings, w.inputBindings);
          compare(fresh, restored, golden.rows[i]);
          await step(fresh, restored, i + 1);
          compare(w, t, golden.rows[i]);
        } finally {
          await fresh.close({ flushFiles: false });
        }
      }
    }
    assert.equal(w.input.regions.length, 0);
    assert.equal(golden.actual.allGCALL, 82);
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('SDK23 mouse release updates both masks while other SDK defaults remain independent', () => {
  for (const profile of [
    golden.profile,
    'rebellions-jp-engine-2.6.1.63',
    'bokutomo-engine-2.6.1.67',
    'sdk-4.01-engine-2.6.1.74',
    'nekopara-vol3-engine-2.6.1.76',
  ]) {
    const configuration = new NativeConfiguration({
        profile,
        startup: parseXML(golden.startupXML),
      }),
      input = new NativeInput({ configuration }),
      bindings = new NativeInputBindings(input, configuration);
    bindings.mouse(0, true);
    bindings.sample();
    assert.equal(bindings.query(0, 0), 2);
    bindings.mouse(0, false);
    bindings.sample();
    assert.equal(bindings.query(0, 0), profile === golden.profile ? 0 : 2);
    bindings.finishFrame();
    assert.equal(bindings.query(0, 0), 0);
  }
});
