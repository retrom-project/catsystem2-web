// SPDX-License-Identifier: MPL-2.0
// Search order follows game 5D57A0 / SDK 4B22C0. A mount's archive and loose
// directory are independent candidates, including each row of a list mount.
const normalize = (value) => value.replaceAll('\\', '/').toLowerCase();
export class NativeResourceSearch {
  constructor({ archives, loose, directories, lists, mounts, overrides = [] }) {
    Object.assign(this, { archives, loose, directories, lists, overrides });
    this.slots = new Array(256).fill(null);
    this.groups = new Map();
    for (const { archive, directory = '' } of mounts) this.register(archive, directory);
  }
  register(name, directory, depth = 0) {
    name = normalize(name);
    directory = normalize(directory);
    if (depth > 256) throw new Error('Native resource list nesting exceeds its mount capacity');
    // 5D4910 replaces a previously loaded archive slot. Missing archives and
    // list placeholders occupy their slots until the server is destroyed.
    for (let i = 0; i < this.slots.length; i++)
      if (this.slots[i]?.archive && this.slots[i].name === name) this.slots[i] = null;
    const index = this.slots.indexOf(null);
    if (index === -1) return -1;
    this.slots[index] = {
      name,
      directory,
      directoryExists: !directory || this.directories.has(directory),
      archive: this.archives.get(name) ?? null,
    };
    if (/\.lst$/i.test(name)) {
      const rows = [];
      for (const row of this.lists.get(name) ?? []) {
        const slot = this.register(row.archive, row.directory, depth + 1);
        rows.push({
          ...row,
          slot,
          directoryExists: this.directories.has(normalize(row.directory)),
        });
      }
      this.groups.set(name, [...(this.groups.get(name) ?? []), ...rows]);
    }
    return index;
  }
  looseCandidate(path) {
    path = normalize(path);
    return { kind: 'loose', path, hit: this.loose.get(path) ?? null };
  }
  archiveCandidate(archive, name) {
    const path = normalize(name);
    return { kind: 'archive', archive: archive.name, path, hit: archive.entries.get(path) ?? null };
  }
  candidates(source, mode = 3) {
    if (typeof source !== 'string' || source.includes('\0'))
      throw new Error('Invalid native resource name');
    // The native resource namespace uses the first literal forward slash.
    // Backslashes remain part of a physical Windows path or archive entry.
    const slash = source.indexOf('/'),
      namespace = normalize(slash < 0 ? '' : source.slice(0, slash)),
      filename = slash < 0 ? source : source.slice(slash + 1),
      output = [];
    for (const archive of this.overrides)
      if (archive.entries.has(normalize(filename)))
        return [this.archiveCandidate(archive, filename)];
    if (mode === 1) return [this.looseCandidate(source)];
    if (![2, 3, 4].includes(mode)) return output;
    const loose = (directory) =>
        this.looseCandidate(directory ? `${directory}/${filename}` : filename),
      append = (archive, directory, enabled) => {
        if (mode === 3 && enabled) output.push(loose(directory));
        if (archive) output.push(this.archiveCandidate(archive, filename));
        if (mode === 4 && enabled) output.push(loose(directory));
      };
    if (/\.lst$/i.test(namespace)) {
      for (const row of this.groups.get(namespace) ?? [])
        append(this.slots[row.slot]?.archive, row.directory, row.directoryExists);
    } else {
      for (const slot of this.slots) {
        if (namespace !== (slot?.name ?? '') && !(mode === 3 && !namespace)) continue;
        append(
          slot?.archive,
          slot?.directory ?? '',
          (mode === 3 && !namespace) || slot?.directoryExists,
        );
      }
    }
    return output;
  }
}

export function nativeUpdatePriority(name) {
  if (!/^update..\.int$/i.test(name)) return null;
  const suffix = name.slice(6, 8),
    first = suffix.charCodeAt(0) - 48,
    second = suffix.charCodeAt(1) - 48;
  return first < 0 || first > 9 ? 0 : second >= 0 && second <= 9 ? first * 10 + second : first;
}
