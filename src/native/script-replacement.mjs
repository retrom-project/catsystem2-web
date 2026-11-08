// SPDX-License-Identifier: MPL-2.0
// Engine SCRIPT/replace rules: game713680 and SDK5C4D60, main3EA.
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { findNativeXML } from './xml.mjs';
const key = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
  terminated = (bytes) => {
    const at = bytes.indexOf(0);
    return bytes.slice(0, at < 0 ? bytes.length : at);
  },
  order = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  };

function replace(source, find, replacement) {
  if (!find.length && source.length)
    throw new Error('Native SCRIPT replacement with an empty find string does not terminate');
  const prefix = [];
  let at = 0;
  for (;;) {
    let found = -1;
    for (let i = at; i < source.length; i++)
      if (i + find.length <= source.length && find.every((byte, j) => byte === source[i + j])) {
        found = i;
        break;
      }
    if (found < 0) break;
    prefix.push(...source.subarray(at, found), ...replacement);
    at = found + find.length;
  }
  return {
    prefix: Uint8Array.from(prefix),
    bytes: Uint8Array.from([...prefix, ...source.subarray(at)]),
  };
}

export class NativeScriptReplacements {
  constructor(document, { encoding = 'Shift_JIS' } = {}) {
    this.entries = new Map();
    if (!document) return;
    const encode =
      encoding.toLowerCase() === 'utf-8' ? (text) => new TextEncoder().encode(text) : encodeCP932;
    for (let index = 0; ; index++) {
      const path = `SCRIPT/replace/r${String(index).padStart(2, '0')}`,
        find = findNativeXML(document, `${path}/find`),
        replacement = findNativeXML(document, `${path}/rep`);
      if (!find || !replacement) break;
      this.add(encode(find.text), encode(replacement.text));
    }
  }
  add(find, replacement) {
    find = terminated(find);
    replacement = terminated(replacement);
    const identity = key(find);
    if (!this.entries.has(identity)) this.entries.set(identity, { find, replacement });
  }
  apply(source) {
    let bytes = terminated(source);
    for (const { find, replacement } of [...this.entries.values()].sort((a, b) =>
      order(a.find, b.find),
    )) {
      bytes = replace(bytes, find, replacement).bytes;
    }
    return bytes;
  }
  write(machine, address, source) {
    let bytes = terminated(source);
    machine.bytes(address, bytes.length + 1).set([...bytes, 0]);
    for (const { find, replacement } of [...this.entries.values()].sort((a, b) =>
      order(a.find, b.find),
    )) {
      const result = replace(bytes, find, replacement);
      // Original 6A59B0 writes a WORD NUL after the replacement prefix,
      // then strcat copies the remaining source, including only its BYTE NUL.
      machine.bytes(address, result.prefix.length + 2).set([...result.prefix, 0, 0]);
      bytes = result.bytes;
      machine.bytes(address, bytes.length + 1).set([...bytes, 0]);
    }
  }
}

export function nativeScriptReplacement(id, args, machine, services = {}) {
  if (id !== 0x3ea) return undefined;
  if (args.length !== 2) throw new Error('Native SCRIPT replacement expects two arguments');
  const rules = services.configuration?.scriptReplacements;
  if (!rules || (!services.formatBytes && !services.format)) return undefined;
  const source = services.formatBytes
    ? services.formatBytes(args[1], machine)
    : encodeCP932(services.format(args[1], machine));
  rules.write(machine, args[0], source);
  return nativeReply(2);
}

export function installNativeScriptReplacements(world) {
  world.runtime.register('main', 0x3ea, (args, machine) =>
    nativeScriptReplacement(0x3ea, args, machine, world.runtime.services),
  );
}
