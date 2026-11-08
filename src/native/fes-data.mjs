// SPDX-License-Identifier: MPL-2.0
// STRTABLE and FILELIST are base data objects. Their original constructors,
// definitions and commands execute in the shared process; neither has a frame
// driver or a renderer child in 628D60 / 500390 and 62DA50 / 504E50.
import { registerNativeFESObjectType } from './fes-objects.mjs';

const ABI = {
  game: {
    34: { construct: 0x764620, apply: 0x769440 },
    35: { construct: 0x765530, apply: 0x769460 },
  },
  sdk: {
    34: { construct: 0x6002e0, apply: 0x605630 },
    35: { construct: 0x6011f0, apply: 0x605650 },
  },
};

export class NativeFESData {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return [34, 35].includes(object.nativeType);
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    return (await this.world.getNativeFeature('fes-objects')).create(instance, object);
  }
  async command(instance, object, verb, args, context) {
    return (await this.world.getNativeFeature('fes-objects')).command(
      instance,
      object,
      verb,
      args,
      {
        ...context,
        setStringBytes: (index, bytes) => {
          const record = this.world.objects.objects.get(instance.runtimeID),
            bank = this.world.runtime.handles.get(record.context.stringBank, 'string-bank');
          bank.setBytes(index, bytes);
        },
      },
    );
  }
  async close(object) {
    if (object.nativeObjectPointer == null) return;
    await (await this.world.getNativeFeature('fes-objects')).destroy(object.nativeObjectPointer);
    object.nativeObjectPointer = null;
  }
}

export function installNativeFESData(world) {
  world.dataFES = new NativeFESData(world);
  for (const type of [34, 35])
    registerNativeFESObjectType(world, type, (runtime) => {
      const abi = ABI[runtime.sdk ? 'sdk' : 'game'][type];
      return {
        construct: abi.construct,
        size: 0x34,
        definitionApply: abi.apply,
        verbs: new Set(runtime.table.keys()),
        vramOffset: null,
        async initialize(runtime, instance, object, pointer) {
          if (type === 34) await runtime.world.getNativeFeature('engine-files');
          await runtime.applyDefinition(instance, object, pointer, abi.apply);
        },
        syncObject() {},
      };
    });
}
