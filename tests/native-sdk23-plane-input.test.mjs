// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-plane-input-state.json', import.meta.url)),
);
async function make(initialize = true) {
  const w = await modernParticleMessageWorld(
    golden.profile,
    {
      'scripts.int': kif([
        ['input-g1.kcs', Buffer.from(golden.program, 'base64')],
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
      ]),
      'startup.xml': Buffer.from(golden.startupXML),
    },
    { initialize, startup: parseXML(golden.startupXML) },
  );
  w.graphics.createLogicalDevice();
  return w;
}
const locations = [
  ['parent', 64],
  ['child', 68],
  ['base', 72],
  ['hint', 76],
];
function compare(w, t, row) {
  const names = new Map(
      locations.map(([name, at]) => [w.resolveTaskID(t.machine.load(at), t.id), name]),
    ),
    name = (id) => names.get(id) ?? (id === t.id ? 'caller' : id),
    nativeName = (id, owner) => (id === -1 ? -1 : name(w.resolveTaskID(id, owner)));
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => t.machine.load(128 + i * 4)),
    row.outputs,
  );
  assert.deepEqual(
    w
      .inputFor(t.id)
      .ordered()
      .map((r) => ({
        owner: name(r.owner),
        bounds: r.bounds,
        priority: r.priority | 0,
        mask: r.mask,
        active: Number(r.active),
        enabled: Number(r.enabled),
        hover: Number(r.hoverEnabled),
        dragEnabled: Number(r.dragEnabled),
      })),
    row.regions,
  );
  const actors = [];
  for (const [id, name] of names) {
    const object = w.objects.objects.get(id);
    if (!object) continue;
    const s = object.implementation.state;
    actors.push({
      name,
      kind: object.kind,
      receiver: nativeName(s.receiver, id),
      ...(object.kind === 2
        ? {
            phase: s.phase,
            blocked: s.blocked,
            buttonEnabled: s.buttonEnabled,
            button: s.button,
            imageIndex: nativeName(s.imageIndex, id),
            attribute: s.frameStep,
          }
        : {}),
    });
  }
  assert.deepEqual(actors, row.actors);
}
async function step(w, t, index) {
  const pending = golden.callsByPhase[index].slice(),
    original = w.runtime.native;
  w.runtime.native = async function (table, id, args, m, caller, ...rest) {
    const reply = await Reflect.apply(original, this, [table, id, args, m, caller, ...rest]);
    if (caller.id === t.id) {
      const expected = pending.shift();
      assert.equal(table, 'main');
      assert.equal(id, expected?.id);
      assert.equal(reply.control, expected.control, 'original Main' + id + ' control');
      if (expected.outputWritten) assert.equal(reply.value, expected.value);
    }
    return reply;
  };
  try {
    await w.objects.update(t.id, golden.rows[index].frame);
  } finally {
    w.runtime.native = original;
  }
  assert.equal(pending.length, 0);
  compare(w, t, golden.rows[index]);
}
test('SDK23 loaded Plane/Base metadata, visibility, clear/rebind and six independent cold continuations', async () => {
  const w = await make();
  try {
    const t = await w.spawnScript('input-g1', { initialExecute: false });
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
          compare(fresh, restored, golden.rows[i]);
          await step(fresh, restored, i + 1);
        } finally {
          await fresh.close({ flushFiles: false });
        }
      }
    }
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('SDK23 rejects an unqualified ancestor hint cycle before changing the retained hint', async () => {
  const w = await make();
  try {
    const t = await w.spawnScript('input-g1', { initialExecute: false });
    await w.runtime.native('main', 209, [512], t.machine, t);
    await step(w, t, 0);
    const childID = t.machine.load(68),
      parentID = t.machine.load(64),
      child = w.graphics.get(w.resolveTaskID(childID, t.id));
    assert.equal(child.state.imageIndex, -1);
    await assert.rejects(
      () => w.runtime.native('main', 102, [childID, parentID], t.machine, t),
      /ancestor visibility cycle/,
    );
    await assert.rejects(
      () => w.runtime.native('main', 102, [childID, childID], t.machine, t),
      /ancestor visibility cycle/,
    );
    assert.equal(child.state.imageIndex, -1);
    compare(w, t, golden.rows[0]);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('SDK23 static raw43/44 gate keeps raw83-only registration distinct from raw67 button enable', async () => {
  const w = await make();
  try {
    const t = await w.spawnScript('input-g1', { initialExecute: false });
    await w.runtime.native('main', 209, [512], t.machine, t);
    await step(w, t, 0);
    const childID = t.machine.load(68),
      child = w.graphics.get(w.resolveTaskID(childID, t.id));
    const call = (id, args) => w.runtime.native('main', id, args, t.machine, t);
    await call(95, [childID, 0x21]);
    const region = w.inputFor(t.id).get(child.record.id);
    assert.equal(child.state.buttonEnabled, false);
    await call(92, [childID, 0]);
    assert.equal(
      Number(region.enabled),
      1,
      'raw83 registers but does not set the raw67 button gate',
    );
    await call(96, [childID, 0x31, 512]);
    assert.equal(child.state.buttonEnabled, true);
    await call(92, [childID, 0]);
    assert.equal(Number(region.enabled), 0);
  } finally {
    await w.close({ flushFiles: false });
  }
});
