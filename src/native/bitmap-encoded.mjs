// SPDX-License-Identifier: MPL-2.0
import { openImage } from '../formats/hg3.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { blendBitmapPixel } from './image.mjs';
import { nativeABI } from './abi/index.mjs';
import { rasterFormat } from '../formats/raster.mjs';

export async function nativeEncodedBitmap(world, id, argument, machine, task) {
  const handle = argument(0) >>> 0;
  if (!handle && id === 428) return nativeReply(1, 0);
  if (!handle) throw new Error('Native nine-piece bitmap requires an encoded image owner');
  const buffers = world.runtime.imageDataBuffers,
    bytes = buffers.data(buffers.pointer(handle)),
    images = world.graphics.images,
    format = rasterFormat(bytes)?.toUpperCase();
  if (
    id === 428 &&
    nativeABI(world.profile).graphics.bitmapOrdinalRejectedFormats?.includes(format)
  )
    return nativeReply(1, 0);
  if (id === 648 && nativeABI(world.profile).graphics.ninePieceEmptyFormats?.includes(format))
    return nativeReply(1, images.createEmpty(task.id));
  if (
    bytes.length < 4 ||
    bytes[0] !== 72 ||
    bytes[1] !== 71 ||
    bytes[2] !== 45 ||
    (bytes[3] !== 50 && bytes[3] !== 51)
  )
    throw new Error('Unreviewed encoded bitmap format');
  const image = await openImage(bytes);
  if (id === 428) {
    const index = argument(1) >>> 0,
      // The own HG2 wrapper exposes ordinal lookup only from format0x25.
      frame =
        bytes[3] === 50 && image.version < 0x25
          ? index === 0
            ? image.frame(0)
            : null
          : image.frames[index];
    if (!frame) return nativeReply(1, 0);
    await image.decode(frame);
    const bitmap = images.addDecoded(image, frame);
    try {
      const value = images.get(bitmap);
      value.owner = task.id;
      value.state.bpp = 4;
      machine.store(argument(2), frame.id);
      return nativeReply(1, bitmap);
    } catch (error) {
      await images.release(bitmap);
      throw error;
    }
  }
  const width = argument(1) >>> 0,
    height = argument(2) >>> 0;
  if (!width || !height) throw new Error('Unreviewed empty nine-piece bitmap dimensions');
  const result = images.create(width, height, task.id);
  try {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let id = 0; id < 9; id++) {
      const frame = image.frame(id);
      if (!frame) continue;
      await image.decode(frame);
      const w = frame.width,
        h = frame.height;
      if (width < w || height < h)
        throw new Error('Unreviewed nine-piece bitmap smaller than its source tile');
      const draw = (x, y, columns = w, rows = h) => {
        for (let row = 0; row < rows; row++)
          for (let column = 0; column < columns; column++) {
            const source = ((h - 1 - row) * w + column) * 4,
              target = ((height - 1 - y - row) * width + x + column) * 4;
            blendBitmapPixel(pixels, target, frame.rgba, source, 255);
          }
      };
      if (id < 4) draw(id & 1 ? width - w : 0, id & 2 ? height - h : 0);
      else if (id < 6)
        for (let y = h; y < height - h; y += h)
          draw(id === 4 ? 0 : width - w, y, w, Math.min(h, height - y - h));
      else if (id < 8)
        for (let x = w; x < width - w; x += w)
          draw(x, id === 6 ? 0 : height - h, Math.min(w, width - x - w), h);
      else
        for (let y = h; y < height - h; y += h)
          for (let x = w; x < width - w; x += w)
            draw(x, y, Math.min(w, width - x - w), Math.min(h, height - y - h));
    }
    images.get(result).state.rgba = pixels;
    return nativeReply(1, result);
  } catch (error) {
    await images.release(result);
    throw error;
  }
}
