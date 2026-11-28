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
const corpus = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-plane-trails.json', import.meta.url)),
);
for (const golden of corpus.versions) {
  const code = (rows) =>
    kcsProgram(
      rows
        .filter((r) => r.id)
        .flatMap((r) => [
          ...r.args.map((a) => [
            37,
            typeof a === 'string' ? [0x13, a === 'caller' ? 2300 : 2304] : a,
          ]),
          [43, r.id, r.args.length * 4],
          ...(r.control === 1 ? [[38, 2304]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2360],
        ])
        .concat([[59]]),
    );
  async function make(init = true, rows = golden.cases) {
    const xml = parseNativeXML(encodeCP932(golden.startupXML)),
      w = await dataWorld(
        golden.profile,
        {
          'trail.kcs': code(rows),
          ...Object.fromEntries(
            Object.entries(golden.resources).map(([n, b]) => [n, Uint8Array.from(b)]),
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
    const m = t.machine,
      resourceReads = [];
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
          [1024, [1, 2, row.sampleBaseZ ?? 0]],
          [1040, [10 + row.sample, 9, 0]],
          [1056, [0.5, 1, 1]],
          [1080, Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0))],
        ])
          values.forEach((v, i) => m.store(at + 4 * i, floatBits(v)));
      const native = w.runtime.native,
        read = w.game.read;
      w.game.read = function (name, ...rest) {
        resourceReads.push(name);
        return Reflect.apply(read, this, [name, ...rest]);
      };
      w.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        assert.equal(id, row.id);
        if (row.text) m.writeString(row.text, row.textAt ?? 128);
        const before = m.memory.slice(0, 2048),
          r = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        assert.equal(r.control, row.control);
        const changed = [];
        for (let i = 0; i < 2048; i++)
          if (m.memory[i] !== before[i]) changed.push([i, m.memory[i]]);
        assert.deepEqual(changed, row.changed, 'caller writes');
        return r;
      };
      try {
        if (m.waiting?.kind === 'message') await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
        else await w.runtime.scheduler.execute(t);
      } finally {
        w.runtime.native = native;
        w.game.read = read;
      }
    }
    if (row.id === 398)
      assert.deepEqual(
        resourceReads,
        row.reads.filter((r) => r.destination).map((r) => r.path),
        'one complete read per native clone reconstruction',
      );
    const task = plane(w, t);
    assert.equal(!!task, row.state.planeLive);
    if (!task) return;
    assert.equal(
      task.state.trail?.graphs.length ?? 0,
      row.state.modelKeys.filter((k) => k !== 'plane').length,
      'retained clone keys',
    );
    assert.equal(!!task.graph, row.state.primaryModelRegistered, 'independent primary key');
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
  test(
    golden.version + ' actual trail Script, defined ring lanes, ordered Root triangles and release',
    async () => {
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
    },
  );
  for (const boundary of golden.coldAfter)
    test(golden.version + ' independent trail cold at ' + boundary, async () => {
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

  if (golden.version === '74') {
    const config = [2, 1, 128, floatBits(1), floatBits(1), floatBits(1), 0, 0, 0, 0, 0, 0, 0];
    async function direct() {
      const w = await make(),
        id = await w.objects.create({ kind: 2, parent: w.main.id, name: 'file trail IO' }),
        task = w.objects.objects.get(id).implementation;
      const b = encodeCP932('file\\shape.kx2\0'),
        p = new NativeGraphicsPacket(new Array(Math.ceil(b.length / 4)).fill(0));
      p.bytes(0, b.length).set(b);
      await task.message([0, 70, 0, 0], { payload: p });
      return { w, id, task };
    }
    const configure = (task) =>
      task.message([0, 79, 1, 0], { payload: new NativeGraphicsPacket(config) });
    test('file trail reads fresh independent models and releases a partial failed reconstruction', async () => {
      const { w, task } = await direct();
      try {
        const replies = [];
        let reads = 0;
        w.game.read = async () => {
          const b = Uint8Array.from(golden.resources['file\\shape.kx2']);
          new DataView(b.buffer).setFloat32(12, ++reads === 1 ? 1 : 5, true);
          replies.push(b);
          return b;
        };
        await configure(task);
        assert.equal(reads, 2);
        assert.deepEqual(
          task.state.trail.graphs.map((g) => g.width),
          [3, 7],
        );
        for (const b of replies) b.fill(0);
        assert.deepEqual(
          task.state.trail.graphs.map((g) => g.width),
          [3, 7],
          'returned provider buffers are not retained as mutable geometry',
        );
        await task.message([0, 79, 0, 0]);
        const failure = new Error('second clone read fails');
        reads = 0;
        w.game.read = async () => {
          if (++reads === 2) throw failure;
          return Uint8Array.from(golden.resources['file\\shape.kx2']);
        };
        await assert.rejects(configure(task), (e) => e === failure);
        assert.equal(task.state.trail, null);
        assert.equal(w.graphics.graphs.size, 1, 'partial clone keys retired, primary remains');
      } finally {
        await close(w);
      }
    });
    test('canceled, replaced and retired pending file trail construction cannot publish old keys', async () => {
      const { w, id, task } = await direct();
      try {
        let release, started;
        const ready = new Promise((r) => (started = r));
        w.game.read = () =>
          new Promise((r) => {
            release = r;
            started();
          });
        const old = configure(task);
        await ready;
        await task.message([0, 79, 0, 0]);
        w.game.read = async () => Uint8Array.from(golden.resources['file\\shape.kx2']);
        await configure(task);
        const current = task.state.trail;
        release(Uint8Array.from(golden.resources['file\\shape.kx2']));
        await old;
        assert.equal(task.state.trail, current);
        assert.equal(current.graphs.length, 2);
        for (const graph of current.graphs)
          assert.equal(w.graphics.graphs.get(graph.nativeID), graph);
        let finish, notify;
        const begun = new Promise((r) => (notify = r));
        w.game.read = () =>
          new Promise((r) => {
            finish = r;
            notify();
          });
        const pending = configure(task);
        await begun;
        await w.objects.destroy(id);
        finish(Uint8Array.from(golden.resources['file\\shape.kx2']));
        await pending;
        assert.equal(task.state.trail, null);
        assert.equal(w.graphics.graphs.size, 0);
      } finally {
        await close(w);
      }
    });
  }
}
