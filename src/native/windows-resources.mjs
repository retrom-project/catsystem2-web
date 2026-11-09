// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';

function resourceIndex(module) {
  const image = new Binary(module.pe.image, 'mapped PE resources'),
    optional = image.u32(0x3c) + 24,
    optionalSize = image.u16(optional - 4),
    directories = optional + 96,
    types = new Map(),
    infos = new Map(),
    payloads = new Set(),
    index = { types, infos, payloads };
  if (optionalSize < 120 || image.u16(optional) !== 0x10b || image.u32(optional + 92) < 3)
    return index;
  const root = image.u32(directories + 16),
    size = image.u32(directories + 20);
  if (!root || !size) return index;
  const data = new Binary(image.range(root, size), 'PE resource directory'),
    unicode = new TextDecoder('utf-16le', { ignoreBOM: true }),
    visited = new Set();
  let remaining = 65536;
  function directory(offset, depth) {
    if (visited.has(offset)) throw new Error('PE resource directory has a repeated subdirectory');
    visited.add(offset);
    const named = data.u16(offset + 12),
      ids = data.u16(offset + 14),
      count = named + ids,
      entries = new Map();
    data.range(offset + 16, count * 8);
    remaining -= count;
    if (remaining < 0) throw new Error('PE resource directory exceeds entry limit');
    for (let n = 0; n < count; n++) {
      const at = offset + 16 + n * 8,
        raw = data.u32(at),
        target = data.u32(at + 4),
        subdirectory = Boolean(target & 0x80000000),
        entry = target & 0x7fffffff;
      let name = raw;
      if (n < named && raw & 0x80000000 && depth < 2) {
        const start = raw & 0x7fffffff;
        name = unicode.decode(data.range(start + 2, data.u16(start) * 2));
      } else if (n < named || raw > 0xffff)
        throw new Error('PE resource entry has an invalid name or ID');
      if (entries.has(name) || subdirectory !== depth < 2)
        throw new Error('PE resource entry has an invalid directory level');
      if (subdirectory) entries.set(name, directory(entry, depth + 1));
      else {
        data.range(entry, 16);
        const rva = data.u32(entry),
          bytes = data.u32(entry + 4),
          info = module.base + root + entry,
          address = module.base + rva;
        if (rva === image.bytes.length) throw new Error('PE resource starts beyond its image');
        image.range(rva, bytes);
        entries.set(name, info);
        infos.set(info, { address, bytes });
        payloads.add(address);
      }
    }
    return entries;
  }
  index.types = directory(0, 0);
  return index;
}

export function installNativeResourceAPIs(kernel, uiLanguage = () => 0x411) {
  const p = kernel.process,
    indices = new WeakMap(),
    findModule = (handle) => p.modules.find((module) => module.base === (handle || 0x400000)),
    failure = (error) => {
      kernel.lastError = error;
      return 0;
    },
    register = (name, count, fn) => kernel.register('kernel32.dll', name, { count, fn });
  function index(module) {
    let value = indices.get(module);
    if (value === undefined) {
      try {
        value = resourceIndex(module);
      } catch {
        value = null;
      }
      indices.set(module, value);
    }
    return value;
  }
  function identifier(pointer, wide) {
    if (pointer < 0x10000) return pointer;
    const value = p.string(pointer, wide);
    if (value[0] !== '#') return value.toUpperCase();
    const decimal = value.slice(1);
    if (/^[0-9]+$/.test(decimal) && +decimal < 0x10000) return +decimal;
    throw new Error('Invalid decimal PE resource ID');
  }
  function find(handle, type, name, language, wide) {
    const module = findModule(handle);
    if (!module) return failure(126);
    const resources = index(module);
    if (!resources?.types.size) return failure(1812);
    let typeID, nameID;
    try {
      typeID = identifier(type, wide);
      nameID = identifier(name, wide);
    } catch {
      return failure(87);
    }
    const names = resources.types.get(typeID);
    if (!names) return failure(1813);
    const languages = names.get(nameID);
    if (!languages) return failure(1814);
    const preferred = [language, language & 0x3ff, 0];
    if (!(language & 0x3ff)) {
      const current = uiLanguage() & 0xffff;
      if (language !== 0x800) preferred.push(current, current & 0x3ff);
      preferred.push(0x411, 0x11, 0x409);
    }
    for (const candidate of preferred) {
      const info = languages.get(candidate);
      if (info !== undefined) return info;
    }
    if (!(language & 0x3ff) && languages.size) return languages.values().next().value;
    return failure(1815);
  }
  for (const suffix of ['A', 'W']) {
    const wide = suffix === 'W';
    register('FindResource' + suffix, 3, ([handle, name, type]) =>
      find(handle, type, name, 0, wide),
    );
    register('FindResourceEx' + suffix, 4, ([handle, type, name, language]) =>
      find(handle, type, name, language & 0xffff, wide),
    );
  }
  function info(handle, resource) {
    const module = findModule(handle);
    if (!module) return failure(126);
    return index(module)?.infos.get(resource) ?? failure(1812);
  }
  register('SizeofResource', 2, ([handle, resource]) =>
    resource ? (info(handle, resource)?.bytes ?? 0) : 0,
  );
  register('LoadResource', 2, ([handle, resource]) =>
    resource ? (info(handle, resource)?.address ?? 0) : 0,
  );
  register('LockResource', 1, ([address]) => {
    const module = p.modules.find(
      ({ base, pe }) => address >= base && address < base + pe.image.length,
    );
    return module && index(module)?.payloads.has(address) ? address : 0;
  });
  // Win32 maps the resource for the lifetime of its module.
  register('FreeResource', 1, () => 0);
}
