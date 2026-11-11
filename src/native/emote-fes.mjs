// SPDX-License-Identifier: MPL-2.0
// M2PLANE's model parameters and frame driver belong to JS. D7 may still
// borrow its common plane/motion prefix; it never receives an M2 suffix.
import { nativeABI } from './abi/index.mjs';
import { registerNativeFESObjectType } from './fes-objects.mjs';
import { NativeSoundPacket } from './sound.mjs';
import { planeState } from './fes-graphics.mjs';
import { MOTION_ABI } from '../motion/abi.mjs';
import { floatBits } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export const FES_M2_VERBS = new Set(
  'load play time color m2eff m2att m2fspeed m2prmscale m2body m2iner m2enable_blink m2enable_lip m2splay m2draw m2enable_eff'.split(
    ' ',
  ),
);
export class NativeFESM2 {
  constructor(world) {
    this.world = world;
    this.packets = new WeakMap();
  }
  supports(object) {
    return object.nativeType === 33;
  }
  state(instance, object) {
    if (!object.nativeM2State) {
      const definition = object.nativeDefinition ?? {},
        color = Object.hasOwn(definition, 'COLOR') ? instance.value(definition.COLOR) >>> 0 : 0;
      object.nativeM2State = {
        program: object.file ?? '',
        loaded: null,
        body: '',
        bodyDirty: false,
        playing: 1,
        effects: color,
        effectsDirty: Object.hasOwn(definition, 'COLOR'),
      };
      // COLOR is consumed by the M2 header callback, before common-plane COLOR.
      object.color = 0xffffffff;
      if (!Object.hasOwn(definition, 'PRI')) object.pri = 5000;
    }
    return object.nativeM2State;
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    this.state(instance, object);
    if (object.nativeTaskID == null)
      object.nativeTaskID = await this.world.objects.create({
        kind: 54,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: 'FE M2 plane',
      });
  }
  async send(instance, object, message, w = 0, l = 0, packet = this.packets.get(object)) {
    const task = this.world.objects.objects.get(object.nativeTaskID)?.implementation;
    if (!task) return undefined;
    const sdk = nativeABI(this.world.profile).plugins.emoteDriver === 'placeholder',
      raw = sdk ? (message >= 524 ? message - 26 : message >= 39 ? message - 2 : message) : message;
    return task.message([instance.runtimeID, raw, w, l], {
      payload: packet,
      nativeSenderWorldID: instance.runtimeID,
    });
  }
  async update(instance, object) {
    if (object.deleted) return this.close(object);
    await this.initialize(instance, object);
    const state = this.state(instance, object),
      text = (value) => {
        const p = new NativeSoundPacket([], Math.max(128, encodeCP932(value).length + 5));
        p.writeString(value, 4);
        return p;
      };
    if (state.loaded !== state.program) {
      await this.send(instance, object, 524, 0, 4, text(state.program));
      state.loaded = state.program;
      if (!state.bodyDirty) {
        const packet = new NativeSoundPacket([], 512);
        await this.send(instance, object, 534, 0, 4, packet);
        state.body = packet.string(4);
      }
    }
    if (state.bodyDirty) {
      await this.send(instance, object, 533, 1, 4, text(state.body));
      state.bodyDirty = false;
    }
    let packet = this.packets.get(object);
    if (!packet) {
      packet = new NativeSoundPacket();
      this.packets.set(object, packet);
    }
    const bytes = planeState(instance, object),
      view = new DataView(bytes.buffer, bytes.byteOffset),
      position = [0, 1, 2].map((i) => view.getUint32(MOTION_ABI.pos + i * 4, true)),
      scale = [0, 1, 2].map((i) => view.getUint32(MOTION_ABI.scale + i * 4, true));
    position[2] = floatBits(object.pri);
    position.forEach((word, i) => packet.store(4 + i * 4, word));
    await this.send(instance, object, 51, 0, 4, packet);
    packet.store(4, 0);
    packet.store(8, 0);
    await this.send(instance, object, 49, 0, 4, packet);
    scale.forEach((word, i) => packet.store(4 + i * 4, word));
    await this.send(instance, object, 66, 0, 4, packet);
    packet.store(4, 0);
    packet.store(8, 0);
    packet.store(12, floatBits(object.rotation));
    await this.send(instance, object, 55, 0, 4, packet);
    await this.send(instance, object, 59, 1, object.color >>> 0);
    await this.send(
      instance,
      object,
      47,
      0,
      Number(object.disp && !instance.player.nativeInput?.state.sleeping),
    );
    await this.send(instance, object, 526, 0, state.playing);
    if (state.effectsDirty) {
      await this.send(instance, object, 546, 0, state.effects);
      state.effectsDirty = false;
    }
    object.nativeM2Playing = Boolean(await this.send(instance, object, 528));
  }
  async command(instance, object, verb, args) {
    const state = this.state(instance, object);
    if (verb === 'load') state.program = object.file = args.length ? instance.text(args[0]) : '';
    else if (verb === 'm2body') {
      state.body = args.length ? instance.text(args[0]) : '';
      state.bodyDirty = true;
    } else if (verb === 'color') {
      object.color = args.length ? instance.value(args[0]) >>> 0 : 0xffffffff;
      object.alpha = object.color >>> 24;
    } else if (verb === 'm2enable_eff') {
      state.effects = args.length ? instance.value(args[0]) >>> 0 : 1;
      state.effectsDirty = true;
    }
    // The reviewed SDK/game FES handlers for the other M2 verbs are inert.
    // Task/native commands with similar names are separate, active entry points.
    return 0;
  }
  async close(object) {
    if (object.nativeTaskID != null) {
      if (this.world.objects.objects.has(object.nativeTaskID))
        await this.world.objects.destroy(object.nativeTaskID);
      object.nativeTaskID = null;
    }
    if (object.nativeObjectPointer != null) {
      await (await this.world.getNativeFeature('fes-objects')).destroy(object.nativeObjectPointer);
      object.nativeObjectPointer = null;
    }
  }
}
export function installNativeFESM2(world) {
  registerNativeFESObjectType(world, 33, () => ({
    vramOffset: null,
    construct: (runtime, instance, object, pointer, args) =>
      runtime.constructPlane(instance, object, pointer, args),
  }));
  world.m2FES = new NativeFESM2(world);
}
