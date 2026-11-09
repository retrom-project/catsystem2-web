// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

export const NATIVE_VERSION_QUERY = Object.freeze({
  id: 0x1bc,
  handlers: Object.freeze({
    'sdk-4.01-engine-2.6.1.74': 0x51b8f0,
    'nekopara-vol3-engine-2.6.1.76': 0x6502a0,
  }),
});

export function installNativeVersionQuery(world) {
  const { id, handlers } = NATIVE_VERSION_QUERY,
    handler = handlers[world.profile];
  if (!handler) return;
  world.runtime.register('main', id, async (args, machine, task) => {
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
  });
}
