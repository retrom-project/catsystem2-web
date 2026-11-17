// SPDX-License-Identifier: MPL-2.0
export const WM_TIMER = 0x113;
export const QS_TIMER = 0x10;
const MIN_INTERVAL = 10;
const MAX_INTERVAL = 0x7fffffff;
const FIRST_THREAD_TIMER = 0x7fff;
const keyOf = (handle, id) => `${handle}:${id}`;
const isWord = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export class NativeWindowsTimers {
  constructor(queue) {
    this.queue = queue;
    this.kernel = queue.kernel;
    this.records = new Map();
    this.next = FIRST_THREAD_TIMER;
    this.kernel.register('USER32.dll', 'SetTimer', {
      count: 4,
      fn: (args) => this.set(...args),
    });
    this.kernel.register('USER32.dll', 'KillTimer', {
      count: 2,
      fn: (args) => this.kill(...args),
    });
  }
  now() {
    return Math.floor(this.kernel.now());
  }
  set(handle, id, interval, callback) {
    if (handle && !this.kernel.windowViews.windows.has(handle)) return this.queue.error(1400);
    if (!handle && !this.records.has(keyOf(0, id))) {
      do {
        id = this.next;
        this.next = this.next === 0xffffffff ? FIRST_THREAD_TIMER : this.next + 1;
      } while (this.records.has(keyOf(0, id)));
    }
    const period = Math.min(Math.max(interval, MIN_INTERVAL), MAX_INTERVAL);
    this.records.set(keyOf(handle, id), {
      handle,
      id,
      period,
      callback,
      due: this.now() + period,
      ready: false,
    });
    this.queue.timersChanged();
    return id || 1;
  }
  kill(handle, id) {
    if (handle && !this.kernel.windowViews.windows.has(handle)) return this.queue.error(1400);
    if (!this.records.delete(keyOf(handle, id))) return this.queue.error(87);
    this.queue.timersChanged();
    return 1;
  }
  dropWindow(handle) {
    for (const [key, timer] of this.records) if (timer.handle === handle) this.records.delete(key);
  }
  update() {
    if (!this.records.size) return false;
    const now = this.now();
    let changed = false;
    for (const timer of this.records.values()) {
      if (timer.ready || timer.due > now) continue;
      timer.ready = true;
      changed = true;
    }
    return changed;
  }
  get ready() {
    for (const timer of this.records.values()) if (timer.ready) return true;
    return false;
  }
  get delay() {
    let due = Infinity;
    for (const timer of this.records.values()) if (!timer.ready) due = Math.min(due, timer.due);
    return due === Infinity ? due : Math.max(0, due - this.now());
  }
  take(matches) {
    let next;
    for (const timer of this.records.values())
      if (timer.ready && matches(timer.handle) && (!next || timer.due < next.due)) next = timer;
    if (!next) return null;
    const elapsed = this.now() - next.due;
    next.due += (Math.floor(elapsed / next.period) + 1) * next.period;
    next.ready = false;
    return next;
  }
  snapshot() {
    return structuredClone({ next: this.next, records: this.records });
  }
  restore(state) {
    const { next, records } = state ?? {};
    if (
      !isWord(next) ||
      next < FIRST_THREAD_TIMER ||
      !(records instanceof Map) ||
      [...records].some(
        ([key, timer]) =>
          !timer ||
          !isWord(timer.handle) ||
          (timer.handle && !this.kernel.windowViews.windows.has(timer.handle)) ||
          !isWord(timer.id) ||
          (!timer.handle && timer.id < FIRST_THREAD_TIMER) ||
          key !== keyOf(timer.handle, timer.id) ||
          !isWord(timer.callback) ||
          !Number.isSafeInteger(timer.due) ||
          timer.due < 0 ||
          !Number.isInteger(timer.period) ||
          timer.period < MIN_INTERVAL ||
          timer.period > MAX_INTERVAL ||
          typeof timer.ready !== 'boolean',
      )
    )
      throw new Error('Invalid native window timer checkpoint');
    this.next = next;
    this.records = structuredClone(records);
  }
}
