// SPDX-License-Identifier: MPL-2.0
// USER32 standard RT_MENU templates and process-local menu handles.
import { Binary } from '../binary.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const FIRST_HANDLE = 0x5b000000;
const MENU_MISSING = 1401;
const ITEM_MISSING = 1456;
const INVALID_PARAMETER = 87;
const MIIM_STRING = 0x40;
const ITEM_WORDS = [
  [0x100, 8, 'type'],
  [0x001, 12, 'state'],
  [0x002, 16, 'id'],
  [0x004, 20, 'submenu'],
];
const INVALID_DATA = 13;
const MENU_POPUP = 0x10;
const MENU_END = 0x80;
const MENU_SEPARATOR = 0x800;
const TYPE_FLAGS = 0x6b64;
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
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W';
      register('LoadMenu' + suffix, 2, ([instance, name]) => this.load(instance, name, suffix));
      register('GetMenuItemInfo' + suffix, 4, (args) => this.itemInfo(args, wide, false));
      register('SetMenuItemInfo' + suffix, 4, (args) => this.itemInfo(args, wide, true));
    }
    register('DestroyMenu', 1, ([handle]) => this.destroy(handle));
    register('DeleteMenu', 3, ([handle, item, flags]) => this.remove(handle, item, flags));
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
  locate(menu, id, byPosition) {
    if (byPosition) return id < menu.length ? [menu, id] : null;
    for (let index = 0; index < menu.length; index++) {
      const entry = menu[index];
      if ((entry.id ?? entry.submenu) === id) return [menu, index];
      const child = this.menus.get(entry.submenu);
      if (child) {
        const match = this.locate(child, id, false);
        if (match) return match;
      }
    }
    return null;
  }
  remove(handle, item, flags) {
    const menu = this.menus.get(handle);
    if (!menu) return this.error(MENU_MISSING);
    const location = this.locate(menu, item, flags & 0x400);
    if (!location) return this.error(ITEM_MISSING);
    const [items, index] = location,
      [{ submenu }] = items.splice(index, 1);
    if (this.menus.has(submenu)) this.destroy(submenu);
    return 1;
  }
  itemInfo([handle, item, byPosition, at], wide, write) {
    const p = this.kernel.process,
      menu = this.menus.get(handle);
    if (!menu) return this.error(MENU_MISSING);
    if (!at || ![44, 48].includes(p.load(at))) return this.error(INVALID_PARAMETER);
    const location = this.locate(menu, item, byPosition);
    if (!location) return this.error(ITEM_MISSING);
    const [items, index] = location,
      entry = items[index],
      mask = p.load(at + 4),
      supported = write ? MIIM_STRING : 0x147;
    if (mask & ~supported)
      throw new Error(`Unsupported native menu item information mask 0x${mask.toString(16)}`);
    if (!write)
      for (const [field, offset, key] of ITEM_WORDS)
        if (mask & field) p.store(at + offset, entry[key] ?? entry.submenu);
    if (mask & MIIM_STRING) {
      const pointer = p.load(at + 36);
      if (write) entry.label = pointer ? p.string(pointer, wide) : '';
      else this.readLabel(entry, at, pointer, wide);
    }
    return 1;
  }
  readLabel(entry, at, pointer, wide) {
    const p = this.kernel.process,
      label = entry.type & (MENU_SEPARATOR | 0x104) ? '' : entry.label,
      capacity = p.load(at + 40),
      encoded = wide ? null : encodeCP932(label),
      length = wide ? label.length : encoded.length;
    let written = length;
    if (pointer && capacity) {
      written = Math.min(length, capacity - 1);
      if (wide) this.kernel.writeString(pointer, label.slice(0, written), true);
      else if (encoded.length < capacity) {
        p.write(pointer, encoded);
        p.write(pointer + encoded.length, Uint8Array.of(0));
      } else {
        // The ANSI API's short-buffer conversion can fill the supplied buffer.
        // Its count still excludes the slot reserved for the terminator.
        p.write(pointer, encoded.subarray(0, capacity));
      }
    }
    p.store(at + 40, written);
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
