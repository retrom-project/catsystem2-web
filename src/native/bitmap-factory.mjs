// SPDX-License-Identifier: MPL-2.0
// Script-owned bitmap handles and their automatic task lifetime live in JS.
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument } from './data-text.mjs';

export const NATIVE_BITMAP_FACTORY_CONTRACTS = Object.freeze(
  [
    [0x6f, 1, 1],
    [0x70, 2, 1],
    [0x72, 1, 2],
    [0x75, 6, 2],
    [0x76, 1, 1],
    [0x77, 3, 2],
    [0x79, 4, 2],
  ].map(([id, words, control]) => Object.freeze({ id, words, control })),
);
const contracts = new Map(NATIVE_BITMAP_FACTORY_CONTRACTS.map((entry) => [entry.id, entry]));

export class NativeBitmapFactories {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine, task) {
    if (!contracts.has(id)) return undefined;
    const argument = (index) => nativeDataArgument(args, machine, index),
      images = this.world.graphics.images,
      value = (word) => nativeReply(1, word),
      done = () => nativeReply(2),
      handle = argument(0) >>> 0;
    switch (id) {
      case 0x6f: {
        const loaded = await images.formattedLoad(
          this.world.runtime.services.format(handle, machine),
          task.id,
        );
        if (loaded) {
          const bitmap = images.get(loaded);
          if (bitmap.state.bpp === 3) bitmap.state.bpp = 4;
          await bitmap.hasAlpha();
        }
        return value(loaded);
      }
      case 0x70:
        return value(images.create(handle, argument(1) >>> 0, task.id));
      case 0x72:
        if (handle) await images.release(handle);
        return done();
      case 0x75:
        if (handle) {
          const bitmap = images.get(handle),
            x = argument(1) | 0,
            y = argument(2) | 0,
            width = argument(3) | 0,
            height = argument(4) | 0;
          await bitmap.fill(x, bitmap.height - y - height, width, height, argument(5));
        } else await this.world.graphics.fill(...[1, 2, 3, 4].map(argument));
        return done();
      case 0x76: {
        if (!handle) return value(0);
        const copy = images.get(handle).clone();
        copy.owner = task.id;
        return value(images.add(copy));
      }
      case 0x77: {
        const bitmap = handle ? images.get(handle) : null;
        machine.store(argument(1), bitmap?.width ?? 0);
        machine.store(argument(2), bitmap?.height ?? 0);
        return done();
      }
      case 0x79:
        if (handle) await images.get(handle).tone(argument(1), argument(2), argument(3));
        return done();
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeBitmapFactories(world) {
  const factories = new NativeBitmapFactories(world);
  world.bitmapFactories = factories;
  world.registerNativeFeature('bitmap-factories', (engine) => {
    engine.registerFeature('bitmap-factories', factories);
    return factories;
  });
}
