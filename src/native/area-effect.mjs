// SPDX-License-Identifier: MPL-2.0
// Original area effects share the mounted view and borrow caller bitmaps.
import { NativeScreenEffectTask } from './screen-effect.mjs';
import { installNativeAreaEffectCommands } from './area-effect-commands.mjs';

const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    17: { construct: 0x5ee010, size: 0x84, vtable: 0x8cdc8c, baseLogic: false },
    18: { construct: 0x5ee060, size: 0x94, vtable: 0x8cdcb0, requiresRenderer: true },
    19: { construct: 0x5ee790, size: 0xd0, vtable: 0x8cdd0c, requiresRenderer: true },
    20: { construct: 0x5ef0d0, size: 0x9c, vtable: 0x8cdd34, requiresRenderer: true },
    21: {
      construct: 0x5ef9e0,
      size: 0xd8,
      vtable: 0x8cdd64,
      requiresRenderer: true,
      baseLogic: false,
    },
    22: { construct: 0x5efad0, size: 0xd4, vtable: 0x8cddb4, baseLogic: false },
    23: { construct: 0x5efb20, size: 0xb8, vtable: 0x8cddd8, baseLogic: false },
    24: { construct: 0x5efb70, size: 0xd0, vtable: 0x8cddfc, baseLogic: false },
    25: { construct: 0x5efbd0, size: 0xb4, vtable: 0x8cde20 },
    26: { construct: 0x5efc30, size: 0xc8, vtable: 0x8cde44 },
    27: { construct: 0x5f0690, size: 0xb0, vtable: 0x8cdef0 },
    28: { construct: 0x5f10e0, size: 0xc4, vtable: 0x8ce004 },
    29: { construct: 0x5f1aa0, size: 0xc8, vtable: 0x8ce0d4 },
    30: { construct: 0x5f22b0, size: 0x4cc, vtable: 0x8ce188, payloadBytes: { 260: 24 } },
    31: { construct: 0x5f2db0, size: 0x4c8, vtable: 0x8ce23c, payloadBytes: { 260: 12 } },
  },
  'sdk-4.01-engine-2.6.1.74': {
    17: { construct: 0x4c8940, size: 0x84, vtable: 0x992f6c, baseLogic: false },
    18: { construct: 0x4c8990, size: 0x94, vtable: 0x992f90, requiresRenderer: true },
    19: { construct: 0x4c90c0, size: 0xd0, vtable: 0x992fec, requiresRenderer: true },
    20: { construct: 0x4c9a00, size: 0x9c, vtable: 0x993014, requiresRenderer: true },
    21: {
      construct: 0x4ca310,
      size: 0xd8,
      vtable: 0x993044,
      requiresRenderer: true,
      baseLogic: false,
    },
    22: { construct: 0x4ca400, size: 0xd4, vtable: 0x993094, baseLogic: false },
    23: { construct: 0x4ca450, size: 0xb8, vtable: 0x9930b8, baseLogic: false },
    24: { construct: 0x4ca4b0, size: 0xd0, vtable: 0x9930dc, baseLogic: false },
    25: { construct: 0x4ca500, size: 0xb4, vtable: 0x993100 },
    26: { construct: 0x4ca560, size: 0xc8, vtable: 0x993124 },
    27: { construct: 0x4caf30, size: 0xb0, vtable: 0x9931d0 },
    28: { construct: 0x4cb950, size: 0xc4, vtable: 0x9932e4 },
    29: { construct: 0x4cc2e0, size: 0xc8, vtable: 0x9933b4 },
    30: { construct: 0x4ccac0, size: 0x4cc, vtable: 0x993468, payloadBytes: { 260: 24 } },
    31: { construct: 0x4cd560, size: 0x4c8, vtable: 0x99351c, payloadBytes: { 260: 12 } },
  },
};
export function areaEffectRawMessage(profile, message) {
  if (!profile.startsWith('sdk-')) return message;
  return message >= 257 && message <= 278 ? message - 5 : message >= 39 ? message - 2 : message;
}
function areaEffectCanonicalMessage(profile, message) {
  if (!profile.startsWith('sdk-')) return message;
  return message >= 252 && message <= 273 ? message + 5 : message >= 37 ? message + 2 : message;
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
    this.payloadBytes = {
      260: 20,
      263: 20,
      264: 20,
      266: 40,
      267: 12,
      274: 56,
      275: 44,
      276: 48,
      277: 60,
      278: 52,
    };
    this.routeTrap = this.process.trap('native CPU-area effect task router', 7, (args) =>
      this.route(args),
    );
    for (const abi of Object.values(this.abi)) this.process.store(abi.vtable + 16, this.routeTrap);
    engine.registerFeature('area-effects', this);
  }
  async create(record, options) {
    const task = new NativeScreenEffectTask(this, record);
    if (!options.restoring) {
      if (task.abi.requiresRenderer) await this.platform.ensureRenderer();
      await task.construct();
    }
    return task;
  }
  async route([sender, target, raw, w, l, flags, out]) {
    const senderID = this.world.resolveTaskID(sender, this.engine.currentTaskID);
    if (senderID === null) throw new Error('CPU-area effect sender is outside its Top');
    const context = {
        nativePointer: true,
        nativeResult: out,
        nativeSenderWorldID: senderID,
        payload: this.platform.memory,
        flags,
        fromHost: true,
      },
      value = await this.world.sendNativeEngine(
        target,
        senderID,
        areaEffectCanonicalMessage(this.engine.profile, raw),
        w,
        l,
        context,
      );
    if (raw !== 1 && out && Number.isInteger(value)) this.process.store(out, value);
    return Number(Boolean(context.nativeRouted));
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
  for (const kind of [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
    world.objects.register(kind, async (record, _objects, options) =>
      (await world.getNativeFeature('area-effects')).create(record, options),
    );
  installNativeAreaEffectCommands(world);
}
