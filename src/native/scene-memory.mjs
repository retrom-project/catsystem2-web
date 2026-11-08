// SPDX-License-Identifier: MPL-2.0
// Script175 exposes two distinct original objects. Their browser-facing state
// remains the existing NativeSceneData reader/history, rather than a second
// persistent scene model.
import { Binary } from '../binary.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    readerBytes: 324,
    readerCtor: 0x72b270,
    readerDtor: 0x72b3a0,
    readerLoad: 0x72b580,
    prefix: 0x72b890,
    historyCtor: 0x72d010,
    historyDtor: 0x72d030,
    historyImport: 0x72d680,
    historyExport: 0x72d480,
  },
  'sdk-4.01-engine-2.6.1.74': {
    readerBytes: 304,
    readerCtor: 0x5db920,
    readerDtor: 0x5db970,
    readerLoad: 0x5dba80,
    historyCtor: 0x5dbfa0,
    historyDtor: 0x5dbfc0,
    historyImport: 0x5dc610,
    historyExport: 0x5dc410,
  },
};
const same = (a, b) => a?.length === b?.length && a.every((v, i) => v === b[i]);
function sceneFile(reader) {
  if (!reader.body) return null;
  const body = reader.body.bytes,
    bytes = new Uint8Array(16 + body.length);
  bytes.set(new TextEncoder().encode('CatScene'));
  new DataView(bytes.buffer).setUint32(12, body.length, true);
  bytes.set(body, 16);
  return bytes;
}
function translationFile(reader) {
  if (!reader.translations) return null;
  const languages = Object.keys(reader.translations),
    out = [67, 83, 84, 76, 0, 0, 0, 0];
  const number = (n) => {
    while (n >= 255) {
      out.push(255);
      n -= 255;
    }
    out.push(n);
  };
  const string = (s) => {
    const b = new TextEncoder().encode(s);
    number(b.length);
    out.push(...b);
  };
  number(languages.length);
  for (const language of languages) string(language);
  const count = languages.length ? reader.translations[languages[0]].length : 0;
  number(count);
  for (let i = 0; i < count; i++)
    for (const language of languages) {
      const row = reader.translations[language][i];
      string(row.speaker);
      string(row.text);
    }
  return Uint8Array.from(out);
}

export class NativeSceneMemory {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.layout = layouts[engine.profile];
    if (!this.layout) throw new Error('Native scene-memory profile has no recovered layout');
    this.syncing = false;
    this.closing = false;
    this.readerViews = new Map();
    engine.kernel.registerFiles('scene-memory', {
      read: (path) => {
        const match = /^@native-scene\/(\d+)\.(cst|cstl)$/.exec(path.replaceAll('\\', '/'));
        if (!match) return undefined;
        const scene = this.data(Number(match[1]));
        if (!scene) return null;
        return match[2] === 'cst' ? sceneFile(scene.reader) : translationFile(scene.reader);
      },
    });
    engine.registerFeature('scene-memory', this);
  }
  get refs() {
    return (this.engine.refs.scenes ??= new Map());
  }
  data(handle) {
    const record = this.world.runtime.handles.records.get(handle);
    return record?.type === 'scene-data' ? record.value : null;
  }
  call(address, args = [], pointer) {
    if (this.process.asyncEnabled) return this.engine.callFromHost(address, args, pointer);
    return this.syncing
      ? this.process.callAsync(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  async create(handle) {
    const p = this.process,
      f = this.layout,
      entry = {
        reader: p.allocate(f.readerBytes, true),
        history: p.allocate(8, true),
        seen: null,
        path: null,
        bodyLength: 0,
      };
    let readerReady = false,
      historyReady = false;
    try {
      await this.call(f.readerCtor, [], entry.reader);
      readerReady = true;
      await this.call(f.historyCtor, [], entry.history);
      historyReady = true;
      if (f.prefix)
        for (const language of this.data(handle).reader.languages) {
          const bytes = Uint8Array.from([...encodeCP932(language), 0]),
            pointer = p.allocate(bytes.length, true);
          p.write(pointer, bytes);
          try {
            await this.call(f.prefix, [pointer], entry.reader);
          } finally {
            p.free(pointer);
          }
        }
      this.refs.set(handle, entry);
      return entry;
    } catch (error) {
      if (historyReady) await this.call(f.historyDtor, [], entry.history);
      if (readerReady) await this.call(f.readerDtor, [], entry.reader);
      p.free(entry.history);
      p.free(entry.reader);
      throw error;
    }
  }
  async release(handle) {
    const entry = this.refs.get(handle);
    if (!entry) return;
    this.refs.delete(handle);
    this.readerViews.delete(handle);
    await this.call(this.layout.readerDtor, [], entry.reader);
    await this.call(this.layout.historyDtor, [], entry.history);
    this.process.free(entry.reader);
    this.process.free(entry.history);
  }
  async pushEntry(handle, entry) {
    const scene = this.data(handle),
      p = this.process,
      f = this.layout,
      reader = scene.reader,
      cached = this.readerViews.get(handle);
    let reload =
      !cached || cached.body !== reader.body || cached.translations !== reader.translations;
    if (reload && !cached && entry.bodyLength) {
      const raw = p.load(entry.reader + 12);
      if (
        raw &&
        reader.body &&
        reader.body.bytes.length === entry.bodyLength &&
        same(p.read(raw, entry.bodyLength), reader.body.bytes)
      )
        reload = false;
    }
    if (reload && reader.body) {
      const name = encodeCP932(`@native-scene/${handle}.cst\0`),
        pointer = p.allocate(name.length, true);
      p.write(pointer, name);
      try {
        if (!(await this.call(f.readerLoad, [pointer], entry.reader)))
          throw new Error('Original scene reader rejected its canonical body');
      } finally {
        p.free(pointer);
      }
      entry.bodyLength = reader.body.bytes.length;
    } else if (reload && !reader.body && p.load(entry.reader + 12)) {
      await this.call(f.readerDtor, [], entry.reader);
      await this.call(f.readerCtor, [], entry.reader);
      entry.bodyLength = 0;
    }
    this.readerViews.set(handle, { body: reader.body, translations: reader.translations });
    p.store(entry.reader, reader.fileValue);
    p.store(entry.reader + 32, reader.block);
    p.store(entry.reader + 36, reader.line);
    const filename = encodeCP932(reader.filename + '\0');
    if (filename.length > 260) throw new RangeError('Native scene filename exceeds 260 bytes');
    p.write(entry.reader + 40, filename);
    const seen = scene.history.encode('seen', true),
      path = scene.history.encode('path', true);
    if (!same(seen, entry.seen) || !same(path, entry.path)) {
      await this.call(f.historyDtor, [], entry.history);
      await this.call(f.historyCtor, [], entry.history);
      const a = p.allocate(seen.length, true),
        b = p.allocate(path.length, true);
      p.write(a, seen);
      p.write(b, path);
      try {
        await this.call(f.historyImport, [a, seen.length, b, path.length], entry.history);
      } finally {
        p.free(a);
        p.free(b);
      }
      entry.seen = seen;
      entry.path = path;
    }
  }
  async pullEntry(handle, entry) {
    const scene = this.data(handle);
    if (!scene) return;
    const p = this.process,
      reader = scene.reader;
    reader.fileValue = p.load(entry.reader);
    reader.block = p.load(entry.reader + 32) | 0;
    reader.line = p.load(entry.reader + 36) | 0;
    reader.filename = p.string(entry.reader + 40);
    const raw = p.load(entry.reader + 12);
    if (raw) {
      const length = p.load(raw) + 16;
      if (
        !reader.body ||
        length !== reader.body.bytes.length ||
        !same(p.read(raw, length), reader.body.bytes)
      ) {
        reader.body = new Binary(p.read(raw, length).slice(), 'Native CatScene body');
        reader.blockCount = p.load(entry.reader + 4);
        reader.offsetsOffset = p.load(raw + 8) + 16;
        reader.stringsOffset = p.load(raw + 12) + 16;
        reader.stringsSize = p.load(entry.reader + 28);
      }
      entry.bodyLength = length;
    } else if (reader.body) {
      reader.body = null;
      entry.bodyLength = 0;
    }
    this.readerViews.set(handle, { body: reader.body, translations: reader.translations });
    const counts = p.allocate(8, true);
    let a = 0,
      b = 0;
    try {
      await this.call(this.layout.historyExport, [0, counts, 0, counts + 4, 1], entry.history);
      const aSize = p.load(counts),
        bSize = p.load(counts + 4);
      a = p.allocate(aSize, true);
      b = p.allocate(bSize, true);
      await this.call(this.layout.historyExport, [a, counts, b, counts + 4, 1], entry.history);
      const seen = p.read(a, aSize),
        path = p.read(b, bSize);
      if (!same(seen, entry.seen) || !same(path, entry.path)) {
        scene.history.decode('seen', seen, path);
        scene.history.decode('path', path);
        entry.seen = seen.slice();
        entry.path = path.slice();
      }
    } finally {
      if (a) p.free(a);
      if (b) p.free(b);
      p.free(counts);
    }
  }
  async pointers(handle) {
    if (!handle) return [0, 0];
    if (!this.data(handle)) throw new Error('Native Script scene data has been released');
    await this.world.getNativeFeature('engine-files');
    const previous = this.syncing;
    this.syncing = true;
    try {
      const entry = this.refs.get(handle) ?? (await this.create(handle));
      await this.pushEntry(handle, entry);
      return [entry.reader, entry.history];
    } finally {
      this.syncing = previous;
    }
  }
  async beforeCall() {
    if (this.syncing || this.closing) return;
    this.syncing = true;
    try {
      for (const [handle, entry] of [...this.refs]) {
        if (!this.data(handle)) await this.release(handle);
        else await this.pushEntry(handle, entry);
      }
    } finally {
      this.syncing = false;
    }
  }
  async afterCall() {
    if (this.syncing || this.closing) return;
    this.syncing = true;
    try {
      for (const [handle, entry] of this.refs) await this.pullEntry(handle, entry);
    } finally {
      this.syncing = false;
    }
  }
  snapshot() {
    return {};
  }
  restore() {
    this.readerViews.clear();
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    this.syncing = true;
    try {
      for (const handle of [...this.refs.keys()]) await this.release(handle);
    } finally {
      this.syncing = false;
    }
  }
}
