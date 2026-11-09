// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { MotionInstance } from '../../src/motion/instance.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { nativeABI, NATIVE_ABIS } from '../../src/native/abi/index.mjs';
import { NativeKCSMemory } from '../../src/native/kcs-memory.mjs';
import { readKCS, nativeReply } from '../../src/kcs.mjs';
import { NATIVE_EXE_PROFILES } from '../../src/native/catalog.mjs';
import { memoryGame, kcsProgram } from '../helpers.mjs';

const independent = {
  generic: new Set(['math.sin', 'math.cos', 'matrix.copy', 'vector4.normalize']),
  main: new Set([
    'math.linearInterpolate',
    'math.roundInteger',
    ...Object.values(NATIVE_ABIS)[0]
      .tables.main.entries.filter((e) => e.family === 'math')
      .map((e) => e.name),
  ]),
};

function vmMemory(machine) {
  return Object.fromEntries([
    ['memory', machine.memory.slice()],
    ['shared', machine.shared.slice()],
    ...machine.blockIDs.map((id, index) => [`block:${id}`, machine.blockBytes(index).slice()]),
  ]);
}
function vmState(machine) {
  const state = machine.snapshot();
  // Byte regions are compared separately. memoryID identifies the host backing.
  delete state.memory;
  delete state.memoryID;
  delete state.blocks;
  return structuredClone(state);
}
function applyInitial(machine, initial = {}) {
  for (const size of initial.blocks ?? []) machine.allocate(size);
  for (const [address, words] of initial.words ?? [])
    words.forEach((word, index) => machine.store(address + index * 4, word));
}
function imageMemory(engine) {
  return engine.module.pe.sections
    .filter((section) => section.flags & 0x80000000)
    .map((section) => ({
      name: section.name,
      address: engine.module.base + section.address,
      bytes: engine.process.read(engine.module.base + section.address, section.size).slice(),
    }));
}
function imageWrites(engine, before) {
  const result = [];
  for (const section of before) {
    const after = engine.process.read(section.address, section.bytes.length);
    for (let at = 0; at < after.length; at++)
      if (section.bytes[at] !== after[at])
        result.push({
          region: section.name,
          offset: at,
          before: section.bytes[at],
          after: after[at],
        });
  }
  return result;
}

function originalReply(engine, table, id, args, machine, evidence, allowedBoundaries = []) {
  const p = engine.process,
    abi = nativeABI(engine.profile),
    allocations = new Map(p.allocations);
  const bridge = new NativeKCSMemory(p, machine);
  let argv, out, watch;
  const boundaries = [],
    callbacks = [];
  for (const trap of p.traps.values()) {
    const callback = trap.callback;
    callbacks.push([trap, callback]);
    trap.callback = (...parameters) => {
      boundaries.push(trap.name);
      return callback(...parameters);
    };
  }
  try {
    argv = p.allocate(Math.max(4, args.length * 4));
    out = p.allocate(12);
    args.forEach((word, index) => p.store(argv + index * 4, word));
    p.write(out, new Uint8Array(12).fill(0xcc));
    watch = p.watchWrites(out + 4, 4);
    const before = imageMemory(engine),
      address = p.load(NATIVE_EXE_PROFILES[engine.profile].tables[table].va + id * 4);
    p.cpu.reg_write_i32(p.uc.X86_REG_FPCW, abi.floatingPoint.x87ControlWord);
    p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, abi.floatingPoint.mxcsr);
    p.lastTrap = null;
    const control = p.call(address, [bridge.pointer, 0, argv, out + 4]);
    for (const boundary of boundaries)
      assert.ok(
        allowedBoundaries.includes(boundary),
        `unreviewed oracle host boundary ${boundary}`,
      );
    evidence.hostBoundaries.push(boundaries);
    assert.equal(p.load(out), 0xcccccccc, 'original leading output canary');
    assert.equal(p.load(out + 8), 0xcccccccc, 'original trailing output canary');
    const written = control === 1 || control === 3;
    assert.equal(watch.written, written, 'original result-word write contract');
    evidence.outputWrites.push(watch.written);
    if (!written) assert.equal(p.load(out + 4), 0xcccccccc, 'original void output');
    evidence.peWrites.push(...imageWrites(engine, before));
    assert.equal(
      p.cpu.reg_read_i32(p.uc.X86_REG_FPCW),
      abi.floatingPoint.x87ControlWord,
      'normal oracle precision and rounding',
    );
    assert.equal(
      p.cpu.reg_read_i32(p.uc.X86_REG_MXCSR) & ~0x3f,
      abi.floatingPoint.mxcsr & ~0x3f,
      'normal oracle SSE rounding',
    );
    evidence.floatingPoint.push({
      controlWord: p.cpu.reg_read_i32(p.uc.X86_REG_FPCW),
      mxcsr: p.cpu.reg_read_i32(p.uc.X86_REG_MXCSR),
      boundaries,
    });
    return nativeReply(control, written ? p.load(out + 4) : undefined);
  } finally {
    for (const [trap, callback] of callbacks) trap.callback = callback;
    watch?.close();
    try {
      bridge.close();
    } finally {
      if (out) p.free(out);
      if (argv) p.free(argv);
      assert.deepEqual(
        p.allocations,
        allocations,
        'oracle wrapper releases its VM bridge and output buffers',
      );
    }
  }
}

export async function observeNativeCase(fixture, oracleEngine = null) {
  const { profile, table, id, args, initial } = fixture;
  const abi = nativeABI(profile),
    entry = abi.tables[table]?.entries[id];
  if (!entry || !independent[table]?.has(entry.name))
    throw new Error(`No independent JS differential entry ${abi.id}/${table}/${id}`);
  assert.equal(
    args.length,
    entry.signature.argumentWords,
    'fixture matches the reviewed signature',
  );
  if (oracleEngine) assert.equal(oracleEngine.profile, profile, 'oracle ABI');
  const instructions = [...args.map((word) => [37, word]), [43, id, args.length * 4], [59]];
  const bytes = kcsProgram(instructions),
    trace = [],
    evidence = { peWrites: [], floatingPoint: [], outputWrites: [], hostBoundaries: [] };
  let lastReply;
  const observeReply = (reply) => {
    assert.ok(
      reply && typeof reply.then !== 'function',
      'initial arithmetic cases are synchronous',
    );
    lastReply = reply;
    trace.push({ table, id, args: [...args], control: reply.control });
    return reply;
  };
  if (table === 'generic') {
    const motion = new MotionInstance(await readKCS(bytes), { profile });
    applyInitial(motion.machine, initial);
    const js = motion.native.bind(motion);
    motion.native = (nativeID, words, machine) => {
      assert.equal(nativeID, id);
      assert.deepEqual(words, args);
      if (oracleEngine) {
        motion.calls.set(nativeID, (motion.calls.get(nativeID) ?? 0) + 1);
        return observeReply(
          originalReply(
            oracleEngine,
            table,
            nativeID,
            words,
            machine,
            evidence,
            fixture.oracle?.boundaries,
          ),
        );
      }
      return observeReply(js(nativeID, words, machine));
    };
    const result = motion.run();
    return {
      control: lastReply.control,
      resultWritten: oracleEngine
        ? evidence.outputWrites.at(-1)
        : Object.hasOwn(lastReply, 'value'),
      value: lastReply.value,
      memory: vmMemory(motion.machine),
      peWrites: evidence.peWrites,
      handles: { next: 1, records: [] },
      tasks: {
        frame: motion.frame,
        active: motion.active,
        result,
        machine: vmState(motion.machine),
      },
      events: motion.messages,
      nativeCalls: trace,
      oracleEvidence: evidence.floatingPoint,
    };
  }
  const game = memoryGame({ 'case.kcs': bytes }),
    random = new ParticleRandom();
  const world = new NativeWorld({
    profile,
    game,
    random,
    configuration: new NativeConfiguration({ profile }),
    host: {},
    images: {},
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
  world.ensureNativeEngine = () => {
    throw new Error('JS differential lane attempted to load the EXE');
  };
  try {
    const dispatch = world.runtime.native.bind(world.runtime);
    world.runtime.native = (nativeTable, nativeID, words, machine, task, scheduler) => {
      assert.equal(nativeTable, table);
      assert.equal(nativeID, id);
      assert.deepEqual(words, args);
      if (oracleEngine) {
        const key = `${table}:${id}`;
        world.runtime.calls.set(key, (world.runtime.calls.get(key) ?? 0) + 1);
        return observeReply(
          originalReply(
            oracleEngine,
            table,
            nativeID,
            words,
            machine,
            evidence,
            fixture.oracle?.boundaries,
          ),
        );
      }
      return observeReply(dispatch(nativeTable, nativeID, words, machine, task, scheduler));
    };
    // Initialize the VM before execution through the existing scheduler hook.
    const add = world.runtime.scheduler.add.bind(world.runtime.scheduler);
    world.runtime.scheduler.add = (...parameters) => {
      const task = add(...parameters);
      applyInitial(task.machine, initial);
      return task;
    };
    await world.initialize('case.kcs');
    const task = world.main,
      scheduler = world.runtime.scheduler;
    return {
      control: lastReply.control,
      resultWritten: oracleEngine
        ? evidence.outputWrites.at(-1)
        : Object.hasOwn(lastReply, 'value'),
      value: lastReply.value,
      memory: vmMemory(task.machine),
      peWrites: evidence.peWrites,
      handles: world.runtime.handles.snapshot(),
      tasks: {
        frame: scheduler.frame,
        nextID: scheduler.nextID,
        records: [...scheduler.tasks.values()].map((record) => ({
          id: record.id,
          name: record.name,
          abi: record.abi,
          context: structuredClone(record.context),
          parent: record.parent,
          priority: record.priority,
          status: record.status,
          createdFrame: record.createdFrame,
          finishedFrame: record.finishedFrame,
          machine: vmState(record.machine),
        })),
      },
      events: structuredClone(scheduler.events),
      nativeCalls: trace,
      oracleEvidence: evidence.floatingPoint,
    };
  } catch (error) {
    const task = world.main ?? [...world.runtime.scheduler.tasks.values()].at(-1);
    if (task?.machine) error.nativeMemory = vmMemory(task.machine);
    throw error;
  } finally {
    await world.close({ flushFiles: false });
  }
}
