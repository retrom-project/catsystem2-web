// SPDX-License-Identifier: MPL-2.0
// FES control objects keep their own native records; their child tasks own the
// input planes and renderer descriptors created by the original drivers.
import { motionRegisters } from '../motion/definitions.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
const ABI = {
  game: {
    13: {
      construct: 0x74d120,
      apply: 0x768940,
      driver: 0x662580,
      size: 0x1fc,
      task: 492,
      value: 328,
      priority: 484,
      display: 0x74d300,
      setValue: 0x74d390,
    },
    14: {
      construct: 0x74d740,
      apply: 0x768a70,
      driver: 0x662220,
      size: 0x234,
      task: 524,
      value: 364,
      priority: 520,
      display: 0x74d8f0,
      setValue: 0x74d980,
    },
    15: {
      construct: 0x74de60,
      apply: 0x768b20,
      driver: 0x6627f0,
      size: 0x230,
      task: 520,
      value: 364,
      priority: 516,
      display: 0x74e010,
      setValue: 0x74e0a0,
    },
  },
  sdk: {
    13: {
      construct: 0x5ed570,
      apply: 0x604bd0,
      driver: 0x531f70,
      size: 0x1fc,
      task: 492,
      value: 328,
      priority: 484,
      display: 0x5ed750,
      setValue: 0x5ed7e0,
    },
    14: {
      construct: 0x5edb60,
      apply: 0x604d00,
      driver: 0x531c10,
      size: 0x234,
      task: 524,
      value: 364,
      priority: 520,
      display: 0x5edd10,
      setValue: 0x5edda0,
    },
    15: {
      construct: 0x5ee250,
      apply: 0x604db0,
      driver: 0x5321e0,
      size: 0x230,
      task: 520,
      value: 364,
      priority: 516,
      display: 0x5ee400,
      setValue: 0x5ee490,
    },
  },
};
const layout = (runtime, object) => ABI[runtime.sdk ? 'sdk' : 'game'][object.nativeType];
function pull(runtime, object, pointer) {
  const p = runtime.process,
    abi = layout(runtime, object);
  object.value = p.load(pointer + abi.value) | 0;
  object.pri = p.load(pointer + abi.priority) | 0;
  object.alpha = p.load(pointer + { 13: 500, 14: 536, 15: 532 }[object.nativeType]);
  object.motionDelay = p.load(pointer + 40);
  if (!object.nativeControlSleeping) {
    object.disp = !!p.load(pointer + 316);
    object.enable = !!p.load(pointer + 20);
  }
  object.x = p.load(pointer + 300) | 0;
  object.y = p.load(pointer + 304) | 0;
  if (object.nativeType !== 13) {
    object.width = (p.load(pointer + 308) | 0) - object.x;
    object.height = (p.load(pointer + 312) | 0) - object.y;
  }
}
export class NativeFESControls {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return [13, 14, 15].includes(object.nativeType);
  }
  async runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    const runtime = await this.runtime(),
      pointer = await runtime.create(instance, object);
    if (object.nativeTaskID == null)
      object.nativeTaskID = await this.world.objects.create({
        kind: { 13: 40, 14: 41, 15: 42 }[object.nativeType],
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name:
          object.nativeType === 15
            ? 'FE slider'
            : object.nativeType === 14
              ? 'FE scroll2'
              : 'FE scroll',
      });
    runtime.process.store(
      pointer + layout(runtime, object).task,
      this.world.nativeTaskID(object.nativeTaskID),
    );
    return runtime;
  }
  async update(instance, object, options) {
    if (object.deleted) return this.close(object);
    const runtime = await this.initialize(instance, object);
    return runtime.runDriver(instance, object, options);
  }
  async command(instance, object, verb, args, context) {
    const runtime = await this.runtime(),
      result = await runtime.command(instance, object, verb, args, context);
    pull(runtime, object, object.nativeObjectPointer);
    object.nativeMotionBusy = !!(await runtime.call(
      runtime.sdk ? 0x5e8fb0 : 0x748990,
      [],
      object.nativeObjectPointer,
      instance.runtimeID,
    ));
    return result;
  }
  async advance(instance, object) {
    if (object.deleted) return;
    const runtime = await this.runtime(),
      pointer = await runtime.create(instance, object);
    await advanceNative(runtime, instance, object, pointer);
  }
  motion(instance, object, definition, args) {
    return runNativeFESObjectMotion(this, instance, object, definition, args);
  }

  async message(record, player, [sender, message, , value], context = {}) {
    if (!player?.root) return;
    const instance = player.root,
      senderWorldID = context.nativeSenderWorldID ?? this.world.resolveTaskID(sender, record.id);
    await player.nativeInput.updateMouse();
    for (const object of instance.objects)
      if (this.supports(object) && !object.deleted && object.nativeTaskID === senderWorldID) {
        if (message === 27) {
          const runtime = await this.runtime(),
            pointer = await runtime.create(instance, object);
          await runtime.call(layout(runtime, object).setValue, [value, 0], pointer, record.id);
          pull(runtime, object, pointer);
          await player.nativeEvent(object.key, 'SCRL_P');
        } else await player.nativeEvent(object.key, value === 0 ? 'UNFOCUS' : 'FOCUS');
      }
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
export function nativeFESControlAdapter(runtime, type) {
  const abi = ABI[runtime.sdk ? 'sdk' : 'game'][type];
  return {
    construct: abi.construct,
    size: abi.size,
    definitionApply: abi.apply,
    driver: abi.driver,
    verbs: new Set(runtime.table.keys()),
    vramOffset: null,
    canonicalMessage: (message) =>
      runtime.sdk
        ? message >= 348
          ? message + 5
          : message >= 37
            ? message + 2
            : message
        : message,
    async initialize(runtime, instance, object, pointer) {
      await runtime.applyDefinition(instance, object, pointer, abi.apply);
      pull(runtime, object, pointer);
    },
    afterDefinition: pullAfterDefinition,
    async syncObject(runtime, instance, object, pointer) {
      const sleeping = !!instance.player.nativeInput?.state.sleeping;
      if (sleeping !== !!object.nativeControlSleeping) {
        await runtime.call(
          abi.display,
          [sleeping ? 0 : Number(object.disp)],
          pointer,
          instance.runtimeID,
        );
        await runtime.call(
          runtime.sdk ? 0x5e8ea0 : 0x748880,
          [sleeping ? 0 : Number(object.enable)],
          pointer,
          instance.runtimeID,
        );
        object.nativeControlSleeping = sleeping;
      }
    },
    async beforeDriver(runtime, instance, object, pointer) {
      await advanceNative(runtime, instance, object, pointer);
      const surface = instance.player.surface;
      if (surface == null)
        throw new Error('Native FES control driver requires its renderer surface');
      runtime.process.store(runtime.driver + 408, runtime.world.nativeTaskID(surface));
    },
    afterDriver(runtime, instance, object, pointer) {
      pull(runtime, object, pointer);
    },
  };
}
function pullAfterDefinition(runtime, instance, object, pointer) {
  pull(runtime, object, pointer);
}
async function advanceNative(runtime, instance, object, pointer) {
  const record = runtime.world.objects.objects.get(instance.runtimeID),
    frame = ((record.effectiveFrame ?? 0) - (record.pausedFrames ?? 0)) >>> 0;
  if (object.nativeControlMotionFrame !== frame) {
    await runtime.call(
      runtime.process.load(runtime.process.load(pointer) + 8),
      [frame],
      pointer,
      instance.runtimeID,
    );
    object.nativeControlMotionFrame = frame;
  }
  object.nativeMotionBusy = !!(await runtime.call(
    runtime.sdk ? 0x5e8fb0 : 0x748990,
    [],
    pointer,
    instance.runtimeID,
  ));
  pull(runtime, object, pointer);
}

export async function runNativeFESObjectMotion(service, instance, object, definition, args) {
  const runtime = await service.runtime(),
    p = runtime.process,
    pointer = await runtime.create(instance, object);
  await service.world.getNativeFeature('engine-files');
  if (!(await runtime.call(runtime.sdk ? 0x5e8fb0 : 0x748990, [], pointer, instance.runtimeID)))
    await runtime.call(p.load(p.load(pointer) + 4), [], pointer, instance.runtimeID);
  const state = p.read(p.load(pointer + 24) + 4, 144),
    registers = motionRegisters(definition, args, state, (expression, current) =>
      instance.value(expression, current),
    ),
    name = `@cat/mot/${definition.file}`,
    fileBytes = runtime.sdk ? encodeCP932(name + '\0') : new Uint8Array((name.length + 1) * 2),
    file = p.allocate(fileBytes.length, true),
    values = p.allocate(Math.max(4, registers.length * 4), true);
  if (!runtime.sdk) {
    const view = new DataView(fileBytes.buffer);
    for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
  }
  p.write(file, fileBytes);
  const registerBytes = new Uint8Array(new Float32Array(registers).buffer);
  p.write(values, registerBytes);
  try {
    await runtime.call(
      runtime.sdk ? 0x5e8ef0 : 0x7488d0,
      [file, values, registers.length, 0, 0, 0],
      pointer,
      instance.runtimeID,
    );
    object.nativeControlMotionFrame = null;
    object.nativeImageMotionFrame = null;
    object.nativeMotionBusy = !!(await runtime.call(
      runtime.sdk ? 0x5e8fb0 : 0x748990,
      [],
      pointer,
      instance.runtimeID,
    ));
  } finally {
    p.free(file);
    p.free(values);
  }
}
