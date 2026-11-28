// SPDX-License-Identifier: MPL-2.0
import { findNativeXML } from './xml.mjs';

const lower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
export class NativeResources {
  constructor(startup, { soundCategory } = {}) {
    this.soundCategory = soundCategory;
    this.entries = Array.from({ length: 128 }, (_, i) => {
      const root = `INT/int${String(i).padStart(2, '0')}`;
      const read = (field) => findNativeXML(startup, `${root}/${field}`)?.text ?? '';
      return {
        id: i,
        name: read('name'),
        archive: read('int'),
        extension: read('ext'),
        directory: read('dir'),
      };
    });
  }
  resolve(name, category) {
    if (/[\\/]/.test(name) || category === undefined) return name;
    if (lower(category) === 'sound') {
      if (typeof this.soundCategory !== 'function')
        throw new Error('Native sound resource classification is unavailable');
      category = this.soundCategory(name);
      if (category === null) return null;
    }
    const entry = this.entries.find((entry) => lower(entry.name) === lower(category));
    if (!entry) return null;
    if (!name.includes('.')) name = `${name}.${entry.extension}`;
    return entry.archive ? `${entry.archive}/${name}` : name;
  }
  resolveLoose(name, category) {
    if (Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) > 0) return name;
    const entry = this.entries.find((entry) => lower(entry.name) === lower(category));
    if (!entry) return null;
    if (!name.includes('.')) name = `${name}.${entry.extension}`;
    return entry.directory ? `${entry.directory}\\${name}` : name;
  }
}
