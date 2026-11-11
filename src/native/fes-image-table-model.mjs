// SPDX-License-Identifier: MPL-2.0
// Resource bytes become ordinary table/row/node state. No EXE or file service.
import { NativeGalleryTable } from './gallery-tables.mjs';
import { nativeDataKey, nativeDataPair, nativeDataString } from './data-text.mjs';

const types = new Set([16, 17, 18, 19, 20]);
const marker = Uint8Array.of(0x81, 0x9b);
const top = '_TOP_';
const copyCString = (bytes) => nativeDataString(bytes).slice();
const equals = (a, b) => a.length === b.length && a.every((byte, at) => byte === b[at]);
const selectorsRequired = (selectors, minimum, exact = false) => {
  if (
    !Array.isArray(selectors) ||
    selectors.length < minimum ||
    (exact && selectors.length !== minimum) ||
    selectors.some((value) => !Number.isInteger(value))
  )
    throw new TypeError('FES image table requires its complete integer selector array');
};

// 727AB0/7282E0, CSV mode0 and constructor keepNewlines=false. This is not RFC CSV.
export function parseFESImageCSV(bytes) {
  const rows = [];
  let at = 0;
  while (at < bytes.length) {
    const fields = [];
    while (at < bytes.length && bytes[at] !== 13 && bytes[at] !== 10) {
      const field = [],
        quoted = bytes[at] === 34;
      if (quoted) at++;
      let done = false;
      while (at < bytes.length && !done) {
        const byte = bytes[at];
        if (!byte) throw new Error('FES image CSV stops advancing at an embedded NUL');
        if ((byte === 44 || byte === 13 || byte === 10) && !quoted) break;
        if (byte === 34) {
          if (bytes[at + 1] === 34) {
            field.push(34);
            at += 2;
          } else {
            at++;
            done = true;
          }
        } else if (byte === 13 || byte === 10) {
          at++;
          if (bytes[at] === (byte === 13 ? 10 : 13)) at++;
        } else if (nativeDataPair(bytes, at)) {
          field.push(byte, bytes[at + 1]);
          at += 2;
        } else {
          field.push(byte);
          at++;
        }
      }
      // Closing a quote discards the remainder up to the next delimiter/newline.
      while (at < bytes.length && ![44, 10, 13].includes(bytes[at])) {
        if (!bytes[at]) throw new Error('FES image CSV stops advancing at an embedded NUL');
        at += nativeDataPair(bytes, at) ? 2 : 1;
      }
      if (bytes[at] === 44) at++;
      fields.push(Uint8Array.from(field));
    }
    rows.push(fields);
    const newline = bytes[at++];
    if (newline === 13 && bytes[at] === 10) at++;
  }
  return rows;
}

// 6A5F70 drops empty tokens, protects valid CP932 pairs, and treats quotes literally.
function splitBytes(bytes, delimiter) {
  bytes = nativeDataString(bytes);
  const result = [];
  let token = [];
  for (let at = 0; at < bytes.length; at++) {
    if (bytes[at] === delimiter) {
      if (token.length) {
        result.push(Uint8Array.from(token));
        token = [];
      }
    } else {
      token.push(bytes[at]);
      if (nativeDataPair(bytes, at)) token.push(bytes[++at]);
    }
  }
  if (token.length) result.push(Uint8Array.from(token));
  return result;
}
function joinBytes(tokens) {
  const result = [];
  for (const [index, token] of tokens.entries()) {
    if (index) result.push(44);
    result.push(...token);
  }
  return Uint8Array.from(result);
}
export function mergeFESSectionReferences(previous, next) {
  const left = splitBytes(previous, 44),
    right = splitBytes(next, 44),
    merged = [];
  for (let at = 0; at < Math.max(left.length, right.length); at++)
    merged.push(
      at >= right.length || (at < left.length && right[at].length === 1 && right[at][0] === 64)
        ? left[at]
        : right[at],
    );
  return joinBytes(merged);
}

function rawLines(bytes) {
  bytes = nativeDataString(bytes);
  const lines = [];
  let at = 0;
  while (at < bytes.length) {
    const begin = at;
    while (at < bytes.length && bytes[at] !== 13 && bytes[at] !== 10) at++;
    lines.push(bytes.slice(begin, at));
    const newline = bytes[at++];
    if (newline === 13 && bytes[at] === 10) at++;
  }
  return lines;
}
function readSections(bytes) {
  const sections = new Map();
  let name = '',
    rows = [];
  const flush = () => {
    // The original unique-map insertion keeps the first nonempty section.
    if (rows.length && !sections.has(name)) sections.set(name, rows);
    rows = [];
  };
  for (const line of rawLines(bytes)) {
    if (line[0] === 35) {
      flush();
      name = nativeDataKey(line.subarray(1));
    } else {
      const fields = splitBytes(line, 32);
      if (fields.length) rows.push({ reference: fields[0], next: fields[1] ?? new Uint8Array() });
    }
  }
  flush();
  return sections;
}
function readTree(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    active = new Set();
  const requireRange = (at, size) => {
    if (!Number.isSafeInteger(at) || at < 0 || size < 0 || at + size > bytes.length)
      throw new RangeError('CHTABLE2 node crosses its serialized resource');
  };
  const readSiblings = (offset) => {
    const nodes = [],
      held = [];
    let at = offset;
    while (true) {
      requireRange(at, 12);
      if (active.has(at)) throw new Error('CHTABLE2 serialized tree contains a cycle');
      active.add(at);
      held.push(at);
      const sibling = view.getInt32(at, true),
        child = view.getInt32(at + 4, true);
      const size = view.getUint32(at + 8, true);
      if (size < 100) throw new RangeError('CHTABLE2 node has no complete ID/prefix/mask payload');
      requireRange(at + 12, size);
      const data = at + 12;
      const prefix = bytes.subarray(data + 36, data + 68);
      if (!prefix.includes(0))
        throw new RangeError('CHTABLE2 prefix has no terminator before its native stack boundary');
      const node = {
        id: view.getUint32(data, true),
        prefix: copyCString(prefix),
        mask: copyCString(bytes.subarray(data + 68, data + 100)),
        children: child ? readSiblings(at + child) : [],
      };
      nodes.push(node);
      if (!sibling) break;
      // A sibling back-edge is also a cycle of the native recursive parser.
      const next = at + sibling;
      requireRange(next, 12);
      at = next;
    }
    for (const offset of held) active.delete(offset);
    // 726A80 prepends each wire node to its parent's first-child link.
    return nodes.reverse();
  };
  return readSiblings(0);
}

export class FESImageTable {
  constructor(type, bytes) {
    if (!types.has(type)) throw new Error(`FES image table type ${type} is not implemented`);
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('FES image table requires resource bytes');
    this.type = type;
    this.baseOption = new Uint8Array();
    if (type === 16 || type === 18) {
      this.gallery = new NativeGalleryTable(type === 16 ? 'names' : 'variants', bytes);
    } else if (type === 17) {
      this.rows = parseFESImageCSV(bytes).filter((row) => row[0] && equals(row[0], marker));
    } else if (type === 19) this.roots = readTree(bytes);
    else this.sections = readSections(bytes);
  }
  setBaseOption(bytes) {
    if (this.type !== 19 && this.type !== 20)
      throw new Error('Only CHTABLE2/3 has the table base-option contract');
    if (bytes !== null && !(bytes instanceof Uint8Array))
      throw new TypeError('FES base option requires bytes or explicit null');
    this.baseOption = bytes === null ? new Uint8Array() : copyCString(bytes);
  }
  select(selectors) {
    if (this.type === 16 || this.type === 17) {
      selectorsRequired(selectors, 2, true);
      if (this.type === 16) return this.gallery.field(selectors[0], selectors[1])?.slice() ?? null;
      const row = this.rows[selectors[0] | 0],
        column = (selectors[1] + 2) | 0;
      const value = column >= 0 && row?.[column];
      return value?.length ? value.slice() : null;
    }
    if (this.type === 18) {
      selectorsRequired(selectors, 4, true);
      return this.gallery.reference(...selectors);
    }
    if (this.type === 19) return this.selectTree(selectors);
    return this.selectSections(selectors);
  }
  selectTree(selectors) {
    selectorsRequired(selectors, 2);
    let children = this.roots;
    for (let at = 0; at < 2; at++) {
      const node = children.find((entry) => entry.id === selectors[at] >>> 0);
      if (!node) return null;
      children = node.children;
    }
    if (!children.length) return null;
    let prefix = new Uint8Array();
    const mask = new Uint8Array(32);
    for (let at = 2; at < selectors.length; at++) {
      const bank = children.find((entry) => entry.id === at - 2);
      const variant = bank?.children.find((entry) => entry.id === selectors[at] >>> 0);
      if (!variant) continue;
      if (!prefix.length || (prefix.length === 1 && prefix[0] === 64)) prefix = variant.prefix;
      for (let index = 0; index < variant.mask.length; index++)
        if (variant.mask[index] !== 64) mask[index] = variant.mask[index];
        else if (!mask[index]) mask[index] = 48;
    }
    let length = mask.length;
    while (length && !mask[length - 1]) length--;
    const result = [...prefix, ...this.baseOption];
    for (let at = 0; at < length; at++) result.push(44, mask[at] || 48);
    return Uint8Array.from(result);
  }
  selectSections(selectors) {
    selectorsRequired(selectors, 0);
    let rows = this.sections.get(top);
    if (!rows) return null;
    let reference = new Uint8Array();
    for (const selector of selectors) {
      const row = rows?.[selector >>> 0];
      if (!row) break;
      reference = mergeFESSectionReferences(reference, row.reference);
      rows = this.sections.get(nativeDataKey(row.next));
    }
    const comma = reference.indexOf(44);
    if (comma > 0)
      reference = Uint8Array.from([
        ...reference.subarray(0, comma),
        ...this.baseOption,
        ...reference.subarray(comma),
      ]);
    // 6A59B0 is byte-blind, including a CP932 trail byte equal to ASCII '@'.
    return reference.map((byte) => (byte === 64 ? 48 : byte));
  }
  max(selectors) {
    selectorsRequired(selectors, 0);
    if (this.type === 16 || this.type === 17) {
      if (selectors.length) throw new TypeError('Background table max takes no typed selectors');
      return this.type === 16 ? this.gallery.count : this.rows.length;
    }
    if (this.type === 18) {
      const mode = selectors[0] | 0,
        character = selectors[1],
        pose = selectors[2];
      if (mode === 0 && selectors.length === 1) return this.gallery.count;
      if (mode === 1 && selectors.length === 2) return this.gallery.fileCount(character);
      if ((mode === 2 || mode === 3) && selectors.length === 3)
        return this.gallery.choices(character, pose, mode === 3);
      throw new TypeError('CHTABLE max requires mode0, mode1+character or mode2/3+character+pose');
    }
    if (this.type === 19) {
      let children = this.roots;
      for (const selector of selectors) {
        const node = children.find((entry) => entry.id === selector >>> 0);
        if (!node) return 0;
        children = node.children;
      }
      return children.length;
    }
    let rows = this.sections.get(top);
    for (const selector of selectors) {
      const row = rows?.[selector >>> 0];
      if (!row) return 0;
      rows = this.sections.get(nativeDataKey(row.next));
    }
    return rows?.length ?? 0;
  }
  snapshot() {
    return structuredClone({
      type: this.type,
      baseOption: this.baseOption,
      ...(this.gallery ? { gallery: this.gallery.snapshot() } : {}),
      ...(this.rows ? { rows: this.rows } : {}),
      ...(this.roots ? { roots: this.roots } : {}),
      ...(this.sections ? { sections: [...this.sections] } : {}),
    });
  }
  static restore(state) {
    if (!types.has(state.type))
      throw new Error(`FES image table type ${state.type} is not implemented`);
    const table = Object.create(FESImageTable.prototype),
      saved = structuredClone(state);
    Object.assign(table, saved);
    if (saved.gallery)
      table.gallery = new NativeGalleryTable(saved.gallery.kind, saved.gallery.bytes);
    if (saved.sections) table.sections = new Map(saved.sections);
    return table;
  }
}
