// SPDX-License-Identifier: MPL-2.0
// USER32 wsprintf is cdecl and has its own 32-bit integer/string format ABI.
import { encodeCP932 } from '../kcs/strings.mjs';
const fromUnits = (units) => {
  const parts = [];
  for (let at = 0; at < units.length; at += 16384)
    parts.push(String.fromCharCode(...units.slice(at, at + 16384)));
  return parts.join('');
};
export function formatWindowsString(process, format, argument, { wide = false } = {}) {
  const read = (pointer, isWide) => {
      if (!pointer)
        return Array.from(isWide ? '(null)' : new TextEncoder().encode('(null)'), (c) =>
          typeof c === 'string' ? c.charCodeAt(0) : c,
        );
      const bytes = process.stringBytes(pointer, isWide);
      if (!isWide) return [...bytes];
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Array.from({ length: bytes.length / 2 }, (_, i) => view.getUint16(i * 2, true));
    },
    convert = (units, sourceWide) => {
      if (sourceWide === wide) return units;
      const text = sourceWide
        ? fromUnits(units)
        : new TextDecoder('shift_jis').decode(Uint8Array.from(units));
      return wide
        ? Array.from({ length: text.length }, (_, i) => text.charCodeAt(i))
        : [...encodeCP932(text)];
    },
    output = [],
    literal = (text) => [...text].map((c) => c.charCodeAt(0));
  for (let at = 0; at < format.length && (1024 - output.length) >>> 0 > 1; ) {
    if (format[at] !== '%') {
      output.push(format.charCodeAt(at++));
      continue;
    }
    at++;
    if (format[at] === '%') {
      output.push(37);
      at++;
      continue;
    }
    let left = false,
      alternate = false,
      zero = false,
      width = '',
      precision = 0,
      length = '';
    if (format[at] === '-') {
      left = true;
      at++;
    }
    if (format[at] === '#') {
      alternate = true;
      at++;
    }
    if (format[at] === '0') {
      zero = true;
      at++;
    }
    while (/[0-9]/.test(format[at] ?? '') && at < format.length) width += format[at++];
    if (format[at] === '.') {
      at++;
      let digits = '';
      while (/[0-9]/.test(format[at] ?? '') && at < format.length) digits += format[at++];
      precision = Number(digits) >>> 0;
    }
    if (format.startsWith('I64', at) || format.startsWith('I32', at)) {
      length = format.slice(at, at + 3);
      at += 3;
    } else if (['h', 'l', 'w', 'I'].includes(format[at])) length = format[at++];
    const type = format[at++];
    if (!type) break;
    // Width and the 1024-unit budget are measured before a hex prefix. The
    // original USER32 implementation also retains its DWORD budget wrap.
    const remaining = (1024 - output.length) >>> 0,
      limit = remaining - 1;
    width = Math.min(Number(width) >>> 0, limit);
    if (left) zero = false;
    if (!'cCsSdiuxXp'.includes(type)) {
      if (!left) output.push(...new Array(Math.max(0, width - precision)).fill(32));
      at--;
      continue;
    }
    const value = argument() >>> 0;
    let units,
      prefix = '',
      padding;
    if ('sScC'.includes(type)) {
      const sourceWide =
        type === 's'
          ? wide
            ? length !== 'h'
            : ['l', 'w'].includes(length)
          : type === 'S'
            ? wide
              ? ['l', 'w'].includes(length)
              : !['h', 'w'].includes(length)
            : type === 'c'
              ? wide
                ? length !== 'h'
                : length === 'l'
              : wide
                ? length === 'l'
                : length !== 'h';
      if (type.toLowerCase() === 's') {
        units = convert(read(value, sourceWide), sourceWide);
        units = units.slice(0, Math.min(precision || units.length, limit));
      } else {
        const code = value & (sourceWide ? 0xffff : 255);
        units = convert([code], sourceWide);
      }
      padding = Math.max(0, width - units.length);
    } else {
      const signed = type === 'd' || type === 'i',
        hex = 'xXp'.includes(type);
      if (alternate && !hex)
        throw new Error('Native wsprintf # on a decimal reads undefined USER32 stack bytes');
      let number = BigInt(value);
      if (length === 'I64') number |= BigInt(argument() >>> 0) << 32n;
      if (signed) number = BigInt.asIntN(length === 'I64' ? 64 : 32, number);
      let text = number.toString(hex ? 16 : 10);
      if (type === 'X' || type === 'p') text = text.toUpperCase();
      text = text.slice(0, limit);
      if (type === 'p') {
        width = Math.min(8, limit);
        zero = !left;
      }
      precision = Math.min(Math.max(precision, text.length), limit);
      if (zero) precision = Math.max(precision, width);
      padding = Math.max(0, width - precision);
      const negative = text.startsWith('-');
      units = literal(
        (negative ? '-' : '') + '0'.repeat(precision - text.length) + text.slice(Number(negative)),
      );
      if (alternate && remaining - padding > 3) prefix = type === 'X' || type === 'p' ? '0X' : '0x';
    }
    if (!left) output.push(...new Array(padding).fill(32));
    output.push(...literal(prefix));
    output.push(...units);
    if (left) output.push(...new Array(padding).fill(32));
  }
  const bytes = new Uint8Array((output.length + 1) * (wide ? 2 : 1)),
    view = new DataView(bytes.buffer);
  output.forEach((unit, i) => (wide ? view.setUint16(i * 2, unit, true) : (bytes[i] = unit)));
  return { bytes, count: (1024 - output.length) >>> 0 > 1 ? output.length : 1024 };
}
export function installWindowsPrintf(kernel) {
  const p = kernel.process;
  for (const [suffix, wide] of [
    ['A', false],
    ['W', true],
  ]) {
    kernel.register('USER32.dll', `wsprintf${suffix}`, {
      count: 0,
      fn: () => {
        const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
          out = p.load(sp + 4),
          format = wide ? p.string(p.load(sp + 8), true) : fromUnits(p.stringBytes(p.load(sp + 8)));
        let at = sp + 12;
        const result = formatWindowsString(
          p,
          format,
          () => {
            const value = p.load(at);
            at += 4;
            return value;
          },
          { wide },
        );
        p.write(out, result.bytes);
        return result.count;
      },
    });
    kernel.register('USER32.dll', `wvsprintf${suffix}`, {
      count: 3,
      fn: ([out, fmt, args]) => {
        let at = args;
        const result = formatWindowsString(
          p,
          wide ? p.string(fmt, true) : fromUnits(p.stringBytes(fmt)),
          () => {
            const value = p.load(at);
            at += 4;
            return value;
          },
          { wide },
        );
        p.write(out, result.bytes);
        return result.count;
      },
    });
  }
}
