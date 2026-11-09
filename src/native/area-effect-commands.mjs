// SPDX-License-Identifier: MPL-2.0
// Original KCS wrappers for the task effect initializer and playback controls.
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { NATIVE_PROFILES } from './catalog.mjs';

export const NATIVE_AREA_EFFECT_COMMANDS = Object.freeze(
  [
    [0xc4, 2, 2, 0x641600, 0x529770],
    [0xc5, 1, 2, 0x6419a0, 0x529b10],
    [0xc6, 1, 2, 0x6419d0, 0x529b40],
    [0xc8, 1, 1, 0x641840, 0x5299b0],
    [0xc9, 3, 2, 0x641910, 0x529a80],
    [0xca, 2, 2, 0x641a00, 0x529b70],
    [0xcb, 1, 2, 0x6415d0, 0x529740],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_AREA_EFFECT_COMMANDS.map((spec) => [spec.id, spec])),
  bitmapPackets = new Map([
    [260, { size: 20, fields: [4, 16] }],
    [274, { size: 56, fields: [4, 16, 28] }],
    [275, { size: 44, fields: [4, 16] }],
    [276, { size: 48, fields: [4, 16] }],
  ]);

export class NativeAreaEffectCommands {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    const p = this.process,
      route = p.trap('KCS area effect transport', 7, (args) => this.dispatch(args));
    this.vtable = p.allocate(20, true);
    p.store(this.vtable + 16, route);
    engine.registerFeature('area-effect-commands', this);
  }
  async bitmapPacket(address, schema) {
    if (!address) throw new Error('Native area effect command has no mapped VM packet');
    const p = this.process,
      world = this.world,
      bytes = p.read(address, schema.size),
      packet = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      refs = world.runtime.handles.records,
      sources = this.engine.features.get('render-sources'),
      typed = [],
      borrowed = [];
    for (const at of schema.fields) {
      const value = packet.getUint32(at, true);
      if (!value) continue;
      if (refs.has(value)) typed.push([at, value]);
      else {
        const identity = sources?.bitmapWrapperIdentity(value);
        if (!identity) throw new Error(`Unknown or released area-effect bitmap wrapper ${value}`);
        borrowed.push([value, identity]);
      }
    }
    if (!typed.length) return 0;
    const memory = await world.getNativeFeature('bitmap-memory');
    for (const [at, value] of typed) packet.setUint32(at, await memory.wrapper(value), true);
    for (const [value, identity] of borrowed)
      if (sources.bitmapWrapperIdentity(value) !== identity)
        throw new Error('Area-effect bitmap wrapper was released before dispatch');
    const copy = p.allocate(bytes.length);
    p.write(copy, bytes);
    return copy;
  }
  async dispatch([sender, target, raw, w, l, flags, out]) {
    const p = this.process,
      world = this.world,
      origin = this.engine.currentTaskID,
      query = this.engine.currentMessageContext,
      message = this.sdk && raw >= 252 ? raw + 5 : raw;
    if (origin == null || w || flags || (message !== 13 && (message < 257 || message > 278)))
      throw new Error('Unexpected original area effect envelope');
    const record = world.objects.objects.get(world.resolveTaskID(target, origin)),
      area = this.engine.features.get('area-effects'),
      schema = area && record?.implementation?.owner === area ? bitmapPackets.get(message) : null;
    const copy = schema ? await this.bitmapPacket(l, schema) : 0;
    try {
      const context = {
          payload: p,
          nativePointer: true,
          nativeSender: sender,
          nativeResult: out,
          fromHost: true,
          flags,
        },
        value = await world.sendNativeEngine(target, origin, message, w, copy || l, context);
      if (out && Number.isInteger(value)) {
        p.store(out, value);
        if (message === 259 && query) query.written = true;
      }
      if (typeof context.nativeRouted !== 'boolean')
        throw new Error('Native area effect transport did not report its route');
      return Number(context.nativeRouted);
    } finally {
      if (copy) p.free(copy);
    }
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine));
    let scratch;
    try {
      scratch = p.allocate(12 + 4 * spec.words);
      const host = scratch,
        out = scratch + 8,
        onStack = memory && task.io?.native === id && task.io.pc === machine.pc,
        argv = onStack
          ? memory.guestAddress(task.id, machine, machine.nativeArgumentBase)
          : scratch + 12;
      if (!onStack)
        for (let i = 0; i < spec.words; i++)
          p.store(argv + 4 * i, args[i] ?? machine.nativeArgument(i));
      p.store(host, this.vtable);
      p.store(host + 4, this.world.nativeTaskID(task.id));
      p.store(out, NATIVE_RESULT_SENTINEL);
      const address = spec.handlers[Number(this.sdk)],
        // The original GCALL leaves ECX pointing at the dispatch slot.
        slot = NATIVE_PROFILES[this.engine.profile].tables.main.va + 4 * id,
        parameters = [bridge.pointer, host, argv, out],
        query = id === 0xc8 ? { written: false } : null,
        options = { task: task.id, messageContext: query },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, slot, options)
          : await this.engine.call(address, parameters, slot, options);
      let value = p.load(out);
      if (control !== spec.control || (control === 2 && value !== NATIVE_RESULT_SENTINEL))
        throw new Error('Unexpected original area effect command result');
      // C8 reuses the host argument's stack word for the receiver reply.
      // If it remains unwritten, return the real caller's guest identity.
      if (query && !query.written && memory) value = await memory.pointer(task.id);
      return nativeReply(control, control === 1 ? value : undefined);
    } finally {
      try {
        bridge.close();
      } finally {
        if (scratch) p.free(scratch);
      }
    }
  }
  snapshot() {
    return { vtable: this.vtable };
  }
  restore(state) {
    this.vtable = state.vtable;
  }
  close() {
    this.process.free(this.vtable);
  }
}

export function installNativeAreaEffectCommands(world) {
  world.registerNativeFeature(
    'area-effect-commands',
    (engine) => new NativeAreaEffectCommands(engine, world),
  );
  for (const { id } of NATIVE_AREA_EFFECT_COMMANDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('area-effect-commands')).apply(id, args, machine, task),
    );
}
