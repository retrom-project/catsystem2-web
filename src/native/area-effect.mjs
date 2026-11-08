// SPDX-License-Identifier: MPL-2.0
// Original CPU-area effects. These borrow their source/destination bitmap
// wrappers; the FES resource list owns the wrappers and task lifetime.
import { NativeScreenEffectTask } from './screen-effect.mjs';

const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    26: { construct: 0x5efc30, size: 0xc8, vtable: 0x8cde44 },
    27: { construct: 0x5f0690, size: 0xb0, vtable: 0x8cdef0 },
    28: { construct: 0x5f10e0, size: 0xc4, vtable: 0x8ce004 },
  },
  'sdk-4.01-engine-2.6.1.74': {
    26: { construct: 0x4ca560, size: 0xc8, vtable: 0x993124 },
    27: { construct: 0x4caf30, size: 0xb0, vtable: 0x9931d0 },
    28: { construct: 0x4cb950, size: 0xc4, vtable: 0x9932e4 },
  },
};
export function areaEffectRawMessage(profile, message) {
  if (!profile.startsWith('sdk-')) return message;
  return message >= 257 && message <= 276 ? message - 5 : message >= 39 ? message - 2 : message;
}
function canonicalMessage(profile, message) {
  if (!profile.startsWith('sdk-')) return message;
  return message >= 252 && message <= 271 ? message + 5 : message >= 37 ? message + 2 : message;
}
export class NativeAreaEffects {
  static async open(engine, world) {
    const platform = await world.getNativeFeature('graphics-platform'),
      taskMemory = await world.getNativeFeature('task-memory');
    return new NativeAreaEffects(engine, world, platform, taskMemory);
  }
  constructor(engine, world, platform, taskMemory) {
    Object.assign(this, { engine, world, platform, taskMemory, process: engine.process });
    this.abi = ABI[engine.profile];
    if (!this.abi) throw new Error('CPU-area effects require a reviewed engine profile');
    this.requiresRenderer = false;
    this.rawMessage = areaEffectRawMessage;
    this.payloadBytes = { 260: 20, 274: 56, 275: 44, 276: 48 };
    this.routeTrap = this.process.trap('native CPU-area effect task router', 7, (args) =>
      this.route(args),
    );
    for (const abi of Object.values(this.abi)) this.process.store(abi.vtable + 16, this.routeTrap);
    engine.registerFeature('area-effects', this);
  }
  async create(record, options) {
    const task = new NativeScreenEffectTask(this, record);
    if (!options.restoring) await task.construct();
    return task;
  }
  async route([sender, target, raw, w, l, flags, out]) {
    const senderID = this.world.resolveTaskID(sender, this.engine.currentTaskID);
    if (senderID === null) throw new Error('CPU-area effect sender is outside its Top');
    const value = await this.world.sendNativeEngine(
      target,
      senderID,
      canonicalMessage(this.engine.profile, raw),
      w,
      l,
      {
        nativePointer: true,
        nativeResult: out,
        nativeSenderWorldID: senderID,
        payload: this.platform.memory,
        flags,
        fromHost: true,
      },
    );
    if (out && Number.isInteger(value)) this.process.store(out, value);
    return this.world.resolveTaskID(target, senderID) === null ? 0 : 1;
  }
  snapshot() {
    return { routeTrap: this.routeTrap };
  }
  restore(state) {
    this.routeTrap = state.routeTrap;
  }
  recoverTrap(trap) {
    return trap.name === 'native CPU-area effect task router'
      ? { args: 7, real: false, handler: (args) => this.route(args) }
      : null;
  }
}
export function installNativeAreaEffects(world) {
  world.registerNativeFeature('area-effects', (engine) => NativeAreaEffects.open(engine, world));
  for (const kind of [26, 27, 28])
    world.objects.register(kind, async (record, _objects, options) =>
      (await world.getNativeFeature('area-effects')).create(record, options),
    );
}
