// SPDX-License-Identifier: MPL-2.0
// Original main wrappers send controls to the shared PTCL/PPI task.
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { NATIVE_PROFILES } from './catalog.mjs';

export const NATIVE_PARTICLE_CONTROLS = Object.freeze(
  [
    [0x110, 1, 315, 0x657860, 0x524370],
    [0x111, 1, 316, 0x657890, 0x5243a0],
    [0x112, 1, 318, 0x657780, 0x524290],
    [0x113, 2, 319, 0x657820, 0x524330],
    [0x1aa, 2, 320, 0x6577c0, 0x5242d0],
    [0x1ab, 2, 321, 0x6577f0, 0x524300],
  ].map(([id, words, message, game, sdk]) =>
    Object.freeze({ id, words, message, handlers: [game, sdk] }),
  ),
);
const controls = new Map(NATIVE_PARTICLE_CONTROLS.map((entry) => [entry.id, entry])),
  messages = new Set(NATIVE_PARTICLE_CONTROLS.map((entry) => entry.message));

export class NativeParticleCommands {
  static has(id) {
    return controls.has(id);
  }
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    const p = this.process,
      send = p.trap('KCS particle task transport', 7, (args) => this.send(args));
    this.vtable = p.allocate(20, true);
    p.store(this.vtable + 16, send);
    this.payload = { bytes: (address, size) => p.read(address, size) };
    engine.registerFeature('particle-commands', this);
  }
  async send([sender, target, raw, w, l, flags, out]) {
    const origin = this.engine.currentTaskID,
      message = this.sdk ? raw + 5 : raw;
    if (origin == null || !messages.has(message) || w || flags)
      throw new Error('Unexpected original particle control envelope');
    const context = {
        payload: this.payload,
        nativeSender: sender,
        nativePointer: true,
        nativeResult: out,
        fromHost: true,
        flags,
      },
      value = await this.world.sendNativeEngine(target, origin, message, w, l, context);
    if (out && Number.isInteger(value)) this.process.store(out, value);
    if (typeof context.nativeRouted !== 'boolean')
      throw new Error('Native particle transport did not report its route');
    return Number(context.nativeRouted);
  }
  async apply(id, args, machine, task) {
    const spec = controls.get(id);
    if (!spec) return undefined;
    const p = this.process,
      memory =
        this.world.objects.machine(task.id) === machine
          ? await this.world.getNativeFeature('task-memory')
          : null;
    if (memory) memory.vmPointer(task.id);
    const bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine));
    let scratch;
    try {
      scratch = p.allocate(12 + spec.words * 4);
      const out = scratch + 8,
        onStack = memory && task.io?.native === id && task.io.pc === machine.pc,
        argv = onStack
          ? memory.guestAddress(task.id, machine, machine.nativeArgumentBase)
          : scratch + 12;
      if (!onStack)
        for (let i = 0; i < spec.words; i++)
          p.store(argv + i * 4, args[i] ?? machine.nativeArgument(i));
      p.store(scratch, this.vtable);
      p.store(scratch + 4, this.world.nativeTaskID(task.id));
      p.store(out, NATIVE_RESULT_SENTINEL);
      const address = spec.handlers[Number(this.sdk)],
        slot = NATIVE_PROFILES[this.engine.profile].tables.main.va + 4 * id,
        parameters = [bridge.pointer, scratch, argv, out],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, slot, options)
          : await this.engine.call(address, parameters, slot, options),
        value = p.load(out);
      if (control !== (id === 0x112 ? 1 : 2) || (control === 2 && value !== NATIVE_RESULT_SENTINEL))
        throw new Error('Unexpected original particle control result');
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
  restore({ vtable }) {
    if (
      this.process.allocations.get(vtable) !== 20 ||
      this.process.traps.get(this.process.load(vtable + 16))?.name !== 'KCS particle task transport'
    )
      throw new Error('Invalid native particle transport checkpoint');
    this.vtable = vtable;
  }
  close() {
    this.process.free(this.vtable);
  }
}
