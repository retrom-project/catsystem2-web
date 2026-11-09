// SPDX-License-Identifier: MPL-2.0
// The virtual process can open its current execution thread by ID. Real
// handles have their own lifetime; the current-thread pseudo handle does not.
const FIRST = 0x58000000,
  END = 0x59000000,
  CURRENT = 0xfffffffe,
  QUERY_ACCESS = 0x92000840;

export class NativeWindowsThreadHandles {
  constructor(kernel) {
    this.kernel = kernel;
    this.handles = new Map();
    this.next = FIRST;
    const def = (name, count, fn) => kernel.register('KERNEL32.dll', name, { count, fn });
    def('GetCurrentThread', 0, () => CURRENT);
    def('OpenThread', 3, ([access, inherit, id]) => {
      if (id !== this.currentID()) return this.error(87);
      if (this.next === END) return this.error(8);
      const handle = this.next++;
      this.handles.set(handle, { id, access, inherit: Boolean(inherit) });
      return handle;
    });
    def('GetThreadId', 1, ([handle]) => {
      if (handle === CURRENT) return this.currentID();
      const opened = this.handles.get(handle);
      if (!opened) return this.error(6);
      if (!(opened.access & QUERY_ACCESS)) return this.error(5);
      return opened.id;
    });
  }
  currentID() {
    return this.kernel.definitions.get('GetCurrentThreadId').fn();
  }
  error(code) {
    this.kernel.lastError = code;
    return 0;
  }
  close(handle) {
    return this.handles.delete(handle);
  }
  closeAll() {
    this.handles.clear();
  }
  snapshot() {
    return { next: this.next, handles: structuredClone([...this.handles]) };
  }
  restore({ next, handles }) {
    const entries = new Map(structuredClone(handles));
    if (
      !Number.isInteger(next) ||
      next < FIRST ||
      next > END ||
      entries.size !== handles.length ||
      [...entries].some(
        ([handle, record]) =>
          !Number.isInteger(handle) ||
          handle < FIRST ||
          handle >= next ||
          !record ||
          record.id !== this.currentID() ||
          !Number.isInteger(record.access) ||
          record.access < 0 ||
          record.access > 0xffffffff ||
          typeof record.inherit !== 'boolean',
      )
    )
      throw new Error('Invalid native thread handle checkpoint');
    this.next = next;
    this.handles = entries;
  }
}
