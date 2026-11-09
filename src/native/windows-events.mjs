// SPDX-License-Identifier: MPL-2.0
// Process-local Win32 synchronization handles share the same wait operations.
const BASE = 0x57000000;
const END = 0x58000000;
const INFINITE = 0xffffffff;
const WAIT_FAILED = 0xffffffff;
const WAIT_TIMEOUT = 0x102;
const INVALID_HANDLE = 6;
const INVALID_PARAMETER = 87;
const TOO_MANY_POSTS = 298;
const NOT_OWNER = 288;
const ALREADY_EXISTS = 183;
const ACCESS_DENIED = 5;
const MODIFY_STATE = 2;
const SYNCHRONIZE = 0x100000;
const FULL_EVENT_ACCESS = 0x1f0003;

// The guest exposes one Win32 thread. Its own mutex can be acquired recursively.
const available = (object) =>
  'depth' in object || ('maximum' in object ? object.count > 0 : object.signaled);
function consume(object) {
  if ('depth' in object) object.depth++;
  else if ('maximum' in object) object.count--;
  else if (!object.manual) object.signaled = false;
}

export class NativeWindowsEvents {
  constructor(kernel) {
    this.kernel = kernel;
    this.events = new Map();
    this.mutexes = new Map();
    this.namedEvents = new Map();
    this.waiters = new Set();
    this.next = BASE;
    const register = (name, count, fn) => kernel.register('KERNEL32.dll', name, { count, fn });
    for (const suffix of ['A', 'W']) {
      register(`CreateEvent${suffix}`, 4, ([attributes, manual, signaled, name]) => {
        if (attributes) throw new Error('Native event requires default security');
        return this.create(
          manual,
          signaled,
          name ? kernel.process.string(name, suffix === 'W') : '',
        );
      });
      register(`OpenEvent${suffix}`, 3, ([access, , name]) =>
        name
          ? this.openEvent(kernel.process.string(name, suffix === 'W'), access)
          : this.error(INVALID_PARAMETER),
      );
      register(`CreateSemaphore${suffix}`, 4, ([attributes, count, maximum, name]) => {
        if (attributes || name)
          throw new Error('Native semaphore requires an unnamed default-security object');
        count |= 0;
        maximum |= 0;
        if (maximum <= 0 || count < 0 || count > maximum) return this.error(INVALID_PARAMETER);
        return this.allocate({ count, maximum });
      });
      register(`CreateMutex${suffix}`, 3, ([attributes, owner, name]) => {
        if (attributes) return this.error(INVALID_PARAMETER);
        return this.createMutex(owner, name ? kernel.process.string(name, suffix === 'W') : '');
      });
    }
    register('SetEvent', 1, ([handle]) => this.signal(handle, true));
    register('ResetEvent', 1, ([handle]) => this.signal(handle, false));
    register('ReleaseSemaphore', 3, ([handle, count, previous]) =>
      this.release(handle, count | 0, previous),
    );
    register('ReleaseMutex', 1, ([handle]) => {
      const mutex = this.mutexes.get(this.events.get(handle)?.mutex);
      if (!mutex) return this.error(INVALID_HANDLE);
      if (!mutex.depth) return this.error(NOT_OWNER);
      mutex.depth--;
      return 1;
    });
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
  error(error) {
    this.kernel.lastError = error;
    return 0;
  }
  create(manual, signaled, name = '') {
    const state = { manual: Boolean(manual), signaled: Boolean(signaled) };
    if (!name) return this.allocate(state);
    if (this.findMutex(name)) return this.error(INVALID_HANDLE);
    const existing = this.namedEvents.has(name),
      handle = this.allocate({ event: name, access: FULL_EVENT_ACCESS });
    if (!handle) return 0;
    if (existing) this.kernel.lastError = ALREADY_EXISTS;
    else this.namedEvents.set(name, state);
    return handle;
  }
  openEvent(name, access) {
    if (this.findMutex(name)) return this.error(INVALID_HANDLE);
    if (!this.namedEvents.has(name)) return this.error(2);
    return this.allocate({ event: name, access });
  }
  findMutex(name) {
    return name && [...this.mutexes].find(([, record]) => record.name === name);
  }
  createMutex(owner, name) {
    if (this.namedEvents.has(name)) return this.error(INVALID_HANDLE);
    const existing = this.findMutex(name);
    const handle = this.allocate({ mutex: existing ? existing[0] : this.next });
    if (!handle) return 0;
    if (existing) this.kernel.lastError = ALREADY_EXISTS;
    else this.mutexes.set(handle, { name, depth: Number(Boolean(owner)) });
    return handle;
  }
  allocate(record) {
    if (this.next >= END) return this.error(8);
    const handle = this.next++;
    this.events.set(handle, record);
    this.kernel.lastError = 0;
    return handle;
  }
  signal(handle, signaled) {
    const record = this.events.get(handle);
    if (!record || 'maximum' in record || 'mutex' in record) return this.error(INVALID_HANDLE);
    if (record.event && !(record.access & MODIFY_STATE)) return this.error(ACCESS_DENIED);
    const event = record.event ? this.namedEvents.get(record.event) : record;
    event.signaled = signaled;
    if (signaled) this.wake();
    return 1;
  }
  release(handle, count, previous) {
    const semaphore = this.events.get(handle);
    if (!semaphore || !('maximum' in semaphore)) return this.error(INVALID_HANDLE);
    if (count <= 0) return this.error(INVALID_PARAMETER);
    if (semaphore.count + count > semaphore.maximum) return this.error(TOO_MANY_POSTS);
    if (previous) this.kernel.process.store(previous, semaphore.count);
    semaphore.count += count;
    this.wake();
    return 1;
  }
  poll(handles, all) {
    const records = handles.map((handle) => this.events.get(handle));
    if (records.some((record) => !record)) return this.failed(INVALID_HANDLE);
    if (records.some((record) => record.event && !(record.access & SYNCHRONIZE)))
      return this.failed(ACCESS_DENIED);
    const events = records.map((record) =>
      record.mutex
        ? this.mutexes.get(record.mutex)
        : record.event
          ? this.namedEvents.get(record.event)
          : record,
    );
    if (all) {
      if (!events.every(available)) return null;
      for (const event of events) consume(event);
      return 0;
    }
    const index = events.findIndex(available);
    if (index < 0) return null;
    consume(events[index]);
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
    const record = this.events.get(handle);
    if (!this.events.delete(handle)) return false;
    const { mutex, event } = record;
    if (mutex && ![...this.events.values()].some((record) => record.mutex === mutex))
      this.mutexes.delete(mutex);
    if (event && ![...this.events.values()].some((record) => record.event === event))
      this.namedEvents.delete(event);
    this.wake();
    return true;
  }
  snapshot() {
    if (this.waiters.size) throw new Error('Cannot checkpoint a pending native event wait');
    return {
      next: this.next,
      events: structuredClone([...this.events]),
      mutexes: structuredClone([...this.mutexes]),
      namedEvents: structuredClone([...this.namedEvents]),
    };
  }
  restore(state) {
    if (this.waiters.size) throw new Error('Cannot restore over a pending native event wait');
    const events = new Map(structuredClone(state.events)),
      mutexes = new Map(structuredClone(state.mutexes)),
      namedEvents = new Map(structuredClone(state.namedEvents)),
      eventNames = new Set(),
      mutexHandles = new Set(),
      names = new Set();
    if (
      !Number.isInteger(state.next) ||
      state.next < BASE ||
      state.next > END ||
      events.size !== state.events.length ||
      mutexes.size !== state.mutexes.length ||
      namedEvents.size !== state.namedEvents.length
    )
      throw new Error('Invalid native event checkpoint');
    for (const [handle, object] of events) {
      const valid =
        object &&
        typeof object === 'object' &&
        ('event' in object
          ? namedEvents.has(object.event) &&
            Number.isInteger(object.access) &&
            object.access >= 0 &&
            object.access <= 0xffffffff
          : 'mutex' in object
            ? mutexes.has(object.mutex)
            : 'maximum' in object
              ? Number.isInteger(object.count) &&
                Number.isInteger(object.maximum) &&
                object.count >= 0 &&
                object.maximum > 0 &&
                object.maximum <= 0x7fffffff &&
                object.count <= object.maximum
              : typeof object.manual === 'boolean' && typeof object.signaled === 'boolean');
      if (!Number.isInteger(handle) || handle < BASE || handle >= state.next || !valid)
        throw new Error('Invalid native event checkpoint record');
      if ('mutex' in object) mutexHandles.add(object.mutex);
      if ('event' in object) eventNames.add(object.event);
    }
    for (const [id, record] of mutexes) {
      if (
        !Number.isInteger(id) ||
        id < BASE ||
        id >= state.next ||
        !mutexHandles.has(id) ||
        !record ||
        typeof record.name !== 'string' ||
        !Number.isSafeInteger(record.depth) ||
        record.depth < 0 ||
        (record.name && (names.has(record.name) || namedEvents.has(record.name)))
      )
        throw new Error('Invalid native mutex checkpoint record');
      if (record.name) names.add(record.name);
    }
    for (const [name, state] of namedEvents)
      if (
        !name ||
        typeof name !== 'string' ||
        !eventNames.has(name) ||
        typeof state?.manual !== 'boolean' ||
        typeof state.signaled !== 'boolean'
      )
        throw new Error('Invalid native named event checkpoint record');
    this.next = state.next;
    this.events = events;
    this.mutexes = mutexes;
    this.namedEvents = namedEvents;
  }
  closeAll() {
    this.events.clear();
    this.mutexes.clear();
    this.namedEvents.clear();
    this.wake();
  }
}
