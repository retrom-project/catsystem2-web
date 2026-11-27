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
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const corpus = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-plane-files.json', import.meta.url)),
);
for (const golden of corpus.versions) {
  const names = ['caller', 'plane', 'base', 'bitmap'],
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
      Object.entries(golden.resources).map(([n, b]) => [n, Uint8Array.from(b)]),
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
      assert.equal(
        actual.length,
        expected.length,
        'ordered actual submitted triangles ' + row.label,
      );
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
      const native = w.runtime.native,
        read = w.game.read,
        releaseMovie = w.planeMovies.release;
      if (row.args[0] === 'base' && [81, 82, 346].includes(row.id))
        w.planeMovies.release = () => {
          throw new Error('BasePlane ignore invoked movie provider');
        };
      w.game.read = function (...args) {
        if (row.id === 81 || row.id === 82)
          assert.equal(
            object(w, t, 'plane')?.implementation.graph ?? null,
            null,
            'modern model removed before resource callback',
          );
        return Reflect.apply(read, this, args);
      };
      w.runtime.native = async function (table, id, args, machine, owner, ...rest) {
        if (id === 71)
          return Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]);
        assert.equal(id, row.id);
        if (row.text)
          machine
            .bytes(row.textAt ?? 128, encodeCP932(row.text).length + 1)
            .set([...encodeCP932(row.text), 0]);
        for (const o of row.outputs ?? []) machine.bytes(o[0], o[1]).fill(0xa5);
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
        w.game.read = read;
        w.planeMovies.release = releaseMovie;
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
    assert.equal(!!object(w, t, 'base'), row.state.baseLive, 'BasePlane lifetime');
    assert.equal(!!plane?.graph, row.state.primaryModelRegistered, 'registered primary model');
    for (const event of row.input ?? [])
      if (event.registration) {
        const region = w.inputFor(t.id).get(object(w, t, 'plane').id);
        assert(region);
        assert.deepEqual(region.bounds, event.registration.bounds, 'native Input geometry');
        assert.equal(region.priority | 0, event.registration.priority);
        assert.equal(region.mask, event.registration.mask);
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
  test(
    golden.version +
      ' actual Script file models, Input pose, subsequent COM geometry and native lifetime',
    async () => {
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
    },
  );
  for (const checkpoint of golden.coldAfter)
    test(
      golden.version + ' file model independent cold at native boundary ' + checkpoint,
      async () => {
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
      },
    );
  test(
    golden.version +
      ' modern file replacement preserves callback errors and reentrant registry occupants',
    async () => {
      const w = await make();
      try {
        const id = await w.objects.create({
            kind: 2,
            parent: w.main.id,
            name: 'resource callback boundary',
          }),
          task = w.objects.objects.get(id).implementation;
        const load = async (name) => {
          const b = encodeCP932(name + '\0'),
            packet = new NativeGraphicsPacket(new Array(Math.ceil(b.length / 4)).fill(0));
          packet.bytes(0, b.length).set(b);
          return task.message([0, 70, 0, 0], { payload: packet });
        };
        await load('file\\shape.kx2');
        const metadata = {
            rect: task.state.rect.slice(),
            type: task.state.drawType,
            path: task.state.modelFilename,
          },
          error = new Error('provider failure');
        w.game.read = async () => {
          assert.equal(task.graph, null);
          throw error;
        };
        await assert.rejects(load('file\\unread.kx2'), (e) => e === error);
        assert.equal(task.graph, null);
        assert.deepEqual(task.state.rect, metadata.rect);
        assert.equal(task.state.drawType, metadata.type);
        assert.equal(task.state.modelFilename, metadata.path);
        w.game.read = async () => new Uint8Array(4);
        await load('file\\wrong-signature.kx2');
        assert.equal(task.graph, null);
        let installed;
        w.game.read = async () => {
          assert.equal(task.graph, null);
          await task.message([0, 42, 0, 0], {
            payload: new NativeGraphicsPacket([
              0,
              0,
              0,
              floatBits(3),
              floatBits(2),
              0,
              0,
              0xff123456,
            ]),
          });
          installed = task.graph;
          return Uint8Array.from(golden.resources['file\\shape.kx2']);
        };
        await load('file\\reentry.kx2');
        assert.equal(
          task.graph,
          installed,
          'registration rejects newly occupied key without deleting that occupant',
        );
        assert.deepEqual(task.state.rect, [0, 0, 3, 2]);
        assert.equal(task.state.modelFilename, metadata.path);
      } finally {
        await close(w);
      }
    },
  );
}
