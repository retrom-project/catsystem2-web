// SPDX-License-Identifier: MPL-2.0
import { NativeKCSMemory } from './kcs-memory.mjs';
import { nativeReply } from '../src/kcs/vm.mjs';
export const NATIVE_VERSION_QUERY = Object.freeze({
  id: 0x1bc,
  handlers: Object.freeze({
    'sdk-4.01-engine-2.6.1.74': 0x51b8f0,
    'nekopara-vol3-engine-2.6.1.76': 0x6502a0,
  }),
});

export async function originalVersionQuery(world, args, machine, task) {
  const handler = NATIVE_VERSION_QUERY.handlers[world.profile];
  if (!handler) throw new Error('Original version query has no reviewed physical descriptor');
  const engine = await world.ensureNativeEngine(),
    p = engine.process,
    memory =
      world.objects.machine(task.id) === machine
        ? await world.getNativeFeature('task-memory')
        : null;
  if (memory) memory.vmPointer(task.id);
  const bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
    argv = p.allocate(16),
    out = p.allocate(4);
  try {
    for (let i = 0; i < 4; i++) p.store(argv + i * 4, args[i] ?? machine.nativeArgument(i));
    p.store(out, 0xcccccccc);
    const parameters = [bridge.pointer, 0, argv, out],
      options = { task: task.id },
      control = p.asyncEnabled
        ? await engine.callFromHost(handler, parameters, undefined, options)
        : await engine.call(handler, parameters, undefined, options);
    if (control !== 2 || p.load(out) !== 0xcccccccc)
      throw new Error('Original version query changed its output contract');
    return nativeReply(control);
  } finally {
    try {
      bridge.close();
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
}
