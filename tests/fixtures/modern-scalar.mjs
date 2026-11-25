// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readKCS, nativeReply } from '../../src/kcs.mjs';
import { MotionInstance } from '../../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../../src/ppi/script.mjs';
import { kcsProgram } from '../helpers.mjs';
import { dataWorld } from './data-world.mjs';

function comparable(state) {
  const result = structuredClone(state);
  delete result.machine.memoryID;
  return result;
}

export async function modernScalarVM(profile, table, input, physical = false, mode = 'exact') {
  const id = input[table === 'main' ? 'main' : table === 'generic' ? 'generic' : 'particle'],
    declared =
      mode === 'mapped'
        ? []
        : mode === 'short'
          ? input.args.slice(0, -1)
          : mode === 'tail'
            ? [...input.args, 0x7f800001, 0xdeadbeef]
            : input.args,
    program = kcsProgram([
      [37, 0x36eb67a5],
      ...declared.map((word) => [37, word]),
      [43, id, declared.length * 4],
      [59],
    ]),
    seed = (machine) => {
      // The first pushed word is the sentinel. Subsequent mapped words are
      // native argv storage even when GCALL declares a shorter argument list.
      input.args.forEach((word, i) => machine.store(machine.script.data.length + 4 + i * 4, word));
    };
  let reply,
    callCount = 0;
  const invoke = (apply, args, machine) => {
    callCount++;
    assert.deepEqual(args, declared);
    const before = machine.snapshot();
    reply = physical ? nativeReply(1, input.value) : apply();
    assert.deepEqual(machine.snapshot(), before, 'pure scalar callee preserves VM bytes/state');
    assert.equal(reply.control, 1);
    assert.equal(reply.value, input.value, input.name);
    return reply;
  };
  if (table === 'main') {
    const world = await dataWorld(profile, { 'case.kcs': program }, { initialize: false });
    try {
      const native = world.runtime.native.bind(world.runtime);
      const add = world.runtime.scheduler.add.bind(world.runtime.scheduler);
      world.runtime.scheduler.add = (...args) => {
        const task = add(...args);
        seed(task.machine);
        return task;
      };
      world.runtime.native = (kind, nativeID, args, machine, task, scheduler) => {
        assert.equal(kind, 'main');
        assert.equal(nativeID, id);
        if (physical) world.runtime.calls.set(`main:${id}`, 1);
        return invoke(() => native(kind, nativeID, args, machine, task, scheduler), args, machine);
      };
      await world.initialize('case.kcs');
      return comparable({
        reply,
        callCount,
        machine: world.main.machine.snapshot(),
        matrix: world.calculations.matrix,
        handles: world.runtime.handles.snapshot(),
        calls: [...world.runtime.calls],
        events: world.runtime.scheduler.events,
      });
    } finally {
      await world.close();
    }
  }
  const script = await readKCS(program);
  if (table !== 'generic') script.scriptVersion = table === 'particle-v1' ? 0x10000 : 0x20000;
  const make = () =>
      table === 'generic'
        ? new MotionInstance(script, { profile })
        : new ParticleScriptInstance(script, {
            profile,
            count: 1,
            width: 64,
            height: 32,
            screenWidth: 800,
            screenHeight: 600,
            shared: new Uint8Array(64).fill(0xb5),
          }),
    install = (owner) => {
      const native = owner.native.bind(owner);
      owner.native = (nativeID, args, machine) => {
        assert.equal(nativeID, id);
        if (physical) owner.calls.set(id, (owner.calls.get(id) ?? 0) + 1);
        return invoke(() => native(nativeID, args, machine), args, machine);
      };
    },
    run = (owner, frame) => {
      seed(owner.machine);
      if (table === 'generic') {
        owner.machine.start();
        owner.run();
      } else owner.update(frame);
      assert.equal(owner.machine.pop(), input.value);
      assert.equal(owner.machine.pop(), 0x36eb67a5);
      return comparable(owner.snapshot());
    },
    owner = make();
  install(owner);
  const first = run(owner, 3),
    saved = owner.snapshot(),
    fresh = make();
  fresh.restore(saved);
  install(fresh);
  const cold = run(fresh, 4),
    warm = run(owner, 4);
  assert.deepEqual(cold, warm, 'new owner cold restore retains the complete scalar lifecycle');
  return { reply, callCount, first, cold };
}

export async function unmappedModernScalar(profile, table, id) {
  const program = kcsProgram([[49, 4095], [43, id, 0], [59]]);
  if (table === 'main') {
    const world = await dataWorld(profile, { 'case.kcs': program }, { initialize: false });
    try {
      await assert.rejects(world.initialize('case.kcs'), /KCS memory 1fff\+4/);
    } finally {
      await world.close();
    }
    return;
  }
  const script = await readKCS(program);
  script.scriptVersion = table === 'particle-v1' ? 0x10000 : 0x20000;
  const owner =
    table === 'generic'
      ? new MotionInstance(script, { profile })
      : new ParticleScriptInstance(script, {
          profile,
          count: 1,
          width: 64,
          height: 32,
          screenWidth: 800,
          screenHeight: 600,
        });
  assert.throws(() => (table === 'generic' ? owner.run() : owner.update(1)), /KCS memory 1fff\+4/);
}
