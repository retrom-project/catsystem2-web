// SPDX-License-Identifier: MPL-2.0
// Original bitmap base operations share persistent wrappers and guest pixels.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
export const NATIVE_BITMAP_OPERATION_CONTRACTS = Object.freeze(
  [
    [0x7a, 3, 2, 0x64c8b0, 0x519270],
    [0x16a, 3, 2, 0x64bfa0, 0x518b40],
    [0x16b, 3, 2, 0x64bf50, 0x518af0],
    [0x16f, 10, 2, 0x64b200, 0x517e10],
    [0x171, 2, 2, 0x64b940, 0x518500],
    [0x172, 3, 1, 0x64ca70, 0x519460],
    [0x173, 3, 1, 0x64bad0, 0x518690],
    [0x174, 3, 1, 0x64c9c0, 0x5193b0],
    [0x175, 3, 1, 0x64c980, 0x519370],
    [0x176, 3, 1, 0x64c910, 0x519300],
    [0x178, 2, 2, 0x64a9e0, 0x517630],
    [0x179, 1, 1, 0x64c080, 0x518be0],
    [0x17a, 2, 2, 0x64ca40, 0x519430],
    [0x1d4, 2, 2, 0x64c770, 0x5192a0],
    [0x22e, 2, 2, 0x64b9c0, 0x518580],
    [0x234, 2, 2, 0x64c950, 0x519340],
    [0x281, 2, 2, 0x64c8e0, 0x5192d0],
    [0x2c1, 3, 2, 0x64c8b0, 0x519270],
    [0x402, 3, 1, 0x64bff0, null],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_BITMAP_OPERATION_CONTRACTS.map((s) => [s.id, s])),
  rawBitmapOperations = new Map([
    [0x7a, 'resize'],
    [0x1d4, 'rotation'],
    [0x281, 'alpha'],
    [0x2c1, 'resize'],
  ]);

function checkRotationFootprint(p, wrapper, angle) {
  if (angle !== 90 && angle !== 180 && angle !== 270) return;
  const bitmap = p.load(wrapper),
    width = p.load(bitmap + 4),
    height = p.load(bitmap + 8),
    rowBytes = (angle === 180 ? width : height) * p.load(bitmap + 24);
  // The original helper uses a four-byte pitch for an unaligned row.
  if (width && height && rowBytes > 4 && rowBytes % 4)
    throw new RangeError(
      `Original bitmap rotation cannot fit a ${rowBytes}-byte row in a four-byte stride`,
    );
}

export class NativeBitmapOperations {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.profileIndex =
      engine.profile === 'nekopara-vol3-engine-2.6.1.76'
        ? 0
        : engine.profile === 'sdk-4.01-engine-2.6.1.74'
          ? 1
          : -1;
    if (this.profileIndex < 0) throw new Error('Bitmap operations require a reviewed engine');
    this.inputChecks = new Map();
    const p = this.process,
      addresses = new Set(
        [...rawBitmapOperations.keys()].map((id) => byID.get(id).handlers[this.profileIndex]),
      );
    // The allocation can be released while a call is queued.
    this.detachInputs = Array.from(addresses, (address) =>
      p.beforeInstruction(address, 'check original bitmap input', () => {
        if (!this.inputChecks.size) return;
        const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
          argv = p.load(sp + 12),
          request = this.inputChecks.get(argv);
        if (!request) return;
        const pointer = p.load(argv),
          live = request.rawIdentity
            ? engine.features.get('render-sources')?.bitmapWrapperIdentity(pointer) ===
              request.rawIdentity
            : request.wrapper?.pointer === pointer &&
              engine.features.get('bitmap-memory')?.refs.wrappers.get(request.input) ===
                request.wrapper &&
              p.allocations.has(pointer);
        if (!live)
          throw new Error(
            `Native bitmap ${request.operation} wrapper was released before execution`,
          );
        if (request.operation === 'rotation') checkRotationFootprint(p, pointer, p.load(argv + 4));
      }),
    );
    engine.registerFeature('bitmap-operations', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec?.handlers[this.profileIndex]) return undefined;
    const words = Array.from(args);
    while (!words.length) words.push(machine.nativeArgument(0));
    let count = spec.words;
    if (id === 0x16f) {
      while (words.length < 6) words.push(machine.nativeArgument(words.length));
      if (!words[5]) count = 6;
    } else if (!words[0] && id !== 0x16a && id !== 0x16b) count = 1;
    while (words.length < count) words.push(machine.nativeArgument(words.length));
    const operation = rawBitmapOperations.get(id),
      input = words[0] >>> 0;
    let rawIdentity;
    if (operation && input && !this.world.runtime.handles.records.has(input)) {
      rawIdentity = this.engine.features.get('render-sources')?.bitmapWrapperIdentity(input);
      if (!rawIdentity) throw new Error(`Unknown or released bitmap ${operation} input ${input}`);
    }
    const bitmaps = rawIdentity ? null : await this.world.getNativeFeature('bitmap-memory');
    if (bitmaps && (id !== 0x16f || words[5])) {
      words[0] = await bitmaps.wrapper(words[0]);
      if (id === 0x16f) words[5] = await bitmaps.wrapper(words[5]);
    }
    let platform;
    if (id === 0x16f && !words[0] && words[5]) {
      platform = await this.world.getNativeFeature('graphics-platform');
      await platform.ensureRenderer();
    }
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4),
      host = platform ? (memory ? await memory.pointer(task.id) : p.allocate(120, true)) : 0;
    try {
      words.forEach((v, i) => p.store(argv + i * 4, v));
      if (rawIdentity || (id === 0x1d4 && input))
        this.inputChecks.set(argv, {
          operation,
          rawIdentity,
          input,
          wrapper: bitmaps?.refs.wrappers.get(input),
        });
      p.store(out, 0xcccccccc);
      if (platform) p.store(host + 116, platform.refs.view);
      const params = [bridge.pointer, host, argv, out],
        control = p.asyncEnabled
          ? await this.engine.callFromHost(spec.handlers[this.profileIndex], params, undefined, {
              task: task.id,
            })
          : await this.engine.call(spec.handlers[this.profileIndex], params, undefined, {
              task: task.id,
            });
      if (control !== spec.control)
        throw new Error('Original bitmap wrapper returned an unexpected control');
      if (input && !rawIdentity) bitmaps.captureOperation?.(input);
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
    } finally {
      this.inputChecks.delete(argv);
      try {
        bridge.close();
      } finally {
        if (host && !memory) p.free(host);
        p.free(out);
        p.free(argv);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
  close() {
    for (const detach of this.detachInputs) detach();
  }
}
export function installNativeBitmapOperations(world) {
  world.registerNativeFeature(
    'bitmap-operations',
    (engine) => new NativeBitmapOperations(engine, world),
  );
  const profileIndex = Number(world.profile.startsWith('sdk-'));
  for (const { id } of NATIVE_BITMAP_OPERATION_CONTRACTS.filter(
    (spec) => spec.id !== 0x7a && spec.handlers[profileIndex],
  ))
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('bitmap-operations')).apply(id, args, machine, task),
    );
}
