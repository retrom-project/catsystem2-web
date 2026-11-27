// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { floatBits } from '../src/kcs.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { nativeTexturePageSummary } from '../src/native/texture-layout.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-view-mesh-golden.json', import.meta.url)),
  ),
  marker = 0x67727068;
const configuration = (evidence) => ({
  startup: evidence.startup && parseNativeXML(Uint8Array.from(evidence.startup)),
});
const plane = (world, m) =>
  [...world.objects.objects.values()].find((r) => r.kind === 2 && r.nativeID === m.load(32))
    ?.implementation;
const modelWords = (mesh) =>
  mesh.flatMap((record, index) => [
    index,
    record.textureID >>> 0,
    ...record.vertices.flatMap((v) => [
      floatBits(v.x),
      floatBits(v.y),
      floatBits(v.z),
      null,
      floatBits(v.u),
      floatBits(v.v),
    ]),
  ]);
const ordered = (v) => {
  const word = floatBits(v);
  return word & 0x80000000 ? ~word >>> 0 : word + 0x80000000;
};
function compareVertices(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (const [i, v] of actual.entries())
    for (const key of ['x', 'y', 'z', 'w', 'u', 'v', 'color']) {
      if (key === 'color') assert.equal(v[key] >>> 0, expected[i][key] >>> 0);
      else
        assert(
          Math.abs(ordered(v[key]) - ordered(expected[i][key])) <= 1,
          `vertex${i}.${key}: ${v[key]} vs ${expected[i][key]}`,
        );
    }
}
function observe(world) {
  const packets = [],
    send = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = async (target, sender, message, w, l, context = {}) => {
    if (message !== 83) return send(target, sender, message, w, l, context);
    const originalBytes = context.payload.bytes,
      bytes = originalBytes.bind(context.payload),
      record = { count: w, reads: 0 };
    context.payload.bytes = (at, size) => {
      record.reads++;
      const data = bytes(at, size),
        view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      record.words = Array.from({ length: data.length / 4 }, (_, i) => {
        const f = i % 20;
        return f >= 2 && (f - 2) % 6 === 3 ? null : view.getUint32(i * 4, true);
      });
      return data;
    };
    try {
      const reply = await send(target, sender, message, w, l, context);
      assert.equal(reply, NATIVE_UNWRITTEN_WORD, 'actual .23 receiver output remains unwritten');
      packets.push(record);
      return reply;
    } finally {
      context.payload.bytes = originalBytes;
    }
  };
  return packets;
}
for (const [key, evidence] of Object.entries(golden.cases))
  test(`SDK23 ${key} real VM retains divided models and consumes the near word through cold`, async (t) => {
    const init = evidence.initialSource.flatMap((word, i) => [
        [37, word],
        [38, 1024 + i * 4],
      ]),
      files = {
        'case.kcs': kcsProgram([[37, 240], [43, 71, 4], [59]]),
        'mesh.kcs': kcsProgram(
          [
            [37, marker],
            ...init,
            ...evidence.rows.flatMap((row) =>
              row.render
                ? []
                : [
                    ...(row.code ?? [
                      ...row.args.map((v, i) => [37, row.id === 66 && i === 1 ? [0x13, 88] : v]),
                      [43, row.id, row.args.length * 4],
                      ...(row.resultAddress === undefined ? [] : [[38, row.resultAddress]]),
                    ]),
                    [43, 65, 0],
                  ],
            ),
            [37, 240],
            [43, 71, 4],
            [59],
          ],
          [[256, 'Mesh']],
        ),
      },
      world = await dataWorld(golden.profile, files, configuration(evidence));
    t.after(() => world.close({ flushFiles: false }));
    world.graphics.createLogicalDevice();
    const task = await world.spawnScript('mesh.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      floor = task.machine.sp;
    task.machine.store(88, world.nativeTaskID(world.main.id));
    const packets = observe(world);
    const step = async (current, caller, row, trace) => {
      const m = caller.machine,
        previous = plane(current, m)?.graph;
      trace.length = 0;
      if (!row.render) await current.runtime.scheduler.execute(caller);
      else await current.objects.drawTick(evidence.rows.indexOf(row));
      assert.equal(m.sp, floor + 4, row.label + ' stack');
      assert.equal(m.load(floor), marker);
      assert.equal(
        current.graphics.cameraNearWord,
        row.nearWord,
        row.label + ' exact manager near word',
      );
      assert.deepEqual(
        Array.from({ length: 32 }, (_, i) => m.load(1024 + i * 4)),
        row.source,
        row.label + ' current VM source',
      );
      const actual = plane(current, m)?.graph;
      assert.equal(
        actual?.mesh?.length ?? 0,
        row.modelCount,
        row.label + ' actual retained model count',
      );
      if (actual)
        assert.deepEqual(
          modelWords(actual.mesh),
          row.mesh,
          row.label + ' original private model copy',
        );
      if (row.label.startsWith('existing-key-') || row.label.startsWith('edit-source'))
        assert.equal(
          actual,
          previous,
          row.label + ' occupied registration preserves actual model identity',
        );
      assert.deepEqual(
        trace.map((p) => ({ count: p.count, definedWords: p.words })),
        row.packets,
        row.label + ' real wrapper packet',
      );
      assert(
        trace.every((p) => p.reads > 0),
        'even rejected registration consumes its constructed candidate',
      );
      if (row.draws.length) {
        const draws = [];
        await plane(current, m).drawGPU({
          drawGeometry: (geometry, frame) => draws.push({ geometry, frame }),
        });
        assert.equal(draws.length, row.draws.length, row.label + ' shared renderer draw packets');
        for (const [i, draw] of draws.entries()) {
          const expected = row.draws[i];
          compareVertices(
            draw.geometry.flatMap((t) => t.vertices),
            expected.vertices,
          );
          assert.deepEqual(
            [draw.frame.width, draw.frame.height],
            [expected.texture.width, expected.texture.height],
          );
          assert.deepEqual(
            [...draw.frame.rgba],
            expected.texture.rgba ?? expected.texture.first8x8,
            evidence.startup
              ? 'configured page bytes/alpha match the original COM memory texture'
              : 'defined unconfigured-page fallback; not proof of uploaded texture sampling',
          );
        }
      }
      if (row.pageCount !== undefined && current.graphics.texturePages)
        assert.equal(
          nativeTexturePageSummary(current.graphics.texturePages).pages,
          row.pageCount,
          row.label + ' actual configured page release/allocation',
        );
      if (['release-upload-source', 'release-replacement-upload'].includes(row.label))
        assert.equal(
          current.runtime.handles.records.has(m.load(64)),
          false,
          'actual Script bitmap release',
        );
    };
    const retire = async (current, caller) => {
      const id = plane(current, caller.machine).record.id;
      await current.objects.tick(500);
      assert.equal(current.objects.objects.has(id), false);
      assert.equal(current.graphics.tasks.has(id), false);
    };
    for (const [i, row] of evidence.rows.entries()) {
      await step(world, task, row, packets);
      if (
        [
          'mesh-two',
          'render-same-mesh-near500',
          'mesh-two-texture-selectors',
          'render-retained-model-new-page',
        ].includes(row.label)
      ) {
        const fresh = await dataWorld(golden.profile, files, {
          initialize: false,
          ...configuration(evidence),
        });
        fresh.graphics.createLogicalDevice();
        try {
          await fresh.restore(structuredClone(world.snapshot()));
          const caller = fresh.runtime.scheduler.tasks.get(task.id),
            trace = observe(fresh);
          for (const next of evidence.rows.slice(i + 1)) await step(fresh, caller, next, trace);
          await retire(fresh, caller);
        } finally {
          await fresh.close({ flushFiles: false });
        }
      }
    }
    await retire(world, task);
  });
test('SDK23 view/mesh keeps unreviewed mode, receiver and vertex record shapes protected', async (t) => {
  const code = kcsProgram(
      [
        ...[2, 6].flatMap((kind, i) => [
          [37, kind],
          [37, [0x13, 88]],
          [37, 256],
          [43, 66, 12],
          [38, 32 + 4 * i],
        ]),
        [37, 240],
        [43, 71, 4],
        [59],
      ],
      [[256, 'Actual guarded Plane']],
    ),
    world = await dataWorld(golden.profile, { 'factory.kcs': code });
  t.after(() => world.close({ flushFiles: false }));
  world.graphics.createLogicalDevice();
  const caller = await world.spawnScript('factory.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = caller.machine;
  m.store(88, world.nativeTaskID(world.main.id));
  await world.runtime.scheduler.execute(caller);
  golden.cases.flat.initialSource.forEach((word, i) => m.store(1024 + 4 * i, word));
  const call = async (id, args) => world.runtime.native('main', id, args, m, caller),
    target = m.load(32),
    foreign = m.load(36);
  await assert.rejects(call(12, []), /expects one argument/);
  await assert.rejects(call(12, [floatBits(-1)]), /positive finite/);
  await assert.rejects(call(467, [foreign, 1024, 1]), /reviewed Plane receiver/);
  await assert.rejects(call(467, [target, 1024, 0]), /positive record count/);
  m.store(1028, 0x7fc00000);
  await assert.rejects(call(467, [target, 1024, 1]), /finite vertex/);
  world.graphics.view.configure({ active: false });
  await assert.rejects(call(12, [floatBits(1000)]), /initialized mode1/);
  assert.equal(plane(world, m).graph, null, 'no protected shape publishes a model');
  assert.equal(world.graphics.cameraNearWord, floatBits(1000));
});

// Native provider lookup checks its unsigned bound and missing page before the
// same no-texture binding observed in the original default-grid fixture.
for (const missing of [false, true])
  test(`SDK23 actual VM uses the defined white fallback for ${missing ? 'an unallocated page' : 'an unsigned index outside the grid'}`, async (t) => {
    const source = golden.cases.flat.initialSource.slice(0, 16);
    source[0] = missing ? 0 : 0xffffffff;
    const code = kcsProgram(
        [
          ...source.flatMap((word, i) => [
            [37, word],
            [38, 1024 + i * 4],
          ]),
          [37, 2],
          [37, [0x13, 88]],
          [37, 256],
          [43, 66, 12],
          [38, 32],
          [37, [0x13, 32]],
          [37, 1024],
          [37, 1],
          [43, 467, 12],
          [37, [0x13, 32]],
          [37, 1],
          [43, 92, 8],
          [43, 65, 0],
          [59],
        ],
        [[256, 'Fallback Plane']],
      ),
      startup = missing
        ? parseNativeXML(
            Buffer.from(
              '<?xml version="1.0" encoding="Shift_JIS"?><document><TEXTURE><vt><x>1</x><y>1</y></vt></TEXTURE></document>',
            ),
          )
        : undefined,
      world = await dataWorld(golden.profile, { 'fallback.kcs': code }, { startup });
    t.after(() => world.close({ flushFiles: false }));
    world.graphics.createLogicalDevice();
    const caller = await world.spawnScript('fallback.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    caller.machine.store(88, world.nativeTaskID(world.main.id));
    await world.runtime.scheduler.execute(caller);
    const model = plane(world, caller.machine),
      frames = [];
    assert.equal(model.graph.mesh[0].textureID >>> 0, source[0]);
    await model.drawGPU({ drawGeometry: (_geometry, frame) => frames.push(frame) });
    assert.equal(frames.length, 1);
    assert.deepEqual(
      [frames[0].width, frames[0].height, ...frames[0].rgba],
      [1, 1, 255, 255, 255, 255],
    );
  });
