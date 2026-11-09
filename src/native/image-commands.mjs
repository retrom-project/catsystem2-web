// SPDX-License-Identifier: MPL-2.0
// Original image transfers, attributes and filters share one bitmap backing.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { nativeHG3DecodeContext } from './hg3-delta.mjs';

export const NATIVE_IMAGE_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x73, 10, 2, 0x64ab20, 0x517730],
    [0x74, 10, 2, 0x64afa0, 0x517bb0],
    [0x78, 4, 2, 0x64ada0, 0x5179b0],
    [0x1be, 2, 1, 0x64bbf0, 0x5187b0],
    [0x218, 7, 1, 0x64b9f0, 0x5185b0],
    [0x219, 2, 1, 0x64a8c0, 0x517530],
    [0x21a, 3, 2, 0x64a910, 0x517580],
    [0x2a9, 1, 2, 0x64a940, 0x5175b0],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_IMAGE_COMMAND_CONTRACTS.map((spec) => [spec.id, spec]));

export class NativeImageCommands {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.profileIndex = Number(engine.profile.startsWith('sdk-'));
    engine.registerFeature('image-commands', this);
  }
  async compositeMemory(machine, words, bitmaps) {
    const count = words[2] >>> 0,
      records = machine.bytes(words[1], count * 12).slice(),
      rectangle = machine.bytes(words[3], 16).slice(),
      view = new DataView(records.buffer, records.byteOffset, records.byteLength);
    for (let i = 0; i < count; i++) {
      const handle = view.getUint32(i * 12, true);
      if (handle) view.setUint32(i * 12, await bitmaps.wrapper(handle), true);
    }
    // These arguments are read-only. Separate copies preserve the caller's
    // logical handles and an overlapping rectangle while guest code reads
    // actual wrapper pointers. No temporary native address is written to KCS.
    const memory = new Uint8Array(16 + records.length);
    memory.set(rectangle);
    memory.set(records, 16);
    words[1] = 16;
    words[3] = 0;
    return new NativeKCSMemory(this.process, {
      memory,
      shared: new Uint8Array(),
      blocks: [],
      fp: 0,
    });
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args),
      need = (count) => {
        while (words.length < count) words.push(machine.nativeArgument(words.length));
      };
    need(id === 0x73 || id === 0x74 ? 6 : id === 0x219 ? 2 : 1);
    const active =
      id === 0x73
        ? Boolean(words[5])
        : id === 0x74
          ? Boolean(words[0] && words[5])
          : id === 0x219
            ? Boolean(words[0] && words[1])
            : Boolean(words[0]);
    if (active) need(spec.words);
    const warmup = id === 0x2a9,
      bitmaps = warmup ? null : await this.world.getNativeFeature('bitmap-memory');
    if (active && !warmup) {
      if (words[0]) words[0] = await bitmaps.wrapper(words[0]);
      if (id === 0x73 || id === 0x74) words[5] = await bitmaps.wrapper(words[5]);
      if (id === 0x219) words[1] = await bitmaps.wrapper(words[1]);
    }
    let platform;
    if (warmup) {
      await this.world.getNativeFeature('data-buffers');
      await this.world.getNativeFeature('engine-files');
    }
    if (warmup || (id === 0x73 && active && !words[0])) {
      platform = await this.world.getNativeFeature('graphics-platform');
      await platform.ensureRenderer();
    }
    let bridge;
    if (id === 0x78 && active) bridge = await this.compositeMemory(machine, words, bitmaps);
    else {
      const memory =
        this.world.objects.machine(task.id) === machine
          ? await this.world.getNativeFeature('task-memory')
          : null;
      if (memory) memory.vmPointer(task.id);
      bridge = new NativeKCSMemory(this.process, machine, memory?.mapMachine(task.id, machine));
    }
    const p = this.process,
      argv = p.allocate(words.length * 4),
      out = p.allocate(4),
      host = platform ? p.allocate(120, true) : 0;
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      if (host) {
        if (!platform.refs.view) throw new Error('Native image upload has no initialized view');
        p.store(host + 116, platform.refs.view);
      }
      const parameters = [bridge.pointer, host, argv, out],
        options = { task: task.id, messageContext: warmup ? nativeHG3DecodeContext() : undefined },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(
              spec.handlers[this.profileIndex],
              parameters,
              undefined,
              options,
            )
          : await this.engine.call(
              spec.handlers[this.profileIndex],
              parameters,
              undefined,
              options,
            );
      if (control !== spec.control)
        throw new Error('Original image command returned an unexpected control');
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(out);
        p.free(argv);
        if (host) p.free(host);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}

export function installNativeImageCommands(world) {
  world.registerNativeFeature('image-commands', (engine) => new NativeImageCommands(engine, world));
  for (const { id } of NATIVE_IMAGE_COMMAND_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('image-commands')).apply(id, args, machine, task),
    );
}
