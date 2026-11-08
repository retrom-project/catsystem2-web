// SPDX-License-Identifier: MPL-2.0
// The game build's UTF-8 primitives retain its original permissive byte walker
// and CP932-to-UTF8 search-key conversion, including CRT/Windows boundaries.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { NATIVE_PROFILES } from './catalog.mjs';
export const NATIVE_UTF8_IDS = Object.freeze([0x415, 0x416, 0x41b]);
export async function nativeUTF8(id, args, machine, task, world) {
  if (!NATIVE_UTF8_IDS.includes(id) || world.profile !== 'nekopara-vol3-engine-2.6.1.76')
    return undefined;
  if (args.length !== 2)
    throw new Error(`Native UTF-8 primitive 0x${id.toString(16)} expects two arguments`);
  const engine = await world.ensureNativeEngine(),
    p = engine.process,
    taskMemory =
      world.objects.machine(task.id) === machine
        ? await world.getNativeFeature('task-memory')
        : null;
  if (taskMemory) taskMemory.vmPointer(task.id);
  const bridge = new NativeKCSMemory(p, machine, taskMemory?.mapMachine(task.id, machine)),
    argv = p.allocate(8),
    out = p.allocate(4);
  try {
    args.forEach((word, i) => p.store(argv + i * 4, word));
    p.store(out, 0xcccccccc);
    const control = await engine.call(
      p.load(NATIVE_PROFILES[world.profile].tables.main.va + id * 4),
      [bridge.pointer, 0, argv, out],
      undefined,
      { task: task.id },
    );
    return nativeReply(control, p.load(out));
  } finally {
    try {
      bridge.close();
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
}
export function installNativeUTF8(world) {
  if (world.profile !== 'nekopara-vol3-engine-2.6.1.76') return;
  for (const id of NATIVE_UTF8_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      nativeUTF8(id, args, machine, task, world),
    );
}
