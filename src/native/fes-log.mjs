// SPDX-License-Identifier: MPL-2.0
// LOGSTRING owns layout/display slots and creates STRING children. Its first
// fields after the 44-byte base are not the plane/KX2 record.

export class NativeFESLog {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return [24, 38].includes(object.nativeType);
  }
  async runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async update(instance, object, options) {
    if (object.deleted) return this.close(object);
    return (await this.runtime()).runDriver(instance, object, options);
  }
  async command(instance, object, verb, args, context) {
    if (verb === 'setlog' && args.length) {
      const logs = await this.world.getNativeFeature('display-logs');
      args = [String(logs.pointer(instance.value(args[0]))), ...args.slice(1)];
    }
    const runtime = await this.runtime(),
      result = await runtime.command(instance, object, verb, args, context);
    pullLog(runtime, object, object.nativeObjectPointer);
    return result;
  }
  async close(object) {
    if (object.nativeObjectPointer == null) return;
    await (await this.runtime()).destroy(object.nativeObjectPointer);
    object.nativeObjectPointer = null;
  }
}

const LOG_ABI = {
  game: {
    construct: 0x75e0a0,
    driver: 0x65f710,
    count: 0x75e590,
    vram: 0x75e980,
    priority: 0x75e8e0,
    position: 0x75e750,
    size: 0x75e810,
    display: 0x75e610,
    configureChildren: 0x75e3e0,
  },
  sdk: {
    construct: 0x5fc1d0,
    driver: 0x52f300,
    count: 0x5fc6c0,
    vram: 0x5fcab0,
    priority: 0x5fca10,
    position: 0x5fc880,
    size: 0x5fc940,
    display: 0x5fc740,
    configureChildren: 0x5fc510,
  },
  utf8: {
    construct: 0x75fcb0,
    driver: 0x65f870,
    count: 0x760320,
    vram: 0x760890,
    priority: 0x7607c0,
    position: 0x760630,
    size: 0x7606f0,
    display: 0x7603a0,
    configureChildren: 0x760050,
  },
};
function pullLog(runtime, object, pointer) {
  const p = runtime.process;
  object.count = p.load(pointer + 52);
  object.top = p.load(pointer + 56) | 0;
  object.width = p.load(pointer + 340);
  object.height = p.load(pointer + 344);
  object.pri = p.load(pointer + 356) | 0;
  object.disp = !!p.load(pointer + 368);
}
export function nativeFESLogAdapter(runtime, type) {
  if (type === 38 && runtime.sdk) throw new Error('The frozen SDK has no LOGSTRING8 constructor');
  const abi = LOG_ABI[runtime.sdk ? 'sdk' : type === 38 ? 'utf8' : 'game'];
  return {
    construct: abi.construct,
    driver: abi.driver,
    size: type === 38 ? 0x1c4 : 0x1bc,
    verbs: new Set(runtime.table.keys()),
    definitionApply: runtime.sdk ? 0x6051f0 : type === 38 ? 0x769000 : 0x768f60,
    async initialize(runtime, instance, object, pointer) {
      await runtime.applyDefinition(
        instance,
        object,
        pointer,
        runtime.sdk ? 0x6051f0 : type === 38 ? 0x769000 : 0x768f60,
      );
      pullLog(runtime, object, pointer);
    },
    afterDefinition(runtime, instance, object, pointer) {
      pullLog(runtime, object, pointer);
    },
    async syncObject(runtime, instance, object, pointer) {
      const p = runtime.process,
        offset = instance.player.nativeDraw?.offset ?? [0, 0],
        previous = object.nativeLogSurfaceOffset || [0, 0];
      if (offset[0] !== previous[0] || offset[1] !== previous[1]) {
        await runtime.call(
          abi.vram,
          [
            p.load(pointer + 348) + offset[0] - previous[0],
            p.load(pointer + 352) + offset[1] - previous[1],
          ],
          pointer,
        );
        await runtime.call(abi.configureChildren, [], pointer);
        object.nativeLogSurfaceOffset = [...offset];
      }
    },
    afterDriver(runtime, instance, object, pointer) {
      pullLog(runtime, object, pointer);
    },
  };
}
