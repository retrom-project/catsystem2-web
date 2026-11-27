// SPDX-License-Identifier: MPL-2.0
// Selector composition owns its output independently of the calling Script.
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument } from './data-text.mjs';
import { parseNativeResourceSelection } from './resource-selection.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { nativeImagePathParts } from './image-file.mjs';
import { nativeABI } from './abi/index.mjs';
import { blendBitmapPixel } from './image.mjs';
import { HG2 } from '../formats/hg2.mjs';
import { HG3 } from '../formats/hg3.mjs';
import { PSD } from '../formats/psd.mjs';
import { rasterImageHeader } from '../formats/raster.mjs';
import { blendTypePixel } from './raster-kernel.mjs';
export const NATIVE_IMAGE_COMPOSITE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x1cc, words: 1, control: 1 }),
]);
export class NativeImageComposites {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine) {
    if (id !== 0x1cc) return undefined;
    const name = this.world.runtime.services.format(nativeDataArgument(args, machine, 0), machine);
    return nativeReply(1, await this.load(name));
  }
  async load(name) {
    const images = this.world.graphics.images,
      { stem, extension } = nativeImagePathParts(name);
    const selection = parseNativeResourceSelection(encodeCP932(stem));
    if (!selection) return 0;
    if (!selection.selectors.length) {
      const handle = await images.load(name, 0);
      if (handle && nativeABI(this.world.profile).graphics.imageCompositePreservesRGB24) {
        try {
          const image = await images.images.load(name),
            graphics = nativeABI(this.world.profile).graphics,
            formats = graphics.imageCompositePlainFormats ?? graphics.imageCompositeFormats,
            format =
              image instanceof HG2
                ? 'HG2'
                : image instanceof HG3
                  ? 'HG3'
                  : image.format?.toUpperCase();
          if (graphics.imageCompositeRejectedPlainFormats?.includes(format)) {
            await images.release(handle);
            return 0;
          }
          if (formats && !formats.includes(format))
            throw new Error('Selector image input has no reviewed format binding');
          if (
            format === 'BMP' &&
            graphics.imageCompositeBmpHeaders &&
            (!graphics.nativeBmp || !rasterImageHeader(image))
          ) {
            const header = new DataView(
              image.bytes.buffer,
              image.bytes.byteOffset,
              image.bytes.byteLength,
            );
            if (
              !graphics.imageCompositeBmpHeaders.includes(header.getUint32(14, true)) ||
              !graphics.imageCompositeBmpCompressions.includes(header.getUint32(30, true)) ||
              (graphics.nativeBmp &&
                (header.getUint32(14, true) === 12 || header.getUint32(30, true) === 6))
            )
              throw new Error('The BMP primary header has no reviewed ABI binding');
          }
          if (format === 'PSD' && graphics.imageCompositePsd) {
            const policy = graphics.imageCompositePsd,
              header = new DataView(
                image.bytes.buffer,
                image.bytes.byteOffset,
                image.bytes.byteLength,
              ),
              psd = new PSD(image.bytes, { rleChannels: policy.rleChannels });
            if (
              header.getUint16(22) !== policy.depth ||
              header.getUint16(24) !== policy.mode ||
              !policy.channels.includes(psd.channels) ||
              !policy.compression.includes(psd.compression)
            )
              throw new Error('The PSD primary header has no reviewed ABI binding');
            const bitmap = images.get(handle);
            bitmap.state.rgba = psd.decode();
            bitmap.state.source = null;
            await bitmap.changed();
          }
          if (format === 'KCF' && graphics.imageCompositeKcfPixelDepth) {
            const bitmap = images.get(handle);
            bitmap.state.bpp = image.pixelSize;
            await bitmap.changed();
          }
          const frame = image.frame(0);
          if (frame?.bpp === 24) {
            const bitmap = images.get(handle);
            bitmap.state.bpp = 3;
            await bitmap.changed();
          }
        } catch (error) {
          await images.release(handle);
          throw error;
        }
      }
      return handle;
    }
    const names = this.names(selection, extension),
      layers = [];
    for (const file of names) {
      let state = images.assets.get(file.toLowerCase() + ':0');
      if (!state) {
        const resolved = images.images.resolve?.(file) ?? file;
        try {
          const bytes = await this.world.imageFiles.readResolved(resolved),
            out = new Uint8Array(36);
          if (!bytes) continue;
          const formats = nativeABI(this.world.profile).graphics.imageCompositeFormats,
            magic = String.fromCharCode(...bytes.subarray(0, 4)),
            format = magic === 'HG-2' ? 'HG2' : magic === 'HG-3' ? 'HG3' : 'raster';
          if (formats && !formats.includes(format))
            throw new Error('Selector image input has no reviewed format binding');
          if (!nativeImageMetadata(bytes, 0, false, out).success) continue;
          const view = new DataView(out.buffer),
            v = Array.from({ length: 9 }, (_, i) => view.getInt32(i * 4, true));
          state = {
            offsetX: v[0],
            offsetY: v[1],
            width: v[2],
            height: v[3],
            canvasWidth: v[4] || v[2],
            canvasHeight: v[5] || v[3],
            baseX: v[7],
            baseY: v[8],
          };
        } catch (error) {
          if (nativeABI(this.world.profile).graphics.imageCompositeFormats) throw error;
          continue;
        }
      }
      if (state) layers.push({ file, state });
    }
    if (!layers.length) return 0;
    const left = Math.min(...layers.map((l) => l.state.offsetX)),
      bottom = Math.min(...layers.map((l) => l.state.offsetY)),
      right = Math.max(...layers.map((l) => l.state.offsetX + l.state.width)),
      top = Math.max(...layers.map((l) => l.state.offsetY + l.state.height));
    if (left >= right || bottom >= top) return 0;
    const handle = images.create(right - left, top - bottom),
      output = images.get(handle),
      s = output.state;
    Object.assign(s, {
      offsetX: left,
      offsetY: bottom,
      canvasWidth: Math.max(0, ...layers.map((l) => l.state.canvasWidth || l.state.width)),
      canvasHeight: Math.max(0, ...layers.map((l) => l.state.canvasHeight || l.state.height)),
      baseX: layers[0].state.baseX,
      baseY: layers[0].state.baseY,
    });
    try {
      for (const { file } of layers) {
        const h = await images.load(file, 0);
        if (!h) continue;
        try {
          const formats = nativeABI(this.world.profile).graphics.imageCompositeFormats;
          if (formats) {
            const image = await images.images.load(file),
              format = image instanceof HG2 ? 'HG2' : image instanceof HG3 ? 'HG3' : 'raster';
            if (!formats.includes(format))
              throw new Error('Selector image input has no reviewed format binding');
            if (
              nativeABI(this.world.profile).graphics.imageCompositePreservesRGB24 &&
              image.frame(0)?.bpp === 24
            )
              images.get(h).state.bpp = 3;
          }
          const source = images.get(h),
            v = source.state;
          let dx = Math.max(0, v.offsetX - s.offsetX) + s.baseX - v.baseX,
            dy = Math.max(0, v.offsetY - s.offsetY) + s.baseY - v.baseY;
          let sx = 0,
            sy = 0,
            width = source.width,
            height = source.height;
          const x = Math.max(0, dx),
            y = Math.max(0, dy);
          width = Math.min(width, output.width - x);
          height = Math.min(height, output.height - y);
          dx = x;
          dy = y;
          if (width > 0 && height > 0) {
            if (nativeABI(this.world.profile).graphics.bitmapCompositeUsesLegacyRows) {
              const blend = v.blendType ?? 0,
                modes = nativeABI(this.world.profile).graphics.imageCompositeBlendTypes ?? [0];
              if (![3, 4].includes(v.bpp) || !modes.includes(blend))
                throw new Error('Selector composition requires the reviewed scalar pixel format');
              const pixels = await output.pixels(),
                input = await source.pixels();
              for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                  const from = ((source.height - 1 - sy - y) * source.width + sx + x) * 4,
                    to = ((output.height - 1 - dy - y) * output.width + dx + x) * 4;
                  if (input[from + 3]) {
                    if (!blend) blendBitmapPixel(pixels, to, input, from);
                    else if (v.bpp === 4)
                      blendTypePixel(pixels, to, input, from, 255, blend, false);
                  }
                }
              s.source = null;
              await output.changed();
            } else
              await output.blit(source, {
                dx,
                dy: output.height - dy - height,
                sx,
                sy: source.height - sy - height,
                width,
                height,
                copy: v.bpp === 3,
                flipY: Boolean(v.blendType),
              });
          }
          const attrs = new Map((s.attributes ?? []).map((v) => [v.id, v]));
          for (const attr of v.attributes ?? []) attrs.set(attr.id, structuredClone(attr));
          s.attributes = [...attrs.values()].sort((a, b) => a.id - b.id);
        } finally {
          await images.release(h);
        }
      }
      return handle;
    } catch (error) {
      await images.release(handle);
      throw error;
    }
  }
  names(selection, extension) {
    if (nativeABI(this.world.profile).graphics.compositeWideBase) {
      const bytes = new Uint8Array(selection.base.length + 4);
      bytes.set(selection.base);
      let base = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = bytes[i] | (bytes[i + 1] << 8);
        if (!code) break;
        base += String.fromCharCode(code);
      }
      return [...selection.selectors].flatMap((selector, i) => {
        if (selector === 0 || selector === 48) return [];
        const low = selector & 65535,
          high = (selector >>> 16) & 255,
          suffix = String.fromCharCode(low) + (high ? String.fromCharCode(high) : '');
        return [base + '_' + '0'.repeat(i) + suffix + extension];
      });
    }
    const base = new TextDecoder('shift_jis').decode(selection.base);
    return [...selection.selectors].flatMap((selector, i) =>
      selector === 0 || selector === 48
        ? []
        : [
            base +
              '_' +
              '0'.repeat(i) +
              new TextDecoder('shift_jis').decode(
                Uint8Array.of(selector, selector >> 8, selector >> 16).subarray(
                  0,
                  selector < 0 ? 3 : 1,
                ),
              ) +
              extension,
          ],
    );
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeImageComposites(world) {
  const composites = (world.imageComposites = new NativeImageComposites(world));
  world.runtime.register('main', 0x1cc, (args, machine, task) =>
    composites.apply(0x1cc, args, machine, task),
  );
}
