// SPDX-License-Identifier: MPL-2.0
// The resource uses eight-byte records; x86 ACCEL structures use six.
import { Binary } from '../binary.mjs';

const FIRST_HANDLE = 0x5c000000;
const INVALID_ACCELERATOR = 1403;
const INVALID_PARAMETER = 87;
const INVALID_WINDOW = 1400;
const VIRTUAL_KEY = 1;
const ALT = 0x10;
const MODIFIERS = 0x1c;
const WS_DISABLED = 0x08000000;
const WS_MINIMIZE = 0x20000000;

export class NativeWindowsAccelerators {
  constructor(kernel) {
    this.kernel = kernel;
    this.tables = new Map();
    this.nextHandle = FIRST_HANDLE;
    const register = (name, count, fn) => kernel.register('USER32.dll', name, { count, fn });
    for (const suffix of ['A', 'W']) {
      register('LoadAccelerators' + suffix, 2, ([instance, name]) =>
        this.load(instance, name, suffix),
      );
      register('CopyAcceleratorTable' + suffix, 3, ([handle, out, count]) =>
        this.copy(handle, out, count | 0),
      );
      register('CreateAcceleratorTable' + suffix, 2, ([entries, count]) =>
        this.create(entries, count | 0),
      );
      register('TranslateAccelerator' + suffix, 3, ([window, table, message]) =>
        this.translate(window, table, message),
      );
    }
    register('DestroyAcceleratorTable', 1, ([handle]) => this.destroy(handle));
  }
  error(code) {
    this.kernel.lastError = code;
    return 0;
  }
  add(rows, resource = 0) {
    const handle = this.nextHandle++;
    this.tables.set(handle, { rows, resource, references: 1 });
    return handle;
  }
  load(instance, name, suffix) {
    const { definitions, process } = this.kernel,
      resource = definitions.get('FindResource' + suffix)?.fn([instance, name, 9]);
    if (!resource) return 0;
    for (const [handle, table] of this.tables)
      if (table.resource === resource) {
        table.references++;
        return handle;
      }
    const address = definitions.get('LoadResource').fn([instance, resource]),
      size = definitions.get('SizeofResource').fn([instance, resource]);
    if (!address || !size || size % 8) return this.error(13);
    const b = new Binary(process.read(address, size), 'RT_ACCELERATOR'),
      rows = [];
    for (let at = 0; at < size; at += 8) {
      const flags = b.u16(at);
      if (Boolean(flags & 0x80) !== (at + 8 === size)) return this.error(13);
      rows.push([flags & 0x1f, b.u16(at + 2), b.u16(at + 4)]);
    }
    return this.add(rows, resource);
  }
  create(entries, count) {
    if (!entries || count < 1 || count > 32767) return this.error(INVALID_PARAMETER);
    const b = new Binary(this.kernel.process.read(entries, count * 6), 'ACCEL array'),
      rows = [];
    for (let at = 0; at < b.bytes.length; at += 6)
      rows.push([b.u8(at) & 0x1f, b.u16(at + 2), b.u16(at + 4)]);
    return this.add(rows);
  }
  copy(handle, out, count) {
    const table = this.tables.get(handle);
    if (!table) return this.error(INVALID_ACCELERATOR);
    if (!out) return table.rows.length;
    if (count <= 0) return 0;
    const n = Math.min(count, table.rows.length),
      bytes = this.kernel.process.read(out, n * 6),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) {
      const [flags, key, command] = table.rows[i];
      // CopyAcceleratorTable writes each field and leaves the padding byte intact.
      bytes[i * 6] = flags;
      view.setUint16(i * 6 + 2, key, true);
      view.setUint16(i * 6 + 4, command, true);
    }
    this.kernel.process.write(out, bytes);
    return n;
  }
  destroy(handle) {
    const table = this.tables.get(handle);
    if (!table) return this.error(INVALID_ACCELERATOR);
    if (--table.references) return 0;
    this.tables.delete(handle);
    return 1;
  }
  match(handle, message, key, data, modifiers = this.readModifiers?.() ?? 0) {
    const rows = this.tables.get(handle)?.rows;
    if (!rows) return null;
    const character = message === 0x102 || message === 0x106;
    if (!character && message !== 0x100 && message !== 0x104) return null;
    for (const [flags, code, command] of rows) {
      if (code !== key) continue;
      if (flags & VIRTUAL_KEY) {
        if (!character && (flags & MODIFIERS) === (modifiers & MODIFIERS)) return command;
      } else if (
        character
          ? (flags & ALT) === (modifiers & ALT)
          : flags & ALT && (data & 0x21000000) === 0x20000000
      )
        return command;
    }
    return null;
  }
  async translate(target, table, at) {
    if (!target || !at || !this.tables.has(table)) return 0;
    const p = this.kernel.process,
      command = this.match(table, p.load(at + 4), p.load(at + 8), p.load(at + 12));
    if (command === null) return 0;
    await this.dispatch(target, command);
    return 1;
  }
  async dispatch(target, command, notify) {
    const { windowViews, windowMenus } = this.kernel,
      window = windowViews.windows.get(target);
    if (!window) return this.error(INVALID_WINDOW);
    const send = notify ?? ((message, w, l) => windowViews.send(target, message, w, l)),
      menu = window.menu,
      match = windowMenus.commandLocation(menu, command);
    if (match) {
      this.kernel.lastError = 0;
      if (window.style & WS_DISABLED) return 0;
      await send(0x116, menu, 0);
      if (match.popupPosition !== null) await send(0x117, match.handle, match.popupPosition);
      const current = windowMenus.commandLocation(window.menu, command);
      if (
        !windowViews.windows.has(target) ||
        window.style & (WS_DISABLED | WS_MINIMIZE) ||
        this.readCapture?.() ||
        current?.entry.state & 3
      )
        return 0;
    }
    await send(0x111, 0x10000 | command, 0);
    return 1;
  }
  snapshot() {
    return structuredClone({ tables: this.tables, nextHandle: this.nextHandle });
  }
  restore(state) {
    if (
      !(state.tables instanceof Map) ||
      !Number.isInteger(state.nextHandle) ||
      state.nextHandle < FIRST_HANDLE
    )
      throw new Error('Invalid native accelerator checkpoint');
    this.tables = structuredClone(state.tables);
    this.nextHandle = state.nextHandle;
  }
}
