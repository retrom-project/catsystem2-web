// SPDX-License-Identifier: MPL-2.0
// The original selector/layer factory returns an owned image wrapper. Unlike
// main 6F, main 1CC does not register it in the Script automatic bitmap list.
import { nativeReply } from '../src/kcs/vm.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { installNativeEngineFiles } from '../src/native/engine-files.mjs';

export const NATIVE_IMAGE_COMPOSITE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x1cc, words: 1, control: 1, handlers: [0x64c470, 0x518fb0] }),
]);

export class NativeImageComposites {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    engine.registerFeature('image-composites', this);
  }
  async apply(id, args, machine, task) {
    const spec = NATIVE_IMAGE_COMPOSITE_CONTRACTS.find((entry) => entry.id === id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    const platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    const bitmaps = await this.world.getNativeFeature('bitmap-memory'),
      memory =
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
        throw new Error("Native image composition requires its caller's initialized kcView");
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      const params = [bridge.pointer, host, argv, out + 4],
        address = spec.handlers[Number(this.engine.profile.startsWith('sdk-'))],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, params, undefined, options)
          : await this.engine.call(address, params, undefined, options);
      if (control !== 1 || p.load(out) !== 0xcccccccc || p.load(out + 8) !== 0xcccccccc)
        throw new Error('Original image composite factory changed its output contract');
      const pointer = p.load(out + 4);
      if (!pointer) return nativeReply(1, 0);
      // The returned reference is explicit rather than Script-list owned.
      // NativeBitmapMemory retains the complete original wrapper and bitmap;
      // no decode/copy or extra native reference is introduced here.
      const images = this.world.graphics.images,
        handle = images.create(0, 0);
      try {
        bitmaps.adoptWrapper(handle, pointer);
      } catch (error) {
        await images.release(handle);
        if (p.allocations.has(pointer))
          await (await this.world.getNativeFeature('data-buffers')).releaseBitmapPointer(pointer);
        throw error;
      }
      return nativeReply(1, handle);
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

export function installNativeImageComposites(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('image-composites', async (engine) => {
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('data-buffers');
    await world.getNativeFeature('bitmap-memory');
    return new NativeImageComposites(engine, world);
  });
  for (const { id } of NATIVE_IMAGE_COMPOSITE_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('image-composites')).apply(id, args, machine, task),
    );
}
