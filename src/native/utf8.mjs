// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeUTF8Step, readNativeCString } from './utf8-codec.mjs';
import { decodeNativeCP932 } from './cp932.mjs';
export const NATIVE_UTF8_IDS = Object.freeze([0x415, 0x416, 0x41b]);
export const NATIVE_UTF8_OPERATIONS = Object.freeze([
  'utf8.truncateBytes',
  'utf8.truncateCharacters',
  'utf8.findCP932Key',
]);
const operations = new Set(NATIVE_UTF8_OPERATIONS);
export function nativeUTF8(id, args, machine, task, world) {
  const entry = nativeABI(world.profile).tables.main.entries[id];
  if (!operations.has(entry?.name)) return undefined;
  if (args.length !== 2) throw Error('Native UTF-8 primitive expects two arguments');
  const [address, limit] = args,
    read = (at) => machine.load((address + at) >>> 0, 1);
  let at = 0;
  if (entry.name === 'utf8.findCP932Key') {
    const source = readNativeCString(machine, address),
      raw = readNativeCString(machine, limit),
      key = raw.length > 4000 ? new Uint8Array() : new TextEncoder().encode(decodeNativeCP932(raw));
    while (read(at)) {
      if (key.every((byte, i) => read(at + i) === byte)) return nativeReply(1, at);
      const step = nativeUTF8Step(read, at);
      if (step <= 0) break;
      at += step;
    }
    return nativeReply(1, source.length);
  }
  let count = 0;
  while (read(at)) {
    if (entry.name === 'utf8.truncateCharacters' && count >= limit) break;
    const next = (at + nativeUTF8Step(read, at)) | 0;
    if (entry.name === 'utf8.truncateBytes' && next >>> 0 >= limit >>> 0) break;
    at = next;
    count++;
  }
  machine.store((address + at) >>> 0, 0, 2);
  return nativeReply(1, at >>> 0);
}
export function installNativeUTF8(world) {
  for (const entry of nativeABI(world.profile).tables.main.entries)
    if (operations.has(entry.name))
      world.runtime.register('main', entry.id, (args, machine, task) =>
        nativeUTF8(entry.id, args, machine, task, world),
      );
}
