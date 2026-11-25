// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { readKCS, nativeReply } from '../../src/kcs.mjs';
import { MotionInstance } from '../../src/motion/instance.mjs';
import { kcsProgram } from '../helpers.mjs';
import { dataWorld } from './data-world.mjs';

const decode = (regions) =>
  Object.fromEntries(
    Object.entries(regions).map(([key, bytes]) => [
      key,
      new Uint8Array(inflateSync(Buffer.from(bytes, 'base64'))),
    ]),
  );

function comparable(state) {
  const identities = new Map();
  const visit = (value) => {
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'memoryID') {
        if (!identities.has(child)) identities.set(child, identities.size + 1);
        value[key] = identities.get(child);
      } else visit(child);
    }
  };
  const result = structuredClone(state);
  visit(result);
  return result;
}

function program(input, id) {
  return kcsProgram([
    ...(input.sentinel ? [[37, 0x36eb67a5]] : []),
    ...input.declared.map((word) => [37, word]),
    [43, id, input.declared.length * 4],
    [59],
  ]);
}

function seed(machine, before) {
  machine.allocate(before.block.length);
  machine.memory.set(before.local);
  machine.shared.set(before.shared);
  machine.blockBytes(0).set(before.block);
}

function regions(machine, matrix) {
  return {
    local: machine.memory.slice(),
    shared: machine.shared.slice(),
    block: machine.blockBytes(0).slice(),
    matrix: matrix.slice(),
  };
}

function copyReply(machine, matrix, input, after) {
  machine.memory.set(after.local);
  machine.shared.set(after.shared);
  machine.blockBytes(0).set(after.block);
  matrix.set(after.matrix);
  return nativeReply(input.control, input.value);
}

export async function modernGeometryVM(profile, input, physicalReplay = false) {
  const before = decode(input.before),
    after = decode(input.after),
    script = await readKCS(program(input, input.id)),
    make = () => {
      const calculations = { matrix: before.matrix.slice() };
      return { calculations, owner: new MotionInstance(script, { profile, calculations }) };
    },
    firstOwner = make();
  seed(firstOwner.owner.machine, before);
  let reply,
    callCount = 0;
  const install = (bundle, first = false) => {
    const { owner, calculations } = bundle,
      native = owner.native.bind(owner);
    owner.native = (id, args, machine) => {
      callCount++;
      assert.equal(id, input.id);
      if (first) {
        assert.deepEqual(args, input.declared);
        assert.deepEqual(
          regions(machine, calculations.matrix),
          before,
          'exact original caller bytes',
        );
      }
      if (first && physicalReplay) {
        owner.calls.set(id, (owner.calls.get(id) ?? 0) + 1);
        reply = copyReply(machine, calculations.matrix, input, after);
      } else reply = native(id, args, machine);
      if (first) {
        assert.equal(reply.control, input.control);
        assert.equal(reply.value, input.value);
        assert.deepEqual(regions(machine, calculations.matrix), after, 'all physical output bytes');
      }
      first = false;
      return reply;
    };
  };
  install(firstOwner, true);
  firstOwner.owner.run();
  const snapshot = (bundle) =>
      comparable({ ...bundle.owner.snapshot(), matrix: bundle.calculations.matrix }),
    first = snapshot(firstOwner),
    saved = firstOwner.owner.snapshot(),
    fresh = make();
  fresh.owner.restore(saved);
  fresh.calculations.matrix.set(firstOwner.calculations.matrix);
  assert.deepEqual(snapshot(fresh), first, 'cold restore preserves raw operand and owner bytes');
  install(fresh);
  // Each authored invocation supplies the same mapped argv storage. Operand
  // buffers and logical state carry forward; omitted argv words are reseeded.
  for (const bundle of [fresh, firstOwner])
    input.args.forEach((word, i) =>
      bundle.owner.machine.store(script.data.length + (input.sentinel ? 4 : 0) + i * 4, word),
    );
  fresh.owner.run();
  firstOwner.owner.run();
  const cold = snapshot(fresh);
  assert.deepEqual(
    cold,
    snapshot(firstOwner),
    'complete independent cold and warm MOT continuation',
  );
  return { first, cold, callCount };
}

export async function modernMainGeometryVM(profile, input, physicalReplay = false, cold = false) {
  assert.notEqual(input.mainId, null);
  const before = decode(input.before),
    after = decode(input.after),
    files = {
      'case.kcs': program(input, input.mainId),
      'continuation.kcs': kcsProgram([[37, 0xffffffff], [43, 350, 4], [59]]),
    },
    world = await dataWorld(profile, files, { initialize: false });
  let fresh;
  try {
    world.clock.restore({
      elapsed: { numerator: 0n, denominator: 1n },
      utcOrigin: { numerator: 1790000000000n, denominator: 1n },
    });
    world.calculations.matrix.set(before.matrix);
    const add = world.runtime.scheduler.add.bind(world.runtime.scheduler);
    world.runtime.scheduler.add = (...args) => {
      const task = add(...args);
      seed(task.machine, before);
      return task;
    };
    const native = world.runtime.native.bind(world.runtime);
    let firstCall = true;
    world.runtime.native = (table, id, args, machine, task, scheduler) => {
      if (!firstCall) return native(table, id, args, machine, task, scheduler);
      firstCall = false;
      assert.equal(table, 'main');
      assert.equal(id, input.mainId);
      assert.deepEqual(args, input.declared);
      let reply;
      if (physicalReplay) {
        world.runtime.calls.set(`main:${id}`, 1);
        reply = copyReply(machine, world.calculations.matrix, input, after);
      } else reply = native(table, id, args, machine, task, scheduler);
      assert.equal(reply.control, input.control);
      assert.equal(reply.value, input.value);
      const actual = regions(machine, world.calculations.matrix);
      assert.deepEqual(
        actual.shared.subarray(before.shared.length),
        new Uint8Array(actual.shared.length - before.shared.length),
        'unused Main shared bytes stay exact',
      );
      actual.shared = actual.shared.subarray(0, before.shared.length);
      assert.deepEqual(
        actual,
        after,
        'own identical Main wrapper retains every original output byte',
      );
      return reply;
    };
    await world.initialize('case.kcs');
    world.runtime.scheduler.add = add;
    const first = comparable(world.snapshot());
    if (!cold) return { first };
    fresh = await dataWorld(profile, files, { initialize: false });
    await fresh.restore(world.snapshot());
    assert.deepEqual(comparable(fresh.snapshot()), first, 'complete World geometry cold state');
    for (const current of [world, fresh]) {
      const task = await current.runtime.scheduler.spawn('continuation.kcs', { abi: 'main' });
      await current.runtime.scheduler.execute(task);
    }
    const continued = comparable(fresh.snapshot());
    assert.deepEqual(
      continued,
      comparable(world.snapshot()),
      'real Main GCALL after cold World restore',
    );
    return { first, cold: continued };
  } finally {
    if (fresh) await fresh.close();
    await world.close();
  }
}

export async function modernMainYawPitchRollVM(profile, input, mode = 'exact') {
  const declared =
      mode === 'mapped'
        ? []
        : mode === 'short'
          ? input.args.slice(0, -1)
          : mode === 'tail'
            ? [...input.args, 0x7f800001, 0xdeadbeef]
            : input.args,
    bytes = kcsProgram([
      [37, 0x36eb67a5],
      ...declared.map((word) => [37, word]),
      [43, input.id, declared.length * 4],
      [59],
    ]),
    world = await dataWorld(profile, { 'case.kcs': bytes }, { initialize: false });
  try {
    const add = world.runtime.scheduler.add.bind(world.runtime.scheduler);
    world.runtime.scheduler.add = (...args) => {
      const task = add(...args);
      input.args.forEach((word, i) =>
        task.machine.store(task.machine.script.data.length + 4 + i * 4, word),
      );
      return task;
    };
    await world.initialize('case.kcs');
    const machine = world.main.machine;
    assert.deepEqual(
      Array.from({ length: 16 }, (_, i) => machine.load(64 + i * 4)),
      input.words,
    );
    assert.equal(world.runtime.calls.get('main:662'), 1);
    assert.deepEqual(world.calculations.matrix, new Uint8Array(64));
    assert.equal(machine.pop(), 0x36eb67a5, 'Main662 continues without a stack result');
  } finally {
    await world.close();
  }
}
