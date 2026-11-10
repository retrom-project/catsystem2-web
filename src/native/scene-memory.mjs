// SPDX-License-Identifier: MPL-2.0
// Registered, read-only Script175 projections. NativeSceneData is authoritative.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { compareNativeBytes } from './dictionary.mjs';
const utf8 = new TextEncoder();
const compareNames = (a, b) => compareNativeBytes(encodeCP932(a), encodeCP932(b));
const same = (a, b) => a?.length === b?.length && a.every((value, i) => value === b[i]);

export class NativeSceneMemory {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.layout = nativeABI(engine.profile).layouts.sceneMemory;
    this.readerViews = new Map();
    engine.registerFeature('scene-memory', this);
  }
  get refs() {
    return (this.engine.refs.scenes ??= new Map());
  }
  data(handle) {
    const record = this.world.runtime.handles.records.get(handle);
    return record?.type === 'scene-data' ? record.value : null;
  }
  allocate(size, allocations) {
    const pointer = this.process.allocate(size, true);
    allocations.push(pointer);
    return pointer;
  }
  free(allocations) {
    for (const pointer of allocations) this.process.free(pointer);
    allocations.length = 0;
  }
  string(pointer, bytes, allocations) {
    const p = this.process,
      out = bytes.length < 16 ? pointer : this.allocate(bytes.length + 1, allocations);
    p.write(out, Uint8Array.from([...bytes, 0]));
    if (out !== pointer) p.store(pointer, out);
    p.store(pointer + 16, bytes.length);
    p.store(pointer + 20, Math.max(15, bytes.length));
  }
  tree(rows, nodeSize, allocations, write) {
    const p = this.process,
      head = this.allocate(nodeSize, allocations);
    p.write(head + 12, Uint8Array.of(1, 1));
    const nodes = rows.map((row) => {
      const node = this.allocate(nodeSize, allocations);
      p.write(node + 12, Uint8Array.of(1, 0));
      write(node + 16, row);
      return node;
    });
    const build = (begin, end, parent) => {
      if (begin === end) return head;
      const middle = (begin + end) >>> 1,
        node = nodes[middle];
      p.store(node, build(begin, middle, node));
      p.store(node + 4, parent);
      p.store(node + 8, build(middle + 1, end, node));
      return node;
    };
    p.store(head, nodes[0] ?? head);
    p.store(head + 4, build(0, nodes.length, head));
    p.store(head + 8, nodes.at(-1) ?? head);
    return head;
  }
  list(records, nodeSize, allocations, write) {
    const p = this.process,
      object = this.allocate(8, allocations),
      head = this.allocate(nodeSize, allocations),
      nodes = records.map((record) => {
        const node = this.allocate(nodeSize, allocations);
        write(node + 8, record);
        return node;
      }),
      chain = [head, ...nodes];
    chain.forEach((node, i) => {
      p.store(node, chain[(i + 1) % chain.length]);
      p.store(node + 4, chain[(i + chain.length - 1) % chain.length]);
    });
    p.store(object, head);
    p.store(object + 4, records.length);
    return object;
  }
  historyList(records, allocations) {
    const p = this.process;
    return this.list(records, 56, allocations, (at, record) => {
      const name = record.nameBytes ?? encodeCP932(record.scene);
      if (name.length > 32)
        throw new RangeError('Native history projection name exceeds its field');
      p.write(at, name);
      p.store(at + 32, record.value);
      if (record.strings) {
        const bank = this.allocate(8, allocations),
          strings = this.list(record.strings, 80, allocations, (out, [key, bytes]) => {
            key.split(':').forEach((word, i) => p.store(out + i * 4, Number(word)));
            p.write(out + 8, bytes);
          });
        p.store(bank + 4, strings);
        p.store(at + 36, bank);
      }
      if (record.extra?.length) {
        const data = this.allocate(record.extra.length + 4, allocations);
        p.store(data, 1);
        p.write(data + 4, record.extra);
        p.store(at + 40, record.extra.length);
        p.store(at + 44, data + 4);
      }
    });
  }
  translations(reader, at, allocations) {
    const p = this.process,
      layout = this.layout.translations;
    if (!layout) return;
    const languages = [...reader.languages].sort(compareNames),
      prefixes = this.tree(languages, 40, allocations, (out, language) =>
        this.string(out, encodeCP932(language), allocations),
      ),
      rows = Object.entries(reader.translations ?? {}).sort(([a], [b]) => compareNames(a, b)),
      translated = new Map(),
      owner = this.allocate(12, allocations),
      source = this.tree(rows, 76, allocations, (out, [language, records]) => {
        this.string(out, encodeCP932(language), allocations);
        const value = out + 24,
          items = this.allocate(records.length * 48, allocations);
        this.string(value, encodeCP932(language), allocations);
        records.forEach((row, i) => {
          this.string(items + i * 48, utf8.encode(row.speaker), allocations);
          this.string(items + i * 48 + 24, utf8.encode(row.text), allocations);
        });
        [items, items + records.length * 48, items + records.length * 48].forEach((word, i) =>
          p.store(value + 24 + i * 4, word),
        );
        translated.set(language, value);
      }),
      lookup = this.tree(rows, 44, allocations, (out, [language]) => {
        this.string(out, encodeCP932(language), allocations);
        p.store(out + 24, translated.get(language));
      });
    p.store(owner, source);
    p.store(owner + 4, rows.length);
    p.write(owner + 8, Uint8Array.of(Number(Boolean(reader.translations))));
    p.store(at + layout.owner, owner);
    p.store(at + layout.prefixes, prefixes);
    p.store(at + layout.prefixes + 4, languages.length);
    p.store(at + layout.lookup, lookup);
    p.store(at + layout.lookup + 4, rows.length);
  }
  reader(reader, entry) {
    const p = this.process,
      at = entry.reader,
      allocations = entry.readerAllocations;
    this.free(allocations);
    p.zero(at, this.layout.readerBytes);
    if (reader.body) {
      const raw = this.allocate(reader.body.bytes.length + 4, allocations),
        body = raw + 4;
      p.store(raw, 1);
      p.write(body, reader.body.bytes);
      [
        reader.blockCount,
        0,
        body,
        body + reader.blocksOffset,
        body + reader.offsetsOffset,
        body + reader.stringsOffset,
        reader.stringsSize,
      ].forEach((word, i) => p.store(at + 4 + i * 4, word));
    }
    this.translations(reader, at, allocations);
  }
  async create(handle) {
    const entry = {
      reader: this.process.allocate(this.layout.readerBytes, true),
      history: this.process.allocate(8, true),
      readerAllocations: [],
      historyAllocations: [],
    };
    this.refs.set(handle, entry);
    return entry;
  }
  async release(handle) {
    const entry = this.refs.get(handle);
    if (!entry) return;
    this.refs.delete(handle);
    this.readerViews.delete(handle);
    this.free(entry.readerAllocations);
    this.free(entry.historyAllocations);
    this.process.free(entry.reader);
    this.process.free(entry.history);
  }
  async pushEntry(handle, entry, force = false) {
    const scene = this.data(handle),
      p = this.process,
      reader = scene.reader,
      cached = this.readerViews.get(handle),
      seen = scene.history.encode('seen', true),
      path = scene.history.encode('path', true);
    if (
      force ||
      !cached ||
      cached.body !== reader.body ||
      cached.translations !== reader.translations
    )
      this.reader(reader, entry);
    p.store(entry.reader, reader.fileValue);
    p.store(entry.reader + 32, reader.block);
    p.store(entry.reader + 36, reader.line);
    const filename = encodeCP932(reader.filename + '\0');
    if (filename.length > 260) throw new RangeError('Native scene filename exceeds 260 bytes');
    p.write(entry.reader + 40, filename);
    if (force || !same(seen, cached?.seen) || !same(path, cached?.path)) {
      this.free(entry.historyAllocations);
      p.store(entry.history, this.historyList(scene.history.seen, entry.historyAllocations));
      p.store(entry.history + 4, this.historyList(scene.history.path, entry.historyAllocations));
    }
    this.readerViews.set(handle, {
      body: reader.body,
      translations: reader.translations,
      seen,
      path,
    });
  }
  async pointers(handle) {
    if (!handle) return [0, 0];
    if (!this.data(handle)) throw new Error('Native Script scene data has been released');
    const entry = this.refs.get(handle) ?? (await this.create(handle));
    await this.pushEntry(handle, entry, true);
    return [entry.reader, entry.history];
  }
  async beforeCall() {
    for (const [handle, entry] of [...this.refs]) {
      if (!this.data(handle)) await this.release(handle);
      else await this.pushEntry(handle, entry);
    }
  }
  snapshot() {
    return {};
  }
  restore() {
    this.readerViews.clear();
  }
  async close() {
    for (const handle of [...this.refs.keys()]) await this.release(handle);
  }
}
