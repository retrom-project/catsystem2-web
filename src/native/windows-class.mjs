// SPDX-License-Identifier: MPL-2.0
// Per-process class atoms and shared UI resources for the virtual desktop.
const FIRST_ATOM = 0xc000;
const FIRST_ASSET = 0x5a000000;
const INVALID_PARAMETER = 87;
const CLASS_EXISTS = 1410;
const CLASS_MISSING = 1411;

export class NativeWindowsClasses {
  constructor(kernel) {
    this.kernel = kernel;
    this.process = kernel.process;
    this.classes = new Map();
    this.assets = new Map();
    this.nextAtom = FIRST_ATOM;
    this.nextAsset = FIRST_ASSET;
    const register = (name, count, fn) => kernel.register('USER32.dll', name, { count, fn });
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W';
      register('RegisterClassEx' + suffix, 1, ([at]) => this.add(at, wide));
      register('UnregisterClass' + suffix, 2, ([name, instance]) => {
        const entry = this.lookup(name, instance, wide);
        if (!entry) return this.error(CLASS_MISSING);
        this.classes.delete(entry.atom);
        return 1;
      });
      for (const [kind, type] of [
        ['Icon', 14],
        ['Cursor', 12],
      ])
        register('Load' + kind + suffix, 2, ([instance, name]) => {
          if (!instance) {
            if (name !== 0x7f00) return this.error(INVALID_PARAMETER);
            return this.asset({ kind, instance, resource: name });
          }
          const find = kernel.definitions.get('FindResource' + suffix),
            load = kernel.definitions.get('LoadResource'),
            entry = find.fn([instance, name, type]),
            resource = entry && load.fn([instance, entry]);
          return resource ? this.asset({ kind, instance, resource }) : 0;
        });
    }
    kernel.register('GDI32.dll', 'GetStockObject', {
      count: 1,
      fn: ([index]) => {
        const colors = [0xffffff, 0xc0c0c0, 0x808080, 0x404040, 0, null];
        if (index >= colors.length) throw new Error(`Unsupported stock GDI object ${index}`);
        return this.asset({ kind: 'Brush', instance: 0, resource: index, color: colors[index] });
      },
    });
  }
  error(code) {
    this.kernel.lastError = code;
    return 0;
  }
  asset(record) {
    for (const [handle, asset] of this.assets)
      if (
        asset.kind === record.kind &&
        asset.instance === record.instance &&
        asset.resource === record.resource
      )
        return handle;
    const handle = this.nextAsset++;
    this.assets.set(handle, record);
    return handle;
  }
  lookup(pointer, instance, wide) {
    if (!pointer) return null;
    if (pointer < 0x10000) {
      const entry = this.classes.get(pointer);
      return entry?.instance === instance ? entry : null;
    }
    return this.find(this.process.string(pointer, wide), instance);
  }
  find(name, instance) {
    const key = name.toLowerCase();
    for (const entry of this.classes.values())
      if (entry.instance === instance && entry.name.toLowerCase() === key) return entry;
    return null;
  }
  add(at, wide) {
    const p = this.process;
    if (!at || p.load(at) !== 48) return this.error(INVALID_PARAMETER);
    const procedure = p.load(at + 8),
      instance = p.load(at + 20),
      namePointer = p.load(at + 40),
      menu = p.load(at + 36);
    if (!procedure || namePointer < 0x10000) return this.error(INVALID_PARAMETER);
    const name = p.string(namePointer, wide);
    if (!name || name.length > 256) return this.error(INVALID_PARAMETER);
    if (this.find(name, instance)) return this.error(CLASS_EXISTS);
    if (this.nextAtom >= 0x10000) return this.error(8);
    const atom = this.nextAtom++;
    this.classes.set(atom, {
      atom,
      name,
      wide,
      instance,
      procedure,
      style: p.load(at + 4),
      classExtra: p.load(at + 12),
      windowExtra: p.load(at + 16),
      icon: p.load(at + 24),
      cursor: p.load(at + 28),
      brush: p.load(at + 32),
      menu: menu < 0x10000 ? menu : p.string(menu, wide),
      smallIcon: p.load(at + 44),
    });
    return atom;
  }
  snapshot() {
    return structuredClone({
      classes: this.classes,
      assets: this.assets,
      nextAtom: this.nextAtom,
      nextAsset: this.nextAsset,
    });
  }
  restore(state) {
    if (
      !(state.classes instanceof Map) ||
      !(state.assets instanceof Map) ||
      !Number.isInteger(state.nextAtom) ||
      state.nextAtom < FIRST_ATOM ||
      state.nextAtom > 0x10000 ||
      !Number.isInteger(state.nextAsset) ||
      state.nextAsset < FIRST_ASSET
    )
      throw new Error('Invalid native window class checkpoint');
    this.classes = structuredClone(state.classes);
    this.assets = structuredClone(state.assets);
    this.nextAtom = state.nextAtom;
    this.nextAsset = state.nextAsset;
  }
}
