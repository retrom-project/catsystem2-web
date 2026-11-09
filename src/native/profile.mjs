// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';

export function readPEVersionResource(bytes) {
  const b = new Binary(bytes, 'PE version');
  if (!b.magic('MZ')) return null;
  const pe = b.u32(0x3c);
  if (!b.magic('PE\0\0', pe)) throw new Error('Invalid PE signature');
  const sections = b.u16(pe + 6),
    optionalSize = b.u16(pe + 20),
    optional = pe + 24;
  const magic = b.u16(optional),
    directory = optional + (magic === 0x10b ? 96 : magic === 0x20b ? 112 : 0);
  if (directory === optional) throw new Error('Unsupported PE optional header');
  const resourceRVA = b.u32(directory + 16),
    resourceSize = b.u32(directory + 20);
  if (!resourceRVA || !resourceSize) return null;
  const headers = Array.from({ length: sections }, (_, i) => {
    const at = optional + optionalSize + i * 40;
    return { rva: b.u32(at + 12), size: b.u32(at + 16), offset: b.u32(at + 20) };
  });
  const map = (rva, length) => {
    const section = headers.find((s) => rva >= s.rva && rva + length <= s.rva + s.size);
    if (!section) throw new Error('PE resource RVA exceeds file sections');
    const at = section.offset + rva - section.rva;
    b.range(at, length);
    return at;
  };
  const base = map(resourceRVA, resourceSize);
  let at = base,
    dataAt = null;
  for (let depth = 0; depth < 3; depth++) {
    b.range(at, 16);
    const count = b.u16(at + 12) + b.u16(at + 14);
    if (count > resourceSize / 8 || at < base || at + 16 + count * 8 > base + resourceSize)
      throw new Error('PE resource directory exceeds resource section');
    let entry = null;
    for (let n = 0; n < count; n++) {
      const position = at + 16 + n * 8;
      if (depth > 0 || b.u32(position) === 16) {
        entry = b.u32(position + 4);
        break;
      }
    }
    if (entry === null) return null;
    const offset = entry & 0x7fffffff;
    if (offset + 16 > resourceSize) throw new Error('Invalid PE resource offset');
    if (!(entry & 0x80000000)) {
      dataAt = base + offset;
      break;
    }
    at = base + offset;
  }
  if (dataAt === null) throw new Error('PE version resource nesting exceeds native layout');
  const size = b.u32(dataAt + 4);
  return b.range(map(b.u32(dataAt), size), size);
}

export function readEngineVersion(bytes) {
  const resource = readPEVersionResource(bytes);
  if (!resource) return null;
  const value = new Binary(resource, 'VS_VERSION_INFO');
  const length = value.u16(0),
    valueLength = value.u16(2);
  value.range(0, length);
  let keyAt = 6,
    key = '';
  while (keyAt < length && value.u16(keyAt)) {
    key += String.fromCharCode(value.u16(keyAt));
    keyAt += 2;
  }
  const fixedAt = (keyAt + 2 + 3) & ~3;
  if (key !== 'VS_VERSION_INFO' || valueLength < 52 || value.u32(fixedAt) !== 0xfeef04bd)
    throw new Error('Invalid fixed PE version information');
  const ms = value.u32(fixedAt + 8),
    ls = value.u32(fixedAt + 12);
  return [ms >>> 16, ms & 65535, ls >>> 16, ls & 65535].join('.');
}

const profiles = new Map([
  ['2.6.1.74', 'sdk-4.01-engine-2.6.1.74'],
  ['2.6.1.76', 'nekopara-vol3-engine-2.6.1.76'],
]);
export async function selectNativeProfile(game, explicit) {
  if (explicit) {
    if (![...profiles.values()].includes(explicit))
      throw new Error(`Unimplemented engine ABI ${explicit}`);
    return explicit;
  }
  const found = new Map();
  for (const name of game.names('exe')) {
    const bytes = await game.require(name),
      version = readEngineVersion(bytes);
    if (profiles.has(version)) found.set(version, name);
  }
  if (found.size !== 1)
    throw new Error(
      'A unique supported CatSystem2 executable version or an explicit native profile is required',
    );
  return profiles.get([...found.keys()][0]);
}
