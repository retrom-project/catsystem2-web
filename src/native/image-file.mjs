// SPDX-License-Identifier: MPL-2.0
// ANM presence is determined by the original kcView predicate, including its
// anmtable.csv fallback and real IFile open/destruction. It does not decode images.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

export const NATIVE_IMAGE_FILE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x1ae, words: 1, control: 1, handlers: [0x644570, 0x51cc20] }),
]);

export class NativeImageFiles {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    engine.registerFeature('image-files', this);
  }
  async apply(id, args, machine, task) {
    const spec = NATIVE_IMAGE_FILE_CONTRACTS.find((entry) => entry.id === id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    const platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      host = memory ? await memory.pointer(task.id) : p.allocate(120, true),
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(12);
    try {
      if (!memory) p.store(host + 116, platform.refs.view);
      if (p.load(host + 116) !== platform.refs.view)
        throw new Error("ANM presence query requires its caller's initialized kcView");
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      const parameters = [bridge.pointer, host, argv, out + 4],
        address = spec.handlers[Number(this.engine.profile.startsWith('sdk-'))],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, undefined, options)
          : await this.engine.call(address, parameters, undefined, options);
      if (control !== 1 || p.load(out) !== 0xcccccccc || p.load(out + 8) !== 0xcccccccc)
        throw new Error('Original ANM presence query changed its output contract');
      return nativeReply(control, p.load(out + 4));
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(out);
        p.free(argv);
        if (!memory) p.free(host);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}

export function installNativeImageFiles(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('image-files', async (engine) => {
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('data-buffers');
    return new NativeImageFiles(engine, world);
  });
  for (const { id } of NATIVE_IMAGE_FILE_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('image-files')).apply(id, args, machine, task),
    );
}
