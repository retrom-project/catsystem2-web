// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { floatBits } from '../src/kcs.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk67-plane-file-models.json', import.meta.url)),
);
const names = ['caller', 'plane', 'bitmap'],
  at = (name) => 2300 + names.indexOf(name) * 4;
const program = kcsProgram(
  golden.cases
    .filter((r) => r.id)
    .flatMap((r) => [
      ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
      [43, r.id, r.args.length * 4],
      ...(r.control === 1 ? [[38, r.save ? at(r.save) : 2340]] : []),
      [37, 3968],
      [43, 71, 4],
      [38, 2360],
    ])
    .concat([[59]]),
);
const files = {
  'plane.kcs': program,
  ...Object.fromEntries(
    Object.entries(golden.resources).map(([n, b]) => ['models.int/' + n, Uint8Array.from(b)]),
  ),
};
async function make(initialize = true) {
  const w = await dataWorld(golden.profile, files, {
    initialize: false,
    startup: parseNativeXML(encodeCP932(golden.startupXML)),
  });
  w.game.nativeResources = new NativeResources(parseNativeXML(encodeCP932(golden.startupXML)));
  w.graphics.createLogicalDevice();
  if (initialize) {
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
const object = (w, t, name) => {
  const n = t.machine.load(at(name));
  return n ? w.objects.objects.get(w.resolveTaskID(n, t.id)) : undefined;
};
const ordered = (n) => {
  const b = floatBits(n);
  return b & 0x80000000 ? ~b >>> 0 : b + 0x80000000;
};
function compareVertices(a, b) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++)
    for (const k of ['x', 'y', 'z', 'w', 'u', 'v', 'color'])
      if (k === 'color') assert.equal(a[i][k] >>> 0, b[i][k] >>> 0, `vertex${i} color`);
      else
        assert(
          Math.abs(ordered(a[i][k]) - ordered(b[i][k])) <= 1,
          `vertex${i}.${k}: ${a[i][k]} vs ${b[i][k]}`,
        );
}
async function step(w, t, row) {
  const m = t.machine;
  if (row.operation) {
    await w.objects.update(w.root, row.frame);
    await w.objects.drawTick(row.frame);
    const plane = object(w, t, 'plane')?.implementation,
      draws = [];
    if (plane)
      await plane.drawGPU({
        drawGeometry: (geometry, frame) =>
          draws.push({
            triangles: geometry.flatMap((q) =>
              q.vertices.length === 3 ||
              (q.vertices.length === 4 && q.vertices[3] === q.vertices[2])
                ? [q.vertices.slice(0, 3)]
                : [q.vertices.slice(0, 3), [q.vertices[2], q.vertices[1], q.vertices[3]]],
            ),
            frame,
          }),
      });
    const actual = draws.flatMap((q) =>
        q.triangles.map((vertices) => ({ vertices, frame: q.frame })),
      ),
      expected = row.draws.flatMap((q) =>
        q.triangles.map((vertices) => ({ vertices, frame: q.texture })),
      );
    assert.equal(actual.length, expected.length, 'ordered actual submitted triangles ' + row.label);
    for (let i = 0; i < actual.length; i++) {
      compareVertices(actual[i].vertices, expected[i].vertices);
      if (expected[i].frame) {
        assert.deepEqual(
          [actual[i].frame.width, actual[i].frame.height],
          [expected[i].frame.width, expected[i].frame.height],
        );
        assert.deepEqual([...actual[i].frame.rgba], expected[i].frame.rgba, 'all RGBA/alpha');
      }
    }
  } else {
    const native = w.runtime.native;
    w.runtime.native = async function (table, id, args, machine, owner, ...rest) {
      if (id === 71) return Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]);
      assert.equal(id, row.id);
      if (row.text)
        machine
          .bytes(row.textAt ?? 128, encodeCP932(row.text).length + 1)
          .set([...encodeCP932(row.text), 0]);
      for (const o of row.outputs ?? []) machine.bytes(o.at, o.bytes.length).fill(0xa5);
      const before = machine.memory.slice(0, 2048),
        reply = await Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]),
        changed = [];
      for (let i = 0; i < 2048; i++)
        if (before[i] !== machine.memory[i]) changed.push([i, machine.memory[i]]);
      assert.equal(reply.control, row.control);
      if (!row.save) assert.equal(reply.value ?? null, row.result);
      assert.deepEqual(changed, row.changed, 'all caller output writes Main' + id);
      return reply;
    };
    try {
      if (m.waiting?.kind === 'message') await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
      else await w.runtime.scheduler.execute(t);
    } finally {
      w.runtime.native = native;
    }
  }
  const plane = object(w, t, 'plane')?.implementation;
  assert.equal(!!plane, row.state.planeLive, 'Plane lifetime');
  if (plane) {
    assert.equal(Number(plane.state.shown), row.state.plane.ownShown, 'own visibility');
    assert.equal(
      plane.state.drawType,
      row.state.plane.drawType,
      'model kind ' + (row.label ?? row.id) + ' ordinal' + row.ordinal,
    );
    assert.deepEqual(plane.state.rect.map(floatBits), row.state.plane.rect, 'model bounds');
    assert.equal(plane.state.modelFilename, row.state.plane.filename, 'retained KX2 filename');
  }
  const input = w.inputFor(t.id);
  assert.equal(input.regions.length, row.state.regions.length, 'actual Input registration count');
  for (const e of row.state.regions) {
    const region = input.get(object(w, t, e.owner).id);
    assert(region);
    assert.deepEqual(region.bounds, e.bounds, 'actual Input pose bounds');
    for (const key of ['priority', 'mask', 'active', 'enabled'])
      assert.equal(key === 'priority' ? region[key] | 0 : region[key], e[key], `Input ${key}`);
  }
}
async function caller(w) {
  const t = await w.spawnScript('plane.kcs', { parent: w.main.id, initialExecute: false });
  t.machine.store(at('caller'), w.nativeTaskID(t.id));
  t.machine
    .bytes(1200, 48)
    .set(new Uint8Array(Uint32Array.from([1, 0, 0, 1, 2, 1, 1, 4, 3, 0, 0, 0]).buffer));
  await w.sendEngine(t.id, t.id, 162, 0, 0);
  return t;
}
test('SDK67 actual Script file models, Input pose, subsequent COM geometry and native lifetime', async () => {
  const w = await make();
  try {
    const t = await caller(w),
      floor = t.machine.sp;
    for (const row of golden.cases) {
      await step(w, t, row);
      assert.equal(t.machine.sp, floor, 'stack canary');
    }
  } finally {
    await close(w);
  }
});
for (const checkpoint of golden.coldAfter)
  test('SDK67 file model independent cold at native boundary ' + checkpoint, async () => {
    const w = await make();
    let fresh;
    try {
      const t = await caller(w);
      for (const row of golden.cases.slice(0, checkpoint + 1)) await step(w, t, row);
      fresh = await make(false);
      await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
      const restored = fresh.runtime.scheduler.tasks.get(t.id);
      for (const row of golden.cases.slice(checkpoint + 1)) await step(fresh, restored, row);
    } finally {
      if (fresh) await close(fresh);
      await close(w);
    }
  });
test('SDK67 original BasePlane receiver consumes KX2/KX3 packets without file IO, including current cold', async () => {
  const rows = golden.baseBridge.rows,
    baseAt = 2400;
  const code = kcsProgram(
    rows
      .filter((r) => r.id)
      .flatMap((r) => [
        ...r.args.map((a) => [
          37,
          typeof a === 'string' ? [0x13, a === 'caller' ? 2300 : baseAt] : a,
        ]),
        [43, r.id, r.args.length * 4],
        ...(r.control === 1 ? [[38, baseAt]] : []),
        [37, 3968],
        [43, 71, 4],
        [38, 2360],
      ])
      .concat([[59]]),
  );
  const makeBase = async () => {
    const world = await dataWorld(
      golden.profile,
      { 'base.kcs': code },
      { initialize: false, startup: parseNativeXML(encodeCP932(golden.startupXML)) },
    );
    world.game.nativeResources = new NativeResources(
      parseNativeXML(encodeCP932(golden.startupXML)),
    );
    world.graphics.createLogicalDevice();
    return world;
  };
  const w = await makeBase();
  let fresh;
  try {
    await w.initialize('case.kcs');
    await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
    await w.objects.tick(0);
    const t = await w.spawnScript('base.kcs', { parent: w.main.id, initialExecute: false });
    t.machine.store(2300, w.nativeTaskID(t.id));
    await w.sendEngine(t.id, t.id, 162, 0, 0);
    const stepBase = async (world, task, r) => {
      if (r.operation) {
        await world.objects.update(world.root, r.frame);
        assert(!world.objects.objects.has(world.resolveTaskID(task.machine.load(baseAt), task.id)));
        return;
      }
      const original = world.runtime.native,
        read = world.game.read;
      let reads = 0;
      world.game.read = function (...a) {
        reads++;
        return Reflect.apply(read, this, a);
      };
      world.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(original, this, [table, id, args, m, owner, ...rest]);
        assert.equal(id, r.id);
        if (r.text) m.writeString(r.text, r.id === 66 ? 128 : 192);
        const before = reads,
          reply = await Reflect.apply(original, this, [table, id, args, m, owner, ...rest]);
        assert.equal(reply.control, r.control);
        if (!r.dependency)
          assert.equal(reads, before, 'ignored model messages must not read resource data');
        return reply;
      };
      try {
        if (task.machine.waiting?.kind === 'message')
          await world.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
        else await world.runtime.scheduler.execute(task);
      } finally {
        world.runtime.native = original;
        world.game.read = read;
      }
      const id = world.resolveTaskID(task.machine.load(baseAt), task.id),
        object = world.objects.objects.get(id);
      assert(object);
      assert.equal(object.kind, 6);
      assert.equal(object.implementation.graph, null);
    };
    for (let i = 0; i < rows.length; i++) {
      await stepBase(w, t, rows[i]);
      if (i === 4) {
        fresh = await makeBase();
        await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
        const restored = fresh.runtime.scheduler.tasks.get(t.id);
        for (const r of rows.slice(i + 1)) await stepBase(fresh, restored, r);
      }
    }
  } finally {
    if (fresh) await close(fresh);
    await close(w);
  }
});
