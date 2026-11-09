// SPDX-License-Identifier: MPL-2.0
// A browser window supplies the Win32 boundaries of the original kcInput
// constructor. The returned pointer is its real object, with original key and
// gesture code, rather than a task prefix or an opaque JS handle.
import { nativeSystemMetric } from './engine-desktop.mjs';
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    construct: 0x70f560,
    fromWindow: 0x70e740,
    destruct: 0x70f740,
    windowEvent: 0x710f30,
    poll: 0x70fbb0,
    finish: 0x70f7f0,
    commit: 0x70fee0,
    clear: 0x70f780,
    touchReset: 0x70fe90,
    touchEnable: 0x70fbe0,
    wheelCancel: 0x70f820,
    joypad: 0x70fbd0,
    query: 0x70fc60,
    keyboard: 0x70f930,
    mouse: 0x70fa30,
    joy: 0x70f830,
  },
  'sdk-4.01-engine-2.6.1.74': {
    construct: 0x5c0830,
    fromWindow: 0x5bfab0,
    destruct: 0x5c09d0,
    windowEvent: 0x5c24e0,
    poll: 0x5c0e40,
    finish: 0x5c0a80,
    commit: 0x5c1170,
    clear: 0x5c0a10,
    touchReset: 0x5c1120,
    touchEnable: 0x5c0e70,
    wheelCancel: 0x5c0ab0,
    joypad: 0x5c0e60,
    query: 0x5c0ef0,
    keyboard: 0x5c0bc0,
    mouse: 0x5c0cc0,
    joy: 0x5c0ac0,
  },
};
const emptyInput = () => ({ pointer: 0, window: 0, userData: 0, windowOwner: 0, ready: false });
const categories = [
  ['keyboard', 4, 24],
  ['touch', 8, 40],
  ['joypad', 12, 56],
  ['mouse', 16, 72],
];

export class NativeInputDevice {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.process = engine.process;
    this.layout = layouts[engine.profile];
    if (!this.layout) throw new Error('Unrecovered input-device profile');
    this.handles = new Map();
    this.nextHandle = 0x62000000;
    this.capture = 0;
    this.visibility = 0;
    this.foreground = null;
    this.installWindows();
    engine.registerFeature('input-device', this);
  }
  get refs() {
    return (this.engine.refs.inputDevice ??= emptyInput());
  }
  get bindings() {
    return this.world.inputBindings;
  }
  get input() {
    return this.world.input;
  }
  async call(address, args = [], pointer) {
    return this.process.awaitingHost
      ? this.engine.callFromHost(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  readPointer() {
    return { x: this.input.x | 0, y: this.input.y | 0 };
  }
  size() {
    return (
      this.world.graphics?.view?.virtualSize() ?? [this.world.game.width, this.world.game.height]
    );
  }
  focused() {
    return (
      this.world.host.nativeWindowFocused?.() ??
      (typeof document === 'undefined' || document.hasFocus())
    );
  }
  installWindows() {
    const e = this.engine,
      p = this.process;
    e.kernel.accelerators.readModifiers = () => {
      const keys = this.bindings?.down.keyboard;
      return (keys?.has(16) ? 4 : 0) | (keys?.has(17) ? 8 : 0) | (keys?.has(18) ? 16 : 0);
    };
    e.kernel.accelerators.readCapture = () => this.capture;
    const add = (dll, name, count, fn) => {
      if (!e.kernel.overrides.has(`${dll.toLowerCase()}!${name}`))
        e.registerWindows(dll, name, { count, fn });
    };
    add('USER32.dll', 'GetCursorPos', 1, ([out]) => {
      const { x, y } = this.readPointer();
      p.store(out, x);
      p.store(out + 4, y);
      return 1;
    });
    add('USER32.dll', 'SetCursorPos', 2, ([x, y]) => {
      this.input.pointer(x, y);
      this.world.host.nativePointerWarped?.(x | 0, y | 0);
      return 1;
    });
    add('USER32.dll', 'GetForegroundWindow', 0, () => (this.focused() ? 1 : 0));
    add('USER32.dll', 'GetClientRect', 2, ([window, out]) => {
      if (window !== 1) return 0;
      const [w, h] = this.size();
      [0, 0, w, h].forEach((v, i) => p.store(out + i * 4, v));
      return 1;
    });
    for (const name of ['ClientToScreen', 'ScreenToClient'])
      add('USER32.dll', name, 2, ([window]) => Number(window === 1));
    add('USER32.dll', 'SetRectEmpty', 1, ([out]) => {
      p.zero(out, 16);
      return 1;
    });
    add('USER32.dll', 'UnionRect', 3, ([out, first, second]) => {
      const read = (at) => Array.from({ length: 4 }, (_, i) => p.load(at + i * 4) | 0),
        a = read(first),
        b = read(second),
        empty = (r) => r[0] >= r[2] || r[1] >= r[3],
        aEmpty = empty(a),
        bEmpty = empty(b),
        result = aEmpty
          ? bEmpty
            ? [0, 0, 0, 0]
            : b
          : bEmpty
            ? a
            : [
                Math.min(a[0], b[0]),
                Math.min(a[1], b[1]),
                Math.max(a[2], b[2]),
                Math.max(a[3], b[3]),
              ];
      result.forEach((v, i) => p.store(out + i * 4, v));
      return Number(!aEmpty || !bEmpty);
    });
    add('USER32.dll', 'IsRectEmpty', 1, ([a]) =>
      Number((p.load(a) | 0) >= (p.load(a + 8) | 0) || (p.load(a + 4) | 0) >= (p.load(a + 12) | 0)),
    );
    add('USER32.dll', 'PtInRect', 3, ([a, x, y]) =>
      Number(
        (x | 0) >= (p.load(a) | 0) &&
          (x | 0) < (p.load(a + 8) | 0) &&
          (y | 0) >= (p.load(a + 4) | 0) &&
          (y | 0) < (p.load(a + 12) | 0),
      ),
    );
    add('USER32.dll', 'WindowFromPoint', 2, ([x, y]) => {
      const [w, h] = this.size();
      return (x | 0) >= 0 && (y | 0) >= 0 && (x | 0) < w && (y | 0) < h ? 1 : 0;
    });
    add('USER32.dll', 'IsChild', 2, () => 0);
    add('USER32.dll', 'SetCapture', 1, ([window]) => {
      const old = this.capture;
      this.capture = window;
      return old;
    });
    add('USER32.dll', 'ReleaseCapture', 0, () => {
      this.capture = 0;
      return 1;
    });
    add('USER32.dll', 'ShowCursor', 1, ([visible]) => {
      this.visibility += visible ? 1 : -1;
      return this.visibility;
    });
    e.kernel.windowViews.fallbackLong = (window, index) => {
      if (window !== 1) return undefined;
      if (index === -21) return this.refs.userData;
      if (index === -6) return e.module.base;
      throw new Error(`Input window field ${index} has no host contract`);
    };
    for (const suffix of ['A', 'W']) {
      add('USER32.dll', `FindWindow${suffix}`, 2, () => 0);
      add('USER32.dll', `RegisterWindowMessage${suffix}`, 1, ([name]) => {
        const key = p.string(name, suffix === 'W');
        if (!this.handles.has(key)) this.handles.set(key, 0xc000 + this.handles.size);
        return this.handles.get(key);
      });
    }
    add('USER32.dll', 'GetSystemMetrics', 1, ([index]) =>
      nativeSystemMetric(
        index,
        () => this.size(),
        () => this.world.host.nativeTouchPoints?.(),
      ),
    );
    const pad = () =>
      this.world.host.nativeGamepad?.() ??
      Array.from(globalThis.navigator?.getGamepads?.() ?? []).find((pad) => pad?.connected);
    add('WINMM.dll', 'joyGetNumDevs', 0, () => Number(!!pad()));
    add('WINMM.dll', 'joyReleaseCapture', 1, () => 0);
    add('WINMM.dll', 'joySetCapture', 4, ([window, id]) =>
      window === 1 && id === 0 && pad() ? 0 : 167,
    );
    for (const suffix of ['A', 'W'])
      add('WINMM.dll', `joyGetDevCaps${suffix}`, 3, ([id, out, size]) => {
        const current = pad();
        if (id !== 0 || !current) return 167;
        const minimum = suffix === 'W' ? 728 : 404,
          base = suffix === 'W' ? 68 : 36;
        if (size < minimum) return 165;
        p.zero(out, minimum);
        for (const offset of [4, 12, 20]) p.store(out + base + offset, 65535);
        p.store(out + base + 24, Math.min(32, current.buttons.length));
        p.store(out + base + 28, 1);
        p.store(out + base + 32, 1000);
        return 0;
      });
    add('WINMM.dll', 'joyGetPosEx', 2, ([id, out]) => {
      const current = pad();
      if (id !== 0 || !current) return 167;
      if (p.load(out) !== 52) return 165;
      const axis = (index) =>
        Math.round((Math.max(-1, Math.min(1, current.axes[index] ?? 0)) + 1) * 32767.5);
      p.store(out + 8, axis(0));
      p.store(out + 12, axis(1));
      let buttons = 0;
      for (let i = 0; i < Math.min(32, current.buttons.length); i++)
        if (current.buttons[i]?.pressed) buttons |= 1 << i;
      p.store(out + 32, buttons);
      p.store(out + 36, 0);
      p.store(out + 40, 0xffff);
      return 0;
    });
    const touchDefinitions = {
      RegisterTouchWindow: { count: 2, fn: () => 1 },
      GetTouchInputInfo: {
        count: 4,
        fn: ([handle, count, out, size]) => {
          const source = this.handles.get(handle);
          if (!(source instanceof Uint8Array) || size !== 40 || source.length < count * size)
            return 0;
          p.write(out, source.subarray(0, count * size));
          return 1;
        },
      },
      CloseTouchInputHandle: { count: 1, fn: ([handle]) => Number(this.handles.delete(handle)) },
    };
    const touchExports = new Map();
    for (const [name, definition] of Object.entries(touchDefinitions)) {
      add('USER32.dll', name, definition.count, definition.fn);
      touchExports.set(name, e.resolve({ dll: 'USER32.dll', name }));
    }
    // Both original constructors resolve these through the shared DLL loader.
    e.kernel.registerHostModule('user32.dll', touchExports);
    for (const suffix of ['A', 'W'])
      add('USER32.dll', `PostMessage${suffix}`, 4, ([window, message, w, l]) => {
        if (window !== 1) return 0;
        if (!this.world.windowMessages)
          throw new Error(`Native input window message ${message} has no dispatcher`);
        this.world.windowMessages.push({ message, wParam: w, lParam: l });
        return 1;
      });
  }
  async pointer() {
    if (this.refs.ready) return this.refs.pointer;
    const p = this.process,
      window = this.engine.kernel.windowViews.windows.get(1),
      owner = window && p.load(NATIVE_STARTUP_BLOCKS[this.engine.profile]);
    if (owner && (window.userData !== owner || p.load(owner + 8)))
      throw new Error('Original window already owns a different input device');
    try {
      if (owner) {
        this.refs.pointer = await this.call(this.layout.fromWindow, [], owner);
        this.refs.windowOwner = this.refs.userData = owner;
        if (!this.refs.pointer || p.load(owner + 8) !== this.refs.pointer)
          throw new Error('Original window did not retain its input device');
      } else {
        this.refs.pointer = p.allocate(18636, true);
        this.refs.userData = p.allocate(12, true);
        p.store(this.refs.userData + 8, this.refs.pointer);
        await this.call(this.layout.construct, [1, 0], this.refs.pointer);
      }
      this.refs.window = p.load(this.refs.pointer + 8);
      this.refs.ready = true;
      if (this.bindings) {
        this.bindings.nativeMode = true;
        for (const code of this.bindings.down.keyboard)
          p.write(this.refs.window + 1040 + code, Uint8Array.of(1));
        for (const code of this.bindings.down.mouse) p.store(this.refs.window + 16 + code * 4, 1);
      }
      this.push();
      return this.refs.pointer;
    } catch (error) {
      if (owner) {
        const pointer = p.load(owner + 8);
        if (pointer)
          try {
            Object.assign(this.refs, { pointer, userData: owner, windowOwner: owner, ready: true });
            await this.close();
          } catch (cleanup) {
            error.cleanup = cleanup;
          }
      } else {
        p.free(this.refs.pointer);
        p.free(this.refs.userData);
      }
      Object.assign(this.refs, emptyInput());
      throw error;
    }
  }
  push() {
    if (!this.refs.ready || !this.bindings) return;
    const p = this.process,
      b = this.bindings,
      base = this.refs.pointer;
    p.store(base + 780, Number(b.pointerActivation));
    for (let i = 0; i < 80; i++) {
      const row = this.world.configuration.keys.rows[i],
        at = i * 108;
      for (const offset of [784, 9424]) {
        p.store(base + offset + at, row.enabled);
        p.store(base + offset + at + 20, b.repeat[i]);
        for (const [name, map, repeat] of categories) {
          p.write(base + offset + at + map, row[name]);
          for (let slot = 0; slot < 4; slot++)
            p.store(base + offset + at + repeat + slot * 4, row[`rep_${name}`][slot]);
        }
        for (let slot = 0; slot < 4; slot++)
          p.store(
            base + offset + at + 88 + slot * 4,
            (offset === 784 ? b.sampled : b.live)[i * 4 + slot],
          );
        p.store(base + offset + at + 104, b.injected[i]);
      }
    }
    if (this.refs.window) {
      p.write(this.refs.window + 1576, new Uint8Array(b.mouseState.buffer));
      p.store(this.refs.window + 4, b.inside);
    }
  }
  pull() {
    if (!this.refs.ready || !this.bindings) return;
    const p = this.process,
      b = this.bindings,
      base = this.refs.pointer;
    b.pointerActivation = !!p.load(base + 780);
    for (let i = 0; i < 80; i++) {
      b.repeat[i] = p.load(base + 804 + i * 108);
      b.injected[i] = p.load(base + 888 + i * 108);
      for (let slot = 0; slot < 4; slot++) {
        b.sampled[i * 4 + slot] = p.load(base + 872 + i * 108 + slot * 4);
        b.live[i * 4 + slot] = p.load(base + 9512 + i * 108 + slot * 4);
      }
    }
    if (this.refs.window) {
      b.mouseState.set(new Uint32Array(p.read(this.refs.window + 1576, 32).buffer));
      b.inside = p.load(this.refs.window + 4);
    }
    b.sync();
  }
  beforeCall() {
    this.push();
  }
  afterCall() {
    this.pull();
  }
  async event(message, w = 0, l = 0) {
    await this.pointer();
    return this.call(this.layout.windowEvent, [this.refs.window, 1, message, w, l, 0]);
  }
  async poll() {
    if (!this.refs.ready) return;
    const foreground = this.focused();
    if (foreground !== this.foreground) {
      await this.event(6, Number(foreground), 0);
      this.foreground = foreground;
    }
    const b = this.bindings;
    if (b)
      while (b.nativeEvents.length) {
        const event = b.nativeEvents.shift(),
          { category, code, down } = event;
        if (category === 'reset') await this.control('clear');
        else if (category === 'keyboard') await this.event(down ? 0x100 : 0x101, code, 0);
        else if (category === 'mouse') {
          const pair = {
            1: [0x201, 0x202],
            2: [0x207, 0x208],
            3: [0x204, 0x205],
            4: [0x20b, 0x20c],
            5: [0x20b, 0x20c],
          }[code];
          if (!pair) throw new Error('Unknown native mouse button');
          await this.event(
            pair[down ? 0 : 1],
            code === 4 ? 32 << 16 : code === 5 ? 64 << 16 : 0,
            0,
          );
        } else if (category === 'wheel')
          await this.event(0x20a, (code === 6 ? 120 : -120) << 16, 0);
        else if (category === 'joypad')
          await this.call(this.layout.joy, [code, Number(down)], this.refs.pointer);
        else if (category === 'touch')
          await this.call(this.layout.mouse, [code, Number(down), 8], this.refs.pointer);
        else throw new Error('Unknown native input event source');
        if (b.down[category]) {
          if (down) b.down[category].add(code);
          else b.down[category].delete(code);
        }
      }
    await this.call(this.layout.poll, [], this.refs.pointer);
  }
  async finishFrame() {
    if (this.refs.ready) {
      await this.call(this.layout.finish, [], this.refs.pointer);
      await this.call(this.layout.commit, [], this.refs.pointer);
    }
  }
  async control(name, value) {
    if (!['clear', 'touchReset', 'touchEnable', 'wheelCancel', 'joypad'].includes(name))
      throw new Error('Unknown native input-device control');
    await this.pointer();
    return this.call(
      this.layout[name],
      ['touchEnable', 'joypad'].includes(name) ? [value] : [],
      this.refs.pointer,
    );
  }
  async touch(contacts) {
    if (!Array.isArray(contacts) || contacts.length > 65535)
      throw new RangeError('Invalid native touch contact batch');
    await this.pointer();
    const bytes = new Uint8Array(contacts.length * 40),
      view = new DataView(bytes.buffer);
    contacts.forEach((contact, index) => {
      const flags = { down: 2, move: 1, up: 4 }[contact.phase];
      if (!flags) throw new Error('Unknown native touch phase');
      const at = index * 40;
      view.setInt32(at, Math.trunc(contact.x * 100), true);
      view.setInt32(at + 4, Math.trunc(contact.y * 100), true);
      view.setUint32(at + 12, contact.id >>> 0, true);
      view.setUint32(at + 16, flags, true);
    });
    const handle = this.nextHandle++;
    this.handles.set(handle, bytes);
    try {
      return await this.event(0x240, contacts.length, handle);
    } finally {
      this.handles.delete(handle);
    }
  }
  async close() {
    if (!this.refs.ready) return;
    const { pointer, userData, windowOwner } = this.refs,
      p = this.process;
    this.refs.ready = false;
    if (windowOwner) {
      const actual = p.load(windowOwner + 8);
      if (!actual && !p.allocations.has(pointer)) {
        // An original WM_DESTROY can already have released the device.
        Object.assign(this.refs, emptyInput());
        return;
      }
      if (actual !== pointer) throw new Error('Original input owner changed before release');
      p.store(windowOwner + 8, 0);
    }
    await this.call(this.layout.destruct, [], pointer);
    if (!p.free(pointer) || (!windowOwner && !p.free(userData)))
      throw new Error('Original input allocation could not be released');
    Object.assign(this.refs, emptyInput());
  }
  snapshot() {
    return {
      refs: { ...this.refs },
      handles: [...this.handles],
      nextHandle: this.nextHandle,
      capture: this.capture,
      visibility: this.visibility,
      foreground: this.foreground,
    };
  }
  restore(state) {
    this.engine.refs.inputDevice = { ...state.refs };
    this.handles = new Map(state.handles);
    this.nextHandle = state.nextHandle;
    this.capture = state.capture;
    this.visibility = state.visibility;
    this.foreground = state.foreground;
  }
}
