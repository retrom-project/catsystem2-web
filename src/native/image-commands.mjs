// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { nativeABI } from './abi/index.mjs';
import { nativeDataArgument, nativeDataMapped, nativeDataFormat } from './data-text.mjs';
import { bitmapBlur, bitmapTransfer } from './bitmap-pixels.mjs';

async function compositeLegacyBitmap(bitmap, images, machine, recordsAddress, count, rectangle) {
  const [rect, offset] = machine.region(rectangle, 16),
    fields = new DataView(rect.buffer, rect.byteOffset + offset, 16),
    left = Math.max(0, fields.getInt32(0, true)),
    top = Math.max(0, fields.getInt32(4, true)),
    right = Math.min(bitmap.width, fields.getInt32(8, true)),
    bottom = Math.min(bitmap.height, fields.getInt32(12, true)),
    destinationBpp = bitmap.state.bpp;
  if (![1, 2, 3, 4].includes(destinationBpp))
    throw new RangeError('Unsupported bitmap composite destination format');

  const layers = [];
  if (count) {
    const [memory, start] = machine.region(recordsAddress, count * 12),
      records = new DataView(memory.buffer, memory.byteOffset + start, count * 12);
    for (let at = 0; at < records.byteLength; at += 12) {
      const handle = records.getUint32(at, true);
      if (!handle) continue;
      const image = images.get(handle),
        bpp = image.state.bpp,
        x = records.getInt32(at + 4, true),
        y = records.getInt32(at + 8, true),
        x0 = Math.max(left, x),
        y0 = Math.max(top, y),
        x1 = Math.min(right, (x + image.width) | 0),
        y1 = Math.min(bottom, (y + image.height) | 0);
      if (![1, 2, 3, 4].includes(bpp))
        throw new RangeError('Unsupported bitmap composite source format');
      if (x0 >= x1 || y0 >= y1 || bpp === 1 || destinationBpp === 1) continue;
      if (bpp === 4 && destinationBpp === 4) continue;
      if (destinationBpp !== 4 && destinationBpp !== bpp)
        throw new RangeError('Unresolved packed bitmap composite conversion');
      if (bpp === 3 && image.state === bitmap.state && y === 0 && x > 0 && x < x1 - x0)
        throw new RangeError(
          'Bitmap composite RGB24 overlap depends on the original CPU copy mode',
        );
      layers.push({ image, bpp, x, y, x0, y0, x1, y1 });
    }
  }
  if (destinationBpp === 1 || left >= right || top >= bottom) return;

  // Resolve every source before clearing the destination. Shared backing remains
  // live so a later layer can read pixels written by an earlier one.
  const output = await bitmap.pixels();
  for (const layer of layers) layer.pixels = await layer.image.pixels();
  for (let row = top; row < bottom; row++) {
    const start = ((bitmap.height - row - 1) * bitmap.width + left) * 4,
      end = start + (right - left) * 4;
    output.fill(0, start, end);
    for (let i = start + 3; i < end; i += 4) output[i] = 255;
  }
  for (const { image, bpp, x, y, x0, y0, x1, y1, pixels } of layers) {
    for (let row = y0; row < y1; row++) {
      const destination = (bitmap.height - row - 1) * bitmap.width,
        source = (image.height - (row - y) - 1) * image.width;
      if (bpp === 3) {
        const dst = (destination + x0) * 4,
          src = (source + x0 - x) * 4,
          width = (x1 - x0) * 4;
        output.set(pixels.subarray(src, src + width), dst);
        for (let i = dst + 3; i < dst + width; i += 4) output[i] = 255;
        continue;
      }
      for (let column = x0; column < x1; column++) {
        const dst = (destination + column) * 4,
          src = (source + column - x) * 4;
        const alpha = (pixels[src + 3] >>> 4) * 17,
          oldAlpha = output[dst + 3],
          total = Math.min(255, oldAlpha + alpha - ((oldAlpha * alpha) >> 8));
        if (!total) continue;
        for (let channel = 0; channel < 3; channel++) {
          const offset = dst + channel,
            expanded = (pixels[src + channel] >>> 4) * 17,
            color = output[offset] + Math.trunc(((expanded - output[offset]) * alpha) / total);
          output[offset] = destinationBpp === 2 ? (color >>> 4) * 17 : color;
        }
        output[dst + 3] = destinationBpp === 2 ? (total >>> 4) * 17 : total;
      }
    }
  }
  bitmap.state.source = null;
  await bitmap.changed();
}
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
    const legacyComposite =
      id === 0x78 && nativeABI(this.world.profile).graphics.bitmapCompositeUsesLegacyRows;
    if (legacyComposite && args.length !== 4)
      throw new Error('Native bitmap composite expects four argument words');
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
        target.commitCanvas();
        const attrs = new Map((target.state.attributes ?? []).map((v) => [v.id, v]));
        for (const attr of source.state.attributes ?? []) attrs.set(attr.id, structuredClone(attr));
        target.state.attributes = [...attrs.values()].sort((a, b) => a.id - b.id);
        await target.changed();
      }
      return value(1);
    }
    if (!h) return [0x1be, 0x218].includes(id) ? value(0) : done();
    const bitmap = images.get(h);
    if (legacyComposite) {
      await compositeLegacyBitmap(bitmap, images, machine, a(1), a(2) >>> 0, a(3));
      return done();
    }
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
  for (const { id } of NATIVE_IMAGE_COMMAND_CONTRACTS)
    world.runtime.register('main', id, (args, machine, task) =>
      commands.apply(id, args, machine, task),
    );
}
