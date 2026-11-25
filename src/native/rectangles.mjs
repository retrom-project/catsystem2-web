// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeRectangleUnion } from './windows-rectangles.mjs';
export const NATIVE_RECTANGLE_OPERATIONS = Object.freeze([
  'rectangle.clear',
  'rectangle.union',
  'rectangle.unionBitmap',
  'rectangle.isEmpty',
  'rectangle.intersect',
]);
const empty = (r) => r[0] >= r[2] || r[1] >= r[3];
const read = (m, a) => Array.from({ length: 4 }, (_, i) => m.load((a + i * 4) >>> 0) | 0);
export function nativeRectangle(operation, args, machine, argumentWords, images) {
  const words = Array.from(args);
  while (words.length < argumentWords) words.push(machine.nativeArgument(words.length));
  const [address, b, x, y, z] = words;
  machine.bytes(address, 16);
  if (operation === 'rectangle.isEmpty')
    return nativeReply(1, Number(empty(read(machine, address))));
  let result = [0, 0, 0, 0];
  if (operation !== 'rectangle.clear') {
    const a = read(machine, address);
    if (operation === 'rectangle.union') {
      machine.bytes(b, 16);
      result = nativeRectangleUnion(a, read(machine, b));
    } else if (operation === 'rectangle.unionBitmap') {
      const bitmap = b ? images.get(b) : null;
      result = nativeRectangleUnion(a, [
        x | 0,
        y | 0,
        (x + (bitmap?.width ?? 0)) | 0,
        (y + (bitmap?.height ?? 0)) | 0,
      ]);
    } else {
      result = [
        Math.max(a[0], b | 0),
        Math.max(a[1], x | 0),
        Math.min(a[2], y | 0),
        Math.min(a[3], z | 0),
      ];
      if (empty(result)) result = [0, 0, 0, 0];
    }
  }
  result.forEach((word, i) => machine.store((address + i * 4) >>> 0, word));
  return nativeReply(2);
}
export function installNativeRectangles(world) {
  const abi = nativeABI(world.profile);
  for (const entry of abi.tables.main.entries)
    if (NATIVE_RECTANGLE_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) => {
        if (abi.rectangles?.strictArity && args.length !== entry.signature.argumentWords)
          throw new Error(
            `Native rectangle ${entry.id} expects ${entry.signature.argumentWords} argument words`,
          );
        return nativeRectangle(
          entry.name,
          args,
          machine,
          entry.signature.argumentWords,
          world.graphics.images,
        );
      });
}
