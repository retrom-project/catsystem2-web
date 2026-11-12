// SPDX-License-Identifier: MPL-2.0
import { LogicalThreadCRT } from './crt-random.mjs';

const threadID = (id) => {
  if (typeof id !== 'string' || !id || id.includes('\0'))
    throw new TypeError('An explicit logical CRT thread ID is required');
  return id;
};

// A World owns all logical threads. Callers select their current thread for
// every sampling operation; managers do not own a private seed or a fixed thread.
export class LogicalCRTThreads {
  constructor() {
    this.threads = new Map();
    this.closed = false;
  }
  assertOpen() {
    if (this.closed) throw new Error('Logical CRT threads are closed');
  }
  create(id) {
    this.assertOpen();
    threadID(id);
    if (this.threads.has(id)) throw new Error(`Logical CRT thread already exists: ${id}`);
    const stream = new LogicalThreadCRT();
    this.threads.set(id, stream);
    return stream;
  }
  forThread(id) {
    this.assertOpen();
    threadID(id);
    const stream = this.threads.get(id);
    if (!stream) throw new Error(`Unregistered logical CRT thread: ${id}`);
    return stream;
  }
  remove(id) {
    this.forThread(id);
    this.threads.delete(id);
  }
  snapshot() {
    this.assertOpen();
    return {
      threads: [...this.threads]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, stream]) => ({ id, ...stream.snapshot() })),
    };
  }
  restore(saved) {
    this.assertOpen();
    if (this.threads.size) throw new Error('CRT thread restore requires a fresh owner');
    if (!saved || !Array.isArray(saved.threads) || saved.threads.length > 65536)
      throw new TypeError('Invalid CRT threads checkpoint');
    const next = new Map();
    for (const item of saved.threads) {
      threadID(item?.id);
      if (next.has(item.id)) throw new Error(`Duplicate CRT thread checkpoint: ${item.id}`);
      const stream = new LogicalThreadCRT();
      stream.restore(item);
      next.set(item.id, stream);
    }
    this.threads = next;
  }
  close() {
    this.threads.clear();
    this.closed = true;
  }
}
