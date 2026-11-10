// SPDX-License-Identifier: MPL-2.0
import { nativeDataPair } from './data-text.mjs';
import { nativeUTF16 } from './utf8-codec.mjs';
import { parseNativeIntegerPrefix } from './standard.mjs';

export function nativeTextUnits(bytes, utf8 = false) {
  if (utf8) {
    const text = nativeUTF16(bytes);
    return Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
  }
  const out = [];
  for (let i = 0; i < bytes.length && bytes[i]; i++) {
    if (nativeDataPair(bytes, i)) out.push((bytes[i++] << 8) | bytes[i]);
    else out.push(bytes[i] === 255 ? 65535 : bytes[i]);
  }
  return out;
}
export function scanNativeText(
  input,
  { utf8 = false, parse = true, ruby = true, config = [], rate = 60, state = null } = {},
) {
  const units = input instanceof Uint8Array ? nativeTextUnits(input, utf8) : Array.from(input),
    records = [];
  const get = (i, fallback = 0) => config[i] ?? fallback;
  let at = state?.at ?? 0,
    group = state?.group ?? 0,
    depth = state?.depth ?? 0,
    mainSize = state?.mainSize ?? get(11, 24),
    rubySize = state?.rubySize ?? get(16, 12),
    color = state?.color ?? get(6, 0xffffff),
    defaultColor = state?.defaultColor ?? color,
    shadow = state?.shadow ?? get(7),
    rubyColor = state?.rubyColor ?? get(8, 0xffffff),
    wait = state?.wait ?? 0;
  const contexts = state?.contexts?.slice() ?? [],
    ids = new Map(state?.ids ?? []),
    next = () => (at < units.length ? units[at++] : 0);
  const numeric = () => {
    const start = at;
    let value = 0;
    if (!/[0-9]/.test(String.fromCharCode(units[at] ?? 0))) return null;
    const hex = units[at] === 48 && [88, 120].includes(units[at + 1]);
    if (hex) at += 2;
    const radix = hex ? 16 : 10;
    while (at < units.length) {
      const digit = Number.parseInt(String.fromCharCode(units[at]), radix);
      if (!Number.isInteger(digit) || digit >= radix) break;
      value = (Math.imul(value, radix) + digit) >>> 0;
      at++;
    }
    if (units[at] === 59) at++;
    return { value, used: at - start };
  };
  const parameter = () => {
    const result = [];
    while (at < units.length) {
      const code = next();
      if (code === 59) break;
      result.push(code);
    }
    return result;
  };
  const emit = (code, mode = 0, x = 0, y = 0, unicode = Number(utf8)) => {
    const style = mode >= 0 && mode <= 2;
    const revealTime =
      !style || mode === 2 || rate === null ? 0 : Math.floor((Math.imul(wait, rate) >>> 0) / 10);
    if (
      style &&
      mode !== 2 &&
      rate !== null &&
      code > 9 &&
      code !== 65535 &&
      (!get(33) || (code !== 32 && code !== 0x8140))
    )
      wait = (wait + get(code === 0x8142 ? 32 : 31)) >>> 0;
    records.push({
      code: code & 65535,
      mode,
      unicode,
      x: style ? x | 0 : 0,
      y: style ? y | 0 : 0,
      color: !style ? 0 : mode === 2 ? rubyColor : color,
      shadow: style ? shadow : 0,
      size: !style ? 0 : mode === 2 ? rubySize : mainSize,
      group: !style ? 0 : mode === 0 ? -1 : group,
      depth,
      revealTime,
    });
  };
  function escape(mode) {
    if (!parse && !ruby) return false;
    const lead = next();
    if (!lead) return false;
    if (lead !== 92) {
      at--;
      return false;
    }
    const original = next(),
      c = String.fromCharCode(original).toLowerCase();
    if (c === '$') {
      const p = parameter();
      if (p.length) {
        const s = p
          .map((n) => (n > 255 ? String.fromCharCode(n >>> 8, n & 255) : String.fromCharCode(n)))
          .join('');
        emit(parseNativeIntegerPrefix(s)?.value ?? 0, mode, 0, 0, 1);
      }
      return true;
    }
    if (c === 'z') {
      const p = parameter();
      if (p.length) {
        contexts.push(p.slice());
        depth++;
      } else if (depth > 0) depth--;
      return true;
    }
    if (c === 'c') {
      const qualifier = next(),
        q = String.fromCharCode(qualifier).toLowerCase();
      if (!qualifier) {
        if (parse) color = defaultColor;
        return true;
      }
      if (!['d', 'r', 's'].includes(q)) at--;
      const n = numeric();
      if (parse) {
        if (q === 'd') defaultColor = n?.value ?? get(6, 0xffffff);
        else if (q === 'r') rubyColor = n?.value ?? get(8, 0xffffff);
        else if (q === 's') shadow = n?.value ?? get(7);
        else color = n?.value ?? defaultColor;
      }
      if (!n) {
        if (q === 'r') {
          if (next() === 59) at++;
        } else if (qualifier === 59) at++;
      }
      return true;
    }
    if (c === 'f') {
      const qualifier = next(),
        q = String.fromCharCode(qualifier).toLowerCase();
      if (q === 'n') {
        mainSize = get(11, 24);
        rubySize = get(16, 12);
        return true;
      }
      if (q === 'l' || q === 's') {
        const tail = next(),
          double = String.fromCharCode(tail).toLowerCase() === q;
        mainSize = get(q === 'l' ? (double ? 13 : 12) : double ? 9 : 10, 24);
        rubySize = get(q === 'l' ? (double ? 18 : 17) : double ? 14 : 15, 12);
        const last = double ? next() : tail;
        if (last && last !== 59) at--;
        return true;
      }
      if (!['+', '-', 'r'].includes(q)) at--;
      const n = numeric();
      if (parse) {
        if (q === 'r') rubySize = n?.value ?? get(16, 12);
        else if (q === '+') mainSize = n ? (mainSize + n.value) | 0 : get(11, 24);
        else if (q === '-') mainSize = n ? (mainSize - n.value) | 0 : get(11, 24);
        else mainSize = n?.value ?? get(11, 24);
      }
      if (!n) {
        if (q === 'r') {
          if (next() === 59) at++;
        } else if (qualifier === 59) at++;
      }
      return true;
    }
    if (c === 'i') {
      const q = next();
      if (q === 100 || q === 68) {
        const n = numeric();
        let second = 0;
        if (n) {
          if (next() === 58) second = numeric()?.value ?? 0;
          else at--;
        }
        if (!ids.has(n?.value ?? 0)) ids.set(n?.value ?? 0, second);
      } else {
        if (q) at--;
        if (parse) emit(6);
      }
      return true;
    }
    if (c === 'p') {
      const q = next(),
        n = { 108: 1, 76: 1, 99: 2, 67: 2, 114: 3, 82: 3 }[q];
      if (!n) at--;
      if (parse) emit(n ?? 1);
      return true;
    }
    if (c === 'w') {
      const q = next();
      if (q === 114 || q === 82) {
        if (parse) {
          wait = 0;
          emit(9);
        }
      } else {
        if (q !== 102 && q !== 70) at--;
        const n = numeric();
        if (n && parse) {
          if (q === 102 || q === 70) wait = (wait + n.value) >>> 0;
          else if (rate > 0)
            wait = Math.floor((Math.imul(Math.imul(10, n.value), get(31, 1)) >>> 0) / (rate >>> 0));
        }
      }
      return true;
    }
    if (c === 'x' || c === 'y') {
      const n = numeric();
      if (n && parse) {
        if (c === 'x') emit(4, n.value, 0, 0);
        else emit(5, 0, n.value, 0);
      }
      return true;
    }
    if (c === 'n') {
      if (parse) emit(0);
      return true;
    }
    if (c === '@') {
      if (parse) emit(7);
      return true;
    }
    if (c === 'r') {
      emit(8);
      return true;
    }
    if (c === 's') {
      emit(0x8140);
      emit(0);
      return true;
    }
    emit(original, mode);
    return true;
  }
  function scan(mode = 0) {
    while (at < units.length) {
      const before = at;
      if (escape(mode)) {
        if (at < before) throw new Error('Text scanner moved before its input');
        continue;
      }
      const c = next();
      if (!c) continue;
      if (c === 91 && mode === 0) {
        if (parse || ruby) {
          scan(1);
          if (parse) group++;
        } else emit(c);
      } else if (c === 47 && mode === 1) mode = 2;
      else if (c === 93 && (mode === 1 || mode === 2)) return;
      else if (mode !== 2 || parse) emit(c, mode);
    }
  }
  scan();
  return {
    records,
    ids,
    wait,
    state: {
      at,
      group,
      depth,
      mainSize,
      rubySize,
      color,
      defaultColor,
      shadow,
      rubyColor,
      wait,
      contexts,
      ids: [...ids],
    },
  };
}
export function plainNativeText(bytes, utf8 = false) {
  const out = [],
    encoder = new TextEncoder();
  for (const r of scanNativeText(bytes, { utf8 }).records)
    if (r.code > 9 && r.code !== 65535 && r.mode !== 2) {
      if (utf8) out.push(...encoder.encode(String.fromCharCode(r.code)));
      else {
        if (r.code > 255) out.push(r.code >>> 8);
        out.push(r.code & 255);
      }
    }
  return Uint8Array.from(out);
}
