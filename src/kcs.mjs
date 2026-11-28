// SPDX-License-Identifier: MPL-2.0
// KCS container layout initially based on CatSystemKit (OWCramer).
import { Binary, inflate, boundedCount } from './binary.mjs';
import { nativeReply, bitsFloat } from './kcs/vm.mjs';
import { encodeCP932 } from './kcs/strings.mjs';
export { KCSMachine, nativeReply, floatBits, bitsFloat } from './kcs/vm.mjs';
export { encodeCP932 } from './kcs/strings.mjs';

const verifiedScriptVersions = new Set([0, 0x10000, 0x20000]);
const warnedVersions = new Set();

export async function readKCS(bytes, { warn = (message) => console.warn(message) } = {}) {
  const b = new Binary(bytes, 'KCS');
  if (!b.magic('KCS\0')) throw new Error('Expected KCS');
  const headerBytes = b.u32(12);
  if (headerBytes < 52) throw new Error('KCS header is shorter than its structural fields');
  b.range(0, headerBytes);
  const codeSize = boundedCount(b.u32(16), 64 * 1024 * 1024, 'KCS code'),
    count = boundedCount(b.u32(24), 1000000, 'KCS strings');
  const tableOffset = b.u32(20) - headerBytes,
    tableSize = boundedCount(b.u32(28), 64 * 1024 * 1024, 'KCS string table'),
    bodyCapacity = boundedCount(b.u32(48), 128 * 1024 * 1024, 'KCS body capacity');
  const body = new Binary(
    await inflate(b.range(headerBytes, bytes.length - headerBytes), undefined, bodyCapacity),
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
  const stackSize = boundedCount(b.u32(36), 16 * 1024 * 1024, 'KCS stack'),
    formatVersion = b.u32(4),
    scriptVersion = ((b.u16(8) << 16) | b.u16(10)) >>> 0;
  // Version metadata does not select an ABI or bypass structural validation.
  // Unknown executable/native/plugin implementations still fail at dispatch.
  if (formatVersion !== 2 || headerBytes !== 52 || !verifiedScriptVersions.has(scriptVersion)) {
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    const version = `format=${formatVersion}, headerBytes=${headerBytes}, script=${b.u16(8)}.${b.u16(10)}`,
      key = version + '/' + sha256;
    if (!warnedVersions.has(key)) {
      warnedVersions.add(key);
      warn(
        `Unverified KCS script container: ${version}, sha256=${sha256}; continuing with JS KCS reader`,
      );
    }
  }
  return {
    header: b.range(0, headerBytes).slice(),
    body,
    codeSize,
    data,
    strings,
    formatVersion,
    scriptMajor: b.u16(8),
    scriptMinor: b.u16(10),
    scriptVersion,
    tableOffset,
    tableSize,
    debugOffset: b.u32(40) - headerBytes,
    debugSize: b.u32(44),
    bodyCapacity,
    stackSize,
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
      case 0x0e: {
        const bytes = formatNativeAt(args[1], m),
          end = bytes.indexOf(0);
        m.writeStringBytes(end < 0 ? bytes : bytes.subarray(0, end), args[0]);
        return nativeReply(1, args[0]);
      }
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
function nativeFormatAddress(region, digits, machine) {
  let offset = 0;
  for (let i = 0; i < digits.length; i++) offset = (offset * 10 + digits.charCodeAt(i) - 48) >>> 0;
  return (region === 'H' ? offset | 0x80000000 : offset + (region === 'L' ? machine.fp : 0)) >>> 0;
}

function nativeFormatNumber(digits) {
  let value = 0;
  for (let i = 0; i < digits.length; i++) value = (value * 10 + digits.charCodeAt(i) - 48) | 0;
  return value;
}
function nativeFormatCString(machine, address) {
  const bytes = [];
  for (let at = address >>> 0; ; at = (at + 1) >>> 0) {
    const byte = machine.load(at, 1);
    if (!byte) return Uint8Array.from(bytes);
    bytes.push(byte);
  }
}
function nativeFormatFloat(word, precision, alternate) {
  const number = Math.abs(bitsFloat(word));
  let digits, point;
  if (Number.isFinite(number)) {
    if (!number) {
      digits = '0';
      point = 1;
    } else {
      // The pinned CRTs keep 17 significant decimal digits before fixed
      // formatting. More precision appends zeroes to those digits.
      const [mantissa, exponent] = number.toExponential(16).split('e');
      digits = mantissa.replace('.', '');
      point = Number(exponent) + 1;
    }
  } else {
    digits = Number.isNaN(number) ? (word === 0xffc00000 ? '1#IND' : '1#QNAN') : '1#INF';
    point = 1;
  }
  precision = precision === undefined || precision < 0 ? 6 : Math.min(precision, 512);
  const count = point + precision;
  let rounded = '';
  if (count >= 0) {
    rounded = digits.slice(0, count).padEnd(count, '0');
    // The native digit-rounding helper also runs over INF/NAN spellings.
    if ((digits[count] ?? '0') >= '5') {
      const chars = [...rounded];
      let at = chars.length - 1;
      while (at >= 0 && chars[at] === '9') chars[at--] = '0';
      if (at < 0) {
        chars.unshift('1');
        point++;
      } else chars[at] = String.fromCharCode(chars[at].charCodeAt(0) + 1);
      rounded = chars.join('');
    }
  }
  const whole = point <= 0 ? '0' : rounded.padEnd(point, '0').slice(0, point),
    fraction = (point < 0 ? '0'.repeat(-point) + rounded : rounded.slice(point))
      .padEnd(precision, '0')
      .slice(0, precision);
  return whole + (precision || alternate ? '.' + fraction : '');
}
function nativeFormatField(field, machine, stringBytes) {
  const { flags, type, modifier, address } = field,
    width = Math.max(0, nativeFormatNumber(field.width)),
    precision = field.precision === undefined ? undefined : nativeFormatNumber(field.precision);
  let bytes,
    prefix = '',
    zero = false;
  if (type === 's') {
    bytes = stringBytes;
    const end = bytes.indexOf(0);
    if (end >= 0) bytes = bytes.subarray(0, end);
    if (precision !== undefined && precision >= 0) bytes = bytes.subarray(0, precision);
    zero = flags.includes('0');
  } else {
    const word = machine.load(address);
    // Uppercase F resolves its argument but produces no field in these CRTs.
    if (type === 'F') return new Uint8Array();
    if (type === 'c') {
      bytes = Uint8Array.of(word & 255);
      zero = flags.includes('0');
    } else if (type === 'f') {
      bytes = encodeCP932(nativeFormatFloat(word, precision, flags.includes('#')));
      prefix = word >>> 31 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
      zero = flags.includes('0');
    } else {
      const signed = type === 'd' || type === 'i',
        pointer = type === 'p',
        value =
          modifier === 'h'
            ? signed
              ? (word << 16) >> 16
              : word & 65535
            : signed
              ? word | 0
              : word,
        radix = type === 'o' ? 8 : /[xXp]/.test(type) ? 16 : 10,
        minimum = pointer ? 8 : Math.min(512, Math.max(0, precision ?? 0));
      let text = precision === 0 && value === 0 && !pointer ? '' : Math.abs(value).toString(radix);
      text = text.padStart(minimum, '0');
      if (type === 'X' || pointer) text = text.toUpperCase();
      if (signed)
        prefix = value < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
      else if (flags.includes('#'))
        prefix =
          type === 'o'
            ? text.startsWith('0')
              ? ''
              : '0'
            : !value
              ? ''
              : type === 'x'
                ? '0x'
                : /[Xp]/.test(type)
                  ? '0X'
                  : '';
      bytes = encodeCP932(text);
      zero = !pointer && flags.includes('0') && (precision === undefined || precision < 0);
    }
  }
  const head = encodeCP932(prefix),
    length = head.length + bytes.length,
    size = Math.max(width, length);
  if (size >= 0x2800) throw new Error('Native format field exceeds its original VM temporary');
  const output = new Uint8Array(size),
    padding = size - length;
  output.fill(32);
  if (flags.includes('-')) {
    output.set(head);
    output.set(bytes, head.length);
  } else if (zero) {
    output.set(head);
    output.fill(48, head.length, head.length + padding);
    output.set(bytes, head.length + padding);
  } else {
    output.set(head, padding);
    output.set(bytes, padding + head.length);
  }
  return output;
}

// Native formatting consumes bytes. Decode only after the complete result, so
// a precision-truncated CP932 lead byte is never replaced between fields.
export function formatNative(text, machine) {
  return new TextDecoder('shift_jis').decode(formatNativeBytes(encodeCP932(text), machine));
}
export function formatNativeBytes(source, machine) {
  const frames = [{ source, at: 0, chunks: [], length: 0 }],
    active = new Set(),
    append = (frame, bytes) => {
      frame.chunks.push(bytes);
      frame.length += bytes.length;
    };
  while (frames.length) {
    const frame = frames.at(-1);
    if (frame.at >= frame.source.length) {
      const output = new Uint8Array(frame.length);
      let at = 0;
      for (const bytes of frame.chunks) {
        output.set(bytes, at);
        at += bytes.length;
      }
      frames.pop();
      if (!frames.length) return output;
      active.delete(frame.address);
      if (output.length >= 0x800)
        throw new Error('Native format string exceeds its original recursive temporary');
      const parent = frames.at(-1);
      append(parent, nativeFormatField(parent.pending, machine, output));
      delete parent.pending;
      continue;
    }
    const start = frame.at;
    if (frame.source[start] !== 37) {
      const next = frame.source.indexOf(37, start),
        end = next < 0 ? frame.source.length : next;
      append(frame, frame.source.subarray(start, end));
      frame.at = end;
      continue;
    }
    if (frame.source[start + 1] === 37) {
      append(frame, Uint8Array.of(37));
      frame.at += 2;
      continue;
    }
    const text = Array.from(frame.source.subarray(start), (byte) => String.fromCharCode(byte)).join(
        '',
      ),
      match = /^%([-+ #0]*)(\d*)(?:\.(\d*))?([hl]?)([diuoxXcpsfF])\[([LGH])(\d*)\]/.exec(text);
    if (
      !match ||
      (match[4] && !/[diuoxXfF]/.test(match[5])) ||
      (match[4] === 'h' && /[fF]/.test(match[5]))
    ) {
      if (/^%[^[\]\r\n]*\[[LGH]\d*\]/.test(text))
        throw new Error(`Unsupported native format conversion at ${text.slice(0, 64)}`);
      append(frame, Uint8Array.of(37));
      frame.at++;
      continue;
    }
    if (match[0].indexOf('[') >= 64)
      throw new Error('Native format conversion exceeds its original field buffer');
    const [, flags, width, precision, modifier, type, region, digits] = match,
      address = nativeFormatAddress(region, digits, machine),
      field = { flags, width, precision, modifier, type, address };
    frame.at += match[0].length;
    if (type === 's') {
      if (active.has(address))
        throw new Error('KCS native format recursion follows a cyclic string');
      active.add(address);
      frame.pending = field;
      frames.push({
        source: nativeFormatCString(machine, address),
        address,
        at: 0,
        chunks: [],
        length: 0,
      });
    } else append(frame, nativeFormatField(field, machine));
  }
}
export function formatNativeAt(address, machine) {
  return formatNativeBytes(nativeFormatCString(machine, address), machine);
}

// The SDK debug receiver passes the first formatter's C string through its
// own CRT logger. Main1 first duplicates a percent whose next byte differs;
// Generic/PTCL debug passes that string directly to the logger.
export function nativeLogBytes(bytes, { escapePercent = false, limit = 500 } = {}) {
  const end = bytes.indexOf(0),
    source = end < 0 ? bytes : bytes.subarray(0, end),
    format = [];
  for (let i = 0; i < source.length; i++) {
    format.push(source[i]);
    if (escapePercent && source[i] === 37 && source[i + 1] !== 37) format.push(37);
  }
  const output = [];
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== 37) output.push(format[i]);
    else {
      const next = format[++i];
      if (next === undefined) break;
      // A conversion here would read native variadic words that the SDK
      // caller did not provide. The original CRT's unknown bare conversion
      // instead emits its character, as does the measured "%b" case.
      if (next !== 37 && /[-+ #0-9.*hlIwdiuoxXcCsSpnfFeEgGaAZ]/.test(String.fromCharCode(next)))
        throw new Error('Native logger conversion reads unprovided variadic arguments');
      output.push(next);
    }
    if (output.length >= limit)
      throw new Error('Native logger exceeds its original terminated 500-byte buffer');
  }
  return Uint8Array.from(output);
}
