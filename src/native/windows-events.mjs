// SPDX-License-Identifier: MPL-2.0
// Process-local Win32 events used by the original DirectShow reader.
const BASE = 0x57000000;
const END = 0x58000000;
const INFINITE = 0xffffffff;
const WAIT_FAILED = 0xffffffff;
const WAIT_TIMEOUT = 0x102;
const INVALID_HANDLE = 6;
const INVALID_PARAMETER = 87;

export class NativeWindowsEvents {
  constructor(kernel) {
    this.kernel = kernel;
    this.events = new Map();
    this.waiters = new Set();
    this.next = BASE;
    const register = (name, count, fn) => kernel.register('KERNEL32.dll', name, { count, fn });
    for (const suffix of ['A', 'W'])
      register(`CreateEvent${suffix}`, 4, ([attributes, manual, signaled, name]) => {
        if (attributes || name)
          throw new Error('Native event requires an unnamed default-security object');
        return this.create(manual, signaled);
      });
    register('SetEvent', 1, ([handle]) => this.signal(handle, true));
    register('ResetEvent', 1, ([handle]) => this.signal(handle, false));
    register('WaitForSingleObject', 2, ([handle, timeout]) => this.wait([handle], false, timeout));
    register('WaitForSingleObjectEx', 3, ([handle, timeout, alertable]) => {
      if (alertable) throw new Error('Native event waits do not have an APC provider');
      return this.wait([handle], false, timeout);
    });
    register('WaitForMultipleObjects', 4, ([count, pointer, all, timeout]) => {
      if (!pointer || !count || count > 64) return this.failed(INVALID_PARAMETER);
      const handles = Array.from({ length: count }, (_, i) => kernel.process.load(pointer + i * 4));
      if (new Set(handles).size !== count) return this.failed(INVALID_PARAMETER);
      return this.wait(handles, Boolean(all), timeout);
    });
  }
  failed(error) {
    this.kernel.lastError = error;
    return WAIT_FAILED;
  }
  create(manual, signaled) {
    if (this.next >= END) {
      this.kernel.lastError = 8;
      return 0;
    }
    const handle = this.next++;
    this.events.set(handle, { manual: Boolean(manual), signaled: Boolean(signaled) });
    this.kernel.lastError = 0;
    return handle;
  }
  signal(handle, signaled) {
    const event = this.events.get(handle);
    if (!event) {
      this.kernel.lastError = INVALID_HANDLE;
      return 0;
    }
    event.signaled = signaled;
    if (signaled) this.wake();
    return 1;
  }
  poll(handles, all) {
    const events = handles.map((handle) => this.events.get(handle));
    if (events.some((event) => !event)) return this.failed(INVALID_HANDLE);
    if (all) {
      if (!events.every((event) => event.signaled)) return null;
      for (const event of events) if (!event.manual) event.signaled = false;
      return 0;
    }
    const index = events.findIndex((event) => event.signaled);
    if (index < 0) return null;
    if (!events[index].manual) events[index].signaled = false;
    return index;
  }
  wait(handles, all, timeout) {
    const status = this.poll(handles, all);
    if (status !== null) return status;
    if (!timeout) return WAIT_TIMEOUT;
    return new Promise((resolve) => {
      const waiter = {
        handles,
        all,
        timer: null,
        finish: (value) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(value);
        },
      };
      this.waiters.add(waiter);
      if (timeout !== INFINITE) {
        const deadline = performance.now() + timeout,
          schedule = () => {
            const remaining = Math.ceil(deadline - performance.now());
            if (remaining <= 0) waiter.finish(WAIT_TIMEOUT);
            else waiter.timer = setTimeout(schedule, Math.min(remaining, 0x7fffffff));
          };
        schedule();
      }
    });
  }
  wake() {
    for (const waiter of this.waiters) {
      const result = this.poll(waiter.handles, waiter.all);
      if (result !== null) waiter.finish(result);
    }
  }
  close(handle) {
    if (!this.events.delete(handle)) return false;
    this.wake();
    return true;
  }
  snapshot() {
    if (this.waiters.size) throw new Error('Cannot checkpoint a pending native event wait');
    return { next: this.next, events: structuredClone([...this.events]) };
  }
  restore(state) {
    if (this.waiters.size) throw new Error('Cannot restore over a pending native event wait');
    const events = new Map(structuredClone(state.events));
    if (
      !Number.isInteger(state.next) ||
      state.next < BASE ||
      state.next > END ||
      events.size !== state.events.length
    )
      throw new Error('Invalid native event checkpoint');
    for (const [handle, event] of events)
      if (
        !Number.isInteger(handle) ||
        handle < BASE ||
        handle >= state.next ||
        typeof event.manual !== 'boolean' ||
        typeof event.signaled !== 'boolean'
      )
        throw new Error('Invalid native event checkpoint record');
    this.next = state.next;
    this.events = events;
  }
  closeAll() {
    this.events.clear();
    this.wake();
  }
}
