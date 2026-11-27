// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { floatBits } from '../src/kcs.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const ordered = (v) => {
  const word = floatBits(v);
  return word & 0x80000000 ? ~word >>> 0 : word + 0x80000000;
};
for (const version of ['63', '67']) {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-sdk' + version + '-owned-collector.json', import.meta.url),
      ),
    ),
    calls = golden.cases.filter((r) => r.id),
    names = ['caller', ...new Set(calls.flatMap((r) => (r.save ? [r.save] : [])))],
    at = (name) => 2048 + names.indexOf(name) * 4,
    files = {
      'case.kcs': kcsProgram([[37, 3968], [43, 71, 4], [59]]),
      ...Object.fromEntries(
        Object.entries(golden.resources).map(([name, b]) => [name, Buffer.from(b, 'base64')]),
      ),
      'owned-collector.kcs': kcsProgram(
        calls
          .flatMap((r) => [
            ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
            [43, r.id, r.args.length * 4],
            ...(r.save ? [[38, at(r.save)]] : []),
            [37, 3968],
            [43, 71, 4],
            [38, 2360],
          ])
          .concat([[59]]),
      ),
    };
  async function make(initialize = true) {
    const game = Object.assign(memoryGame(files), { width: 64, height: 64 }),
      random = new ParticleRandom(),
      world = new NativeWorld({
        profile: golden.profile,
        game,
        random,
        images: {},
        host: {},
        configuration: new NativeConfiguration({
          profile: golden.profile,
          startup: parseNativeXML(encodeCP932(golden.startupXML)),
        }),
        motionLibrary: new MotionLibrary(game, { profile: golden.profile, random }),
        storage: { read: async () => null, write: async () => true },
      });
    world.ensureNativeEngine = () => {
      throw new Error('Current resource replay attempted to execute an EXE');
    };
    world.graphics.createLogicalDevice();
    if (initialize) await world.initialize('case.kcs');
    return world;
  }
  async function close(world) {
    for (const task of world.runtime.scheduler.tasks.values())
      world.runtime.scheduler.cancel(task.id, false);
    await world.close({ flushFiles: false });
  }
  const object = (w, task, name) => {
    const id = task.machine.load(at(name));
    return id ? w.objects.objects.get(w.resolveTaskID(id, task.id)) : undefined;
  };
  async function compare(w, task, row, label) {
    if (row.id === 66) {
      const record = object(w, task, row.save);
      assert.equal(record?.kind, row.args[0], label + ' actual typed factory');
      assert.equal(
        record.parent,
        row.save === 'top' ? task.id : object(w, task, 'top').id,
        label + ' factory parent ownership',
      );
    }
    const draw = object(w, task, 'draw')?.implementation,
      plane = object(w, task, 'plane')?.implementation,
      graph = plane?.graph,
      models = row.state.models;
    assert.equal(graph?.mesh?.length ?? 0, models[0]?.count ?? 0, label + ' retained model count');
    if (graph)
      assert.deepEqual(
        graph.mesh.flatMap((r, i) => [
          i,
          r.textureID >>> 0,
          ...r.vertices.flatMap((v) => [
            floatBits(v.x),
            floatBits(v.y),
            floatBits(v.z),
            null,
            floatBits(v.u),
            floatBits(v.v),
          ]),
        ]),
        models[0].source,
        label + ' defined private model words',
      );
    assert.equal(!!object(w, task, 'plane'), row.state.planeAlive, label + ' Plane lifetime');
    if (row.state.draw) {
      const e = row.state.draw;
      assert(draw, label + ' live Draw');
      assert.deepEqual(
        [draw.state.nativeRasterGate, draw.state.enabled, draw.state.pending],
        [e.gate, e.enabled, e.pending],
        label + ' independent raster/enable/pending',
      );
      assert.equal(
        draw.state.renderer?.items.length ?? null,
        e.renderer?.items ?? null,
        label + ' retained entries',
      );
      if (e.renderer) {
        const bitmap = w.graphics.images.get(draw.state.renderer.bitmap),
          b = e.renderer.bitmap,
          rgba = await bitmap.pixels(),
          physical = new Uint8Array(b.pitch * b.height);
        assert.deepEqual(
          [bitmap.width, bitmap.height, bitmap.state.bpp],
          [b.width, b.height, b.bpp],
          label + ' raster geometry',
        );
        for (let y = 0; y < b.height; y++)
          for (let x = 0; x < b.width; x++) {
            const i = ((b.height - 1 - y) * b.width + x) * 4;
            physical.set(
              [rgba[i + 2], rgba[i + 1], rgba[i], ...(b.bpp === 4 ? [rgba[i + 3]] : [])],
              y * b.pitch + x * b.bpp,
            );
          }
        if (b.physicalPixels)
          assert.deepEqual([...physical], b.physicalPixels, label + ' initialized software raster');
      }
    } else assert.equal(draw, undefined, label + ' Draw lifetime');
  }
  function observe(w, row) {
    const native = w.runtime.native;
    w.runtime.native = async function (table, id, args, m, owner, ...rest) {
      if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
      const r = row();
      assert.equal(id, r.id);
      if (r.text)
        m.bytes(r.textAt ?? 64, encodeCP932(r.text).length + 1).set([...encodeCP932(r.text), 0]);
      const before = m.memory.slice(),
        reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]),
        changed = [];
      for (let i = 0; i < 2048; i++) if (before[i] !== m.memory[i]) changed.push([i, m.memory[i]]);
      assert.equal(reply.control, r.control, 'native control');
      if (!r.save) assert.equal(Object.hasOwn(reply, 'value'), false, 'native result unwritten');
      assert.deepEqual(changed, r.changed, 'complete original VM writes');
      return reply;
    };
    return () => {
      w.runtime.native = native;
    };
  }
  async function step(w, task, row) {
    if (!row.operation) {
      const previous = object(w, task, 'plane')?.implementation.graph;
      if (task.machine.waiting?.kind === 'message')
        await w.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
      else await w.runtime.scheduler.execute(task);
      if (row.occupied) {
        assert.equal(row.modelIdentityPreserved, true, 'original occupied model identity');
        assert.equal(
          object(w, task, 'plane').implementation.graph,
          previous,
          'occupied key preserves original model identity',
        );
      }
      return;
    }
    const draw = object(w, task, 'draw')?.implementation,
      renderer = w.retainedDraw,
      update = renderer.update;
    const pc = task.machine.pc;
    let updates = 0;
    renderer.update = async function (target, ...args) {
      if (target === draw) updates++;
      return Reflect.apply(update, this, [target, ...args]);
    };
    try {
      if (row.operation === 'frame') await w.objects.tick(row.frame);
      await w.objects.drawTick(row.frame);
    } finally {
      renderer.update = update;
    }
    assert.equal(
      task.machine.pc,
      pc,
      'driver outside the measured Top never executes during its child frame',
    );
    assert.equal(updates, row.state.draw?.gate ? 1 : 0, 'actual Base child raster gate');
    if (row.operation !== 'frame') return;
    const submissions = [],
      plane = object(w, task, 'plane')?.implementation;
    if (plane)
      await plane.drawGPU({
        drawGeometry: (triangles, frame) =>
          submissions.push({ vertices: triangles.flatMap((t) => t.vertices), frame }),
      });
    assert.equal(submissions.length, row.commands.length, 'ordinary renderer submissions');
    for (const [i, actual] of submissions.entries()) {
      const expected = row.commands[i];
      assert.equal(actual.vertices.length, expected.vertices.length);
      for (const [j, v] of actual.vertices.entries())
        for (const key of ['x', 'y', 'z', 'w', 'u', 'v', 'color']) {
          if (key === 'color')
            assert.equal(v[key] >>> 0, expected.vertices[j][key] >>> 0, 'uniform model color');
          else
            assert(
              Math.abs(ordered(v[key]) - ordered(expected.vertices[j][key])) <= 1,
              `${row.label} vertex${j}.${key}: ${v[key]} vs ${expected.vertices[j][key]}`,
            );
        }
      assert.deepEqual(
        [actual.frame.width, actual.frame.height],
        [expected.texture.width, expected.texture.height],
        'actual configured texture size',
      );
      assert.deepEqual(
        [...actual.frame.rgba],
        expected.texture.rgba,
        row.label + ' original initialized COM texture bytes',
      );
    }
  }
  test(
    'SDK' +
      version +
      ' factory Root/Draw/mesh consumers retain and release through eight cold continuations',
    async (t) => {
      const world = await make();
      t.after(() => close(world));
      const task = await world.spawnScript('owned-collector.kcs', {
          parent: world.main.id,
          initialExecute: false,
        }),
        m = task.machine,
        floor = m.sp;
      m.store(at('caller'), world.nativeTaskID(task.id));
      golden.source.forEach((word, i) => m.store(1024 + i * 4, word));
      // The native protocol walks only the published Top subtree. Stop the two
      // external JS drivers through the ordinary Script API before walking the
      // World; explicit scheduler messages still advance the reviewed GCALLs.
      await world.sendEngine(task.id, task.id, 162, 0, 0);
      await world.sendEngine(world.main.id, world.main.id, 162, 0, 0);
      let next = 0,
        cold = 0;
      const restoreObserver = observe(world, () => calls[next]);
      for (const [index, row] of golden.cases.entries()) {
        await step(world, task, row);
        assert.equal(m.sp, floor);
        await compare(world, task, row, 'frame' + index);
        if (!row.operation) next++;
        if (golden.coldAfter.includes(index)) {
          const fresh = await make(false);
          try {
            await fresh.restore(
              await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
            );
            const restored = fresh.runtime.scheduler.tasks.get(task.id);
            await compare(fresh, restored, row, 'cold' + index);
            const following = golden.cases[index + 1];
            if (!following.operation) observe(fresh, () => following);
            await step(fresh, restored, following);
            await compare(fresh, restored, following, 'cold next' + index);
            cold++;
          } finally {
            await close(fresh);
          }
        }
      }
      restoreObserver();
      assert.equal(next, calls.length);
      assert.equal(cold, 8);
    },
  );
  test(
    'SDK' + version + ' keeps unreviewed mesh consumers and copy destinations protected',
    async (t) => {
      const world = await make();
      t.after(() => close(world));
      const task = world.main,
        m = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, task);
      assert.equal(mapABIMessage(golden.profile, 'planeMesh', 'raw', 83, 2), 80);
      assert.equal(mapABIMessage(golden.profile, 'planeMesh', 'canonical', 80, 2), 83);
      assert.throws(
        () => mapABIMessage(golden.profile, 'planeMesh', 'raw', 83, 15),
        /Unreviewed ABI message/,
      );
      m.bytes(128, 6).set(encodeCP932('Guard\0'));
      const planeID = (await call(66, [2, world.nativeTaskID(task.id), 128])).value,
        topID = (await call(66, [1, world.nativeTaskID(task.id), 128])).value,
        plane = world.objects.objects.get(world.resolveTaskID(planeID, task.id)).implementation;
      golden.source.forEach((word, i) => m.store(1024 + i * 4, word));
      await assert.rejects(async () => call(467, [topID, 1024, 1]), /reviewed Plane receiver/);
      await assert.rejects(async () => call(467, [planeID, 1024, 0]), /positive record count/);
      m.store(1028, 0x7fc01234);
      await assert.rejects(async () => call(467, [planeID, 1024, 1]), /finite vertex/);
      m.store(1028, golden.source[1]);
      assert.equal(plane.graph, null, 'protected loads never publish a model');
      await call(92, [planeID, 1]);
      for (const textureID of [2, 0xffffffff, 0]) {
        m.store(1024, textureID);
        await call(467, [planeID, 1024, 1]);
        if (textureID === 0) await call(541, [0, 0, 8, 8]);
        let draws = 0;
        await assert.rejects(
          () => plane.drawGPU({ drawGeometry: () => draws++ }),
          /reviewed allocated texture pages/,
        );
        assert.equal(draws, 0, 'unknown texture sampling is protected at consumption');
        await call(83, [planeID]);
      }
      if (version === '67') {
        const bitmap = (await call(112, [1, 1])).value;
        await assert.rejects(
          async () => call(115, [bitmap, 0, 0, 1, 1, bitmap, 0, 0, 1, 1]),
          /reviewed VRAM owner/,
        );
        assert.deepEqual(
          await call(115, [bitmap, 0, 0, 1, 1, 0, 0, 0, 1, 1]),
          { control: 2 },
          'ignored source does not consume the protected destination',
        );
      }
    },
  );
}
