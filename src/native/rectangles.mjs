// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
export const NATIVE_RECTANGLE_OPERATIONS = Object.freeze([
  'rectangle.clear',
  'rectangle.union',
  'rectangle.unionBitmap',
  'rectangle.isEmpty',
  'rectangle.intersect',
]);
const empty = (r) => r[0] >= r[2] || r[1] >= r[3];
const read = (m, a) => Array.from({ length: 4 }, (_, i) => m.load((a + i * 4) >>> 0) | 0);
const union = (a, b) =>
  empty(a)
    ? empty(b)
      ? [0, 0, 0, 0]
      : b
    : empty(b)
      ? a
      : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
export function nativeRectangle(operation, args, machine, argumentWords, images) {
  const words = Array.from(args);
  while (words.length < argumentWords) words.push(machine.nativeArgument(words.length));
  const [address, b, x, y, z] = words;
  if (operation === 'rectangle.isEmpty')
    return nativeReply(1, Number(empty(read(machine, address))));
  let result = [0, 0, 0, 0];
  if (operation !== 'rectangle.clear') {
    const a = read(machine, address);
    if (operation === 'rectangle.union') result = union(a, read(machine, b));
    else if (operation === 'rectangle.unionBitmap') {
      const bitmap = b ? images.get(b) : null;
      result = union(a, [
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
  for (const entry of nativeABI(world.profile).tables.main.entries)
    if (NATIVE_RECTANGLE_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeRectangle(
          entry.name,
          args,
          machine,
          entry.signature.argumentWords,
          world.graphics.images,
        ),
      );
}
