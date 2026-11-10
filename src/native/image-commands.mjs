// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument, nativeDataMapped, nativeDataFormat } from './data-text.mjs';
import { bitmapBlur, bitmapTransfer } from './bitmap-pixels.mjs';
export const NATIVE_IMAGE_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x73, 10, 2],
    [0x74, 10, 2],
    [0x78, 4, 2],
    [0x1be, 2, 1],
    [0x218, 7, 1],
    [0x219, 2, 1],
    [0x21a, 3, 2],
    [0x2a9, 1, 2],
  ].map(([id, words, control]) => Object.freeze({ id, words, control })),
);
export class NativeImageCommands {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine, task) {
    const a = (i) => nativeDataArgument(args, machine, i),
      h = a(0) >>> 0,
      images = this.world.graphics.images;
    const done = () => nativeReply(2),
      value = (v) => nativeReply(1, v);
    if (id === 0x2a9) {
      const text = nativeDataFormat(args, machine, this.world.runtime.services, 0),
        handle = text
          ? await this.world.imageComposites.load(new TextDecoder('shift_jis').decode(text))
          : 0;
      if (handle) await images.release(handle);
      return done();
    }
    if (id === 0x73 || id === 0x74) {
      if (!a(5) || (id === 0x74 && !h)) return done();
      await bitmapTransfer(
        this.world,
        h ? images.get(h) : null,
        images.get(a(5)),
        Array.from({ length: 10 }, (_, i) => a(i)),
        id === 0x74,
        task,
      );
      return done();
    }
    if (id === 0x219) {
      if (!h || !a(1)) return value(0);
      const target = images.get(h),
        source = images.get(a(1));
      if (target.state !== source.state) {
        const attrs = new Map((target.state.attributes ?? []).map((v) => [v.id, v]));
        for (const attr of source.state.attributes ?? []) attrs.set(attr.id, structuredClone(attr));
        target.state.attributes = [...attrs.values()].sort((a, b) => a.id - b.id);
        await target.changed();
      }
      return value(1);
    }
    if (!h) return [0x1be, 0x218].includes(id) ? value(0) : done();
    const bitmap = images.get(h);
    bitmap.commitCanvas();
    if (id === 0x1be) {
      if (!nativeDataMapped(machine, a(1))) return value(0);
      machine.bytes(a(1), 16);
      return value(Number(bitmap.width !== 0 && bitmap.height !== 0));
    }
    if (id === 0x218) {
      const attr = (bitmap.state.attributes ?? []).find((v) => v.id === (a(1) & 65535));
      if (!attr) return value(0);
      [...attr.rect, attr.color].forEach((v, i) => machine.store(a(i + 2), v));
      return value(1);
    }
    if (id === 0x21a) {
      await bitmapBlur(bitmap, a(1), a(2));
      return done();
    }
    if (id === 0x78) {
      const rect = Array.from({ length: 4 }, (_, i) => machine.load(a(3) + i * 4) | 0);
      // Original list blending uses opacity zero for RGBA sources.
      await bitmap.fill(
        rect[0],
        bitmap.height - rect[3],
        rect[2] - rect[0],
        rect[3] - rect[1],
        0xff000000,
      );
      for (let i = 0; i < a(2) >>> 0; i++) {
        const at = a(1) + i * 12,
          source = machine.load(at);
        if (!source) continue;
        const image = images.get(source);
        if (image.state.bpp === 4) continue;
        await bitmap.blit(image, {
          dx: machine.load(at + 4) | 0,
          dy: machine.load(at + 8) | 0,
          alpha: 0,
        });
      }
      return done();
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeImageCommands(world) {
  const commands = (world.imageCommands = new NativeImageCommands(world));
  world.registerNativeFeature('image-commands', (engine) => {
    engine.registerFeature('image-commands', commands);
    return commands;
  });
  for (const { id } of NATIVE_IMAGE_COMMAND_CONTRACTS)
    world.runtime.register('main', id, (args, machine, task) =>
      commands.apply(id, args, machine, task),
    );
}
