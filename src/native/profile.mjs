// SPDX-License-Identifier: MPL-2.0
import { NATIVE_ABIS, nativeABI } from './abi/index.mjs';
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
  return readResourceEngineVersion(resource);
}

function readResourceEngineVersion(resource) {
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

// Only version-resource data crosses into an ordinary World, never executable
// mappings, a process or its heap. Each World owns its immutable metadata copy.
export function nativeModuleMetadata(profile, module) {
  if (module === null) return null;
  if (
    !module ||
    typeof module.name !== 'string' ||
    !module.name ||
    module.name.includes('\0') ||
    !(module.resource instanceof Uint8Array) ||
    readResourceEngineVersion(module.resource) !== nativeABI(profile).engineVersion
  )
    throw new Error('Invalid or unregistered main module metadata');
  return { name: module.name, resource: module.resource.slice() };
}

export async function selectNativeProfile(game, explicit) {
  if (explicit) {
    const profile = nativeABI(explicit).profile,
      names = typeof game.names === 'function' ? game.names('exe') : [];
    let module = null;
    // Explicit profiles still support owned games with no executable. Do not
    // guess among multiple modules or scan unrelated files to establish one.
    if (names.length === 1) {
      const bytes = await game.require(names[0]);
      try {
        if (readEngineVersion(bytes) === nativeABI(profile).engineVersion)
          module = nativeModuleMetadata(profile, {
            name: names[0],
            resource: readPEVersionResource(bytes),
          });
      } catch {
        // An unrelated/malformed module does not revoke the explicit profile.
        // 1BC will report that its actual main-module authority is unavailable.
      }
    }
    return { profile, module };
  }
  const found = [],
    observed = [];
  for (const name of game.names('exe')) {
    const bytes = await game.require(name),
      version = readEngineVersion(bytes);
    observed.push({ name, version });
    const abi = Object.values(NATIVE_ABIS).find((candidate) => candidate.engineVersion === version);
    if (abi) found.push({ name, abi, resource: readPEVersionResource(bytes) });
  }
  if (found.length !== 1)
    throw new Error(
      `A unique supported CatSystem2 executable version is required. Found ${JSON.stringify(observed)}. Provide an explicit registered ABI or reviewed per-version ABI data.`,
    );
  const selected = found[0];
  return {
    profile: selected.abi.profile,
    module: nativeModuleMetadata(selected.abi.profile, {
      name: selected.name,
      resource: selected.resource,
    }),
  };
}
