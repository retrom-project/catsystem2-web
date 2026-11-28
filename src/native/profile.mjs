// SPDX-License-Identifier: MPL-2.0
import { NATIVE_ABIS, nativeABI } from './abi/index.mjs';
import { Binary } from '../binary.mjs';
import { binaryIdentity } from '../identity.mjs';

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

// Only exact, independently reviewed executable bytes enable these tables.
// Content metadata and caller options cannot extend this registry.
const reviewedBuilds = Object.freeze({
  '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f': 'sdk-4.01-engine-2.6.1.74',
  ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0: 'nekopara-vol3-engine-2.6.1.76',
  '9f3a5ad0ed22074420685f1e2a3bc92436d68289c7bac854d5f7d7331dc3ef67': 'grisaia-jp-engine-2.6.1.23',
  c8d4d7091347fc35b22b2dc0cb02793671cd726781d8462134ea602b191c729a: 'rebellions-jp-engine-2.6.1.63',
  d1889d60dbe3350b068605f94a49ae8e93eb388ce66e7abc36607eed2eda7010: 'bokutomo-engine-2.6.1.67',
});

export async function selectNativeProfile(game, explicit) {
  const requested = explicit ? nativeABI(explicit).profile : null,
    names = typeof game.names === 'function' ? game.names('exe') : [];
  // Explicit executable-free authoring is a separate low-level boundary.
  // Production automatic content loading always requires a reviewed PE.
  if (requested && !names.length) return { profile: requested, module: null, executable: null };
  const found = [],
    observed = [];
  for (const name of names) {
    const bytes = Uint8Array.from(await game.require(name)),
      sha256 = await binaryIdentity(bytes);
    let version;
    try {
      version = readEngineVersion(bytes);
    } catch (cause) {
      throw new Error(
        `Native executable ${name}: version unreadable, SHA-256 ${sha256}: ${cause.message}`,
        { cause },
      );
    }
    const profile = Object.hasOwn(reviewedBuilds, sha256) ? reviewedBuilds[sha256] : null,
      abi = profile && nativeABI(profile),
      knownVersion = Object.values(NATIVE_ABIS).some(
        (candidate) => candidate.engineVersion === version,
      );
    observed.push({
      name,
      version,
      sha256,
      reason: profile ? 'reviewed build' : 'unreviewed executable fingerprint',
    });
    if (knownVersion && !profile)
      throw new Error(
        `Native executable ${name}: version ${version}, SHA-256 ${sha256}: unreviewed executable fingerprint`,
      );
    if (!profile) continue;
    if (version !== abi.engineVersion || (requested && requested !== profile))
      throw new Error(
        `Native executable ${name}: version ${version}, SHA-256 ${sha256}: does not match requested profile ${requested ?? profile}`,
      );
    found.push({ profile, bytes, name });
  }
  if (found.length !== 1)
    throw new Error(
      `A unique reviewed CatSystem2 executable fingerprint is required. Found ${JSON.stringify(observed)}.`,
    );
  const { profile, name, bytes } = found[0];
  return {
    profile,
    module: nativeModuleMetadata(profile, { name, resource: readPEVersionResource(bytes) }),
    executable: { name, bytes },
  };
}

export async function selectNativeCheckpointProfile(game, state, explicit) {
  const profile = nativeABI(state.configuration?.profile).profile;
  if (explicit && nativeABI(explicit).profile !== profile)
    throw new Error('Checkpoint does not match the requested native profile');
  const selected = await selectNativeProfile(game, explicit);
  if (selected.profile !== profile)
    throw new Error('Checkpoint does not match the current native profile');
  const saved = nativeModuleMetadata(profile, state.nativeModule),
    current = selected.module;
  if (
    Boolean(saved) !== Boolean(current) ||
    (saved &&
      (saved.name !== current.name ||
        saved.resource.length !== current.resource.length ||
        saved.resource.some((byte, i) => byte !== current.resource[i])))
  )
    throw new Error('Checkpoint main module differs from the current reviewed executable');
  return selected;
}
