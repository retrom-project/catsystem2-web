// SPDX-License-Identifier: MPL-2.0
// Script bitmap commands operate on the one logical pixel and metadata model.
import { nativeABI } from './abi/index.mjs';
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { nativeDataArgument } from './data-text.mjs';
import { bitmapColor, bitmapTransform, bitmapSample, bitmapTransfer } from './bitmap-pixels.mjs';
export const NATIVE_BITMAP_OPERATION_CONTRACTS = Object.freeze(
  [
    [0x7a, 3, 2],
    [0x16a, 3, 2],
    [0x16b, 3, 2],
    [0x16f, 10, 2],
    [0x171, 2, 2],
    [0x172, 3, 1],
    [0x173, 3, 1],
    [0x174, 3, 1],
    [0x175, 3, 1],
    [0x176, 3, 1],
    [0x178, 2, 2],
    [0x179, 1, 1],
    [0x17a, 2, 2],
    [0x1d4, 2, 2],
    [0x22e, 2, 2],
    [0x234, 2, 2],
    [0x281, 2, 2],
    [0x2c1, 3, 2],
    [0x402, 3, 1],
  ].map(([id, words, control]) => Object.freeze({ id, words, control })),
);
const byID = new Map(NATIVE_BITMAP_OPERATION_CONTRACTS.map((s) => [s.id, s]));
const rawIDs = new Set([0x7a, 0x1d4, 0x281, 0x2c1]);
export class NativeBitmapOperations {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec || (id === 0x402 && !nativeABI(this.world.profile).capabilities.bitmapColorQuery))
      return undefined;
    const a = (i) => nativeDataArgument(args, machine, i),
      first = a(0) >>> 0;
    if (first && rawIDs.has(id) && !this.world.runtime.handles.records.has(first))
      return (await this.world.getNativeFeature('render-sources')).withBitmapOperation(
        first,
        (bitmap) => this.operation(id, a, machine, task, bitmap),
        id === 0x1d4 ? 'rotation' : id === 0x281 ? 'alpha' : 'resize',
      );
    return this.operation(
      id,
      a,
      machine,
      task,
      first ? this.world.graphics.images.get(first) : null,
    );
  }
  async operation(id, a, machine, task, bitmap) {
    const done = () => nativeReply(2),
      value = (v) => nativeReply(1, v),
      s = bitmap?.state;
    if (id === 0x16f) {
      const source = a(5) ? this.world.graphics.images.get(a(5)) : null;
      if (source) {
        const words = Array.from({ length: 10 }, (_, i) => a(i));
        words.operation = 'clipped-blend';
        await bitmapTransfer(this.world, bitmap, source, words, false, task);
      }
      return done();
    }
    if (id === 0x16a || id === 0x16b || id === 0x173) {
      if (id === 0x173 && !bitmap) return value(0);
      const keys =
        id === 0x16a
          ? ['canvasWidth', 'canvasHeight']
          : id === 0x16b
            ? ['offsetX', 'offsetY']
            : ['baseX', 'baseY'];
      keys.forEach((key, i) =>
        machine.store(
          a(i + 1),
          s ? (id === 0x16a ? s[key] || s[i ? 'height' : 'width'] : s[key]) : 0,
        ),
      );
      return id === 0x173 ? value(1) : done();
    }
    if (!bitmap)
      return byID.get(id).control === 1 ? value(id === 0x179 ? NATIVE_RESULT_SENTINEL : 0) : done();
    bitmap.commitCanvas();
    if (id === 0x172 || id === 0x402)
      return value(await bitmapSample(bitmap, a(1), a(2), id === 0x402));
    if (id === 0x179) return value(Number(await bitmap.hasAlpha()));
    if ([0x174, 0x175, 0x176].includes(id)) {
      const keys =
        id === 0x174
          ? ['canvasWidth', 'canvasHeight']
          : id === 0x175
            ? ['offsetX', 'offsetY']
            : ['baseX', 'baseY'];
      keys.forEach((key, i) => {
        s[key] = a(i + 1) | 0;
      });
      await bitmap.changed();
      return value(1);
    } else if (id === 0x17a || id === 0x234) {
      s[id === 0x17a ? 'alphaHint' : 'mask'] = id === 0x17a ? Number(a(1) !== 0) + 1 : a(1);
      await bitmap.changed();
    } else if (id === 0x7a || id === 0x2c1) await bitmap.resize(a(1) >>> 0, a(2) >>> 0);
    else if (id === 0x1d4 || id === 0x22e)
      await bitmapTransform(bitmap, id === 0x1d4 ? 'rotate' : 'mirror', a(1) | 0);
    else
      await bitmapColor(
        bitmap,
        id === 0x171 ? 'multiply' : id === 0x281 ? 'alpha' : 'filter',
        a(1),
      );
    return done();
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeBitmapOperations(world) {
  const operations = (world.bitmapOperations = new NativeBitmapOperations(world));
  world.registerNativeFeature('bitmap-operations', (engine) => {
    engine.registerFeature('bitmap-operations', operations);
    return operations;
  });
  for (const { id } of NATIVE_BITMAP_OPERATION_CONTRACTS)
    if (id !== 0x7a && (id !== 0x402 || nativeABI(world.profile).capabilities.bitmapColorQuery))
      world.runtime.register('main', id, (args, machine, task) =>
        operations.apply(id, args, machine, task),
      );
}
