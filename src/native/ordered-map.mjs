// SPDX-License-Identifier: MPL-2.0
// Main2A3..2A8 and game Main41C use the shared string-to-DWORD map type.
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeDictionary } from './dictionary.mjs';
export const NATIVE_ORDERED_MAP_IDS = Object.freeze([
  0x2a3, 0x2a4, 0x2a5, 0x2a6, 0x2a7, 0x2a8, 0x41c,
]);
export function nativeOrderedMap(id, args, machine, services = {}) {
  if (!NATIVE_ORDERED_MAP_IDS.includes(id)) return undefined;
  const count = id === 0x41c ? 2 : [0, 1, 3, 2, 3, 3][id - 0x2a3];
  if (args.length !== count)
    throw new Error(`Native ordered map 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  const handles = services.handles,
    done = () => nativeReply(2),
    word = (value) => nativeReply(1, value);
  if (id === 0x2a3) return word(handles.add('dictionary', new NativeDictionary()));
  if (id === 0x2a4) {
    if (args[0]) handles.release(args[0], 'dictionary');
    return done();
  }
  const map = args[0] ? handles.get(args[0], 'dictionary') : null;
  if (id === 0x2a8) {
    // Translation happens before the null-map guard. A found key with an
    // invalid destination follows the native invalid write rather than
    // being reported as a successful lookup or silently suppressed.
    const key = map?.firstKeyFor(args[1]);
    if (key) machine.writeStringBytes(key, args[2]);
    return word(Number(key !== undefined));
  }
  if (!map) return id === 0x41c ? word(0) : id === 0x2a7 ? word(args[2]) : done();
  if (!services.formatBytes && !services.format) return undefined;
  const key = services.formatBytes
    ? services.formatBytes(args[1], machine)
    : encodeCP932(services.format(args[1], machine));
  if (id === 0x2a5) map.set(key, args[2]);
  else if (id === 0x2a6) map.delete(key);
  else if (id === 0x41c) return word(map.firstValueForKeyPrefix(key));
  else return word(map.get(key, args[2]));
  return done();
}
