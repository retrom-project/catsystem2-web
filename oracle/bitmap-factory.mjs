// SPDX-License-Identifier: MPL-2.0
// Original image wrappers and the Script-owned automatic bitmap list.
import { nativeReply } from '../src/kcs/vm.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';

export const NATIVE_BITMAP_FACTORY_CONTRACTS = Object.freeze(
  [
    [0x6f, 1, 1, 0x64c0b0, 0x518c10],
    [0x70, 2, 1, 0x64b4b0, 0x5180c0],
    [0x72, 1, 2, 0x64b7f0, 0x5183b0],
    [0x75, 6, 2, 0x64b970, 0x518530],
    [0x76, 1, 1, 0x64aa40, 0x517690],
    [0x77, 3, 2, 0x64c030, 0x518b90],
    [0x79, 4, 2, 0x64ca00, 0x5193f0],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_BITMAP_FACTORY_CONTRACTS.map((row) => [row.id, row]));
export class NativeBitmapFactories {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    this.listConstruct = this.sdk ? 0x4c4b40 : 0x5e8820;
    this.listClear = this.sdk ? 0x6363e0 : 0x79d8d0;
    engine.refs.bitmapFactories ??= { contexts: new Map() };
    engine.registerFeature('bitmap-factories', this);
  }
  get refs() {
    return this.engine.refs.bitmapFactories;
  }
  call(address, args = [], pointer, task) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, { task })
      : this.engine.call(address, args, pointer, { task });
  }
  async context(owner, renderer = false) {
    let view;
    if (renderer) {
      const platform = await this.world.getNativeFeature('graphics-platform');
      await platform.ensureRenderer();
      view = platform.refs.view;
    }
    const p = this.process;
    let context = this.refs.contexts.get(owner);
    if (!context) {
      const actual = Boolean(this.world.objects.machine(owner)),
        pointer = actual
          ? await (await this.world.getNativeFeature('task-memory')).pointer(owner)
          : p.allocate(200, true),
        list = p.allocate(8);
      await this.call(this.listConstruct, [], list, owner);
      p.store(pointer + 152, list);
      context = { pointer, list, owned: !actual };
      this.refs.contexts.set(owner, context);
    }
    if (view) p.store(context.pointer + 116, view);
    return context.pointer;
  }
  async releaseWrapper(wrapper, owner) {
    const p = this.process,
      host = await this.context(owner),
      argv = p.allocate(4),
      out = p.allocate(4);
    try {
      p.store(argv, wrapper.pointer);
      p.store(out, 0xcccccccc);
      const control = await this.call(
        byID.get(0x72).handlers[Number(this.sdk)],
        [0, host, argv, out],
        undefined,
        owner,
      );
      if (control !== 2) throw new Error('Original image release changed its control');
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (!words.length) words.push(machine.nativeArgument(0));
    let count = spec.words;
    if ((id === 0x72 || id === 0x76 || id === 0x79) && !words[0]) count = 1;
    // The screen branch of 75 consumes four coordinate words, not color.
    if (id === 0x75 && !words[0]) count = 5;
    while (words.length < count) words.push(machine.nativeArgument(words.length));
    const bitmaps = await this.world.getNativeFeature('bitmap-memory'),
      images = this.world.graphics.images;
    if (id === 0x72 && words[0]) {
      await bitmaps.wrapper(words[0]);
      await images.release(words[0], { task: task.id });
      return nativeReply(2);
    }
    if (id !== 0x6f && id !== 0x70 && words[0]) words[0] = await bitmaps.wrapper(words[0]);
    if (id === 0x6f) await this.world.getNativeFeature('engine-files');
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      host = await this.context(task.id, id === 0x6f || (id === 0x75 && !words[0])),
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      const control = await this.call(
        spec.handlers[Number(this.sdk)],
        [bridge.pointer, host, argv, out],
        undefined,
        task.id,
      );
      if (control !== spec.control) throw new Error('Original bitmap factory changed its control');
      if ([0x6f, 0x70, 0x76].includes(id)) {
        const pointer = p.load(out);
        if (!pointer) return nativeReply(1, 0);
        const handle = images.create(0, 0, task.id);
        try {
          bitmaps.adoptWrapper(handle, pointer, task.id);
        } catch (error) {
          await images.release(handle);
          await this.releaseWrapper({ pointer }, task.id);
          throw error;
        }
        return nativeReply(1, handle);
      }
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(out);
        p.free(argv);
      }
    }
  }
  async disposeContext(owner) {
    const context = this.refs.contexts.get(owner);
    if (!context) return;
    const bitmaps = this.engine.features.get('bitmap-memory'),
      p = this.process;
    for (const [handle, wrapper] of bitmaps.refs.wrappers)
      if (wrapper.registration === owner) await this.world.graphics.images.release(handle);
    const head = p.load(context.list);
    // Any entries left by a cross-task release keep the original list's
    // identity/lifetime behavior; do not silently normalize ownership.
    for (let at = p.load(head); at !== head; at = p.load(at))
      await this.call(bitmaps.layout.wrapperRelease, [], p.load(at + 8), owner);
    await this.call(this.listClear, [], context.list, owner);
    p.store(context.pointer + 152, 0);
    p.free(head);
    p.free(context.list);
    if (context.owned) p.free(context.pointer);
    this.refs.contexts.delete(owner);
  }
  snapshot() {
    return {};
  }
  restore() {
    if (!(this.refs.contexts instanceof Map)) throw new Error('Invalid automatic bitmap list');
  }
  async close() {
    if (this.closed) return;
    for (const owner of [...this.refs.contexts.keys()]) await this.disposeContext(owner);
    this.closed = true;
  }
}
