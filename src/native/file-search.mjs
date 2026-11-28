// SPDX-License-Identifier: MPL-2.0
// Win32 directory searches over mounted loose files and persistent native data.
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
