// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESCommonCommands } from '../src/native/fes-common-commands.mjs';
import { FESObjectGraph } from '../src/native/fes-object-graph.mjs';
import { FESMotionDriver, createFESMotionTarget } from '../src/native/fes-motion-driver.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { evaluateNativeExpression } from '../src/native/expression.mjs';
import { initializeFESControl } from '../src/native/fes-control-model.mjs';
import { FESLogModel, initializeFESLog } from '../src/native/fes-log-model.mjs';
import { FESImageTable } from '../src/native/fes-image-table-model.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { MotionTarget } from '../src/motion/target.mjs';
import { initialMotionObject, MOTION_ABI } from '../src/motion/abi.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

function image(index, extra = {}) {
  return {
    key: `items[${index}]`,
    baseName: 'items',
    index,
    nativeType: 2,
    x: 11.75 + index,
    y: -12.75 - index,
    z: 0,
    imageOriginX: 0,
    imageOriginY: 0,
    baseX: 0,
    baseY: 0,
    width: 16,
    height: 8,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 255,
    pri: 20,
    renderID: 0,
    disp: false,
    displayValue: 0,
    displayDelta: 0,
    enable: true,
    motionDelay: 0,
    ...extra,
  };
}
function fixture(objects = [image(0), image(1), image(2)]) {
  const graph = new FESObjectGraph();
  for (const object of objects)
    if (object) {
      object.handle = graph.allocateHandle();
      graph.register(object);
    }
  const bank = new NativeVariableBank();
  bank.initialize(32);
  bank.registerContext('fes');
  const evaluations = [],
    writes = [],
    specs = [],
    stops = [],
    removed = [],
    instance = {
      objects: objects.filter(Boolean),
      byKey: new Map(objects.filter(Boolean).map((o) => [o.key, o])),
      value(text) {
        evaluations.push(text);
        return evaluateNativeExpression(text, bank);
      },
    },
    collection = {
      count: () => objects.length,
      lookup: (_name, index) => (objects[index]?.deleted ? null : (objects[index] ?? null)),
      async remove(object) {
        for (const current of [...graph.postorder(object)]) {
          removed.push(current.key);
          graph.release(current);
        }
      },
    },
    motions = {
      async add(object, file, spec) {
        specs.push({ object, file, ...spec });
      },
      busy: (object) => !!object.busy,
      stop: (object) => {
        stops.push(object.key);
        object.motionDelay = 0;
      },
    },
    services = {
      collection,
      motions,
      writeGlobal(index, value) {
        writes.push([index, value]);
        bank.set(index, value);
      },
      reference(token) {
        const match = /^(.+?)(?:\[(.*)\])?$/.exec(token);
        if (!match) return null;
        const index = match[2] === undefined ? -1 : instance.value(match[2]);
        return {
          name: match[1],
          index: index === -1 && collection.count(match[1]) <= 1 ? 0 : index,
        };
      },
      bitmap: (object) => object.bitmap ?? null,
      table: (object) => object.table ?? null,
    },
    commands = new FESCommonCommands(instance, services),
    command = (verb, args = [], index = -1, context) =>
      commands.command(verb, { name: 'items', index }, args, context);
  return {
    instance,
    collection,
    motions,
    commands,
    command,
    bank,
    evaluations,
    writes,
    specs,
    stops,
    removed,
    objects,
    graph,
  };
}

test('group argument effects occur once before iteration, while each image pos preserves absent local components', async () => {
  const f = fixture();
  await f.command('pos', ['(#0)++']);
  assert.equal(f.bank.get(0), 1);
  assert.deepEqual(f.evaluations, ['(#0)++']);
  assert.deepEqual(
    f.objects.map((o) => [o.x, o.y]),
    [
      [0, -12],
      [0, -13],
      [0, -14],
    ],
  );
  assert.deepEqual(
    f.specs.map((s) => [s.file, [...s.registers], s.group]),
    [
      ['pPos', [0, -12, 0], 0],
      ['pPos', [0, -13, 0], 0],
      ['pPos', [0, -14, 0], 0],
    ],
  );
  assert.notStrictEqual(f.specs[0].registers, f.specs[1].registers);
  await f.command('pri', ['(#1)++']);
  assert.equal(f.bank.get(1), 1);
  assert.deepEqual(
    f.objects.map((o) => [o.pri, o.renderID]),
    [
      [20, 0],
      [20, 0],
      [20, 0],
    ],
  );
  assert.equal(await f.command('unknown'), undefined);
});

test('original holes distinguish skip, stop, partial OR abort and later delete lookup', async () => {
  const first = image(0, { nativeType: 6, busy: true }),
    last = image(2, { nativeType: 6 }),
    f = fixture([first, null, last]);
  await f.command('enable', ['0']);
  assert.deepEqual([first.enable, last.enable], [false, false]);
  await f.command('disp', ['1']);
  assert.deepEqual([first.disp, last.disp], [true, false]);
  await f.command('pos', ['7']);
  assert.deepEqual([first.x, last.x], [7, 7]);
  await f.command('size', ['3', '4']);
  assert.deepEqual([first.width, last.width], [3, 16]);
  await f.command('delay', ['9']);
  assert.deepEqual([first.motionDelay, last.motionDelay], [9, 0]);
  await f.command('ismot', ['0']);
  assert.deepEqual(f.writes, [], 'a middle hole must not write a partial busy OR');
  await f.command('stop');
  assert.deepEqual(f.stops, [first.key, last.key]);
  f.graph.bind(last, first);
  await f.command('delete');
  assert.deepEqual(f.removed, [last.key, first.key]);
  assert.equal(last.deleted, true);
});

test('queries require an explicit live element, evaluate outputs before type gates and suppress only -1', async () => {
  const f = fixture([image(0, { bitmap: { state: { offsetX: -3, offsetY: 9 } } })]);
  await f.command('getpos', ['(#1)++']);
  assert.equal(f.bank.get(1), 0, 'whole-group query does not evaluate output tokens');
  await f.command('getpos', ['-2', '-1', '3'], 0);
  assert.deepEqual(f.writes, [
    [-2, 11],
    [3, 0],
  ]);
  assert.equal(f.bank.dirty, true, 'negative nonsentinel output still dirties the real bank');
  await f.command('getoffset', ['4', '5', '6'], 0);
  assert.deepEqual(f.writes.slice(-3), [
    [4, -3],
    [5, 9],
    [6, 0],
  ]);
  f.objects[0].nativeType = 33;
  f.evaluations.length = 0;
  f.writes.length = 0;
  await f.command('getsize', ['(#1)++', '2', '3'], 0);
  assert.equal(f.bank.get(1), 1);
  assert.deepEqual(f.evaluations, ['(#1)++', '2', '3']);
  assert.deepEqual(f.writes, [], 'M2/EFK getsize has no output branch');
});

test('clip evaluates present tokens in sequence and keeps int32 wrapping/type gates', async () => {
  const f = fixture();
  await f.command('clip', ['(#0)++', '2', '3'], 0);
  assert.equal(f.bank.get(0), 1);
  assert.equal(f.objects[0].clip, undefined);
  await f.command('clip', ['2147483647', '-2', '2', '-2147483647'], 0);
  assert.deepEqual(f.objects[0].clip, [2147483647, -2, -2147483647, 2147483647]);
  f.objects[0].nativeType = 16;
  await f.command('clip', ['0', '0', '1', '1'], 0);
  assert.deepEqual(f.objects[0].clip, [2147483647, -2, -2147483647, 2147483647]);
});

test('controls and LOG keep value/top semantics and LOG inner loops skip later holes', async () => {
  const control = initializeFESControl(image(0, { nativeType: 15 })),
    log = initializeFESLog(image(2, { nativeType: 24 })),
    last = initializeFESLog(image(4, { nativeType: 24 })),
    f = fixture([control, null, log, null, last]),
    source = { rows: Array.from({ length: 7 }) },
    logs = { get: () => source, remake() {} },
    models = new Map([log, last].map((o) => [o, new FESLogModel(o, logs, {})]));
  for (const model of models.values()) {
    model.object.count = 2;
    model.bind(1);
  }
  f.commands.logModel = (o) => models.get(o);
  await f.command('pos', ['3']);
  assert.deepEqual([control.value, log.top, last.top], [3, 3, 3]);
  await f.command('pri', ['-2'], 0);
  assert.deepEqual(
    [control.pri, control.planePriority],
    [18, 1000],
    'SLIDER common pri changes its biased image priority',
  );
  await f.command('pri', ['8'], 2);
  assert.equal(log.pri, 8);
  assert.equal(last.pri, 0, 'explicit command touches one element');
  // Start the group at a LOG and distinguish the original inner-loop behavior.
  f.objects.splice(0, 2);
  await f.command('pri', ['9']);
  assert.deepEqual([log.pri, last.pri], [9, 9]);
  assert.equal(control.valuePending, true);
  assert.equal(control.valueNotify, 0);
});

test('SCROLL common pri keeps its image priority and changes only its dedicated plane priority', async () => {
  const scroll = initializeFESControl(image(0, { nativeType: 13 })),
    scroll2 = initializeFESControl(image(1, { nativeType: 14 })),
    f = fixture([scroll, scroll2]);
  await f.command('pri', ['-2']);
  assert.deepEqual([scroll.pri, scroll.planePriority], [10, -2]);
  assert.deepEqual([scroll2.pri, scroll2.planePriority], [18, 1000]);
});

test('deferred copy/reference/base options preserve source lookup and raw table output rules', async () => {
  const f = fixture([image(0), image(1, { nativeType: 1 })]);
  await f.command('copy', ['source', '(#0)++', '2', '3', '4']);
  assert.equal(f.bank.get(0), 1);
  assert.deepEqual(f.objects[0].copyRequest, {
    name: 'source',
    index: 0,
    rectangle: Int32Array.of(0, 2, 3, 4),
  });
  assert.equal(f.objects[1].copyRequest, undefined, 'CIMAGE has no copy branch');
  await f.command('pl', ['planes']);
  assert.deepEqual(f.objects[0].planeReference, { name: 'planes', index: -1 });
  const table = new FESImageTable(17, Uint8Array.of(0x81, 0x9b, 44, 120, 44, 102, 111, 111));
  f.objects[0].nativeType = 17;
  f.objects[0].table = table;
  await f.command('exist', [], 0);
  assert.deepEqual(f.writes.at(-1), [0, 1]);
  await f.command('exist', ['-1', '0', '-1'], 0);
  assert.deepEqual(f.writes.at(-1), [-1, 0], 'exist does not use query sentinel suppression');
  await assert.rejects(f.command('exist'), /live explicit table element/);
  f.objects[1].nativeType = 20;
  f.objects[1].table = new FESImageTable(20, new Uint8Array());
  await f.command('baseopt', ['_alt']);
  assert.deepEqual([...f.objects[1].baseOption], [95, 97, 108, 116]);
});

test('blend carries the last plane RGB through a whole mixed group and executes pColor for supported types', async () => {
  const objects = [
      image(0),
      image(1, { nativeType: 4, color: 0xff123456 }),
      image(2),
      image(3, { nativeType: 13 }),
      image(4, { nativeType: 23, running: true }),
    ],
    f = fixture(objects);
  await f.command('blend', ['-3'], -1, { commandPointer: 0x30789abc });
  assert.deepEqual(
    f.specs.map((s) => [s.file, s.registers]),
    [
      ['pColor', [-3, 120, 154, 188]],
      ['pColor', [-3, 18, 52, 86]],
      ['pColor', [-3, 18, 52, 86]],
      ['pColor', [-3, 18, 52, 86]],
    ],
  );
  assert.equal(objects[0].alpha, 0xfffffffd);
  assert.equal(objects[1].color, 0xfd123456);
  assert.equal(objects[3].alpha, 255, 'SCROLL13 is excluded from this original command');
  assert.equal(objects[4].dirty, true);
  await f.command('ismot', ['2'], 4);
  assert.deepEqual(f.writes.at(-1), [2, 1]);
  objects[4].running = 4;
  await f.command('ismot', ['2'], 4);
  assert.deepEqual(f.writes.at(-1), [2, 4], 'PARTICLE contributes its raw busy word');
  await f.command('arc', ['-1', '90', '-180', '16777217', '-2']);
  assert.ok(f.specs.slice(-5).every((s) => s.registers[0] === 0 && s.registers[3] === 16777216));
});

const shared = (offset) => [0x13, (0x80000000 + offset) >>> 0];
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} pos runs a real MOT with delay and fresh target restore; external sound snapshot remains owned by its adapter`, async () => {
    const f = fixture([image(0)]),
      game = memoryGame({
        'ppos.kcs': kcsProgram([
          [21, shared(24), shared(156)],
          [21, shared(28), shared(160)],
          [21, shared(32), shared(164)],
          [43, 38, 0],
          [59],
        ]),
      });
    game.requireCategory = (name) => game.require(name + '.kcs');
    const library = new MotionLibrary(game, { profile }),
      targets = new Map(),
      targetFor = (o, create) => {
        if (!targets.has(o.handle) && create)
          targets.set(o.handle, createFESMotionTarget(library, f.instance, o));
        return targets.get(o.handle);
      },
      driver = new FESMotionDriver(f.graph, targetFor);
    f.commands.motions = driver;
    f.objects[0].motionDelay = 3;
    await f.command('pos', ['7', '-8'], 0);
    assert.equal(driver.busy(f.objects[0]), true);
    const saved = structuredClone(targetFor(f.objects[0]).snapshot()),
      fresh = createFESMotionTarget(library, f.instance, f.objects[0]);
    await fresh.restore(saved);
    targets.set(f.objects[0].handle, fresh);
    driver.update(f.objects[0], 10);
    assert.equal(driver.busy(f.objects[0]), true, 'actual MOT observes its delay');
    driver.update(f.objects[0], 13);
    assert.equal(driver.busy(f.objects[0]), false);
    assert.deepEqual([f.objects[0].x, f.objects[0].y], [7, -8]);
    const sound = { nativeType: 9, handle: f.graph.allocateHandle(), key: 'sound', motionDelay: 0 };
    f.graph.register(sound);
    const bytes = initialMotionObject(),
      view = new DataView(bytes.buffer);
    view.setUint32(MOTION_ABI.color, 0xaabbccdd, true);
    const external = new MotionTarget(library, {
        initialState: bytes,
        readState: () => bytes,
        writeState() {},
      }),
      soundDriver = new FESMotionDriver(f.graph, () => external);
    assert.strictEqual(soundDriver.prepare(sound), external);
    assert.equal(
      new DataView(external.manager.base.buffer).getUint32(MOTION_ABI.color, true),
      0xaabbccdd,
    );
  });
