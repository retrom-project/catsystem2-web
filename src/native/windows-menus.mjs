// SPDX-License-Identifier: MPL-2.0
// USER32 standard RT_MENU templates and process-local menu handles.
import { Binary } from '../binary.mjs';

const FIRST_HANDLE = 0x5b000000;
const MENU_MISSING = 1401;
const INVALID_DATA = 13;
const MENU_POPUP = 0x10;
const MENU_END = 0x80;
const MENU_SEPARATOR = 0x800;
const TYPE_FLAGS = 0x4b64;
const STATE_FLAGS = 0x100b;
const unicode = new TextDecoder('utf-16le', { ignoreBOM: true });

export function readNativeMenuTemplate(bytes) {
  const b = new Binary(bytes, 'RT_MENU template');
  if (b.u16(0) !== 0) throw new Error('Unsupported RT_MENU template version');
  let at = 4 + b.u16(2);
  const take = () => {
    const value = b.u16(at);
    at += 2;
    return value;
  };
  function readGroup(depth) {
    if (depth > 64) throw new Error('RT_MENU nesting exceeds 64 levels');
    const entries = [];
    for (;;) {
      const flags = take(),
        popup = Boolean(flags & MENU_POPUP),
        id = popup ? null : take(),
        start = at;
      while (take()) {
        // The compiled resource supplies an inline, NUL-terminated WCHAR string.
      }
      const label = unicode.decode(b.range(start, at - start - 2)),
        type = (flags & TYPE_FLAGS) | (!popup && id === 0 && !label ? MENU_SEPARATOR : 0),
        state = flags & STATE_FLAGS;
      entries.push({ id, label, type, state, children: popup ? readGroup(depth + 1) : null });
      if (flags & MENU_END) return entries;
    }
  }
  const menu = readGroup(0);
  if (b.bytes.subarray(at).some((byte) => byte)) throw new Error('RT_MENU has trailing entries');
  return menu;
}

export class NativeWindowsMenus {
  constructor(kernel) {
    this.kernel = kernel;
    this.menus = new Map();
    this.nextHandle = FIRST_HANDLE;
    const register = (name, count, fn) => kernel.register('USER32.dll', name, { count, fn });
    for (const suffix of ['A', 'W'])
      register('LoadMenu' + suffix, 2, ([instance, name]) => this.load(instance, name, suffix));
    register('DestroyMenu', 1, ([handle]) => this.destroy(handle));
    register('GetMenuItemCount', 1, ([handle]) => {
      const menu = this.menus.get(handle);
      return menu ? menu.length : this.error(MENU_MISSING, -1);
    });
    register('GetSubMenu', 2, ([handle, position]) => {
      const menu = this.menus.get(handle);
      return menu ? (menu[position]?.submenu ?? 0) : this.error(MENU_MISSING);
    });
  }
  error(code, result = 0) {
    this.kernel.lastError = code;
    return result;
  }
  load(instance, name, suffix) {
    const { definitions, process } = this.kernel,
      resource = definitions.get('FindResource' + suffix)?.fn([instance, name, 4]);
    if (!resource) return 0;
    const address = definitions.get('LoadResource').fn([instance, resource]),
      size = definitions.get('SizeofResource').fn([instance, resource]);
    if (!address || !size) return this.error(INVALID_DATA);
    let tree;
    try {
      tree = readNativeMenuTemplate(process.read(address, size));
    } catch {
      return this.error(INVALID_DATA);
    }
    return this.add(tree);
  }
  add(entries) {
    const handle = this.nextHandle++;
    this.menus.set(
      handle,
      entries.map(({ children, ...entry }) => ({
        ...entry,
        submenu: children ? this.add(children) : 0,
      })),
    );
    return handle;
  }
  destroy(handle) {
    const menu = this.menus.get(handle);
    if (!menu) return this.error(MENU_MISSING);
    this.menus.delete(handle);
    for (const { submenu } of menu) if (this.menus.has(submenu)) this.destroy(submenu);
    return 1;
  }
  snapshot() {
    return structuredClone({ menus: this.menus, nextHandle: this.nextHandle });
  }
  restore(state) {
    if (
      !(state.menus instanceof Map) ||
      !Number.isInteger(state.nextHandle) ||
      state.nextHandle < FIRST_HANDLE
    )
      throw new Error('Invalid native menu checkpoint');
    this.menus = structuredClone(state.menus);
    this.nextHandle = state.nextHandle;
  }
}
