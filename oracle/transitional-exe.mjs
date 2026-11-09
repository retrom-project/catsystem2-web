// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../src/kcs/vm.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { runNativeGameWinMainSpan } from '../src/native/engine-startup-block.mjs';
import { scalarHandler } from './scalar-handlers.mjs';
export async function invokeNative(operation, { engine, world, args, machine, task }) {
  if (typeof operation !== 'string')
    throw new Error('Transitional native requires a semantic operation name');
  const entry = nativeABI(engine.profile).tables.main.entries.find(
    (entry) => entry.name === operation,
  );
  scalarHandler(engine.profile, operation);
  const spec = {
    words: entry.signature.argumentWords,
    control: entry.controlCodes[0],
    memory: entry.parameters.some((parameter) => parameter.startsWith('VMptr ')),
  };
  const words = Array.from(args);
  while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
  let bridge;
  if (spec.memory) {
    const memory =
      world?.objects.machine(task.id) === machine
        ? await world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    bridge = new NativeKCSMemory(engine.process, machine, memory?.mapMachine(task.id, machine));
  }
  const p = engine.process,
    argv = p.allocate(words.length * 4),
    out = p.allocate(12);
  try {
    words.forEach((word, i) => p.store(argv + i * 4, word));
    p.write(out, new Uint8Array(12).fill(0xcc));
    const parameters = [bridge?.pointer ?? 0, 0, argv, out + 4],
      options = { task: task.id },
      control = p.asyncEnabled
        ? await engine.callFromHost(
            scalarHandler(engine.profile, operation),
            parameters,
            undefined,
            options,
          )
        : await engine.call(
            scalarHandler(engine.profile, operation),
            parameters,
            undefined,
            options,
          );
    if (
      control !== spec.control ||
      p.load(out) !== 0xcccccccc ||
      p.load(out + 8) !== 0xcccccccc ||
      (control === 2 && p.load(out + 4) !== 0xcccccccc)
    )
      throw new Error('Native scalar math changed its reviewed output contract');
    return nativeReply(control, control === 1 ? p.load(out + 4) : undefined);
  } finally {
    try {
      bridge?.close();
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
}
export async function invokeRegion(operation, { engine }) {
  if (engine.profile !== 'nekopara-vol3-engine-2.6.1.76' || operation !== 'startup.accelerators')
    throw new Error(`Unreviewed transitional region ${operation}`);
  return runNativeGameWinMainSpan(engine, 0x52cdcb, 0x52cfed, (stack, cpu, uc) => {
    engine.process.store(stack + 0x14, engine.module.base);
    cpu.reg_write_i32(uc.X86_REG_EAX, engine.refs.settings);
    cpu.reg_write_i32(uc.X86_REG_EBX, 0);
  });
}
