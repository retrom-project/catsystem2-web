// SPDX-License-Identifier: MPL-2.0
// Main-table standard primitives. IDs are not valid in the MOT/PTCL tables.
import { nativeReply, floatBits, bitsFloat, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { degreeToRadian, radianToDegree } from '../ppi/numeric.mjs';
import { nativeCalendar } from './calendar.mjs';
import { nativeCommaFields, parseNativeResourceSelection } from './resource-selection.mjs';

const value = (n) => {
  if (!Number.isInteger(n)) throw new TypeError('A native result must be a 32-bit integer');
  return nativeReply(1, n >>> 0);
};
const done = () => nativeReply(2);
const signedByte = (n) => (n << 24) >> 24;

function cstring(m, address) {
  const bytes = [];
  for (let i = 0; ; i++) {
    const byte = m.load(address + i, 1);
    if (!byte) return Uint8Array.from(bytes);
    bytes.push(byte);
  }
}
function write(m, address, bytes, zeroes = 2) {
  const target = m.bytes(address, bytes.length + zeroes);
  target.set(bytes);
  target.fill(0, bytes.length);
}
function doubleByte(bytes, at) {
  const lead = bytes[at],
    trail = bytes[at + 1];
  return (
    ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xef)) &&
    ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc))
  );
}
function comparison(a, b, ignoreCase = false) {
  const lower = (n) => (ignoreCase && n >= 65 && n <= 90 ? n + 32 : n);
  for (let i = 0; ; i++) {
    const x = lower(a[i] || 0),
      y = lower(b[i] || 0);
    if (x !== y) return ignoreCase ? x - y : signedByte(x) - signedByte(y);
    if (!x) return 0;
  }
}
export function parseNativeIntegerPrefix(text) {
  let at = 0,
    negative = false,
    result = 0;
  if (text[at] === '-' || text[at] === '+') negative = text[at++] === '-';
  if (!/[0-9]/.test(text[at] || '')) return null;
  const hexadecimal = text[at] === '0' && /[xX]/.test(text[at + 1] || '');
  if (hexadecimal) at += 2;
  const radix = hexadecimal ? 16 : 10;
  while (at < text.length) {
    const digit = Number.parseInt(text[at], radix);
    if (!Number.isInteger(digit) || digit >= radix) break;
    result = (Math.imul(result, radix) + digit) | 0;
    at++;
  }
  if (!hexadecimal && text[at] === '.') return null;
  return { value: (negative ? -result : result) | 0, count: at };
}
export function parseNativeInteger(text) {
  return parseNativeIntegerPrefix(text)?.value ?? null;
}
function format(services, m, address) {
  if (typeof services.format !== 'function') return undefined;
  const text = services.format(address, m);
  if (typeof text !== 'string') throw new TypeError('Native format service must return text');
  return text;
}
function formatBytes(services, m, address) {
  if (typeof services.formatBytes === 'function') {
    const bytes = services.formatBytes(address, m);
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Native byte formatter must return bytes');
    return bytes;
  }
  const text = format(services, m, address);
  return text === undefined ? undefined : encodeCP932(text);
}
function delimiters(bytes, formatted) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    // The formatted native checks an actual tab after a backslash.
    if (bytes[i] === 92 && bytes[i + 1] === (formatted ? 9 : 116)) {
      out.push(9);
      i++;
    } else out.push(bytes[i]);
  }
  return new Set(out);
}
function groupEnd(bytes, start) {
  let level = 0;
  for (let at = start; at < bytes.length; at++) {
    if (bytes[at] === 40) level++;
    if (bytes[at] === 41 && --level === 0) return at + 1;
  }
  return bytes.length;
}
function split(m, destination, bytes, separator, groups) {
  const alpha = (n) => (n >= 65 && n <= 90) || (n >= 97 && n <= 122);
  let at = 0,
    out = 0,
    separated = true,
    previous = 0;
  while (at < bytes.length) {
    const byte = bytes[at];
    if (groups && byte === 40) {
      if (alpha(previous) && !separated) m.store(destination + out++, 0, 1);
      const end = groupEnd(bytes, at),
        literal = bytes[at + 1] === 58,
        length = end - at;
      write(m, destination + out, bytes.subarray(at, end));
      if (literal) {
        if (length > 3)
          m.bytes(destination + out, length - 3).set(m.bytes(destination + out + 2, length - 3));
        if (length >= 2) m.store(destination + out + length - 3, 0, 1);
        out -= 3;
      }
      out += length;
      at = end;
      separated = false;
    } else if (separator.has(byte)) {
      if (!separated) m.store(destination + out++, 0, 1);
      separated = true;
      previous = 0;
      at++;
    } else {
      m.store(destination + out++, byte, 1);
      if (!groups && doubleByte(bytes, at)) m.store(destination + out++, bytes[++at], 1);
      previous = byte;
      separated = false;
      at++;
    }
  }
  m.store(destination + out, 0, 2);
}
function listEntry(m, address, index) {
  let at = address;
  for (let i = 0; i < (index | 0) && m.load(at, 1); i++) at += cstring(m, at).length + 1;
  return { address: at, bytes: cstring(m, at) };
}
function indexOfBytes(haystack, needle, start = 0, boundaries = false) {
  for (let at = start; at < haystack.length; at += boundaries && doubleByte(haystack, at) ? 2 : 1) {
    let i = 0;
    while (i < needle.length && at + i < haystack.length && haystack[at + i] === needle[i]) i++;
    if (i === needle.length) return at;
  }
  return -1;
}

// Services are synchronous host operations. A host that needs asynchronous I/O
// must suspend/retry the GCALL before invoking this dispatcher.
export function nativeStandard(id, args, m, services = {}) {
  const calendar = nativeCalendar(id, args);
  if (calendar !== undefined) return calendar;
  const requireArguments = (count) => {
    if (args.length !== count)
      throw new Error(
        `KCS native 0x${id.toString(16)} expects ${count} arguments; received ${args.length}`,
      );
  };
  const formatted = (at) => format(services, m, at);
  let a, b, out;
  switch (id) {
    // These exact pinned handlers return control 1 without storing their
    // output. GCALL initializes that word afresh and pushes its sentinel.
    case 0x8c:
    case 0x8e:
    case 0x225:
      return value(NATIVE_RESULT_SENTINEL);
    case 0:
    case 2:
    case 3:
      return done();
    case 1:
      requireArguments(1);
      a = formatted(args[0]);
      if (a === undefined || typeof services.log !== 'function') return undefined;
      services.log(a);
      return done();
    case 4: {
      requireArguments(0);
      if (typeof services.clock !== 'function') return undefined;
      const milliseconds = services.clock();
      if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds))
        throw new TypeError('Native millisecond clock requires a finite platform value');
      return value(Math.trunc(milliseconds) >>> 0);
    }
    case 6:
      requireArguments(1);
      return value(args[0]);
    case 9:
      requireArguments(1);
      if (typeof services.exit !== 'function') return undefined;
      services.exit(Boolean(args[0]));
      return done();
    case 10:
      requireArguments(1);
      a = formatted(args[0]);
      if (a === undefined || typeof services.clipboard !== 'function') return undefined;
      services.clipboard(a.replaceAll('\\n', '\r\n'));
      return done();
    case 11: {
      requireArguments(7);
      const date = services.date ? services.date() : new Date();
      [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDay(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
      ].forEach((n, i) => m.store(args[i], n));
      return done();
    }
    case 0x0d:
    case 0x0e:
    case 0x0f:
    case 0x10:
      requireArguments(2);
      b = id === 0x0e || id === 0x10 ? formatBytes(services, m, args[1]) : cstring(m, args[1]);
      if (b === undefined) return undefined;
      a = id >= 0x0f ? cstring(m, args[0]) : new Uint8Array();
      out = new Uint8Array(a.length + b.length);
      out.set(a);
      out.set(b, a.length);
      write(m, args[0], out);
      return value(args[0]);
    case 0x11:
    case 0x12:
      requireArguments(1);
      a = id === 0x12 ? formatBytes(services, m, args[0]) : cstring(m, args[0]);
      return a === undefined ? undefined : value(a.length);
    case 0x13:
    case 0x14:
    case 0x15:
    case 0x16:
      requireArguments(2);
      if (id === 0x14 || id === 0x16) {
        a = formatBytes(services, m, args[0]);
        b = formatBytes(services, m, args[1]);
      } else {
        a = cstring(m, args[1]);
        b = cstring(m, args[0]);
      }
      return a === undefined || b === undefined ? undefined : value(comparison(a, b, id >= 0x15));
    case 0x17:
    case 0x18: {
      requireArguments(2);
      a = cstring(m, args[0]);
      let at = 0,
        characters = 0;
      while (at < a.length) {
        const width = doubleByte(a, at) ? 2 : 1;
        if (id === 0x17 ? at + width >= args[1] >>> 0 : characters >= args[1] >>> 0) break;
        at += width;
        characters++;
      }
      write(m, args[0], a.subarray(0, at));
      return value(at);
    }
    case 0x19:
    case 0x1a: {
      requireArguments(1);
      a = formatted(args[0]);
      if (a === undefined) return undefined;
      if (id === 0x19) return value(parseNativeInteger(a) ?? 0);
      const number = Number.parseFloat(a);
      return value(floatBits(Number.isNaN(number) ? 0 : number));
    }
    case 0x1b:
      requireArguments(1);
      return value(m.allocate(args[0] >>> 0));
    case 0x1c:
      requireArguments(1);
      return value(Number(m.free(args[0])));
    case 0xed:
      requireArguments(1);
      m.free(args[0]);
      return done();
    case 0x1d:
      requireArguments(2);
      if (!services.files) return undefined;
      a = formatted(args[0]);
      b = formatted(args[1]);
      if (a === undefined || b === undefined) return undefined;
      return value(services.files.open(a, b));
    case 0x1e:
    case 0x1f: {
      requireArguments(4);
      if (!services.files) return undefined;
      const size = Math.imul(args[1], args[2]) >>> 0;
      if (id === 0x1e) {
        const bytes = services.files.read(args[3], size);
        if (bytes === null) return value(0);
        if (!(bytes instanceof Uint8Array) || bytes.length > size)
          throw new TypeError('Native file read must return a bounded Uint8Array or null');
        m.bytes(args[0], bytes.length).set(bytes);
        return value(bytes.length);
      }
      const written = services.files.write(args[3], m.bytes(args[0], size));
      return value(written === -1 ? 0 : written);
    }
    case 0x20:
      requireArguments(1);
      if (!services.files) return undefined;
      services.files.close(args[0]);
      return done();
    case 0x21:
    case 0x22:
      requireArguments(0);
      if (!services.random) return undefined;
      return value(id === 0x21 ? services.random.rand() : floatBits(services.random.frand()));
    case 0x23:
      requireArguments(3);
      m.bytes(args[0], args[2]).set(m.bytes(args[1], args[2]));
      return done();
    case 0x24:
      requireArguments(3);
      m.bytes(args[0], args[2]).fill(args[1]);
      return done();
    case 0x25: {
      requireArguments(3);
      const number = args[1] | 0,
        reversed = [];
      let remaining = Math.abs(number) | 0,
        digits = 0;
      if (!remaining) reversed.push(48);
      while (remaining) {
        if (digits === 3) {
          reversed.push(44);
          digits = 0;
        }
        const next = Math.trunc(remaining / 10);
        reversed.push((remaining - next * 10 + 48) & 255);
        remaining = next;
        digits++;
      }
      if (number < 0) reversed.push(45);
      else if (number > 0 && args[2]) reversed.push(43);
      write(m, args[0], reversed.reverse());
      return done();
    }
    case 0x26:
    case 0x27: {
      requireArguments(4);
      a = id === 0x27 ? formatBytes(services, m, args[1]) : cstring(m, args[1]);
      if (a === undefined) return undefined;
      const separators = delimiters(cstring(m, args[2]), id === 0x27),
        limit = ((args[3] >>> 0) - 2) >>> 0;
      let length = 0;
      while (length < a.length && length < limit && !separators.has(a[length])) length++;
      write(m, args[0], a.subarray(0, length));
      return value(length);
    }
    case 0x28:
      requireArguments(1);
      a = cstring(m, args[0]);
      return value(Number(doubleByte(a, 0)));
    case 0x29:
    case 0x2b:
      requireArguments(3);
      split(m, args[0], cstring(m, args[1]), new Set(cstring(m, args[2])), id === 0x2b);
      return done();
    case 0x2a: {
      requireArguments(3);
      const selected = listEntry(m, args[1], args[2]);
      write(m, args[0], selected.bytes);
      return value(Number(selected.bytes.length > 0));
    }
    case 0x207: {
      requireArguments(3);
      // The wrapper clears its destination before reading the source. Aliases
      // must observe that byte; missing tokens do not clear a second byte.
      m.store(args[0], 0, 1);
      const source = cstring(m, args[1]),
        scratch = new Uint8Array(source.length * 2 + 8),
        memory = {
          load: (at) => new DataView(scratch.buffer).getUint8(at),
          store: (at, word, size) => {
            const view = new DataView(scratch.buffer);
            if (size === 1) view.setUint8(at, word);
            else view.setUint16(at, word, true);
          },
          bytes: (at, size) => scratch.subarray(at, at + size),
        };
      split(memory, 0, source, new Set([32]), true);
      let at = 0,
        index = 0;
      while (index < args[2] >>> 0 && scratch[at]) {
        while (scratch[at]) at++;
        at++;
        index++;
      }
      const token = cstring(memory, at);
      if (token.length) write(m, args[0], token);
      return value(Number(Boolean(token.length)));
    }
    case 0x256: {
      requireArguments(2);
      const source = formatBytes(services, m, args[0]);
      if (source === undefined) return undefined;
      const selected = parseNativeResourceSelection(source);
      if (!selected) return value(0);
      if (selected.selectors.length > 64)
        throw new RangeError('Native resource selector exceeds its original 64-word scratch');
      write(m, args[1], selected.base, 1);
      return value(1);
    }
    case 0x388: {
      requireArguments(2);
      const replacement = formatBytes(services, m, args[1]);
      if (replacement === undefined) return undefined;
      // Both lists are snapshotted before the first destination byte is cleared.
      const fields = nativeCommaFields(replacement),
        previous = nativeCommaFields(cstring(m, args[0]));
      m.store(args[0], 0, 1);
      let offset = 0;
      fields.forEach((field, index) => {
        const selected =
          field.length === 1 && field[0] === 64 ? (previous[index] ?? Uint8Array.of(48)) : field;
        if (index) write(m, args[0] + offset++, Uint8Array.of(44), 1);
        write(m, args[0] + offset, selected, 1);
        offset += selected.length;
      });
      return done();
    }
    case 0x2c: {
      requireArguments(4);
      out = [];
      let selected = listEntry(m, args[1], args[2]),
        index = Math.max(0, args[2] | 0);
      const last = (args[3] | 0) === -1 ? 0x7fffffff : args[3] | 0;
      while (selected.bytes.length && index <= last) {
        out.push(...selected.bytes, 32);
        selected = listEntry(m, selected.address + selected.bytes.length + 1, 0);
        index++;
      }
      write(m, args[0], out, 1);
      return done();
    }
    case 0x2d: {
      requireArguments(4);
      const source = cstring(m, args[1]),
        needle = cstring(m, args[2]),
        replacement = cstring(m, args[3]);
      if (!needle.length && source.length)
        throw new Error(
          'KCS replacement with an empty needle does not terminate in the native engine',
        );
      out = [];
      let at = 0,
        found;
      while ((found = indexOfBytes(source, needle, at)) >= 0) {
        out.push(...source.subarray(at, found), ...replacement);
        at = found + needle.length;
      }
      write(m, args[0], out);
      out.push(...source.subarray(at));
      write(m, args[0], out, 1);
      return done();
    }
    case 0x2e: {
      requireArguments(2);
      a = m.string(args[0]);
      const number = parseNativeInteger(a);
      if (a.endsWith('%') && number !== null) {
        const scaled = Math.fround(
          Math.fround(Math.fround(number) * Math.fround(args[1] >>> 0)) / 100,
        );
        const n =
          Number.isFinite(scaled) && scaled >= -2147483648 && scaled < 2147483648
            ? Math.trunc(scaled)
            : -2147483648;
        write(m, args[0], encodeCP932(String(n)));
      }
      return done();
    }
    case 0x2f:
    case 0x30: {
      requireArguments(1);
      a = id === 0x30 ? formatBytes(services, m, args[0]) : cstring(m, args[0]);
      if (a === undefined) return undefined;
      let count = 0;
      for (let at = 0; at < a.length; count++) at += doubleByte(a, at) ? 2 : 1;
      return value(count);
    }
    case 0x31:
      requireArguments(2);
      a = cstring(m, args[0]);
      b = cstring(m, args[1]);
      out = indexOfBytes(a, b, 0, true);
      return value(out < 0 ? a.length : out);
    case 0x32:
    case 0x33:
    case 0x34:
    case 0x35:
    case 0x36:
    case 0x37:
    case 0x38:
    case 0x39:
    case 0x3a:
    case 0x3c:
    case 0x3e:
    case 0x3f:
      requireArguments(1);
      a = bitsFloat(args[0]);
      out = {
        0x32: Math.sin,
        0x33: Math.cos,
        0x34: Math.tan,
        0x35: Math.asin,
        0x36: Math.acos,
        0x37: Math.atan,
        0x38: Math.ceil,
        0x39: Math.abs,
        0x3a: Math.floor,
        0x3c: Math.sqrt,
        0x3e: degreeToRadian,
        0x3f: radianToDegree,
      }[id](a);
      return value(floatBits(out));
    case 0x3b:
    case 0x3d:
      requireArguments(2);
      a = bitsFloat(args[0]);
      b = bitsFloat(args[1]);
      out = id === 0x3b ? a % b : Math.pow(a, b);
      return value(floatBits(id === 0x3b && a === 0 ? 0 : out));
    case 0x40:
      requireArguments(1);
      return value(Math.abs(args[0] | 0));
    case 0x41:
      requireArguments(0);
      return nativeReply(4);
    default:
      return undefined;
  }
}
