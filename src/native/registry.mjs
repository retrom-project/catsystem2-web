// SPDX-License-Identifier: MPL-2.0
// The engine's four registry wrappers execute unchanged. Only the browser's
// private HKCU hive and its Win32 byte/handle boundary are supplied here.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { registryDecodeANSI, registryEncodeANSI } from './registry-codepage.mjs';

export const NATIVE_REGISTRY_CONTRACTS = Object.freeze(
  [
    [0xc0, 2, 0x65a880, 0x529270],
    [0xc1, 4, 0x65a9e0, 0x5293a0],
    [0xc2, 3, 0x65ab40, 0x5294d0],
    [0xc3, 3, 0x65aca0, 0x529600],
  ].map(([id, words, game, sdk]) => Object.freeze({ id, words, handlers: [game, sdk] })),
);
const byID = new Map(NATIVE_REGISTRY_CONTRACTS.map((spec) => [spec.id, spec]));
const HKCU = 0x80000001,
  HKLM = 0x80000002,
  strings = new Set([1, 2, 7]);
const fold = (text) => {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const unit = text[i].toUpperCase();
    result += unit.length === 1 ? unit : text[i];
  }
  return result;
};
const wideBytes = (text) => {
  const bytes = new Uint8Array(text.length * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return bytes;
};
const wideText = (bytes) => {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2)
    text += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return text;
};
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (value) => {
  if (typeof value !== 'string' || !/^(?:[\da-f]{2})*$/.test(value))
    throw new Error('Invalid persistent registry bytes');
  return Uint8Array.from(value.match(/../g) ?? [], (part) => parseInt(part, 16));
};

export class NativeRegistry {
  static async open(engine, options = {}) {
    const registry = new NativeRegistry(engine, options);
    await registry.load();
    registry.installWindows();
    engine.registerFeature('registry', registry);
    return registry;
  }
  constructor(engine, { read, write, world } = {}) {
    Object.assign(this, { engine, process: engine.process, read, write, world });
    this.keys = new Map([
      ['', new Map()],
      ['SOFTWARE', new Map()],
    ]);
    this.handles = new Map();
    this.nextHandle = 0x52000000;
    this.dirty = false;
  }
  async load() {
    const bytes = await this.read?.();
    if (bytes != null) {
      if (!(bytes instanceof Uint8Array)) throw new Error('Registry storage must return bytes');
      const state = JSON.parse(new TextDecoder().decode(bytes));
      this.restoreKeys(state.keys, true);
    }
  }
  async flush() {
    if (!this.dirty) return;
    if (this.write) {
      const keys = [...this.keys].map(([path, values]) => [
        path,
        [...values].map(([name, { type, data }]) => [name, type, hex(data)]),
      ]);
      await this.write(new TextEncoder().encode(JSON.stringify({ keys })));
    }
    this.dirty = false;
  }
  key(handle) {
    if (handle === HKCU) return { root: HKCU, path: '', access: 0xf003f };
    if (handle === HKLM) return { root: HKLM, path: '', access: 0x20019 };
    return this.handles.get(handle) ?? null;
  }
  name(pointer, wide) {
    if (!pointer) return '';
    if (wide) return this.process.string(pointer, true);
    const bytes = this.process.stringBytes(pointer);
    return registryDecodeANSI(bytes);
  }
  open(handle, subkey, access, create = false) {
    const parent = this.key(handle);
    if (!parent) return { error: 6 };
    if (subkey.startsWith('\\')) return { error: 161 };
    const parts = subkey.split('\\').filter(Boolean),
      path = fold([parent.path, ...parts].filter(Boolean).join('\\'));
    if (parent.root === HKLM) {
      if (create) return { error: 5 };
      if (path) return { error: 2 };
    }
    // The predefined HKCU empty-name creation reports NEW_KEY even though
    // it opens that root. This is separate from an existing named subkey.
    let created = create && parent.root === HKCU && !path;
    if (parent.root === HKCU && !this.keys.has(path)) {
      if (!create) return { error: 2 };
      let key = '';
      for (const part of path.split('\\')) {
        key = [key, part].filter(Boolean).join('\\');
        if (!this.keys.has(key)) {
          this.keys.set(key, new Map());
          this.dirty = true;
        }
      }
      created = true;
    }
    const result = this.nextHandle++;
    this.handles.set(result, { root: parent.root, path, access });
    return { error: 0, handle: result, created };
  }
  async setValue(handle, name, type, pointer, count, wide) {
    const key = this.key(handle),
      p = this.process;
    if (!key) return 6;
    if (key.root !== HKCU || !(key.access & 2)) return 5;
    if (!pointer && count) return 998;
    let size = count;
    if (size && strings.has(type)) {
      if (wide) {
        const units = Math.floor(size / 2),
          before = p.read(pointer + units * 2 - 2, 2),
          after = p.read(pointer + units * 2, 2);
        if ((before[0] || before[1]) && !after[0] && !after[1]) size += 2;
      } else if (p.read(pointer + size - 1, 1)[0] && !p.read(pointer + size, 1)[0]) size++;
    }
    let data = size ? p.read(pointer, size).slice() : new Uint8Array();
    if (!wide && strings.has(type)) data = wideBytes(registryDecodeANSI(data));
    this.keys.get(key.path).set(fold(name), { type, data });
    this.dirty = true;
    await this.flush();
    return 0;
  }
  queryValue(handle, name, type, data, size, wide) {
    const p = this.process,
      key = this.key(handle);
    if (data && !size) return 87;
    if (!key) return 6;
    const capacity = size ? p.load(size) : 0;
    if (!data && size) p.store(size, 0);
    if (!wide) {
      if (type) p.store(type, 0);
    }
    if (!(key.access & 1)) return 5;
    const value = key.root === HKCU ? this.keys.get(key.path)?.get(fold(name)) : null;
    if (!value) return 2;
    let bytes = value.data;
    if (!wide && strings.has(value.type)) bytes = registryEncodeANSI(wideText(bytes));
    if (type) p.store(type, value.type);
    if (size) p.store(size, bytes.length);
    if (!data) return 0;
    if (capacity < bytes.length) return 234;
    p.write(data, bytes);
    const unit = wide ? 2 : 1;
    if (
      bytes.length &&
      strings.has(value.type) &&
      (wide ? bytes.length <= (capacity - 2) >>> 0 : capacity > bytes.length) &&
      (wide
        ? bytes.length < 2 || bytes[bytes.length - 2] || bytes[bytes.length - 1]
        : bytes[bytes.length - 1])
    )
      p.zero(data + bytes.length, unit);
    return 0;
  }
  installWindows() {
    const p = this.process,
      define = (name, count, fn) =>
        this.engine.registerWindows('ADVAPI32.dll', name, { count, fn });
    for (const [suffix, wide] of [
      ['A', false],
      ['W', true],
    ]) {
      const open = async (root, path, options, access, out, create, disposition = 0) => {
        if (!out || options) return 87;
        const result = this.open(root, this.name(path, wide), access, create);
        if (result.error) {
          p.store(out, 0);
          return result.error;
        }
        p.store(out, result.handle);
        if (disposition) p.store(disposition, result.created ? 1 : 2);
        await this.flush();
        return 0;
      };
      define(`RegOpenKeyEx${suffix}`, 5, ([root, path, options, access, out]) =>
        open(root, path, options, access, out, false),
      );
      define(`RegOpenKey${suffix}`, 3, ([root, path, out]) =>
        open(root, path, 0, 0xf003f, out, false),
      );
      define(
        `RegCreateKeyEx${suffix}`,
        9,
        ([root, path, reserved, , options, access, , out, disp]) =>
          reserved || options ? 87 : open(root, path, 0, access, out, true, disp),
      );
      define(`RegSetValueEx${suffix}`, 6, ([key, name, reserved, type, bytes, size]) =>
        reserved ? 87 : this.setValue(key, this.name(name, wide), type, bytes, size, wide),
      );
      define(`RegQueryValueEx${suffix}`, 6, ([key, name, reserved, type, bytes, size]) =>
        reserved ? 87 : this.queryValue(key, this.name(name, wide), type, bytes, size, wide),
      );
    }
    define('RegCloseKey', 1, ([key]) => {
      if ([HKCU, HKLM].includes(key)) return 0;
      return this.handles.delete(key) ? 0 : 6;
    });
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    const memory =
      this.world?.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      const parameters = [bridge.pointer, 0, argv, out],
        options = { task: task.id },
        address = spec.handlers[Number(this.engine.profile.startsWith('sdk-'))],
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, undefined, options)
          : await this.engine.call(address, parameters, undefined, options);
      if (control !== 1) throw new Error('Original registry wrapper changed its control');
      return nativeReply(control, p.load(out));
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(out);
        p.free(argv);
      }
    }
  }
  snapshot() {
    return {
      keys: structuredClone([...this.keys]),
      handles: [...this.handles],
      nextHandle: this.nextHandle,
    };
  }
  restoreKeys(rows, persistent = false) {
    if (!Array.isArray(rows)) throw new Error('Invalid registry hive');
    const keys = new Map();
    for (const [path, values] of rows) {
      if (typeof path !== 'string' || path !== fold(path) || !Array.isArray(values))
        throw new Error('Invalid registry key');
      const result = new Map();
      for (const row of values) {
        const [name, value] = persistent ? [row[0], { type: row[1], data: unhex(row[2]) }] : row;
        if (
          typeof name !== 'string' ||
          name !== fold(name) ||
          !Number.isInteger(value?.type) ||
          !(value.data instanceof Uint8Array)
        )
          throw new Error('Invalid registry value');
        result.set(name, { type: value.type, data: value.data.slice() });
      }
      keys.set(path, result);
    }
    if (!keys.has('') || !keys.has('SOFTWARE'))
      throw new Error('Registry hive lacks its platform roots');
    this.keys = keys;
  }
  restore(state) {
    this.restoreKeys(state.keys.map(([path, values]) => [path, [...values]]));
    if (!Array.isArray(state.handles) || !Number.isInteger(state.nextHandle))
      throw new Error('Invalid registry handles');
    this.handles = new Map(state.handles);
    this.nextHandle = state.nextHandle;
    this.dirty = false;
  }
  async close() {
    await this.flush();
    this.handles.clear();
  }
}

export function installNativeRegistry(world) {
  world.registerNativeFeature('registry', (engine) => {
    if (!world.storage?.readPlatform || !world.storage?.writePlatform)
      throw new Error('Registry requires persistent browser platform storage');
    return NativeRegistry.open(engine, {
      world,
      read: () => world.storage.readPlatform('windows-hkcu'),
      write: (bytes) => world.storage.writePlatform('windows-hkcu', bytes),
    });
  });
  for (const { id } of NATIVE_REGISTRY_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('registry')).apply(id, args, machine, task),
    );
}
