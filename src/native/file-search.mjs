// SPDX-License-Identifier: MPL-2.0
// Win32 directory searches over mounted loose files and persistent native data.
import { nativeFileTime } from './file-time.mjs';
import { nativeFilePattern } from './file-pattern.mjs';
import { isNativeUserPath } from './windows-folders.mjs';
export async function findNativeFileEntries(kernel, pattern) {
  const base = (name) => name.split('/').at(-1),
    info = async (name, directory = false) => {
      if (directory) return { name: base(name), attributes: 0x10, size: 0 };
      const bytes = await kernel.read(name);
      if (bytes === null) return null;
      return {
        name: base(name),
        attributes: 0x80,
        size: bytes.length,
        ...(await kernel.stat(name)),
      };
    };

  const path = kernel.path(pattern).replace(/\.+$/, ''),
    lower = path.toLowerCase();
  if (!/[?*]/.test(path)) {
    const listed = (await kernel.list()).find((entry) => {
      const name = kernel.path(entry.name),
        slash = name.lastIndexOf('/'),
        parent = slash < 0 ? '' : name.slice(0, slash).toLowerCase(),
        at = path.lastIndexOf('/');
      return (
        parent === (at < 0 ? '' : path.slice(0, at).toLowerCase()) &&
        nativeFilePattern(base(path), base(name), entry.shortName)
      );
    });
    const entry = listed
      ? { ...listed, name: base(listed.name) }
      : await info(path, kernel.directories.has(lower));
    return entry ? [entry] : [];
  }
  const slash = path.lastIndexOf('/'),
    directory = slash < 0 ? '' : path.slice(0, slash).toLowerCase(),
    user = isNativeUserPath(directory),
    mask = path.slice(slash + 1),
    entries = new Map(),
    all = await kernel.list();
  for (const value of all) {
    const name = kernel.path(value.name);
    if (isNativeUserPath(name) !== user) continue;
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!entries.has(folder.toLowerCase()))
        entries.set(folder.toLowerCase(), { name: folder, attributes: 0x10, size: 0 });
    }
    if (!entries.has(name.toLowerCase())) entries.set(name.toLowerCase(), { ...value, name });
  }
  for (const name of kernel.directories)
    if (name && isNativeUserPath(name) === user && !entries.has(name))
      entries.set(name, { name, attributes: 0x10, size: 0 });
  return [...entries.values()]
    .filter((e) => {
      const slash = e.name.lastIndexOf('/'),
        parent = slash < 0 ? '' : e.name.slice(0, slash).toLowerCase();
      return parent === directory && nativeFilePattern(mask, base(e.name), e.shortName);
    })
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'))
    .map((e) => ({ ...e, name: base(e.name) }));
}

export function installNativeFileSearch(kernel) {
  const p = kernel.process;
  kernel.finds = new Map();
  kernel.nextFind = 0x51000000;
  const fail = (error) => {
      kernel.lastError = error;
      return 0;
    },
    write = (out, entry, wide) => {
      p.zero(out, wide ? 592 : 320);
      p.store(out, entry.attributes ?? 0x80);
      for (const [field, offset] of [
        ['createdMs', 4],
        ['accessedMs', 12],
        ['modifiedMs', 20],
      ])
        kernel.write64(out + offset, nativeFileTime(entry[field]) ?? 0n);
      const size = BigInt(entry.size ?? 0);
      p.store(out + 28, Number(size >> 32n));
      p.store(out + 32, Number(size & 0xffffffffn));
      kernel.writeString(out + 44, entry.name, wide);
      if (entry.shortName) kernel.writeString(out + (wide ? 564 : 304), entry.shortName, wide);
    };
  for (const [suffix, wide] of [
    ['A', false],
    ['W', true],
  ]) {
    kernel.register('KERNEL32.dll', `FindFirstFile${suffix}`, {
      count: 2,
      fn: async ([name, out]) => {
        const entries = await findNativeFileEntries(kernel, p.string(name, wide));
        if (!entries.length) {
          fail(2);
          return 0xffffffff;
        }
        const handle = kernel.nextFind++;
        kernel.finds.set(handle, { entries, index: 0 });
        write(out, entries[0], wide);
        return handle;
      },
    });
    kernel.register('KERNEL32.dll', `FindNextFile${suffix}`, {
      count: 2,
      fn: ([handle, out]) => {
        const search = kernel.finds.get(handle);
        if (!search) return fail(6);
        if (search.index + 1 >= search.entries.length) return fail(18);
        write(out, search.entries[++search.index], wide);
        return 1;
      },
    });
  }
  kernel.register('KERNEL32.dll', 'FindClose', {
    count: 1,
    fn: ([handle]) => (kernel.finds.delete(handle) ? 1 : fail(6)),
  });
}
