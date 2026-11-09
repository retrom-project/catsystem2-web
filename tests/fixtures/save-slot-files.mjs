// SPDX-License-Identifier: MPL-2.0
// Authored virtual files shared by JS services and oracle fixtures.
const key = (name) => name.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
export class SaveSlotFiles {
  constructor() {
    this.files = new Map();
    this.time = Date.UTC(2024, 3, 12, 15, 24, 36);
    this.operations = [];
    this.failures = new Set();
  }
  async read(name) {
    return this.files.get(key(name))?.bytes.slice() ?? null;
  }
  async write(name, bytes) {
    this.operations.push(['write', key(name)]);
    if (this.failures.has(`write:${key(name)}`)) return false;
    const previous = this.files.get(key(name));
    this.files.set(key(name), {
      bytes: bytes.slice(),
      createdMs: previous?.createdMs ?? this.time,
      accessedMs: previous?.accessedMs ?? this.time,
      modifiedMs: this.time,
      attributes: previous?.attributes ?? 0x80,
    });
    return true;
  }
  async stat(name) {
    const file = this.files.get(key(name));
    if (!file) return null;
    return {
      createdMs: file.createdMs,
      accessedMs: file.accessedMs,
      modifiedMs: file.modifiedMs,
      attributes: file.attributes,
    };
  }
  async setAttributes(name, attributes) {
    this.operations.push(['setAttributes', key(name), attributes]);
    const file = this.files.get(key(name));
    if (!file) return false;
    file.attributes = attributes >>> 0;
    return true;
  }
  async setTimes(name, times) {
    this.operations.push(['setTimes', key(name), { ...times }]);
    const file = this.files.get(key(name));
    if (!file) return false;
    Object.assign(file, times);
    return true;
  }
  async remove(name) {
    this.operations.push(['remove', key(name)]);
    return !this.failures.has(`remove:${key(name)}`) && this.files.delete(key(name));
  }
  async copy(from, to, failIfExists = true) {
    from = key(from);
    to = key(to);
    this.operations.push(['copy', from, to, failIfExists]);
    const file = this.files.get(from);
    if (!file || (failIfExists && this.files.has(to)) || this.failures.has(`copy:${to}`))
      return false;
    this.files.set(to, {
      ...file,
      bytes: file.bytes.slice(),
      createdMs: this.time,
      accessedMs: this.time,
    });
    return true;
  }
  async move(from, to) {
    from = key(from);
    to = key(to);
    this.operations.push(['move', from, to]);
    if (!this.files.has(from) || this.files.has(to) || this.failures.has(`move:${to}`))
      return false;
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
    return true;
  }
  async diskSpace() {
    return { availableBytes: 1024 ** 3, totalBytes: 2 * 1024 ** 3, freeBytes: 1024 ** 3 };
  }
  snapshot() {
    return [...this.files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, file]) => [
        name,
        {
          ...file,
          bytes: file.bytes.slice(),
        },
      ]);
  }
  options() {
    return {
      readFile: this.read.bind(this),
      writeFile: this.write.bind(this),
      statFile: this.stat.bind(this),
      setFileTimes: this.setTimes.bind(this),
      setFileAttributes: this.setAttributes.bind(this),
      removeFile: this.remove.bind(this),
      copyFile: this.copy.bind(this),
      moveFile: this.move.bind(this),
      diskSpace: this.diskSpace.bind(this),
      wallNow: () => this.time,
      localOffsetMinutes: () => 0,
    };
  }
}
