// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { floatBits } from '../src/kcs.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { nativeTexturePageStorage } from '../src/native/texture-layout.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-plane-mesh.json', import.meta.url)),
);
const ordered = (v) => {
  const bits = floatBits(v);
  return bits & 0x80000000 ? ~bits >>> 0 : bits + 0x80000000;
};
function vertices(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (const [i, vertex] of actual.entries())
    for (const key of ['x', 'y', 'z', 'w', 'u', 'v', 'color'])
      if (key === 'color') assert.equal(vertex[key] >>> 0, expected[i][key] >>> 0);
      else
        assert(
          Math.abs(ordered(vertex[key]) - ordered(expected[i][key])) <= 1,
          `vertex${i}.${key}: ${vertex[key]} vs ${expected[i][key]}`,
        );
}
const meshWords = (mesh) =>
  mesh.flatMap((r, index) => [
    index,
    r.textureID >>> 0,
    ...r.vertices.flatMap((v) => [
      floatBits(v.x),
      floatBits(v.y),
      floatBits(v.z),
      null,
      floatBits(v.u),
      floatBits(v.v),
    ]),
  ]);

for (const version of ['74', '76']) {
  const golden = fixture.profiles[version],
    names = ['caller', 'top', 'plane', 'bitmap'],
    at = (name) => 2048 + names.indexOf(name) * 4,
    program = kcsProgram(
      golden.cases
        .filter((r) => r.id)
        .flatMap((r) => [
          ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
          [43, r.id, r.args.length * 4],
          ...(r.control === 1 ? [[38, at(r.save)]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2360],
        ])
        .concat([[59]]),
    );
  async function make(initialize = true) {
    const w = await dataWorld(
      golden.profile,
      { 'plane-mesh.kcs': program },
      {
        initialize: false,
        startup: parseNativeXML(encodeCP932(golden.startupXML)),
      },
    );
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
    const id = t.machine.load(at(name));
    return id ? w.objects.objects.get(w.resolveTaskID(id, t.id)) : undefined;
  };
  async function step(w, t, row) {
    const m = t.machine;
    if (row.input) row.input.forEach((word, i) => m.store(1024 + 4 * i, word));
    if (row.operation) {
      await w.objects.update(object(w, t, 'top').id, row.frame);
      await w.objects.drawTick(row.frame);
      const draws = [],
        plane = object(w, t, 'plane')?.implementation;
      if (plane)
        await plane.drawGPU({
          drawGeometry: (geometry, frame) =>
            draws.push({ vertices: geometry.flatMap((triangle) => triangle.vertices), frame }),
        });
      assert.equal(draws.length, row.commands.length, 'actual model consumer count');
      for (const [i, draw] of draws.entries()) {
        const expected = row.commands[i];
        vertices(draw.vertices, expected.vertices);
        assert.deepEqual(
          [draw.frame.width, draw.frame.height],
          [expected.texture.width, expected.texture.height],
        );
        assert.deepEqual([...draw.frame.rgba], expected.texture.rgba, 'all page bytes and alpha');
      }
    } else {
      const native = w.runtime.native,
        send = w.sendNativeEngine,
        packets = [],
        previous = object(w, t, 'plane')?.implementation.graph;
      w.sendNativeEngine = async function (target, sender, message, first, second, context = {}) {
        if (message === 83) {
          const b = context.payload.bytes(0, first * 80),
            view = new DataView(b.buffer, b.byteOffset, b.byteLength);
          packets.push(
            Array.from({ length: first * 20 }, (_, i) =>
              i % 20 >= 2 && ((i % 20) - 2) % 6 === 3 ? null : view.getUint32(i * 4, true),
            ),
          );
        }
        return Reflect.apply(send, this, [target, sender, message, first, second, context]);
      };
      w.runtime.native = async function (table, id, args, memory, owner, ...rest) {
        if (id === 71)
          return Reflect.apply(native, this, [table, id, args, memory, owner, ...rest]);
        assert.equal(id, row.id);
        if (row.text)
          memory.bytes(128, encodeCP932(row.text).length + 1).set([...encodeCP932(row.text), 0]);
        for (const o of row.outputs ?? []) memory.bytes(o.at, o.bytes.length).fill(0xa5);
        const before = memory.memory.slice(0, 2048),
          reply = await Reflect.apply(native, this, [table, id, args, memory, owner, ...rest]),
          changed = [];
        for (let i = 0; i < 2048; i++)
          if (before[i] !== memory.memory[i]) changed.push([i, memory.memory[i]]);
        assert.equal(reply.control, row.control);
        if (!row.save) assert.equal(reply.value ?? null, row.result);
        assert.deepEqual(changed, row.changed, 'all caller data writes Main' + id);
        for (const o of row.outputs ?? [])
          assert.deepEqual([...memory.bytes(o.at, o.bytes.length)], o.bytes);
        return reply;
      };
      try {
        if (m.waiting?.kind === 'message') await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
        else await w.runtime.scheduler.execute(t);
      } finally {
        w.runtime.native = native;
        w.sendNativeEngine = send;
      }
      assert.deepEqual(
        packets,
        row.packets.map((p) => p.definedWords),
        'original private wrapper packet',
      );
      if (row.id === 467) {
        const plane = object(w, t, 'plane').implementation;
        assert.deepEqual(meshWords(plane.graph.mesh), packets[0]);
        if (previous)
          assert.notEqual(plane.graph, previous, 'occupied modern key rebuilds a new model');
        let drawn = 0;
        await plane.drawGPU({
          drawGeometry() {
            drawn++;
          },
        });
        assert.equal(drawn, 0, 'new record remains hidden until ordinary Main92 shows it');
      }
      if (row.id === 83) assert.equal(object(w, t, 'plane').implementation.graph, null);
    }
    for (const e of row.state.liveTypes)
      assert.equal(!!object(w, t, e.name), e.alive, e.name + ' native lifetime');
    const pages = nativeTexturePageStorage(w.graphics.texturePages)?.pages;
    if (row.ordinal >= 2) assert.equal(pages?.size ?? 0, row.state.pages.length);
    if (row.ordinal >= 2 && pages)
      for (const [i, page] of [...pages.values()].entries())
        assert.deepEqual(
          [...page.frame.rgba],
          row.state.pages[i].rgba,
          'configured page survives source bitmap/model release',
        );
  }
  test(`SDK${version} original divided mesh replacement, uploaded pages, private source and independent cold consumers`, async () => {
    const w = await make();
    try {
      const t = await w.spawnScript('plane-mesh.kcs', { parent: w.main.id, initialExecute: false }),
        floor = t.machine.sp;
      t.machine.store(at('caller'), w.nativeTaskID(t.id));
      await w.sendEngine(t.id, t.id, 162, 0, 0);
      await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
      for (const [index, row] of golden.cases.entries()) {
        await step(w, t, row);
        assert.equal(t.machine.sp, floor, 'stack canary');
        if (golden.coldAfter.includes(index)) {
          const fresh = await make(false);
          try {
            await fresh.restore(
              await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
            );
            const restored = fresh.runtime.scheduler.tasks.get(t.id);
            for (const next of golden.cases.slice(index + 1)) await step(fresh, restored, next);
          } finally {
            await close(fresh);
          }
        }
      }
    } finally {
      await close(w);
    }
  });
  test(`SDK${version} divided mesh keeps receiver, manager, count, finite data and texture-page guards`, async () => {
    const w = await make();
    try {
      const t = w.main,
        m = t.machine,
        call = (id, args) => w.runtime.native('main', id, args, m, t);
      m.bytes(128, 6).set(encodeCP932('Guard\0'));
      const parent = w.nativeTaskID(t.id),
        plane = (await call(66, [2, parent, 128])).value,
        foreign = (await call(66, [1, parent, 128])).value;
      await assert.rejects(() => call(467, [foreign, 1024, 1]), /reviewed Plane receiver/);
      await assert.rejects(() => call(467, [plane, 1024, 0]), /positive record count/);
      await assert.rejects(
        () => call(467, [plane, m.memory.byteLength - 32, 1]),
        /KCS memory|out of bounds/i,
      );
      m.store(1028, 0x7fc00000);
      await assert.rejects(() => call(467, [plane, 1024, 1]), /finite vertex/);
      golden.cases
        .find((r) => r.id === 467)
        .input.forEach((word, i) => m.store(1024 + 4 * i, word));
      m.store(1024, 0xffffffff);
      await call(467, [plane, 1024, 1]);
      await call(92, [plane, 1]);
      await assert.rejects(
        () => w.graphics.get(w.resolveTaskID(plane, t.id)).drawGPU({ drawGeometry() {} }),
        /allocated texture pages/,
      );
      w.graphics.view.configure({ active: false });
      await assert.rejects(() => call(467, [plane, 1024, 1]), /initialized mode1/);
      assert.deepEqual(await call(467, [0, 0xffffffff, 0]), { control: 2 });
    } finally {
      await close(w);
    }
  });
}
