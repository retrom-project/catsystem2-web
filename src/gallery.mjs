// SPDX-License-Identifier: MPL-2.0
// Independently reconstructed from the fixed engine's CGL and registration APIs.
import { Binary } from './binary.mjs';
import { encodeCP932 } from './kcs/strings.mjs';

const decoder = new TextDecoder('shift_jis');
const foldASCII = (s) =>
  Array.from(encodeCP932(s), (b) => (b >= 65 && b <= 90 ? b + 32 : b)).join(',');

function cstring(binary, at, width) {
  const bytes = binary.range(at, width),
    end = bytes.indexOf(0);
  if (end < 0) throw new Error('CGL string is not terminated within its field');
  return decoder.decode(bytes.subarray(0, end));
}

export function readCGList(bytes) {
  let b = new Binary(bytes, 'CGL');
  const variantWidth =
    b.bytes.length > 4 &&
    b.u32(0) === 0x004c4743 /* exe-address-check: non-address - CGL file signature */
      ? 256
      : 64;
  if (variantWidth === 256) b = new Binary(b.bytes.subarray(4), 'CGL');
  const sections = [],
    groups = [],
    visited = new Set();
  let sectionAt = 0,
    flatIndex = 0;
  for (;;) {
    b.range(sectionAt, 12);
    if (visited.has(sectionAt)) throw new Error('CGL section link cycle');
    visited.add(sectionAt);
    const next = b.u32(sectionAt),
      id = b.i32(sectionAt + 4),
      count = b.u32(sectionAt + 8);
    if (count > b.bytes.length / 72) throw new Error('CGL group count exceeds file size');
    const section = { id, groups: [] };
    let at = sectionAt + 12;
    const groupOffsets = new Set();
    for (let n = 0; n < count; n++) {
      if (groupOffsets.has(at)) throw new Error('CGL group link cycle');
      groupOffsets.add(at);
      b.range(at, 72);
      const variants = b.u32(at + 68),
        length = 72 + variants * variantWidth;
      b.range(at, length);
      const group = {
        index: flatIndex,
        ordinal: groups.length,
        section: id,
        name: cstring(b, at + 4, 64),
        variants: Array.from({ length: variants }, (_, i) =>
          cstring(b, at + 72 + i * variantWidth, variantWidth),
        ),
      };
      section.groups.push(group);
      groups.push(group);
      // The native flat counter advances on a nonzero next-group link, even at
      // the end of a section. A zero link can therefore alias the next section's
      // first index. Keep this distinct from the physical inventory ordinal.
      if (b.u32(at)) flatIndex++;
      if (n + 1 < count) {
        const step = b.u32(at);
        if (step < length) throw new Error('CGL group link overlaps its records');
        at += step;
      }
    }
    sections.push(section);
    if (!next) break;
    if (next < 12) throw new Error('CGL section link overlaps its header');
    sectionAt += next;
  }
  return { variantWidth, sections, groups };
}

// Native comma tokenization skips empty tokens; selector words contain signed
// first-byte character codes, not parsed decimal numbers.
export function parseCGReference(source, listVariant = false) {
  const tokens = String(source).split(',').filter(Boolean);
  if (!tokens.length) return null;
  let file = tokens.shift();
  if (listVariant && tokens.length) file += `_${tokens.shift()}`;
  return { file, selectors: tokens.map((token) => (encodeCP932(token)[0] << 24) >> 24) };
}

function matches(node, selectors, at = 0) {
  if (node === null) return selectors.slice(at).every((n) => n === 0);
  if (at === selectors.length) return node.has(-1);
  return node.has(selectors[at]) && matches(node.get(selectors[at]), selectors, at + 1);
}
function insert(node, selectors, at = 0) {
  node ??= new Map();
  const key = at === selectors.length ? -1 : selectors[at];
  node.set(key, key === -1 ? null : insert(node.get(key) ?? null, selectors, at + 1));
  return node;
}

export class CGRegistry {
  constructor(bytes) {
    this.files = new Map();
    if (bytes) this.read(bytes);
  }
  register(file, selectors = []) {
    if (typeof file !== 'string' || !Array.isArray(selectors) || !selectors.every(Number.isInteger))
      throw new TypeError('Invalid CG registration');
    const seen = this.has(file, selectors);
    this.files.set(file, insert(this.files.get(file) ?? null, selectors));
    return !seen;
  }
  has(file, selectors = []) {
    return this.files.has(file) && matches(this.files.get(file), selectors);
  }
  registerReference(source, listVariant = false) {
    const ref = parseCGReference(source, listVariant);
    return ref ? this.register(ref.file, ref.selectors) : false;
  }
  hasReference(source, listVariant = false) {
    const ref = parseCGReference(source, listVariant);
    return !!ref && this.has(ref.file, ref.selectors);
  }
  read(bytes) {
    const b = new Binary(bytes, 'CG registration'),
      files = new Map();
    let at = 0,
      records = 0;
    const tree = (count, depth = 0) => {
      if (depth > 256 || count > (b.bytes.length - at) / 8)
        throw new Error('Invalid CG selector tree');
      if (!count) return null;
      const node = new Map();
      for (let n = 0; n < count; n++) {
        const children = b.u32(at),
          key = b.i32(at + 4);
        at += 8;
        if (node.has(key)) throw new Error('Duplicate CG selector');
        node.set(key, tree(children, depth + 1));
      }
      return node;
    };
    while (at < bytes.length) {
      b.range(at, 68);
      const count = b.u32(at),
        file = cstring(b, at + 4, 64);
      at += 68;
      if (files.has(file) || ++records > bytes.length / 68)
        throw new Error('Duplicate CG registration');
      files.set(file, tree(count));
    }
    this.files = files;
  }
  write() {
    const pieces = [];
    const word = (a, b) => {
      const bytes = new Uint8Array(8),
        v = new DataView(bytes.buffer);
      v.setUint32(0, a, true);
      v.setInt32(4, b, true);
      return bytes;
    };
    const tree = (node) => {
      if (!node) return;
      for (const [key, child] of [...node].sort((a, b) => a[0] - b[0])) {
        pieces.push(word(child?.size ?? 0, key));
        tree(child);
      }
    };
    // MSVC std::string ordering compares unsigned bytes in the original code page.
    const files = [...this.files].map(([file, node]) => ({ file, node, bytes: encodeCP932(file) }));
    files.sort((a, b) => {
      for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++)
        if (a.bytes[i] !== b.bytes[i]) return a.bytes[i] - b.bytes[i];
      return a.bytes.length - b.bytes.length;
    });
    for (const { node, bytes } of files) {
      if (bytes.length >= 64)
        throw new Error('CG registration filename exceeds native 64-byte field');
      const header = new Uint8Array(68);
      new DataView(header.buffer).setUint32(0, node?.size ?? 0, true);
      header.set(bytes, 4);
      pieces.push(header);
      tree(node);
    }
    const result = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const piece of pieces) {
      result.set(piece, at);
      at += piece.length;
    }
    return result;
  }
}

export class CGGallery {
  constructor(list = null, registry = new CGRegistry()) {
    this.list = list;
    this.registry = registry;
  }
  group(block, section = 0) {
    return typeof block === 'number'
      ? this.list?.groups.find((g) => g.index === block)
      : this.list?.groups.find(
          (g) => g.section === section && foldASCII(g.name) === foldASCII(block),
        );
  }
  index(name) {
    // The original cgregtbl helper accepts a section argument but does not use it.
    if (!this.list) return 0;
    return this.list.groups.find((g) => foldASCII(g.name) === foldASCII(name))?.index ?? -1;
  }
  variants(block, section = 0, seenOnly = false) {
    const variants = this.group(block, section)?.variants ?? [];
    return seenOnly ? variants.filter((s) => this.registry.hasReference(s, true)) : variants;
  }
  seen(block, section = 0) {
    return this.variants(block, section, true).length > 0;
  }
  registerGroup(name, section = 0) {
    const group = this.group(name, section);
    if (!group) return false;
    for (const source of group.variants) this.registry.registerReference(source, true);
    return true;
  }
  get(block, variant, section = 0, seenOnly = true) {
    return this.variants(block, section, seenOnly)[variant] ?? '';
  }
  snapshot() {
    return {
      list: structuredClone(this.list),
      registry: this.registry.write(),
      storage: structuredClone(this.storage),
      // Retained resource input for the explicit original gallery consumer.
      listBytes: this.listBytes?.slice(),
    };
  }
  static restore(state) {
    const gallery = new CGGallery(structuredClone(state.list), new CGRegistry(state.registry));
    gallery.storage = structuredClone(state.storage);
    gallery.listBytes = state.listBytes?.slice();
    return gallery;
  }
}

// cgreg_init destroys the previous per-instance registry and reads the current
// global-file entry again (77B0F1..77B11C), even for the same file/list.
export class GalleryLibrary {
  constructor({ read, readEntry, writeEntry, diagnostic }) {
    Object.assign(this, { read, readEntry, writeEntry, diagnostic });
  }
  async open(file, entry, listFile) {
    const registry = new CGRegistry(await this.readEntry(file, entry));
    const bytes = await this.read(listFile);
    if (!bytes?.length) this.diagnostic?.({ resource: listFile, error: 'CG list was not found' });
    const gallery = new CGGallery(bytes?.length ? readCGList(bytes) : null, registry);
    gallery.listBytes = bytes;
    gallery.storage = { file, entry };
    return gallery;
  }
  async persist(gallery) {
    await this.writeEntry(gallery.storage.file, gallery.storage.entry, gallery.registry.write());
  }
}
