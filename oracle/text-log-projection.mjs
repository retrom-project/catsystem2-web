// SPDX-License-Identifier: MPL-2.0
// Read-only D7 LOGSTRING input projection; JS owns the script log tables.
import { encodeDisplayLog } from '../src/native/text-log.mjs';
const layouts = {
  'nekopara-vol3-engine-2.6.1.76': { main: 0xa2dd38, load: 0x72f6d0 },
  'sdk-4.01-engine-2.6.1.74': { main: 0xb3c900, load: 0x5de4d0 },
};
export class NativeDisplayLogProjection {
  constructor(engine, world) {
    Object.assign(this, {
      engine,
      world,
      process: engine.process,
      layout: layouts[engine.profile],
    });
    engine.refs.logProjections ??= new Map();
    this.internal = 0;
    engine.registerFeature('display-log-projection', this);
  }
  get refs() {
    return this.engine.refs.logProjections;
  }
  call(address, args = [], pointer) {
    if (this.preparing && !this.process.asyncEnabled)
      return this.process.callAsync(address, args, pointer);
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  async wrapper(id, words) {
    const p = this.process,
      argv = p.allocate(Math.max(4, words.length * 4), true),
      out = p.allocate(4, true);
    try {
      words.forEach((v, i) => p.store(argv + i * 4, v));
      await this.call(p.load(this.layout.main + id * 4), [0, 0, argv, out]);
      return p.load(out);
    } finally {
      p.free(argv);
      p.free(out);
    }
  }
  async prepare(handle) {
    if (!handle) return 0;
    this.world.displayLogs.get(handle);
    this.internal++;
    try {
      if (!this.refs.has(handle)) this.refs.set(handle, { pointer: await this.wrapper(0x2b8, []) });
      await this.sync(handle);
      return this.refs.get(handle).pointer;
    } finally {
      this.internal--;
    }
  }
  async sync(handle) {
    const model = this.world.displayLogs.get(handle),
      r = this.refs.get(handle);
    if (r.revision === model.revision) return;
    const bytes = encodeDisplayLog(model),
      p = this.process,
      input = p.allocate(bytes.length, true);
    try {
      p.store(r.pointer + 132, model.limit);
      p.write(input, bytes);
      await this.call(this.layout.load, [input, bytes.length], r.pointer);
      const deque = p.load(r.pointer + 20),
        map = p.load(deque + 4),
        mask = p.load(deque + 8) - 1,
        start = p.load(deque + 12);
      for (let i = 0; i < model.rows.length; i++)
        if (model.rows[i].second.length) {
          const row = p.load(map + 4 * ((start + i) & mask)),
            slot = row + 28,
            bytes = model.rows[i].second;
          if (p.load(slot + 20) >= 16) p.free(p.load(slot));
          p.zero(slot, 24);
          const out = bytes.length < 16 ? slot : p.allocate(bytes.length + 1, true);
          p.write(out, Uint8Array.from([...bytes, 0]));
          if (out !== slot) p.store(slot, out);
          p.store(slot + 16, bytes.length);
          p.store(slot + 20, Math.max(15, bytes.length));
        }
      r.revision = model.revision;
    } finally {
      p.free(input);
    }
  }
  async beforeCall() {
    if (this.internal) return;
    this.internal++;
    this.preparing = true;
    try {
      for (const handle of this.refs.keys())
        if (this.world.runtime.handles.records.has(handle)) await this.sync(handle);
    } finally {
      this.preparing = false;
      this.internal--;
    }
  }
  async release(handle) {
    const r = this.refs.get(handle);
    if (!r) return;
    this.internal++;
    try {
      await this.wrapper(0x2b9, [r.pointer]);
      this.refs.delete(handle);
    } finally {
      this.internal--;
    }
  }
  async close() {
    for (const handle of [...this.refs.keys()]) await this.release(handle);
  }
  snapshot() {
    return {};
  }
  restore() {}
}
