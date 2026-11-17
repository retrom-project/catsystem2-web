// SPDX-License-Identifier: MPL-2.0
// Win32 threads run in the same address space with independent guest stacks.
const FIRST = 0x58000000,
  END = 0x59000000,
  CURRENT = 0xfffffffe,
  QUERY_ACCESS = 0x92000840,
  SYNCHRONIZE = 0x100000,
  SUSPEND_RESUME = 0x0002,
  FULL_ACCESS = 0x1fffff,
  PAGE = 4096,
  WAIT_TIMEOUT = 0x102,
  WAIT_FAILED = 0xffffffff,
  STILL_ACTIVE = 259;

export class NativeWindowsThreadHandles {
  constructor(kernel) {
    this.kernel = kernel;
    this.process = kernel.process;
    this.handles = new Map();
    this.threads = new Map();
    this.live = 0;
    this.next = FIRST;
    this.nextID = 2;
    const def = (name, count, fn) => kernel.register('KERNEL32.dll', name, { count, fn });
    def('GetCurrentThread', 0, () => CURRENT);
    def('OpenThread', 3, ([access, inherit, id]) => {
      if (id !== 1 && !this.threads.has(id)) return this.error(87);
      return this.open(id, access, inherit);
    });
    def('GetThreadId', 1, ([handle]) => {
      return this.lookup(handle, QUERY_ACCESS)?.id ?? 0;
    });
    def('CreateThread', 6, (args) => this.create(args));
    def('ResumeThread', 1, ([handle]) => {
      const opened = this.lookup(handle, SUSPEND_RESUME);
      if (!opened) return WAIT_FAILED;
      const thread = this.threads.get(opened.id);
      if (!thread?.context) return this.error(6, WAIT_FAILED);
      const previous = thread.suspended;
      thread.suspended = false;
      return Number(previous);
    });
    def('GetExitCodeThread', 2, ([handle, out]) => {
      const opened = this.lookup(handle, QUERY_ACCESS);
      if (!opened) return 0;
      if (!out) return this.error(87);
      this.process.store(out, this.threads.get(opened.id)?.exitCode ?? STILL_ACTIVE);
      return 1;
    });
    def('ExitThread', 1, ([exitCode]) => this.process.stopThread({ exitCode }));
    def('Sleep', 1, ([timeout]) => this.sleep(timeout));
  }
  currentID() {
    return this.kernel.definitions.get('GetCurrentThreadId').fn();
  }
  get hasWorkers() {
    return this.live > 0;
  }
  open(id, access, inherit) {
    if (this.next === END) return this.error(8);
    const handle = this.next++;
    this.handles.set(handle, { id, access, inherit: Boolean(inherit) });
    return handle;
  }
  lookup(handle, access) {
    const opened =
      handle === CURRENT ? { id: this.currentID(), access: FULL_ACCESS } : this.handles.get(handle);
    if (!opened) this.error(6);
    else if (!(opened.access & access)) this.error(5);
    else return opened;
    return null;
  }
  synchronization(handle) {
    const opened =
      handle === CURRENT ? { id: this.currentID(), access: FULL_ACCESS } : this.handles.get(handle);
    if (!opened) return undefined;
    return {
      access: opened.access & SYNCHRONIZE,
      manual: true,
      signaled: this.threads.get(opened.id)?.exitCode != null,
    };
  }
  error(code, result = 0) {
    this.kernel.lastError = code;
    return result;
  }
  create([attributes, size, address, parameter, flags, out]) {
    const p = this.process,
      inherit = attributes && p.load(attributes + 8);
    if (!address || flags & ~0x10004 || (attributes && p.load(attributes) !== 12))
      return this.error(87);
    if (attributes && p.load(attributes + 4))
      throw new Error('Virtual threads require the default Win32 security descriptor');
    if (this.next === END || this.nextID > 0xffffffff) return this.error(8);
    const reserve = p.modules[0]?.pe.stackReserve || 0x100000,
      stackBytes =
        Math.ceil((flags & 0x10000 && size ? size : Math.max(size, reserve)) / PAGE) * PAGE,
      length = stackBytes + 2 * PAGE;
    const teb = this.kernel.virtualAllocate(0, length, 0x3000, 4);
    if (!teb) return this.error(8);
    try {
      // The browser commits the reservation up front and keeps a no-access
      // page between the TEB and the bottom of the downward-growing stack.
      if (!this.kernel.virtualFree(teb + PAGE, PAGE, 0x4000))
        throw new Error('Could not protect the virtual thread stack');
      const id = this.nextID,
        context = { teb, stackBottom: teb + 2 * PAGE, stackTop: teb + length, registers: null };
      p.initializeTEB(teb, context.stackBottom, context.stackTop, id);
      if (out) p.store(out, id);
      const handle = this.open(id, FULL_ACCESS, inherit);
      this.nextID++;
      this.threads.set(id, {
        id,
        address,
        parameter,
        context,
        suspended: Boolean(flags & 4),
        exitCode: null,
        wait: null,
      });
      this.live++;
      return handle;
    } catch (error) {
      this.kernel.virtualFree(teb, 0, 0x8000);
      throw error;
    }
  }
  park(wait, timeout) {
    return this.process.stopThread({
      wait: {
        ...wait,
        deadline: timeout === 0xffffffff ? null : performance.now() + timeout,
        revision: this.kernel.events.revision,
      },
    });
  }
  sleep(timeout) {
    if (this.currentID() !== 1) return this.park({ kind: 'sleep' }, timeout);
    if (timeout) return this.kernel.events.waitUntil(() => null, timeout).then(() => {});
    if (this.hasWorkers) return this.pump().then(() => {});
  }
  resume(wait) {
    let status = null;
    if (wait.kind === 'objects') status = this.kernel.events.poll(wait.handles, wait.all);
    else if (wait.kind === 'lock' && this.kernel.acquireLock(wait.pointer)) return undefined;
    if (status !== null) return status;
    if (wait.deadline === null || performance.now() < wait.deadline) return null;
    return wait.kind === 'sleep' ? undefined : WAIT_TIMEOUT;
  }
  lock(pointer) {
    if (this.currentID() !== 1) return this.park({ kind: 'lock', pointer }, 0xffffffff);
    return this.kernel.events
      .waitUntil(() => (this.kernel.acquireLock(pointer) ? 0 : null), 0xffffffff)
      .then((status) => {
        if (status !== 0) throw new Error('Native critical section wait was cancelled');
      });
  }
  nextTimeout() {
    let next = Infinity;
    for (const thread of this.threads.values())
      if (thread.context && !thread.suspended && thread.wait?.deadline != null)
        next = Math.min(next, thread.wait.deadline);
    return next;
  }
  async pump() {
    if (this.running) throw new Error('Virtual thread scheduler cannot be reentered');
    this.running = true;
    let progressed = false;
    try {
      for (const thread of [...this.threads.values()]) {
        if (!thread.context || thread.suspended) continue;
        const { wait } = thread,
          revision = this.kernel.events.revision;
        if (
          wait?.revision === revision &&
          (wait.deadline === null || performance.now() < wait.deadline)
        )
          continue;
        let outcome;
        try {
          outcome = await this.process.runThread(
            thread.context,
            thread.address,
            thread.parameter,
            () => this.resume(wait),
          );
        } catch (error) {
          this.finish(thread, 0xc0000144); // STATUS_UNHANDLED_EXCEPTION
          throw error;
        }
        if (outcome === null) {
          wait.revision = revision;
          continue;
        }
        progressed = true;
        if (outcome.wait) thread.wait = outcome.wait;
        else this.finish(thread, outcome.exitCode);
      }
      return progressed;
    } finally {
      this.running = false;
    }
  }
  releaseContext({ teb }) {
    this.kernel.comApartments.delete(teb);
    this.kernel.releaseTLSEnvironment(teb);
    if (!this.kernel.virtualFree(teb, 0, 0x8000))
      throw new Error('Virtual thread could not release its stack and TEB');
  }
  finish(thread, exitCode) {
    this.releaseContext(thread.context);
    thread.context = thread.wait = null;
    thread.exitCode = exitCode >>> 0;
    this.live--;
    this.collect(thread.id);
    this.kernel.events.abandonThread(thread.id);
    this.kernel.events.wake();
  }
  collect(id) {
    if (
      this.threads.get(id)?.exitCode != null &&
      ![...this.handles.values()].some((opened) => opened.id === id)
    )
      this.threads.delete(id);
  }
  close(handle) {
    const opened = this.handles.get(handle);
    if (!opened) return false;
    this.handles.delete(handle);
    this.collect(opened.id);
    this.kernel.events.wake();
    return true;
  }
  closeAll() {
    for (const thread of this.threads.values())
      if (thread.context) this.releaseContext(thread.context);
    this.threads.clear();
    this.handles.clear();
    this.live = 0;
  }
  snapshot() {
    if (this.running) throw new Error('Cannot checkpoint a running virtual thread');
    const now = performance.now();
    return structuredClone({
      next: this.next,
      nextID: this.nextID,
      handles: [...this.handles],
      threads: [...this.threads].map(([id, thread]) => [
        id,
        {
          ...thread,
          wait: thread.wait && {
            ...thread.wait,
            deadline:
              thread.wait.deadline === null ? null : Math.max(0, thread.wait.deadline - now),
            revision: -1,
          },
        },
      ]),
    });
  }
  restore({ next, nextID, handles, threads: saved }) {
    const entries = new Map(structuredClone(handles));
    const threads = new Map(structuredClone(saved));
    const word = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
    if (
      !Number.isInteger(next) ||
      next < FIRST ||
      next > END ||
      !Number.isInteger(nextID) ||
      nextID < 2 ||
      nextID > 0x100000000 ||
      threads.size !== saved.length ||
      entries.size !== handles.length ||
      [...entries].some(
        ([handle, record]) =>
          !Number.isInteger(handle) ||
          handle < FIRST ||
          handle >= next ||
          !record ||
          (record.id !== 1 && !threads.has(record.id)) ||
          !Number.isInteger(record.access) ||
          record.access < 0 ||
          record.access > 0xffffffff ||
          typeof record.inherit !== 'boolean',
      )
    )
      throw new Error('Invalid native thread handle checkpoint');
    let live = 0;
    const now = performance.now();
    for (const [id, thread] of threads) {
      if (
        !word(id) ||
        id < 2 ||
        id >= nextID ||
        thread?.id !== id ||
        !word(thread.address) ||
        !word(thread.parameter) ||
        typeof thread.suspended !== 'boolean' ||
        (thread.exitCode !== null && !word(thread.exitCode)) ||
        Boolean(thread.context) !== (thread.exitCode === null)
      )
        throw new Error('Invalid virtual thread checkpoint');
      if (!thread.context) {
        if (thread.wait) throw new Error('An exited thread cannot retain a wait');
        continue;
      }
      const { teb, stackBottom, stackTop, registers } = thread.context,
        memory = this.kernel.virtual.get(teb);
      if (
        !memory ||
        stackBottom !== teb + 2 * PAGE ||
        stackTop !== teb + memory.size ||
        this.process.load(teb + 0x18) !== teb ||
        this.process.load(teb + 0x24) !== id ||
        Boolean(registers) !== Boolean(thread.wait)
      )
        throw new Error('Invalid virtual thread memory checkpoint');
      const wait = thread.wait;
      if (wait) {
        if (
          !['objects', 'sleep', 'lock'].includes(wait.kind) ||
          (wait.kind === 'objects' &&
            (!Array.isArray(wait.handles) ||
              !wait.handles.length ||
              wait.handles.length > 64 ||
              !wait.handles.every(word) ||
              typeof wait.all !== 'boolean')) ||
          (wait.kind === 'lock' && !word(wait.pointer)) ||
          (wait.deadline !== null && (!Number.isFinite(wait.deadline) || wait.deadline < 0))
        )
          throw new Error('Invalid virtual thread wait checkpoint');
        if (wait.deadline !== null) wait.deadline += now;
        wait.revision = -1;
      }
      live++;
    }
    this.next = next;
    this.nextID = nextID;
    this.handles = entries;
    this.threads = threads;
    this.live = live;
  }
}
