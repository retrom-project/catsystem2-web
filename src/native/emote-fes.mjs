// SPDX-License-Identifier: MPL-2.0
// FES M2 state owns its typed plane and script parameters; kind54 owns models.
import { nativeABI } from './abi/index.mjs';
import { NativeSoundPacket } from './sound.mjs';
import { fesPlaneRenderingState } from './fes-plane-driver.mjs';
import { initializeFESPlane } from './fes-object-factory.mjs';
import { markFESObjectDirty } from './fes-common-model.mjs';
import { floatBits } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export const FES_M2_VERBS = new Set(
  'load play time color m2eff m2att m2fspeed m2prmscale m2body m2iner m2enable_blink m2enable_lip m2splay m2draw m2enable_eff'.split(
    ' ',
  ),
);
export function initializeFESM2(object) {
  if (object.nativeType !== 33) throw new TypeError('Expected FES M2PLANE');
  initializeFESPlane(object);
  object.sizeDirty = true;
  object.nativeM2State = {
    program: '',
    filePending: false,
    body: '',
    bodyDirty: false,
    playing: 1,
    effects: 0,
    effectsDirty: false,
    tone: [100, 100, 100],
    tonePending: false,
  };
  return object;
}
export class NativeFESM2 {
  constructor(world) {
    this.world = world;
    this.packets = new WeakMap();
    this.activeTasks = new WeakMap();
  }
  supports(object) {
    return object.nativeType === 33;
  }
  state(_instance, object) {
    if (!this.supports(object) || !object.nativeM2State)
      throw new Error('FES M2PLANE requires its pure typed initializer');
    return object.nativeM2State;
  }
  applyDefinition(instance, object, record) {
    const state = this.state(instance, object),
      fields = record.fields;
    if (fields.has('FILE')) this.setFile(object, fields.get('FILE'));
    if (fields.has('COLOR')) {
      state.effects = fields.get('COLOR') >>> 0;
      state.effectsDirty = true;
      // Both registered appliers consume this presence bit in the shared row.
      fields.delete('COLOR');
    }
    return true;
  }
  setFile(object, name) {
    const state = this.state(null, object),
      value = String(name);
    if (state.program.toLowerCase() !== value.toLowerCase()) {
      state.program = object.file = value;
      state.filePending = true;
    }
  }
  async initialize(_instance, object, { restoring = false } = {}) {
    this.state(null, object);
    if (restoring && object.nativeTaskID != null) this.validate(_instance, object);
  }
  validate(instance, object) {
    const record = this.world.objects.objects.get(this.taskID(object));
    if (!record || record.kind !== 54 || record.parent !== instance.runtimeID)
      throw new Error('FES M2 child has no owned kind54 World task');
    return record;
  }
  taskID(object) {
    return this.activeTasks.has(object) ? this.activeTasks.get(object) : object.nativeTaskID;
  }
  packet(object) {
    let packet = this.packets.get(object);
    if (!packet) {
      packet = new NativeSoundPacket([], 512);
      this.packets.set(object, packet);
    }
    packet.data.fill(0);
    return packet;
  }
  async send(instance, object, message, w = 0, l = 0, packet = null) {
    if (this.taskID(object) == null) return undefined;
    const task = this.validate(instance, object).implementation;
    if (!task) throw new Error('FES M2 World task is not restored');
    const sdk = nativeABI(this.world.profile).plugins.emoteDriver === 'placeholder',
      raw = sdk ? (message >= 524 ? message - 26 : message >= 39 ? message - 2 : message) : message;
    return task.message([instance.runtimeID, raw, w, l], {
      payload: packet,
      nativeSenderWorldID: instance.runtimeID,
    });
  }
  async update(instance, object, options = {}) {
    const had = this.activeTasks.has(object),
      previous = this.activeTasks.get(object);
    this.activeTasks.set(
      object,
      Object.hasOwn(options, 'previousTaskID') ? options.previousTaskID : object.nativeTaskID,
    );
    try {
      return await this.drive(instance, object, options);
    } finally {
      if (had) this.activeTasks.set(object, previous);
      else this.activeTasks.delete(object);
    }
  }
  async drive(instance, object, { restoring = false } = {}) {
    const state = this.state(instance, object);
    if (restoring) {
      if (object.nativeTaskID != null) this.validate(instance, object);
      return;
    }
    if (object.sizeDirty) {
      if (this.taskID(object) != null && this.world.objects.objects.has(this.taskID(object)))
        await this.world.objects.destroy(this.taskID(object), instance.runtimeID);
      object.nativeTaskID = await this.world.objects.create({
        kind: 54,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: 'M2Plane',
      });
      this.activeTasks.set(object, object.nativeTaskID);
      object.sizeDirty = false;
    }
    if (state.filePending) {
      const packet = this.packet(object);
      await this.send(instance, object, 537, 0, 4, packet);
      if (state.tone.some((value, i) => value !== packet.load(4 + i * 4))) {
        state.tone.forEach((value, i) => packet.store(4 + i * 4, value));
        await this.send(instance, object, 525, 0, 4, packet);
        await this.send(instance, object, 536, 0, 4, packet);
      }
      const bytes = encodeCP932(state.program),
        text = new NativeSoundPacket([], Math.max(512, bytes.length + 5));
      text.writeString(state.program, 4);
      await this.send(instance, object, 524, 0, 4, text);
      const output = this.packet(object);
      await this.send(instance, object, 534, 0, 4, output);
      state.body = output.string(4);
      state.filePending = false;
    }
    if (state.bodyDirty) {
      state.bodyDirty = false;
      const text = new NativeSoundPacket([], Math.max(512, encodeCP932(state.body).length + 5));
      text.writeString(state.body, 4);
      await this.send(instance, object, 533, 1, 4, text);
    }
    const sleeping = !!instance.player.nativeInput?.state.sleeping;
    if (object.dirty) {
      if (object.positionPending) {
        const metadata = await instance.runtime.planes.metadata(
          instance,
          object,
          object.positionReference,
        );
        object.x = Math.fround(metadata.getInt32(0, true));
        object.y = Math.fround(metadata.getInt32(4, true));
        object.positionPending = false;
      }
      const transform = fesPlaneRenderingState(instance, object),
        vector = async (message, values) => {
          const p = this.packet(object);
          values.forEach((v, i) => p.store(4 + i * 4, floatBits(v)));
          await this.send(instance, object, message, 0, 4, p);
        };
      await vector(51, transform.position);
      await vector(49, [transform.base[0], transform.base[1], Math.fround(object.pri)]);
      await vector(66, transform.scale);
      const matrix = this.packet(object);
      transform.matrix.forEach((value, i) => matrix.store(4 + i * 4, floatBits(value)));
      await this.send(instance, object, 57, 0, 4, matrix);
      await this.send(instance, object, 59, 1, object.color);
      await this.send(instance, object, 47, 0, Number(object.disp && !sleeping));
      await this.send(instance, object, 526, 0, state.playing);
      object.dirty = false;
    } else if (object.m2SleepMask !== undefined && object.m2SleepMask !== sleeping)
      await this.send(instance, object, 47, 0, Number(object.disp && !sleeping));
    object.m2SleepMask = sleeping;
    if (state.effectsDirty) {
      state.effectsDirty = false;
      await this.send(instance, object, 546, 0, state.effects);
    }
    object.nativeM2Playing = Boolean(await this.send(instance, object, 528));
  }
  async command(instance, object, verb, args, context = {}) {
    const state = this.state(instance, object),
      p = (i, d = 0) =>
        args[i] === undefined
          ? d
          : context.argument
            ? context.argument(i)
            : instance.value(args[i]);
    if (verb === 'load')
      this.setFile(
        object,
        args.length ? (context.text ? context.text(0) : instance.text(args[0])) : '',
      );
    else if (verb === 'm2body') {
      state.body = args.length ? (context.text ? context.text(0) : instance.text(args[0])) : '';
      state.bodyDirty = true;
    } else if (verb === 'color') {
      object.color = p(0, 0xffffffff) >>> 0;
      object.alpha = object.color >>> 24;
      markFESObjectDirty(instance, object);
    } else if (verb === 'm2enable_eff') {
      state.effects = p(0, 1) >>> 0;
      state.effectsDirty = true;
    } else if (!FES_M2_VERBS.has(verb)) throw new Error('Unknown FES M2 command ' + verb);
    // Complete frozen FES handlers prove the other listed M2 verbs inert.
    return 0;
  }
  async close(object) {
    if (object.nativeTaskID != null && this.world.objects.objects.has(object.nativeTaskID))
      await this.world.objects.destroy(object.nativeTaskID);
    object.nativeTaskID = null;
  }
}
export function installNativeFESM2(world) {
  world.m2FES = new NativeFESM2(world);
}
