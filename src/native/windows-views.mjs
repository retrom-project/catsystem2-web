// SPDX-License-Identifier: MPL-2.0
// Process-local USER32 windows and callbacks for the reviewed engine styles.
import { encodeCP932 } from '../kcs/strings.mjs';

const DESKTOP = 2;
const WS_VISIBLE = 0x10000000;
const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const INVALID_WINDOW = 1400;
const INVALID_MENU = 1401;
const INVALID_INDEX = 1413;
const CLASS_MISSING = 1407;
const LONG_FIELDS = new Map([
  [-21, 'userData'],
  [-20, 'extended'],
  [-16, 'style'],
  [-12, 'controlID'],
  [-8, 'parent'],
  [-6, 'instance'],
  [-4, 'procedure'],
]);

function margins(style, menu, extended) {
  const base = (style & ~WS_VISIBLE) >>> 0;
  if (extended || ![0, 0xca0000, WS_CHILD, WS_POPUP, 0x800a0000, 0xc0000000].includes(base))
    throw new Error(
      `Unreviewed native window frame 0x${base.toString(16)}/0x${extended.toString(16)}`,
    );
  const border = base === 0xca0000 ? 3 : 0,
    caption = border ? 19 : 0;
  return [border, border + caption + (menu ? 19 : 0), border, border];
}

export class NativeWindowsViews {
  constructor(kernel) {
    this.kernel = kernel;
    this.process = kernel.process;
    this.windows = new Map();
    this.next = 1;
    this.quit = null;
    const register = (name, count, fn) => kernel.register('USER32.dll', name, { count, fn });
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W';
      register('CreateWindowEx' + suffix, 12, (args) => this.create(args, wide));
      register('DefWindowProc' + suffix, 4, (args) => this.defaultProcedure(args));
      register('SetWindowText' + suffix, 2, ([handle, at]) => this.setText(handle, at, wide));
      register('GetWindowLong' + suffix, 2, ([handle, index]) => this.long(handle, index | 0));
      register('SetWindowLong' + suffix, 3, ([handle, index, value]) =>
        this.long(handle, index | 0, value),
      );
      register('GetClassName' + suffix, 3, ([handle, output, capacity]) =>
        this.className(handle, output, capacity, wide),
      );
    }
    register('DestroyWindow', 1, ([handle]) => this.destroy(handle));
    register('IsWindow', 1, ([handle]) => Number(handle === DESKTOP || this.windows.has(handle)));
    register('IsChild', 2, ([parent, child]) => Number(this.isChild(parent, child)));
    register(
      'GetMenu',
      1,
      ([handle]) => this.windows.get(handle)?.menu ?? this.error(INVALID_WINDOW),
    );
    register('SetMenu', 2, ([handle, menu]) => {
      const window = this.windows.get(handle);
      if (!window) return this.error(INVALID_WINDOW);
      if (menu && !this.kernel.windowMenus.menus.has(menu)) return this.error(INVALID_MENU);
      window.menu = menu;
      this.setClient(window, this.clientBounds(window));
      return 1;
    });
    register('ShowWindow', 2, ([handle, command]) => {
      const window = this.windows.get(handle);
      if (!window) return this.error(INVALID_WINDOW);
      if (![0, 1, 5, 8].includes(command))
        throw new Error(`Unreviewed native ShowWindow command ${command}`);
      const previous = window.style & WS_VISIBLE;
      window.style = ((window.style & ~WS_VISIBLE) | (command ? WS_VISIBLE : 0)) >>> 0;
      return Number(Boolean(previous));
    });
    register('SetRectEmpty', 1, ([at]) => {
      if (!at) return this.error(87);
      this.process.zero(at, 16);
      return 1;
    });
    register('AdjustWindowRect', 3, ([at, style, menu]) => this.adjust(at, style, menu, 0));
    register('AdjustWindowRectEx', 4, ([at, style, menu, extended]) =>
      this.adjust(at, style, menu, extended),
    );
  }
  error(code) {
    this.kernel.lastError = code;
    return 0;
  }
  isChildWindow(window) {
    return (window.style & 0xc0000000) === WS_CHILD;
  }
  isChild(parent, handle) {
    let window = this.windows.get(handle);
    for (
      let remaining = this.windows.size;
      remaining && window && this.isChildWindow(window);
      remaining--
    ) {
      if (window.parent === parent) return true;
      window = this.windows.get(window.parent);
    }
    return false;
  }
  forget(handle) {
    this.windows.delete(handle);
    this.kernel.messageQueue.dropWindow(handle);
  }
  readRect(at) {
    return Array.from({ length: 4 }, (_, i) => this.process.load(at + i * 4) | 0);
  }
  writeRect(at, values) {
    values.forEach((value, i) => this.process.store(at + i * 4, value));
  }
  adjust(at, style, menu, extended) {
    if (!at) return this.error(87);
    const frame = margins(style, menu, extended);
    this.writeRect(
      at,
      this.readRect(at).map((v, i) => v + (i < 2 ? -frame[i] : frame[i])),
    );
    return 1;
  }
  clientBounds({ bounds, style, menu, extended }) {
    const frame = margins(style, menu, extended);
    return bounds.map((value, i) => value + (i < 2 ? frame[i] : -frame[i]));
  }
  setClient(window, [left, top, right, bottom]) {
    window.client = [left, top, Math.max(0, right - left), Math.max(0, bottom - top)];
  }
  long(handle, index, value) {
    const window = this.windows.get(handle);
    if (!window) {
      const fallback = value === undefined ? this.fallbackLong?.(handle, index) : undefined;
      return fallback ?? this.error(INVALID_WINDOW);
    }
    const field = LONG_FIELDS.get(index);
    if (field) {
      const old = window[field];
      if (value !== undefined) window[field] = value;
      return old;
    }
    if (index < 0 || index + 4 > window.extra.length) return this.error(INVALID_INDEX);
    const view = new DataView(window.extra.buffer),
      old = view.getUint32(index, true);
    if (value !== undefined) view.setUint32(index, value, true);
    return old;
  }
  className(handle, output, capacity, wide) {
    const window = this.windows.get(handle);
    if (!window) return this.error(INVALID_WINDOW);
    if (!output || !capacity) return this.error(87);
    const name = window.className;
    if (wide) {
      const text = name.slice(0, capacity - 1);
      this.kernel.writeString(output, text, true);
      return text.length;
    }
    const bytes = encodeCP932(name).subarray(0, capacity - 1);
    this.process.write(output, Uint8Array.from([...bytes, 0]));
    return bytes.length;
  }
  async setText(handle, pointer, wide) {
    const window = this.windows.get(handle);
    if (!window) return this.error(INVALID_WINDOW);
    if (!pointer || wide === window.wide) return this.send(handle, 0xc, 0, pointer);
    const p = this.process,
      text = p.string(pointer, wide),
      size = window.wide ? (text.length + 1) * 2 : encodeCP932(text).length + 1,
      temporary = p.allocate(size);
    try {
      this.kernel.writeString(temporary, text, window.wide);
      return await this.send(handle, 0xc, 0, temporary);
    } finally {
      p.free(temporary);
    }
  }
  defaultProcedure([handle, message, wParam, lParam]) {
    const window = this.windows.get(handle);
    if (!window) return this.error(INVALID_WINDOW);
    if (message === 0x81) return 1; // WM_NCCREATE accepts the window.
    if (message === 0xc) {
      window.title = lParam ? this.process.string(lParam, window.wide) : '';
      return 1;
    }
    if (message === 0x83) {
      this.writeRect(lParam, this.clientBounds({ ...window, bounds: this.readRect(lParam) }));
      return 0;
    }
    if (message === 0x102 || (message === 0x100 && wParam !== 0x79)) return 0;
    // Application-defined messages have no system default action.
    if (message >= 0x400 || [1, 2, 3, 5, 0x24, 0x82, 0x111, 0x113, 0x116, 0x117].includes(message))
      return 0;
    throw new Error(`Unreviewed native DefWindowProc message 0x${message.toString(16)}`);
  }
  send(handle, message, wParam = 0, lParam = 0) {
    const window = this.windows.get(handle);
    if (!window) throw new Error('Cannot send a native message to a released window');
    return this.process.callFromHost(window.procedure, [handle, message, wParam, lParam]);
  }
  async create(args, wide) {
    const [extended, className, title, style, x, y, width, height, parent, menu, instance, param] =
        args,
      cls = this.kernel.windowClasses.lookup(className, instance, wide),
      p = this.process;
    if (!cls) return this.error(CLASS_MISSING);
    if (parent && parent !== DESKTOP && !this.windows.has(parent))
      return this.error(INVALID_WINDOW);
    // The original popup menu helper combines WS_POPUP and WS_CHILD. In
    // that case the ninth word still identifies a menu, as on the original host.
    const child = this.isChildWindow({ style });
    if (menu && !child && !this.kernel.windowMenus.menus.has(menu)) return this.error(INVALID_MENU);
    const handle = this.next,
      bounds = [x | 0, y | 0, (x | 0) + (width | 0), (y | 0) + (height | 0)],
      window = {
        atom: cls.atom,
        className: cls.name,
        wide: cls.wide,
        procedure: cls.procedure,
        instance,
        title: title ? p.string(title, wide) : '',
        userData: 0,
        style,
        extended,
        parent,
        menu: child ? 0 : menu,
        controlID: child ? menu : 0,
        extra: new Uint8Array(cls.windowExtra),
        bounds,
      },
      scratch = p.allocate(104, true);
    this.next = handle === 1 ? 3 : handle + 1;
    this.windows.set(handle, window);
    let keep = false;
    try {
      this.setClient(window, this.clientBounds(window));
      [
        param,
        instance,
        menu,
        parent,
        height,
        width,
        y,
        x,
        style,
        title,
        className,
        extended,
      ].forEach((value, i) => p.store(scratch + i * 4, value));
      if (!(style & 0xc0000000)) await this.send(handle, 0x24, 0, scratch + 64);
      if (!(await this.send(handle, 0x81, 0, scratch))) {
        await this.send(handle, 0x82);
        return 0;
      }
      this.writeRect(scratch + 48, bounds);
      await this.send(handle, 0x83, 0, scratch + 48);
      this.setClient(window, this.readRect(scratch + 48));
      if ((await this.send(handle, 1, 0, scratch)) === 0xffffffff) {
        await this.send(handle, 0x82);
        return 0;
      }
      if (style & WS_POPUP) {
        const [left, top, w, h] = window.client;
        await this.send(handle, 5, 0, (w & 0xffff) | (h << 16));
        await this.send(handle, 3, 0, (left & 0xffff) | (top << 16));
      }
      keep = true;
      return handle;
    } finally {
      p.free(scratch);
      if (!keep) this.forget(handle);
    }
  }
  async destroy(handle) {
    const window = this.windows.get(handle);
    if (!window) return this.error(INVALID_WINDOW);
    if (window.destroying) return 1;
    window.destroying = true;
    try {
      await this.send(handle, 2);
      for (const [other, entry] of this.windows)
        if (entry.parent === handle) await this.destroy(other);
      await this.send(handle, 0x82);
      if (window.menu && this.kernel.windowMenus.menus.has(window.menu))
        this.kernel.windowMenus.destroy(window.menu);
      return 1;
    } finally {
      this.forget(handle);
    }
  }
  snapshot() {
    return structuredClone({ windows: this.windows, next: this.next, quit: this.quit });
  }
  restore(state) {
    if (!(state.windows instanceof Map) || !Number.isInteger(state.next) || state.next < 1)
      throw new Error('Invalid native virtual window checkpoint');
    this.windows = structuredClone(state.windows);
    this.next = state.next;
    this.quit = state.quit;
  }
}
