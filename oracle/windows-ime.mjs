// SPDX-License-Identifier: MPL-2.0
// The virtual USER32 thread owns one default IMM context across its windows.
const DEFAULT_CONTEXT = 0x5d000000;
const INVALID_HANDLE = 6;
const INVALID_WINDOW = 1400;
const WM_IME_NOTIFY = 0x282;
const IMN_SETOPENSTATUS = 8;
const IMN_SETSTATUSWINDOWPOS = 12;
const isLong = (value) => Number.isInteger(value) && (value | 0) === value;

export class NativeWindowsIME {
  constructor(kernel) {
    this.kernel = kernel;
    this.target = 0;
    this.borrowed = new Map();
    this.open = false;
    this.position = [0, 0];
    const register = (name, count, fn) => kernel.register('IMM32.dll', name, { count, fn });
    register('ImmGetContext', 1, ([window]) => this.acquire(window));
    register('ImmReleaseContext', 2, ([window, context]) => this.release(window, context));
    register('ImmGetOpenStatus', 1, ([context]) =>
      context === DEFAULT_CONTEXT ? Number(this.open) : this.error(INVALID_HANDLE),
    );
    register('ImmSetOpenStatus', 2, ([context, open]) => this.setOpen(context, Boolean(open)));
    register('ImmGetStatusWindowPos', 2, ([context, at]) => this.statusPosition(context, at));
    register('ImmSetStatusWindowPos', 2, ([context, at]) => this.statusPosition(context, at, true));
  }
  error(code) {
    this.kernel.lastError = code;
    return 0;
  }
  acquire(window) {
    if (!this.kernel.windowViews.windows.has(window)) return this.error(INVALID_WINDOW);
    this.borrowed.set(window, (this.borrowed.get(window) ?? 0) + 1);
    this.target = window;
    return DEFAULT_CONTEXT;
  }
  release(window, context) {
    if (!this.kernel.windowViews.windows.has(window)) return this.error(INVALID_WINDOW);
    const count = this.borrowed.get(window);
    if (context !== DEFAULT_CONTEXT || !count) return this.error(INVALID_HANDLE);
    if (count === 1) this.borrowed.delete(window);
    else this.borrowed.set(window, count - 1);
    return 1;
  }
  forgetWindow(window) {
    this.borrowed.delete(window);
    if (this.target === window) this.target = 0;
  }
  async notify(command) {
    if (this.target) await this.kernel.windowViews.send(this.target, WM_IME_NOTIFY, command, 0);
    return 1;
  }
  setOpen(context, open) {
    if (context !== DEFAULT_CONTEXT) return this.error(INVALID_HANDLE);
    if (this.open === open) return 1;
    this.open = open;
    return this.notify(IMN_SETOPENSTATUS);
  }
  statusPosition(context, at, write = false) {
    if (context !== DEFAULT_CONTEXT || !at) return this.error(INVALID_HANDLE);
    const p = this.kernel.process;
    if (write) {
      this.position = [p.load(at) | 0, p.load(at + 4) | 0];
      return this.notify(IMN_SETSTATUSWINDOWPOS);
    }
    p.store(at, this.position[0]);
    p.store(at + 4, this.position[1]);
    return 1;
  }
  snapshot() {
    return structuredClone({
      target: this.target,
      borrowed: this.borrowed,
      open: this.open,
      position: this.position,
    });
  }
  restore(state) {
    const { target, borrowed, open, position } = state ?? {},
      windows = this.kernel.windowViews.windows;
    if (
      (target !== 0 && !windows.has(target)) ||
      !(borrowed instanceof Map) ||
      [...borrowed].some(
        ([window, count]) => !windows.has(window) || !Number.isSafeInteger(count) || count < 1,
      ) ||
      typeof open !== 'boolean' ||
      !Array.isArray(position) ||
      position.length !== 2 ||
      !position.every(isLong)
    )
      throw new Error('Invalid native IMM context checkpoint');
    this.target = target;
    this.borrowed = new Map(borrowed);
    this.open = open;
    this.position = [...position];
  }
}
