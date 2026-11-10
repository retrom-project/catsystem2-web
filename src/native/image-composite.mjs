// SPDX-License-Identifier: MPL-2.0
// Selector composition owns its output independently of the calling Script.
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument } from './data-text.mjs';
import { parseNativeResourceSelection } from './resource-selection.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { nativeABI } from './abi/index.mjs';
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
      at = name.lastIndexOf('.'),
      extension = at < 0 ? '' : name.slice(at),
      stem = at < 0 ? name : name.slice(0, at);
    const selection = parseNativeResourceSelection(encodeCP932(stem));
    if (!selection) return 0;
    if (!selection.selectors.length) return images.load(name, 0);
    const names = this.names(selection, extension),
      layers = [];
    for (const file of names) {
      let state = images.assets.get(file.toLowerCase() + ':0');
      if (!state) {
        const resolved = images.images.resolve?.(file) ?? file;
        if (this.world.game.has && !this.world.game.has(resolved)) continue;
        try {
          const bytes = await this.world.game.read(resolved),
            out = new Uint8Array(36);
          if (!bytes || !nativeImageMetadata(bytes, 0, false, out).success) continue;
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
        } catch {
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
          if (width > 0 && height > 0)
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
  world.registerNativeFeature('image-composites', (engine) => {
    engine.registerFeature('image-composites', composites);
    return composites;
  });
  world.runtime.register('main', 0x1cc, (args, machine, task) =>
    composites.apply(0x1cc, args, machine, task),
  );
}
