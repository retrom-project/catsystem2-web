// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../src/kcs/vm.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  appendSceneCheckpoint,
  restoreSceneCheckpoint,
  pruneSceneCheckpoints,
} from '../src/native/scene-checkpoint.mjs';
import { installNativeEngineFiles } from '../src/native/engine-files.mjs';
const bounded = (size) => {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0x10000000)
    throw new RangeError('Native scene checkpoint exceeds its resource limit');
  return size;
};
export const NATIVE_SCENE_CHECKPOINT_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    construct: 0x5b0ba0,
    destroy: 0x5b0f00,
    write: 0x5b0f50,
    read: 0x5b1150,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    construct: 0x492a60,
    destroy: 0x492dc0,
    write: 0x492e10,
    read: 0x493010,
  }),
});
export class NativeSceneCheckpoints {
  constructor(engine, world) {
    Object.assign(this, { engine, world, layout: NATIVE_SCENE_CHECKPOINT_LAYOUTS[engine.profile] });
    if (!this.layout) throw new Error('Native scene checkpoints require a reviewed profile');
    engine.registerFeature('scene-checkpoints', this);
  }
  async selection(filename) {
    await this.world.getNativeFeature('engine-files');
    const p = this.engine.process,
      pointer = p.allocate(32, true),
      name = filename === null ? null : encodeCP932(`@cat/config/${filename}\0`),
      source = name ? p.allocate(name.length, true) : 0;
    if (name) p.write(source, name);
    let ready = false;
    try {
      await this.engine.call(this.layout.construct, [source, 0, 0], pointer);
      ready = true;
      const vector = (offset) => {
        const begin = p.load(pointer + offset),
          end = p.load(pointer + offset + 4);
        if (end < begin || (end - begin) % 4)
          throw new Error('Original scene checkpoint selector returned an invalid vector');
        return Array.from({ length: bounded(end - begin) / 4 }, (_, i) => p.load(begin + 4 * i));
      };
      return { strings: vector(8), variables: vector(20) };
    } finally {
      if (ready) await this.engine.call(this.layout.destroy, [], pointer);
      if (source) p.free(source);
      p.free(pointer);
    }
  }
  async apply(id, args, machine, task) {
    if (args.length !== (id === 0x3e0 ? 4 : 3))
      throw new Error(`Native scene checkpoint 0x${id.toString(16)} has invalid arguments`);
    // 3E0 translates both VM destinations before testing its scene handle.
    const region = (address) => {
      try {
        return machine.region(address >>> 0, 1);
      } catch {
        return null;
      }
    };
    if (id === 0x3e0) {
      region(args[1]);
      region(args[2]);
    }
    const scene = args[0] ? this.world.runtime.handles.get(args[0], 'scene-data') : null;
    if (!scene) return nativeReply(id === 0x3e0 ? 1 : 2, id === 0x3e0 ? 0 : undefined);
    if (id === 0x3e2) {
      await this.selection(null);
      pruneSceneCheckpoints(scene.history, args[1], args[2]);
      return nativeReply(2);
    }
    const selection = await this.selection(
        this.world.runtime.services.format(args.at(-1), machine),
      ),
      variables = this.world.runtime.variableBank(task, false),
      strings = this.world.runtime.stringBank(task, false);
    if (id === 0x3df) {
      await appendSceneCheckpoint(scene.history, args[1], variables, strings, selection);
      return nativeReply(2);
    }
    const ok = await restoreSceneCheckpoint(
      scene.history,
      machine.load(args[1]),
      machine.load(args[2]),
      variables,
      strings,
      selection,
      (index, position) => {
        machine.store(args[1], index);
        machine.store(args[2], position);
      },
    );
    return nativeReply(1, Number(ok));
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeSceneCheckpoints(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature(
    'scene-checkpoints',
    (engine) => new NativeSceneCheckpoints(engine, world),
  );
  for (const id of [0x3df, 0x3e0, 0x3e2])
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('scene-checkpoints')).apply(id, args, machine, task),
    );
}
