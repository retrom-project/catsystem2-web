// SPDX-License-Identifier: MPL-2.0
import { originalOwner } from './original-adapter.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeABI } from './abi/index.mjs';
import { queryVersionResource } from './windows-version.mjs';
import { registryEncodeANSI } from './registry-codepage.mjs';

function versionInteger(text, previous) {
  let at = text[0] === '-' || text[0] === '+' ? 1 : 0;
  if (!/[0-9]/.test(text[at] ?? '')) {
    if (previous !== undefined) return previous;
    throw new Error('Unsupported FileVersion: first component leaves its native scratch unwritten');
  }
  const hex = text[at] === '0' && /[xX]/.test(text[at + 1] ?? '');
  if (hex) at += 2;
  let value = 0;
  for (; at < text.length; at++) {
    const char = text[at];
    if (!(hex ? /[0-9a-fA-F]/ : /[0-9]/).test(char)) break;
    value = (Math.imul(value, hex ? 16 : 10) + parseInt(char, hex ? 16 : 10)) >>> 0;
  }
  // The original decimal parser returns before applying the sign on a dot.
  return !hex && text[at] === '.' ? value : text[0] === '-' ? -value >>> 0 : value;
}
function ordinaryVersion(world) {
  const module = world.nativeModule;
  if (!module) throw new Error('Module version requires its actual uniquely selected main module');
  const bytes = module.resource,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    translation = queryVersionResource(bytes, '\\VarFileInfo\\Translation'),
    values = [0, 0, 0, 0];
  if (!translation) return values;
  if (translation.count < 4) throw new Error('Unsupported FileVersion translation record');
  const pair =
      ((view.getUint16(translation.offset, true) << 16) |
        view.getUint16(translation.offset + 2, true)) >>>
      0,
    name = pair.toString(16).padStart(8, '0'),
    field = queryVersionResource(bytes, `\\StringFileInfo\\${name}\\FileVersion`);
  if (!field) return values;
  if (!field.text) throw new Error('Unsupported binary FileVersion value');
  let text = '';
  for (let at = 0; at < field.count; at++) {
    const char = view.getUint16(field.offset + at * 2, true);
    if (!char) break;
    text += String.fromCharCode(char);
  }
  if (!nativeABI(world.profile).capabilities.unicodeOutput)
    text = Array.from(registryEncodeANSI(text), (byte) => String.fromCharCode(byte)).join('');
  let previous;
  for (let i = 0; i < 4; i++) {
    let split = text.indexOf(',');
    if (split < 0) split = text.indexOf('.');
    if (i < 3 && split < 0) break;
    const part = (i < 3 ? text.slice(0, split) : text).replace(/^ +/, '');
    if (part.length >= 64)
      throw new Error('Unsupported FileVersion component exceeds native scratch');
    previous = versionInteger(part, previous);
    values[i] = previous & 0xffff;
    text = text.slice(split + 1);
  }
  return values;
}

export const NATIVE_VERSION_QUERY = Object.freeze({ id: 0x1bc });
export function installNativeVersionQuery(world) {
  world.runtime.register('main', NATIVE_VERSION_QUERY.id, async (args, machine, task) => {
    if (!originalOwner(world)) {
      const destinations = Array.from(
          { length: 4 },
          (_, i) => args[i] ?? machine.nativeArgument(i),
        ),
        values = ordinaryVersion(world);
      destinations.forEach((address, i) => machine.store(address, values[i]));
      return nativeReply(2);
    }
    if (typeof world.originalVersionQuery !== 'function')
      throw new Error('Original version query requires its explicit oracle composition');
    return world.originalVersionQuery(args, machine, task);
  });
}
