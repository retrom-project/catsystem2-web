// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from '../helpers.mjs';
import { AuthoredClipboard } from './unicode-output-services.mjs';
import { vmMemory, vmState } from './native-differential.mjs';
export async function observeUnicodeOutput(input, oracleInvoke) {
  const game = memoryGame({ 'case.kcs': kcsProgram([[37, 256], [43, input.id, 4], [59]]) }),
    random = new ParticleRandom(),
    clipboard = Object.assign(new AuthoredClipboard(), input.clipboard),
    logs = [];
  const world = new NativeWorld({
    profile: input.profile,
    game,
    configuration: new NativeConfiguration({ profile: input.profile }),
    random,
    images: {},
    host: { nativeClipboard: clipboard, nativeDebugOutput: (bytes) => logs.push([...bytes]) },
    motionLibrary: new MotionLibrary(game, { profile: input.profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
  world.ensureNativeEngine = () => {
    throw Error('JS Unicode output attempted EXE initialization');
  };
  const add = world.runtime.scheduler.add.bind(world.runtime.scheduler);
  world.runtime.scheduler.add = (...args) => {
    const task = add(...args);
    for (const [address, words] of input.words)
      words.forEach((w, i) => task.machine.store(address + i * 4, w));
    return task;
  };
  const dispatch = world.runtime.native.bind(world.runtime),
    trace = [];
  let reply;
  world.runtime.native = async (table, id, args, machine, task, ...rest) => {
    assert.equal(table, 'main');
    assert.equal(id, input.id);
    assert.deepEqual(args, input.args);
    reply = oracleInvoke
      ? await oracleInvoke(world, args, machine, task)
      : await dispatch(table, id, args, machine, task, ...rest);
    trace.push({ table, id, args: [...args], control: reply.control });
    return reply;
  };
  try {
    await world.initialize('case.kcs');
    const scheduler = world.runtime.scheduler;
    return {
      control: reply.control,
      resultWritten: Object.hasOwn(reply, 'value'),
      value: reply.value,
      memory: vmMemory(world.main.machine),
      peWrites: [],
      handles: world.runtime.handles.snapshot(),
      tasks: {
        frame: scheduler.frame,
        nextID: scheduler.nextID,
        records: [...scheduler.tasks.values()].map((t) => ({
          id: t.id,
          status: t.status,
          parent: t.parent,
          context: structuredClone(t.context),
          machine: vmState(t.machine),
        })),
      },
      events: structuredClone(scheduler.events),
      nativeCalls: trace,
      effects: {
        clipboard: clipboard.events,
        contents: clipboard.contents,
        opened: clipboard.opened,
        logs,
      },
    };
  } finally {
    await world.close({ flushFiles: false });
  }
}
