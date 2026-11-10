// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { bitmapColor, bitmapTransform, bitmapBlur, bitmapTransfer } from './bitmap-pixels.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
const value = (v) => nativeReply(1, v),
  done = () => nativeReply(2);
export async function imageOwnerPixels(owners, id, a, machine, task) {
  const world = owners.world,
    images = world.graphics.images,
    first = a(0) >>> 0;
  if (id === 0x2db || id === 0x2dc) {
    const packet = new NativeGraphicsPacket([
      0,
      0,
      0,
      a(2),
      a(3),
      a(4),
      a(5),
      a(6),
      a(7),
      a(8),
      a(9),
      Math.min(255, a(10) >>> 0),
      a(11),
      a(12),
      0,
    ]);
    await world.sendNativeEngine(first, task.id, id === 0x2db ? 280 : 282, a(1), 0, {
      payload: packet,
      imageOwnerHandle: a(2),
      flags: 0,
    });
    return done();
  }
  if (id === 0x2de || id === 0x2df) {
    if (!a(5)) return done();
    const source = first && owners.get(first),
      target = owners.get(a(5));
    if (source?.bitmap) {
      const words = Array.from({ length: 10 }, (_, i) => a(i));
      if (id === 0x2df) words.operation = 'clipped-copy';
      await bitmapTransfer(
        world,
        target.bitmap ? images.get(target.bitmap) : null,
        images.get(source.bitmap),
        words,
        id === 0x2df,
        task,
      );
    }
    return done();
  }
  if (id === 0x2e0) {
    if (first) {
      const record = owners.get(first);
      if (record.bitmap) {
        const b = images.get(record.bitmap);
        await b.fill(a(1) | 0, b.height - (a(2) | 0) - (a(4) | 0), a(3) | 0, a(4) | 0, a(5));
      }
    } else await world.graphics.fill(...[1, 2, 3, 4].map(a));
    return done();
  }
  if (!first) return id === 0x2d4 || id === 0x2d5 ? value(1) : done();
  const record = owners.get(first),
    bitmap = record.bitmap ? images.get(record.bitmap) : null;
  if (id === 0x2d4)
    return bitmap
      ? world.imageCommands.apply(
          0x218,
          [record.bitmap, ...Array.from({ length: 6 }, (_, i) => a(i + 1))],
          machine,
          task,
        )
      : value(0);
  if (id === 0x2d5) {
    const source = owners.get(a(1));
    if (!record.bitmap || !source.bitmap) return value(0);
    return world.imageCommands.apply(0x219, [record.bitmap, source.bitmap], machine, task);
  }
  if (id === 0x2d8) {
    if (bitmap) {
      bitmap.state.mask = a(1);
      await bitmap.changed();
    }
    return done();
  }
  if (id === 0x2e1 && ![1, 2, 3].includes(a(1))) return done();
  if (id === 0x2e1 && record.layers === null) {
    if (bitmap) await bitmapColor(bitmap, 'filter', a(1));
    return done();
  }
  if (!record.layers)
    throw new RangeError('Original image collection operation requires loaded layers');
  const visit = async (fn) => {
    for (const layer of record.layers) {
      if (layer.bitmap) await fn(images.get(layer.bitmap));
      for (const frame of layer.animation?.frames ?? [])
        if (frame.bitmap) await fn(images.get(frame.bitmap));
    }
  };
  if (id === 0x2c9) {
    if (a(1) === 100 && a(2) === 100 && a(3) === 100) return done();
    await visit((b) => b.tone(a(1), a(2), a(3)));
  } else if (id === 0x2cc) await visit((b) => bitmapColor(b, 'multiply', a(1)));
  else if (id === 0x2d9) await visit((b) => bitmapColor(b, 'alpha', a(1)));
  else if (id === 0x2e1) await visit((b) => bitmapColor(b, 'filter', a(1)));
  else if (id === 0x2d3) await visit((b) => bitmapTransform(b, 'rotate', a(1) | 0));
  else if (id === 0x2d7) await visit((b) => bitmapTransform(b, 'mirror', a(1) | 0));
  else if (id === 0x2da) await visit((b) => b.resize(a(1) >>> 0, a(2) >>> 0));
  else if (id === 0x2d6) {
    // Preserve the output expansion before each layer's own blur. The output
    // and the one static layer can deliberately reference the same bitmap.
    for (const layer of record.layers) {
      if (layer.bitmap) {
        if (bitmap) {
          await owners.expand(bitmap, a(1) | 0, a(2) | 0);
          record.info[0] = bitmap.width;
          record.info[1] = bitmap.height;
          record.info[4] = bitmap.state.offsetX;
          record.info[5] = bitmap.state.offsetY;
        }
        await bitmapBlur(images.get(layer.bitmap), a(1), a(2));
      } else
        for (const frame of layer.animation?.frames ?? [])
          await bitmapBlur(images.get(frame.bitmap), a(1), a(2));
    }
  }
  record.info[9] = 1;
  record.revision = (record.revision ?? 0) + 1;
  if ([0x2d3, 0x2d7, 0x2da].includes(id)) await owners.rebuild(record);
  return done();
}
