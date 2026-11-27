// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { floatBits } from '../src/kcs.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { compareNativeDrawItems } from '../src/native/graphics-render.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk67-plane-trail.json', import.meta.url)),
);
const code = kcsProgram(
  golden.cases
    .filter((r) => r.id)
    .flatMap((r) => [
      ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, a === 'caller' ? 2300 : 2304] : a]),
      [43, r.id, r.args.length * 4],
      ...(r.control === 1 ? [[38, 2304]] : []),
      [37, 3968],
      [43, 71, 4],
      [38, 2360],
    ])
    .concat([[59]]),
);
async function make(init = true) {
  const xml = parseNativeXML(encodeCP932(golden.startupXML)),
    w = await dataWorld(
      golden.profile,
      {
        'trail.kcs': code,
        ...Object.fromEntries(
          Object.entries(golden.resources).map(([n, b]) => ['models.int/' + n, Uint8Array.from(b)]),
        ),
      },
      { initialize: false, startup: xml },
    );
  w.game.nativeResources = new NativeResources(xml);
  w.graphics.createLogicalDevice();
  if (init) {
    await w.initialize('case.kcs');
    await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
    await w.objects.tick(0);
  }
  return w;
}
async function close(w) {
  for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
  await w.close({ flushFiles: false });
}
const plane = (w, t) =>
  w.objects.objects.get(w.resolveTaskID(t.machine.load(2304), t.id))?.implementation;
const ordered = (n) => {
  const b = floatBits(n);
  return b & 0x80000000 ? ~b >>> 0 : b + 0x80000000;
};
function compare(a, b, label) {
  assert.equal(a.length, b.length, label);
  for (let i = 0; i < a.length; i++)
    for (const k of ['x', 'y', 'z', 'w', 'u', 'v', 'color'])
      if (k === 'color') assert.equal(a[i][k] >>> 0, b[i][k] >>> 0);
      else if (b[i][k] === null)
        assert(!Number.isFinite(a[i][k]), `${label} native nonfinite ${i}.${k}`);
      else
        assert(
          Math.abs(ordered(a[i][k]) - ordered(b[i][k])) <= 1,
          `${label} ${i}.${k}: ${a[i][k]} vs ${b[i][k]}`,
        );
}
async function step(w, t, row) {
  const m = t.machine;
  if (row.operation) {
    await w.objects.update(w.root, row.frame);
    await w.objects.drawTick(row.frame);
    const task = plane(w, t),
      draws = [],
      gpu = {
        drawGeometry: (g) =>
          draws.push(
            ...g.flatMap((q) =>
              q.vertices.length === 3 ||
              (q.vertices.length === 4 && q.vertices[3] === q.vertices[2])
                ? [q.vertices.slice(0, 3)]
                : [q.vertices.slice(0, 3), [q.vertices[2], q.vertices[1], q.vertices[3]]],
            ),
          ),
      };
    const items = [
      ...w.graphics.drawItems(),
      ...(task?.graph
        ? [
            {
              n: task.record.nativeID,
              priority: new DataView(task.graph.kx2.buffer).getFloat32(20, true),
              order: task.graph.renderOrder,
              drawGPU: (g) => task.drawGPU(g),
            },
          ]
        : []),
    ].sort(compareNativeDrawItems);
    for (const item of items) await item.drawGPU(gpu);
    const expected = row.draws.flatMap((q) => q.triangles);
    assert.equal(draws.length, expected.length, 'ordered native triangles ' + row.label);
    for (let i = 0; i < draws.length; i++) compare(draws[i], expected[i], row.label);
  } else {
    if (row.sample !== undefined)
      for (const [at, values] of [
        [1024, [1, 2, 0]],
        [1040, [10 + row.sample, 9, 0]],
        [1056, [0.5, 1, 1]],
        [1080, Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0))],
      ])
        values.forEach((v, i) => m.store(at + 4 * i, floatBits(v)));
    const native = w.runtime.native;
    w.runtime.native = async function (table, id, args, m, owner, ...rest) {
      if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
      assert.equal(id, row.id);
      if (row.text) m.writeString(row.text, row.textAt ?? 128);
      const before = m.memory.slice(0, 2048),
        r = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
      assert.equal(r.control, row.control);
      const changed = [];
      for (let i = 0; i < 2048; i++) if (m.memory[i] !== before[i]) changed.push([i, m.memory[i]]);
      assert.deepEqual(changed, row.changed, 'caller writes');
      return r;
    };
    try {
      if (m.waiting?.kind === 'message') await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
      else await w.runtime.scheduler.execute(t);
    } finally {
      w.runtime.native = native;
    }
  }
  const task = plane(w, t);
  assert.equal(!!task, row.state.planeLive);
  if (!task) return;
  const tr = task.state.trail,
    e = row.state.trail;
  assert.equal(tr?.history.length ?? 0, e.ring.length, 'history size ' + row.ordinal);
  if (tr) {
    assert.equal(tr.stride, e.stride);
    assert.equal(tr.mode, e.mode);
    for (let i = 0; i < tr.history.length; i++) {
      const v = new DataView(tr.history[i].buffer);
      for (let j = 0; j < 32; j++)
        if (e.ring[i][j] !== null)
          assert.equal(v.getUint32(j * 4, true), e.ring[i][j], `ring ${row.ordinal}:${i}:${j}`);
    }
  }
  assert.equal(task.state.modelFilename, row.state.plane.filename);
}
async function caller(w) {
  const t = await w.spawnScript('trail.kcs', { parent: w.main.id, initialExecute: false });
  t.machine.store(2300, w.nativeTaskID(t.id));
  await w.sendEngine(t.id, t.id, 162, 0, 0);
  return t;
}
test('SDK67 actual trail Script, defined ring lanes, ordered Root triangles and release', async () => {
  const w = await make();
  try {
    const t = await caller(w),
      sp = t.machine.sp;
    for (const r of golden.cases) {
      await step(w, t, r);
      assert.equal(t.machine.sp, sp);
    }
  } finally {
    await close(w);
  }
});
for (const boundary of golden.coldAfter)
  test('SDK67 independent trail cold at ' + boundary, async () => {
    const w = await make();
    let fresh;
    try {
      const t = await caller(w);
      for (const r of golden.cases.slice(0, boundary + 1)) await step(w, t, r);
      fresh = await make(false);
      await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
      for (const r of golden.cases.slice(boundary + 1))
        await step(fresh, fresh.runtime.scheduler.tasks.get(t.id), r);
    } finally {
      if (fresh) await close(fresh);
      await close(w);
    }
  });

test('SDK67 configure-before-show samples registration display and cold clones publish on later Frames', async () => {
  const w = await make();
  let fresh;
  try {
    const t = await caller(w);
    for (const row of golden.cases.slice(0, 3)) await step(w, t, row);
    const task = plane(w, t);
    assert.equal(task.graph.registrationEnabled, false);
    await task.message([0, 79, 1, 0], {
      payload: new NativeGraphicsPacket(
        [1, 1, 128, floatBits(1), floatBits(1), floatBits(1), undefined, 0, 0, 0, undefined, 0, 0],
        { unwritten: [6, 10] },
      ),
    });
    assert.equal(new DataView(task.state.trail.history[0].buffer).getUint32(8, true), 0);
    await task.message([0, 47, 0, 1]);
    await w.objects.update(w.root, 1);
    await w.objects.drawTick(1);
    assert.equal(task.state.trail.graphs[0].registrationEnabled, false);
    fresh = await make(false);
    await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
    const restored = plane(fresh, fresh.runtime.scheduler.tasks.get(t.id));
    await fresh.objects.update(fresh.root, 2);
    await fresh.objects.drawTick(2);
    assert.equal(restored.state.trail.graphs[0].registrationEnabled, true);
    assert.equal(restored.state.trail.graphs[0].registrationWord, 1);
    await restored.message([0, 79, 0, 0]);
    assert.equal(restored.state.trail, null);
  } finally {
    if (fresh) await close(fresh);
    await close(w);
  }
});
