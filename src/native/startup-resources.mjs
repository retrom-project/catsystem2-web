// SPDX-License-Identifier: MPL-2.0
// Inspect data directories only. No native image is mapped or executed here.
import { Binary } from '../binary.mjs';
import { nativeABI } from './abi/index.mjs';
import { readEngineVersion } from './profile.mjs';

export class UnsupportedStartupResource extends Error {
  constructor({ profile, file, type, name }) {
    super(
      `${profile}: ${file} requires unimplemented startup resource verification ${type}/${name}`,
    );
    this.name = 'UnsupportedStartupResource';
    this.details = { profile, file, type, resourceName: name };
  }
}

// Bounded lookup of a named type/name, independent of executable code sections.
export function hasNativeStartupResource(bytes, type, name) {
  const b = new Binary(bytes, 'PE startup resource');
  if (!b.magic('MZ')) return false;
  const pe = b.u32(0x3c);
  if (!b.magic('PE\0\0', pe)) throw new Error('Invalid PE signature');
  const optional = pe + 24,
    magic = b.u16(optional),
    directory = optional + (magic === 0x10b ? 96 : magic === 0x20b ? 112 : 0);
  if (directory === optional) throw new Error('Unsupported PE optional header');
  const rva = b.u32(directory + 16),
    size = b.u32(directory + 20);
  if (!rva || !size) return false;
  const sections = Array.from({ length: b.u16(pe + 6) }, (_, i) => {
    const at = optional + b.u16(pe + 20) + i * 40;
    return { rva: b.u32(at + 12), size: b.u32(at + 16), offset: b.u32(at + 20) };
  });
  const map = (address, length) => {
    const section = sections.find((s) => address >= s.rva && address + length <= s.rva + s.size);
    if (!section) throw new Error('PE resource RVA exceeds file sections');
    const at = section.offset + address - section.rva;
    b.range(at, length);
    return at;
  };
  const base = map(rva, size),
    range = (at, length) => {
      if (at < 0 || at + length > size) throw new Error('Invalid PE startup resource offset');
      return base + at;
    },
    identifier = (value) => {
      if (!(value & 0x80000000)) return value;
      const at = range(value & 0x7fffffff, 2),
        length = b.u16(at);
      return new TextDecoder('utf-16le').decode(
        b.range(range(at - base + 2, length * 2), length * 2),
      );
    };
  let offset = 0;
  for (const key of [type, name]) {
    const at = range(offset, 16),
      count = b.u16(at + 12) + b.u16(at + 14);
    range(offset + 16, count * 8);
    let target = null;
    for (let i = 0; i < count; i++) {
      const entry = at + 16 + i * 8;
      if (identifier(b.u32(entry)) === key) {
        target = b.u32(entry + 4);
        break;
      }
    }
    if (target === null) return false;
    if (!(target & 0x80000000)) throw new Error('Invalid PE startup resource nesting');
    offset = target & 0x7fffffff;
  }
  const at = range(offset, 16),
    count = b.u16(at + 12) + b.u16(at + 14);
  range(offset + 16, count * 8);
  for (let i = 0; i < count; i++) {
    const target = b.u32(at + 20 + i * 8);
    if (target & 0x80000000) throw new Error('Invalid PE startup resource language entry');
    const data = range(target, 16);
    map(b.u32(data), b.u32(data + 4));
  }
  return count > 0;
}

export async function checkNativeStartupResources(game, profile) {
  const abi = nativeABI(profile);
  for (const file of game.names?.('exe') ?? []) {
    const bytes = await game.require(file);
    if (readEngineVersion(bytes) !== abi.engineVersion) continue;
    // Both fixed wrappers use FindResource(module, DATA, V_CODE). Absence
    // skips the comparison. Presence must never silently bypass verification.
    if (hasNativeStartupResource(bytes, 'V_CODE', 'DATA'))
      throw new UnsupportedStartupResource({ profile, file, type: 'V_CODE', name: 'DATA' });
    // KEY_CODE/KEY only selects the cipher key. V_CODE2/DATA feeds private
    // Settings+262; the prepared/decrypted JS VFS has no consumer of that slot.
    // Encrypted KIF remains rejected by KIFArchive, independently of this check.
  }
}
