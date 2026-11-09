// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeUTF16 } from './utf8-codec.mjs';
import { encodeNativeCP932 } from './cp932.mjs';
export const NATIVE_UNICODE_OUTPUT_IDS = Object.freeze([0x40f, 0x410]);
const names = new Set(['clipboard.copyUTF8', 'log.writeUTF8']);
const boolean = (value, name) => {
  if (![true, false, 0, 1].includes(value))
    throw TypeError('Native clipboard ' + name + ' must report success or failure');
  return Boolean(value);
};
export async function nativeUnicodeOutput(operation, args, machine, services, task) {
  if (args.length !== 1) throw Error('Unicode output expects one argument');
  const bytes = services.formatBytes(args[0], machine).slice(),
    end = bytes.indexOf(0),
    input = end < 0 ? bytes : bytes.subarray(0, end);
  if (operation === 'clipboard.copyUTF8') {
    const clipboard = services.nativeClipboard;
    for (const method of ['open', 'empty', 'write', 'close'])
      if (typeof clipboard?.[method] !== 'function')
        throw Error('Native Unicode clipboard requires ' + method);
    const owner = services.nativeWindowHandle(task.id);
    if (!Number.isInteger(owner) || owner < 0 || owner > 0xffffffff)
      throw TypeError('Native clipboard window handle must be a DWORD');
    if (!boolean(await clipboard.open(owner), 'open')) return nativeReply(2);
    try {
      boolean(await clipboard.empty(), 'empty');
      for (let i = 0; i < input.length - 1; i++)
        if (input[i] === 92 && input[i + 1] === 110) {
          input[i] = 13;
          input[++i] = 10;
        }
      const text = nativeUTF16(input);
      if (text.length >= 2048)
        throw RangeError('Native Unicode clipboard exceeds its conversion buffer');
      boolean(await clipboard.write(text), 'write');
    } finally {
      boolean(await clipboard.close(), 'close');
    }
  } else {
    if (typeof services.nativeDebugOutput !== 'function')
      throw Error('Native Unicode output requires its debug-window service');
    const escaped = [];
    for (let i = 0; i < input.length; i++) {
      const byte = input[i];
      if (byte === 37 && input[i + 1] !== 37) escaped.push(byte);
      escaped.push(byte);
    }
    if (escaped.length >= 2047)
      throw RangeError('Native Unicode log exceeds its conversion buffer');
    const text = nativeUTF16(Uint8Array.from(escaped));
    // The original wide CRT logger receives this string as its format.
    let formatted = text.replace(/%%|%$/g, (token) => (token === '%%' ? '%' : ''));
    // The wide CRT parser ends at WEOF, including that unit in its output.
    const sentinel = formatted.indexOf('\uffff');
    if (sentinel >= 0) formatted = formatted.slice(0, sentinel + 1);
    if (formatted.length >= 500)
      throw RangeError('Native Unicode log has no defined terminated result at 500 UTF-16 units');
    await services.nativeDebugOutput(encodeNativeCP932(formatted));
  }
  return nativeReply(2);
}
export function installNativeUnicodeOutput(world) {
  for (const entry of nativeABI(world.profile).tables.main.entries)
    if (names.has(entry.name))
      world.runtime.register('main', entry.id, (args, machine, task) =>
        nativeUnicodeOutput(entry.name, args, machine, world.runtime.services, task),
      );
}
