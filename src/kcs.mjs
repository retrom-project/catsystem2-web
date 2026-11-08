// SPDX-License-Identifier: MPL-2.0
// KCS container layout initially based on CatSystemKit (OWCramer).
import { Binary, inflate, boundedCount } from './binary.mjs';
import { nativeReply, bitsFloat } from './kcs/vm.mjs';
import { encodeCP932 } from './kcs/strings.mjs';
export { KCSMachine, nativeReply, floatBits, bitsFloat } from './kcs/vm.mjs';
export { encodeCP932 } from './kcs/strings.mjs';

export async function readKCS(bytes) {
  const b = new Binary(bytes, 'KCS');
  if (!b.magic('KCS\0') || b.u32(4) !== 2 || b.u32(12) !== 52)
    throw new Error('Unsupported KCS header');
  const codeSize = boundedCount(b.u32(16), 64 * 1024 * 1024, 'KCS code'),
    count = boundedCount(b.u32(24), 1000000, 'KCS strings');
  const tableOffset = b.u32(20) - 52,
    tableSize = boundedCount(b.u32(28), 64 * 1024 * 1024, 'KCS string table'),
    bodyCapacity = boundedCount(b.u32(48), 128 * 1024 * 1024, 'KCS body capacity');
  const body = new Binary(
    await inflate(b.range(52, bytes.length - 52), undefined, bodyCapacity),
    'KCS body',
  );
  body.range(0, codeSize);
  body.range(tableOffset, tableSize);
  if (count * 8 > tableSize) throw new Error('KCS string records exceed table');
  const data = new Uint8Array(boundedCount(b.u32(32), 64 * 1024 * 1024, 'KCS data')),
    strings = new Map();
  for (let i = 0; i < count; i++) {
    const at = tableOffset + body.u32(tableOffset + i * 8),
      dest = body.u32(tableOffset + i * 8 + 4);
    const end = body.bytes.indexOf(0, at);
    if (
      at < tableOffset + count * 8 ||
      end < at ||
      end >= tableOffset + tableSize ||
      dest + end - at >= data.length
    )
      throw new Error('KCS invalid string');
    data.set(body.range(at, end - at), dest);
    strings.set(dest, body.str(at));
  }
  return {
    body,
    codeSize,
    data,
    strings,
    formatVersion: b.u32(4),
    scriptMajor: b.u16(8),
    scriptMinor: b.u16(10),
    scriptVersion: ((b.u16(8) << 16) | b.u16(10)) >>> 0,
    tableOffset,
    tableSize,
    debugOffset: b.u32(40) - 52,
    debugSize: b.u32(44),
    bodyCapacity,
    stackSize: boundedCount(b.u32(36), 16 * 1024 * 1024, 'KCS stack'),
  };
}

export class BootHost {
  constructor(globals = {}, strings = {}) {
    this.globals = globals;
    this.strings = strings;
    this.calls = new Map();
    this.unimplemented = new Map();
    this.stopped = null;
    this.stopAt = new Set();
  }
  native(id, args, m) {
    this.calls.set(id, (this.calls.get(id) || 0) + 1);
    if (this.stopAt.has(id)) {
      this.stopped = { id, args, text: m.string(args[1] || 0) };
      return nativeReply(4);
    }
    switch (id) {
      case 0x0d:
        m.copyString(args[0], args[1]);
        return nativeReply(1, args[0]);
      case 0x0e:
        m.writeString(formatNative(m.string(args[1]), m), args[0]);
        return nativeReply(1, args[0]);
      case 0xd2:
        return nativeReply(1, this.globals[args[0] | 0] || 0);
      case 0xd3:
        this.globals[args[0] | 0] = args[1] | 0;
        break;
      case 0x114:
        this.strings[args[0]] = m.string(args[1]);
        break;
      case 0x115:
        m.writeString(this.strings[args[0]] || '', args[1]);
        break;
      case 0x116: {
        const s = m.string(args[0]);
        m.writeString(
          s.replace(/\$str(\d+)/g, (_, n) => this.strings[n] || ''),
          args[0],
        );
        break;
      }
      default:
        this.unimplemented.set(id, (this.unimplemented.get(id) || 0) + 1);
        throw new Error(`Unsupported KCS native 0x${id.toString(16)} at pc 0x${m.pc.toString(16)}`);
    }
    return nativeReply(2);
  }
}
export function formatNative(text, m, depth = 0) {
  if (depth > 32) throw new Error('KCS native format recursion');
  let output = '';
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '%') {
      output += text[i++];
      continue;
    }
    if (text[i + 1] === '%') {
      output += '%';
      i += 2;
      continue;
    }
    const match = /^%([-+ #0]*)(\d*)(?:\.(\d+))?([diuoxXsfF])\[([LGH])(\d+)\]/.exec(text.slice(i));
    if (!match) {
      if (/^%[^[\]\r\n]*\[[LGH]\d+\]/.test(text.slice(i)))
        throw new Error(`Unsupported native format conversion at ${text.slice(i, i + 64)}`);
      output += text[i++];
      continue;
    }
    const [, flags, widthText, precisionText, type, region, offsetText] = match;
    const width = Number(widthText) || 0,
      precision = precisionText === undefined ? undefined : Number(precisionText);
    if (width > 65536 || (precision !== undefined && precision > 100))
      throw new Error('KCS native format output bound');
    const address =
      (Number(offsetText) + (region === 'L' ? m.fp : region === 'H' ? 0x80000000 : 0)) >>> 0;
    let value,
      prefix = '';
    if (type === 's') {
      value = formatNative(m.string(address), m, depth + 1);
      if (precision !== undefined)
        value = new TextDecoder('shift_jis').decode(encodeCP932(value).subarray(0, precision));
    } else {
      const word = m.load(address);
      // Both pinned Microsoft CRTs consume uppercase F without producing a
      // field. The VM still resolves and reads its floating argument first.
      if (type === 'F') {
        i += match[0].length;
        continue;
      }
      if (type === 'f' || type === 'F') {
        const number = bitsFloat(word);
        if (!Number.isFinite(number) || Math.abs(number) >= 1e21)
          throw new Error('Native CRT formatting of this float requires an exact runtime adapter');
        value = Math.abs(number).toFixed(precision ?? 6);
        prefix =
          number < 0 || Object.is(number, -0)
            ? '-'
            : flags.includes('+')
              ? '+'
              : flags.includes(' ')
                ? ' '
                : '';
      } else {
        const signed = type === 'd' || type === 'i',
          number = signed ? word | 0 : word;
        const radix = type === 'o' ? 8 : /x/i.test(type) ? 16 : 10;
        value = precision === 0 && number === 0 ? '' : Math.abs(number).toString(radix);
        if (precision !== undefined) value = value.padStart(precision, '0');
        if (type === 'X') value = value.toUpperCase();
        if (signed)
          prefix = number < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        else if (flags.includes('#'))
          prefix =
            type === 'o'
              ? value.startsWith('0')
                ? ''
                : '0'
              : !word
                ? ''
                : type === 'x'
                  ? '0x'
                  : type === 'X'
                    ? '0X'
                    : '';
      }
    }
    if (flags.includes('#') && /[fF]/.test(type) && !value.includes('.')) value += '.';
    const count = Math.max(0, width - encodeCP932(prefix + value).length);
    if (flags.includes('-')) value = prefix + value + ' '.repeat(count);
    else if (type !== 's' && flags.includes('0') && (precision === undefined || /[fF]/.test(type)))
      value = prefix + '0'.repeat(count) + value;
    else value = ' '.repeat(count) + prefix + value;
    output += value;
    i += match[0].length;
  }
  return output;
}

// The VM formatter is byte oriented. Text conversion belongs to its consumer
// (for example STRING versus STRING8), never to this shared formatting step.
export function formatNativeBytes(source, m, depth = 0) {
  if (depth > 32) throw new Error('KCS native format recursion');
  const output = [],
    append = (bytes) => {
      for (const byte of bytes) output.push(byte);
    },
    text = Array.from(source, (byte) => String.fromCharCode(byte)).join('');
  for (let i = 0; i < source.length; ) {
    if (source[i] !== 37) {
      output.push(source[i++]);
      continue;
    }
    if (source[i + 1] === 37) {
      output.push(37);
      i += 2;
      continue;
    }
    const match = /^%([-+ #0]*)(\d*)(?:\.(\d+))?([diuoxXsfF])\[([LGH])(\d*)\]/.exec(text.slice(i));
    if (!match) {
      if (/^%[^[\]\r\n]*\[[LGH]\d*\]/.test(text.slice(i)))
        throw new Error(`Unsupported native format conversion at ${text.slice(i, i + 64)}`);
      output.push(source[i++]);
      continue;
    }
    const [, flags, widthText, precisionText, type, region, offsetText] = match,
      offset = Number(offsetText) >>> 0,
      address = (region === 'H' ? offset | 0x80000000 : offset + (region === 'L' ? m.fp : 0)) >>> 0;
    if (type === 's') {
      const bytes = [];
      for (let at = address; ; at = (at + 1) >>> 0) {
        const byte = m.load(at, 1);
        if (!byte) break;
        bytes.push(byte);
      }
      let value = formatNativeBytes(Uint8Array.from(bytes), m, depth + 1);
      const width = Number(widthText) || 0,
        precision = precisionText === undefined ? undefined : Number(precisionText);
      if (width > 65536 || (precision !== undefined && precision > 100))
        throw new Error('KCS native format output bound');
      if (precision !== undefined) value = value.subarray(0, precision);
      const padding = new Uint8Array(Math.max(0, width - value.length)).fill(32);
      if (!flags.includes('-')) append(padding);
      append(value);
      if (flags.includes('-')) append(padding);
    } else {
      // Numeric fields contain only ASCII. Preserve the independently tested
      // CRT integer/float conversion while feeding it the resolved word.
      append(
        encodeCP932(formatNative(match[0].replace(/\[([LGH])\d*\]/, `[G${address}]`), m, depth)),
      );
    }
    i += match[0].length;
  }
  return Uint8Array.from(output);
}

export function formatNativeAt(address, machine) {
  const bytes = [];
  for (let at = address >>> 0; ; at = (at + 1) >>> 0) {
    const byte = machine.load(at, 1);
    if (!byte) break;
    bytes.push(byte);
  }
  return formatNativeBytes(Uint8Array.from(bytes), machine);
}
