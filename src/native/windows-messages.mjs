// SPDX-License-Identifier: MPL-2.0
// The application and its virtual windows share one Win32 thread queue.
const WM_QUIT = 0x12;
const INVALID_WINDOW = 1400;
const INVALID_THREAD = 1444;
const INVALID_PARAMETER = 87;
const SYNC_ONLY = 1159;
const ABORTED = 995;
const MAX_POSTED = 10000;
const THREAD_ONLY = 0xffffffff;
const BROADCAST = 0xffff;
const QS_POSTMESSAGE = 0x0008;
const QS_ALLPOSTMESSAGE = 0x0100;
const QS_POSTED = QS_POSTMESSAGE | QS_ALLPOSTMESSAGE;
const WAIT_FAILED = 0xffffffff;
const WAIT_TIMEOUT = 0x102;
const isWord = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const validMessage = (entry) =>
  entry &&
  ['handle', 'message', 'wParam', 'lParam', 'time', 'x', 'y'].every((name) => isWord(entry[name]));

export class NativeWindowsMessages {
  constructor(kernel) {
    this.kernel = kernel;
    this.process = kernel.process;
    this.entries = [];
    this.last = null;
    this.waiters = new Set();
    this.changed = 0;
    this.inputWaits = 0;
    this.closing = false;
    const register = (name, count, fn) => kernel.register('USER32.dll', name, { count, fn });
    for (const suffix of ['A', 'W']) {
      register('PostMessage' + suffix, 4, (args) => this.post(...args));
      register('PostThreadMessage' + suffix, 4, ([thread, message, w, l]) =>
        thread === kernel.definitions.get('GetCurrentThreadId').fn()
          ? this.post(0, message, w, l)
          : this.error(INVALID_THREAD),
      );
      register('PeekMessage' + suffix, 5, (args) => this.peek(...args));
      register('GetMessage' + suffix, 4, (args) => this.get(...args));
      register('DispatchMessage' + suffix, 1, ([address]) => this.dispatch(address));
    }
    register('PostQuitMessage', 1, ([code]) => this.postQuit(code));
    register('GetMessageTime', 0, () => this.last?.time ?? 0);
    register('GetMessagePos', 0, () =>
      this.last ? ((this.last.x & 0xffff) | (this.last.y << 16)) >>> 0 : 0,
    );
    register('GetQueueStatus', 1, ([mask]) => this.status(mask));
    register('MsgWaitForMultipleObjects', 5, (args) => this.waitForInput(...args));
  }
  error(code, result = 0) {
    this.kernel.lastError = code;
    return result;
  }
  make(handle, message, wParam, lParam) {
    const [x, y] = this.readPosition?.() ?? [0, 0];
    return {
      handle: handle >>> 0,
      message: message >>> 0,
      wParam: wParam >>> 0,
      lParam: lParam >>> 0,
      time: this.kernel.timerDefinition.fn() >>> 0,
      x: x >>> 0,
      y: y >>> 0,
    };
  }
  post(handle, message, w = 0, l = 0) {
    const views = this.kernel.windowViews;
    if (message === 0xc || message === 0x4a) return this.error(SYNC_ONLY);
    if (handle && handle !== BROADCAST && !views.windows.has(handle))
      return this.error(INVALID_WINDOW);
    const targets =
      handle === BROADCAST
        ? [...views.windows].filter(([, window]) => !views.isChildWindow(window)).map(([id]) => id)
        : [handle];
    if (this.entries.length + targets.length > MAX_POSTED) return this.error(1816);
    for (const target of targets) this.entries.push(this.make(target, message, w, l));
    if (targets.length) this.onPost();
    return 1;
  }
  postQuit(code) {
    this.kernel.windowViews.quit = code | 0;
    this.onPost();
  }
  onPost() {
    this.changed |= QS_POSTED;
    this.wake();
    this.kernel.events.wake();
  }
  get pending() {
    return this.entries.length > 0 || this.kernel.windowViews.quit !== null;
  }
  dropWindow(handle) {
    this.entries = this.entries.filter((entry) => entry.handle !== handle);
    if (!this.pending) this.changed = 0;
    this.wake();
  }
  status(mask) {
    const changed = this.changed & mask,
      current = this.pending ? QS_POSTED & mask : 0;
    this.changed &= ~mask;
    return ((current << 16) | changed) >>> 0;
  }
  waitForInput(count, at, all, timeout, mask) {
    if (count > 63 || (count && !at)) return this.error(INVALID_PARAMETER, WAIT_FAILED);
    const handles = Array.from({ length: count }, (_, index) => this.process.load(at + 4 * index)),
      events = this.kernel.events;
    if (new Set(handles).size !== count) return this.error(INVALID_PARAMETER, WAIT_FAILED);
    const poll = () => {
      if (this.closing) return this.error(ABORTED, WAIT_FAILED);
      const posted = Boolean(this.changed & mask);
      if (all) {
        const objects = events.poll(handles, true, posted);
        if (objects === WAIT_FAILED) return objects;
        return posted ? objects : null;
      }
      const object = events.poll(handles, false);
      return object ?? (posted ? count : null);
    };
    const immediate = poll();
    if (immediate !== null) return immediate;
    if (!timeout) return WAIT_TIMEOUT;
    if (!this.process.asyncEnabled)
      throw new Error('A native message and event wait requires callAsync');
    const waiting = events.waitUntil(poll, timeout);
    if (typeof waiting === 'number') return waiting;
    this.inputWaits++;
    return waiting.finally(() => this.inputWaits--);
  }
  validate(address, handle) {
    if (!address) return INVALID_PARAMETER;
    if (handle && handle !== THREAD_ONLY && !this.kernel.windowViews.windows.has(handle))
      return INVALID_WINDOW;
    return 0;
  }
  take(address, handle, min, max, remove) {
    const views = this.kernel.windowViews,
      first = min & 0xffff,
      last = max & 0xffff,
      index = this.entries.findIndex(
        (entry) =>
          (!handle ||
            (handle === THREAD_ONLY
              ? !entry.handle
              : entry.handle === handle || views.isChild(handle, entry.handle))) &&
          ((!first && !last) ||
            entry.message === WM_QUIT ||
            (entry.message >= first && entry.message <= last)),
      ),
      entry =
        index >= 0
          ? this.entries[index]
          : views.quit !== null
            ? this.make(0, WM_QUIT, views.quit, 0)
            : null;
    this.changed &= ~(first || last ? QS_POSTMESSAGE : QS_POSTED);
    if (!entry) return null;
    const bytes = new Uint8Array(28),
      view = new DataView(bytes.buffer);
    [entry.handle, entry.message, entry.wParam, entry.lParam, entry.time, entry.x, entry.y].forEach(
      (word, index) => view.setUint32(index * 4, word, true),
    );
    this.process.write(address, bytes);
    if (remove) {
      if (index >= 0) this.entries.splice(index, 1);
      else views.quit = null;
      if (!this.pending) this.changed = 0;
    }
    this.last = entry;
    return entry;
  }
  peek(address, handle, min, max, flags) {
    const error = this.validate(address, handle);
    if (error) return this.error(error);
    if (flags & ~3) throw new Error(`Unreviewed native PeekMessage flags 0x${flags.toString(16)}`);
    return Number(Boolean(this.take(address, handle, min, max, flags & 1)));
  }
  get(address, handle, min, max) {
    const error = this.validate(address, handle);
    if (error) return this.error(error, 0xffffffff);
    if (this.closing) return this.error(ABORTED, 0xffffffff);
    const entry = this.take(address, handle, min, max, true);
    if (entry) return Number(entry.message !== WM_QUIT);
    if (!this.process.asyncEnabled) throw new Error('A native GetMessage wait requires callAsync');
    return new Promise((resolve, reject) =>
      this.waiters.add({ address, handle, min, max, resolve, reject }),
    );
  }
  wake() {
    for (const waiter of this.waiters) {
      const { address, handle, min, max, resolve, reject } = waiter;
      try {
        const error = this.validate(address, handle),
          entry = error ? null : this.take(address, handle, min, max, true);
        if (!error && !entry) continue;
        this.waiters.delete(waiter);
        resolve(error ? this.error(error, 0xffffffff) : Number(entry.message !== WM_QUIT));
      } catch (error) {
        this.waiters.delete(waiter);
        reject(error);
      }
    }
  }
  dispatch(address) {
    if (!address) return this.error(INVALID_PARAMETER);
    const p = this.process,
      handle = p.load(address),
      message = p.load(address + 4),
      w = p.load(address + 8),
      l = p.load(address + 12);
    if (!handle) return 0;
    const views = this.kernel.windowViews;
    if (!views.windows.has(handle)) return this.error(INVALID_WINDOW);
    if (message === 0x113 && l) throw new Error('Native WM_TIMER callback needs its timer owner');
    return views.send(handle, message, w, l);
  }
  cancelWaits() {
    const waiting = this.waiters.size > 0 || this.inputWaits > 0;
    this.closing = true;
    for (const { resolve } of this.waiters) resolve(this.error(ABORTED, 0xffffffff));
    this.waiters.clear();
    if (this.inputWaits) this.kernel.events.wake();
    return waiting;
  }
  snapshot() {
    if (this.waiters.size) throw new Error('Cannot checkpoint a pending native GetMessage wait');
    return structuredClone({ entries: this.entries, last: this.last, changed: this.changed });
  }
  restore({ entries, last, changed }) {
    if (
      this.waiters.size ||
      !Array.isArray(entries) ||
      entries.length > MAX_POSTED ||
      entries.some(
        (entry) =>
          !validMessage(entry) ||
          (entry.handle && !this.kernel.windowViews.windows.has(entry.handle)),
      ) ||
      (last !== null && !validMessage(last)) ||
      !isWord(changed) ||
      changed & ~QS_POSTED ||
      (changed && !entries.length && this.kernel.windowViews.quit === null)
    )
      throw new Error('Invalid native window message queue checkpoint');
    this.entries = structuredClone(entries);
    this.last = structuredClone(last);
    this.changed = changed;
  }
}
