// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-areas-golden.json', import.meta.url)),
  ),
  profile = golden.profile,
  marker = 0x61726533;
const init = [];
golden.rows[0].matrix.forEach((word, i) => init.push([37, word], [38, 1664 + i * 4]));
const files = {
  'case.kcs': kcsProgram([[37, 240], [43, 71, 4], [59]]),
  'areas.kcs': kcsProgram(
    [
      [37, marker],
      ...init,
      ...golden.rows.flatMap((row) =>
        row.update
          ? [[43, 65, 0]]
          : [
              ...(row.code ?? [
                ...row.args.map((arg, i) => [37, row.id === 66 && i === 1 ? [0x13, 88] : arg]),
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
    [[256, 'Actual area']],
  ),
  'cleanup.kcs': kcsProgram([
    [37, [0x13, 88]],
    [43, 67, 4],
    [43, 65, 0],
    [37, 240],
    [43, 71, 4],
    [59],
  ]),
};
const areaAt = (world, m, slot) =>
  [...world.areaEffects.tasks.values()].find((area) => area.record.nativeID === m.load(slot));
function observe(world) {
  const events = [],
    uploads = [],
    matrices = [],
    send = world.sendNativeEngine.bind(world),
    output = world.graphics.output.bind(world.graphics);
  world.sendNativeEngine = async (target, sender, message, w, l, context = {}) => {
    const record = world.objects.objects.get(world.resolveTaskID(target, sender));
    let event;
    if (
      record &&
      [0, 26, 27].includes(record.kind) &&
      [13, 258, 260, 262, 274, 275].includes(message)
    ) {
      event = {
        kind: record.kind,
        message,
        replyWritten: false,
        reply: null,
        matrix:
          message === 262
            ? [...new Uint32Array(context.payload.bytes(0, 64).slice().buffer)]
            : null,
        unhandled: message === 262,
      };
      events.push(event);
      if (message === 262) matrices.push({ payload: context.payload, words: event.matrix });
    }
    const reply = await send(target, sender, message, w, l, context);
    if (event) {
      event.replyWritten = reply !== NATIVE_UNWRITTEN_WORD;
      if (event.replyWritten) event.reply = reply;
      assert.equal(context.nativeUnhandled, event.unhandled, 'actual receiver handled state');
    }
    return reply;
  };
  world.graphics.output = async (bitmap, offset, region, ...options) => {
    const frame = await bitmap.frame(),
      area = region ?? [0, 0, bitmap.width, bitmap.height];
    uploads.push({
      args: [
        ...area.slice(0, 2),
        area[2] - area[0],
        area[3] - area[1],
        offset[0] + area[0],
        offset[1] + area[1],
      ],
      frame: { width: frame.width, height: frame.height, rgba: [...frame.rgba] },
    });
    return output(bitmap, offset, region, ...options);
  };
  return { events, uploads, matrices };
}
async function compare(world, task, row, floor) {
  const m = task.machine;
  assert.equal(m.sp, floor + 4, row.label + ' stack');
  assert.equal(m.load(floor), marker, row.label + ' marker');
  assert.deepEqual(
    Array.from({ length: 16 }, (_, i) => m.load(1664 + i * 4)),
    row.matrix,
    row.label + ' VM matrix source',
  );
  for (const [slot, key] of [
    [32, 'wipe'],
    [36, 'fade'],
  ]) {
    const expected = row[key];
    if (!expected) continue;
    const area = areaAt(world, m, slot),
      s = area.state;
    assert.equal(s.initialized, expected.initialized, row.label + ' ' + key + ' initialized');
    assert.equal(s.active, expected.active, row.label + ' ' + key + ' active');
    for (const [field, reference] of [
      ['source', 'sourceSlot'],
      ['destination', 'destinationSlot'],
      ['mask', 'maskSlot'],
    ])
      assert.equal(
        s[field],
        expected[reference] === null ? 0 : m.load(expected[reference]),
        row.label + ' ' + key + ' ' + field,
      );
    if (expected.initialized) {
      for (const field of [
        'sourceOrigin',
        'destinationOrigin',
        'output',
        'duration',
        'width',
        'height',
        'start',
      ])
        assert.deepEqual(s[field], expected[field], row.label + ' ' + key + ' ' + field);
      const frame = await world.graphics.images.get(s.work).frame();
      assert.deepEqual(
        { width: frame.width, height: frame.height, rgba: [...frame.rgba] },
        expected.work,
        row.label + ' ' + key + ' owned work pixels',
      );
    }
  }
  for (const b of row.bitmaps) {
    const handle = m.load(b.slot),
      bitmap = world.graphics.images.get(handle),
      frame = await bitmap.frame();
    assert.equal(bitmap.owner, task.id, row.label + ' actual creator ownership');
    assert.equal(
      [...world.runtime.handles.records.values()].filter(
        ({ type, value }) => type === 'bitmap' && value.dataHandle === bitmap.dataHandle,
      ).length,
      b.refs,
      row.label + ' no bitmap retain or alias',
    );
    assert.deepEqual(
      { width: frame.width, height: frame.height, rgba: [...frame.rgba] },
      b.frame,
      row.label + ' borrowed input remains unchanged',
    );
  }
}
async function retire(world, task) {
  const m = task.machine,
    areaIDs = [32, 36].map((slot) => areaAt(world, m, slot).record.id),
    base = [...world.objects.objects.values()].find(
      (record) => record.kind === 0 && record.nativeID === m.load(40),
    ),
    works = [32, 36].map((slot) => areaAt(world, m, slot).state.work),
    owners = [64, 68, 72, 76, 80].map((slot) => m.load(slot));
  areaIDs.push(base.id);
  await world.objects.tick(500);
  assert(
    areaIDs.every((id) => !world.objects.objects.has(id)),
    'actual Area/Base destruction',
  );
  assert(
    works.every((handle) => !world.runtime.handles.records.has(handle)),
    'owned work released',
  );
  assert(
    owners.every((handle) => world.runtime.handles.records.has(handle)),
    'borrowed inputs stay alive',
  );
  const cleanup = await world.spawnScript('cleanup.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  cleanup.machine.store(88, world.nativeTaskID(task.id));
  await world.runtime.scheduler.execute(cleanup);
  await world.objects.tick(600);
  assert.equal(world.objects.objects.has(task.id), false);
  assert(
    owners.every((handle) => !world.runtime.handles.records.has(handle)),
    'actual creator Script releases all input owners',
  );
}
test('SDK23 areas3 follows real factory GCALLs, local copy, live replacement and independent cold', async (t) => {
  const world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  await world.objects.tick(0); // Match the original fixture's initial Base clock through its normal logic walk.
  const task = await world.spawnScript('areas.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    floor = task.machine.sp;
  task.machine.store(88, world.nativeTaskID(world.main.id));
  const observer = observe(world);
  const step = async (current, caller, row, trace) => {
    trace.events.length = trace.uploads.length = 0;
    const before =
      row.id === 199
        ? [...current.areaEffects.tasks.values()].map((area) => area.snapshot())
        : null;
    if (row.update) {
      await current.objects.tick(row.update);
      await current.objects.drawTick(row.update);
    } else await current.runtime.scheduler.execute(caller);
    await compare(current, caller, row, floor);
    assert.deepEqual(trace.events, row.events, row.label + ' receiver replies and knownness');
    assert.deepEqual(trace.uploads, row.uploads, row.label + ' physical output packets/pixels');
    if (before)
      assert.deepEqual(
        [...current.areaEffects.tasks.values()].map((area) => area.snapshot()),
        before,
        'copied matrix is unhandled, not a numerical transform',
      );
    if (row.label === 'modify-matrix-source') {
      const copied = trace.matrices.at(-1);
      assert.deepEqual(
        [...new Uint32Array(copied.payload.bytes(0, 64).slice().buffer)],
        copied.words,
        'local copy remains isolated from subsequent VM writes',
      );
      assert.notDeepEqual(copied.words, row.matrix);
    }
    if (row.uploads.length) {
      const last = row.uploads.at(-1).frame,
        vram = current.graphics.images.get(current.graphics.vramHandle),
        pixels = await vram.pixels();
      for (let y = 0; y < last.height; y++)
        assert.deepEqual(
          [...pixels.slice(y * vram.width * 4, (y * vram.width + last.width) * 4)],
          last.rgba.slice(y * last.width * 4, (y + 1) * last.width * 4),
          'ordinary VRAM output row',
        );
    }
  };
  for (const [i, row] of golden.rows.entries()) {
    await step(world, task, row, observer);
    if (['initialize-fade', 'replace-fade-live'].includes(row.label)) {
      const fresh = await dataWorld(profile, files, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        const caller = fresh.runtime.scheduler.tasks.get(task.id),
          trace = observe(fresh);
        await compare(fresh, caller, row, floor);
        for (const next of golden.rows.slice(i + 1)) await step(fresh, caller, next, trace);
        await retire(fresh, caller);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  await retire(world, task);
});
test('SDK23 area admission keeps raw236 pure-copy and scopes every new message mapping', () => {
  for (const id of [198, 199, 202]) {
    const e = nativeABI(profile).tables.main.entries[id];
    assert.equal(e.status, 'recovered');
    assert.equal(e.signature.review, 'reviewed');
    assert.deepEqual(e.controlCodes, [2]);
    assert.equal(e.signature.resultWritten, false);
  }
  for (const [channel, raw, canonical, kind] of [
    ['area', 234, 260, 26],
    ['area', 234, 260, 27],
    ['area', 236, 262, 26],
    ['area', 236, 262, 27],
    ['area', 249, 275, 27],
    ['base', 236, 262, 0],
  ]) {
    assert.equal(mapABIMessage(profile, channel, 'raw', canonical, kind), raw);
    assert.equal(mapABIMessage(profile, channel, 'canonical', raw, kind), canonical);
  }
  for (const [channel, message, kind] of [
    ['area', 260, 0],
    ['area', 262, 2],
    ['area', 275, 26],
    ['base', 262, 26],
  ])
    assert.throws(
      () => mapABIMessage(profile, channel, 'raw', message, kind),
      /Unreviewed ABI message/,
    );
});
test('SDK23 area wrappers guard unreviewed receivers and unwritten kind replies before consuming packets', async (t) => {
  const factory = kcsProgram(
    [
      ...[
        [0, 32],
        [2, 36],
        [17, 40],
      ].flatMap(([kind, slot]) => [
        [37, kind],
        [37, [0x13, 88]],
        [37, 256],
        [43, 66, 12],
        [38, slot],
      ]),
      [37, 240],
      [43, 71, 4],
      [59],
    ],
    [[256, 'Actual typed receiver']],
  );
  const world = await dataWorld(profile, { 'factory.kcs': factory });
  t.after(() => world.close({ flushFiles: false }));
  const caller = await world.spawnScript('factory.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = caller.machine;
  m.store(88, world.nativeTaskID(world.main.id));
  await world.runtime.scheduler.execute(caller);
  const call = (id, args) => world.runtime.native('main', id, args, m, caller),
    base = m.load(32),
    graph = m.load(36),
    empty = m.load(40);
  // A normal query establishes the caller's persistent opaque reply identity.
  assert.deepEqual(await call(202, [base, 0]), { control: 2 });
  const before = world.snapshot();
  await assert.rejects(call(198, []), /expects 1 argument words/);
  await assert.rejects(call(199, [graph, 0]), /requires a reviewed receiver/);
  await assert.rejects(call(198, [base]), /requires a reviewed receiver/);
  await assert.rejects(call(202, [empty, 0]), /query did not write/);
  assert.deepEqual(
    await call(202, [base, 0]),
    { control: 2 },
    'written Base kind takes the original early return',
  );
  assert.deepEqual(
    world.snapshot(),
    before,
    'protected shapes and the Base early return do not mutate task or packet state',
  );
});
