// SPDX-License-Identifier: MPL-2.0
// Both profiles use their original M2PLANE constructor, command handlers and
// frame driver. The SDK's actual task is a SimplePlane without a model driver.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { registerNativeFESObjectType } from './fes-objects.mjs';

export const FES_M2_VERBS = new Set(
  'load play time color m2eff m2att m2fspeed m2prmscale m2body m2iner m2enable_blink m2enable_lip m2splay m2draw m2enable_eff'.split(
    ' ',
  ),
);

export class NativeFESM2 {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return object.nativeType === 33;
  }
  async runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async prepare() {
    if (!nativeABI(this.world.profile).capabilities.emoteFes) return;
    await (await this.world.getNativeFeature('m2')).initialize();
  }
  async update(instance, object, { configurationDirty = false } = {}) {
    if (object.deleted) {
      await this.close(object);
      return;
    }
    await this.prepare();
    const runtime = await this.runtime();
    return runtime.runDriver(instance, object, {
      configurationDirty,
      arguments: [
        object.nativeTaskID == null ? 0 : this.world.nativeTaskID(object.nativeTaskID),
        await runtime.create(instance, object),
      ],
    });
  }
  async command(instance, object, verb, args, context) {
    const runtime = await this.runtime(),
      result = await runtime.command(instance, object, verb, args, context);
    if (verb === 'color') object.color = runtime.process.load(object.nativeObjectPointer + 192);
    return result;
  }
  async close(object) {
    if (object.nativeTaskID != null) {
      if (this.world.objects.objects.has(object.nativeTaskID))
        await this.world.objects.destroy(object.nativeTaskID);
      object.nativeTaskID = null;
    }
    if (object.nativeObjectPointer == null) return;
    await (await this.runtime()).destroy(object.nativeObjectPointer);
    object.nativeObjectPointer = null;
  }
}

export function nativeFESM2Adapter(bridge) {
  return {
    construct: bridge.sdk ? 0x5fd7e0 : 0x75f710,
    driver: bridge.sdk ? 0x52f460 : 0x65fa50,
    verbs: FES_M2_VERBS,
    // M2 messages are profile specific: SDK 498..528, game 524..554.
    // They reach each profile's own task receiver without renumbering.
    canonicalMessage: (message) => message,
    async initialize(runtime, instance, object, pointer) {
      const p = runtime.process,
        definition = object.nativeDefinition || {};
      if (Object.hasOwn(definition, 'FILE')) {
        const text = encodeCP932((object.file ?? instance.text(definition.FILE)) + '\0');
        if (text.length > 256)
          throw new RangeError('Native M2 model program exceeds its 256-byte record');
        const source = p.allocate(text.length);
        try {
          p.write(source, text);
          await runtime.call(bridge.sdk ? 0x5fd890 : 0x75f7c0, [source], pointer);
        } finally {
          p.free(source);
        }
      }
      if (Object.hasOwn(definition, 'COLOR')) {
        // Header callback 7693E0 consumes COLOR as an M2 parameter before
        // the common plane callback. Its base-plane color stays unchanged.
        await runtime.call(
          bridge.sdk ? 0x5fdb00 : 0x75fa30,
          [instance.value(definition.COLOR)],
          pointer,
        );
        object.color = p.load(pointer + 192);
      }
      if (!Object.hasOwn(definition, 'PRI')) object.pri = p.load(pointer + 184) | 0;
    },
    afterDriver(runtime, _instance, object, pointer) {
      object.file = runtime.process.string(pointer + 740);
      object.nativeM2Playing = runtime.process.load(pointer + 1536) !== 0;
    },
  };
}

export function installNativeFESM2(world) {
  registerNativeFESObjectType(world, 33, nativeFESM2Adapter);
  world.m2FES = new NativeFESM2(world);
}
