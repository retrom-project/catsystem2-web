// SPDX-License-Identifier: MPL-2.0
// One browser HKCU hive backs ordinary VM calls and the explicit original
// engine's Win32 byte/handle boundary.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { registryDecodeANSI, registryEncodeANSI } from './registry-codepage.mjs';
import { nativeABI } from './abi/index.mjs';
import { formatNativeAt } from '../kcs.mjs';
import { decodeWindowsCP932 } from '../ppi/windows-multibyte.mjs';
import {
  nativeDataArgument,
  nativeDataCString,
  nativeDataMapped,
  nativeDataString,
} from './data-text.mjs';

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
    const registry = options.world
      ? await ordinaryRegistry(options.world)
      : new NativeRegistry(engine, options);
    if (!options.world) await registry.load();
    if (registry.engine && registry.engine !== engine)
      throw new Error('Registry is already attached to another engine');
    registry.engine = engine;
    registry.process = engine.process;
    registry.installWindows();
    engine.registerFeature('registry', registry);
    return registry;
  }
  constructor(engine, { read, write, world } = {}) {
    Object.assign(this, { engine, process: engine?.process, read, write, world });
    this.keys = new Map([
      ['', new Map()],
      ['SOFTWARE', new Map()],
    ]);
    this.handles = new Map();
    this.nextHandle = 0x52000000;
    this.dirty = false;
    this.pending = new Set();
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
    return this.setBytes(
      handle,
      name,
      type,
      count,
      wide,
      (offset, size) => this.process.read(pointer + offset, size),
      Boolean(pointer),
    );
  }
  async setBytes(handle, name, type, count, wide, read, mapped = true) {
    const key = this.key(handle);
    if (!key) return 6;
    if (key.root !== HKCU || !(key.access & 2)) return 5;
    if (!mapped && count) return 998;
    let size = count;
    if (size && strings.has(type)) {
      if (wide) {
        const units = Math.floor(size / 2),
          before = read(units * 2 - 2, 2),
          after = read(units * 2, 2);
        if ((before[0] || before[1]) && !after[0] && !after[1]) size += 2;
      } else if (read(size - 1, 1)[0] && !read(size, 1)[0]) size++;
    }
    let data = size ? read(0, size).slice() : new Uint8Array();
    if (!wide && strings.has(type)) data = wideBytes(registryDecodeANSI(data));
    this.keys.get(key.path).set(fold(name), { type, data });
    this.dirty = true;
    await this.flush();
    return 0;
  }
  valueBytes(handle, name, wide) {
    const key = this.key(handle);
    if (!key) return { error: 6 };
    if (!(key.access & 1)) return { error: 5 };
    const value = key.root === HKCU ? this.keys.get(key.path)?.get(fold(name)) : null;
    if (!value) return { error: 2 };
    const bytes =
      !wide && strings.has(value.type) ? registryEncodeANSI(wideText(value.data)) : value.data;
    return { error: 0, type: value.type, bytes };
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
    const value = this.valueBytes(handle, name, wide);
    if (value.error) return value.error;
    const bytes = value.bytes;
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
  applyOrdinary(id, args, machine) {
    const pending = this.executeOrdinary(id, args, machine);
    this.pending.add(pending);
    pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
    return pending;
  }
  async executeOrdinary(id, args, machine) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from({ length: spec.words }, (_, i) =>
        nativeDataArgument(args, machine, i),
      ),
      wide = nativeABI(this.world.profile).capabilities.unicodeOutput,
      decode = wide ? decodeWindowsCP932 : registryDecodeANSI,
      format = (address) => decode(nativeDataString(formatNativeAt(address, machine))),
      writing = id === 0xc2 || id === 0xc3,
      opened = this.open(
        HKCU,
        `Software\\${format(words[0])}`,
        writing ? 0x20006 : 0x20019,
        writing,
      );
    if (opened.error) return nativeReply(1, 0);
    try {
      await this.flush();
      const name = format(words[1]);
      if (!writing) {
        const value = this.valueBytes(opened.handle, name, wide);
        if (value.error) return nativeReply(1, 0);
        const { bytes, type } = value;
        if (id === 0xc0) return nativeReply(1, Number(bytes.length <= 4));
        const address = words[2] >>> 0,
          capacity = words[3] >>> 0;
        if (!nativeDataMapped(machine, address)) return nativeReply(1, bytes.length);
        if (capacity < bytes.length) return nativeReply(1, 0);
        machine.bytes(address, bytes.length).set(bytes);
        if (
          bytes.length &&
          strings.has(type) &&
          (wide ? bytes.length <= (capacity - 2) >>> 0 : capacity > bytes.length) &&
          (wide
            ? bytes.length < 2 || bytes[bytes.length - 2] || bytes[bytes.length - 1]
            : bytes[bytes.length - 1])
        )
          machine.bytes((address + bytes.length) >>> 0, wide ? 2 : 1).fill(0);
        return nativeReply(1, bytes.length);
      }
      let result;
      if (id === 0xc2) {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, words[2] >>> 0, true);
        result = await this.setBytes(opened.handle, name, 4, 4, wide, (offset, size) =>
          bytes.subarray(offset, offset + size),
        );
      } else {
        const address = words[2] >>> 0,
          count = nativeDataCString(machine, address).length;
        result = await this.setBytes(opened.handle, name, 1, count, wide, (offset, size) =>
          machine.bytes((address + offset) >>> 0, size),
        );
      }
      return nativeReply(1, Number(result === 0));
    } finally {
      this.handles.delete(opened.handle);
    }
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
    if (this.pending.size) throw new Error('Registry checkpoint requires a settled call');
    return {
      keys: structuredClone([...this.keys]),
      handles: [...this.handles],
      nextHandle: this.nextHandle,
      dirty: this.dirty,
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
    if (typeof state.dirty !== 'boolean') throw new Error('Invalid registry persistence state');
    this.dirty = state.dirty;
  }
  async close() {
    await Promise.allSettled([...this.pending]);
    await this.flush();
    this.handles.clear();
  }
}

export function installNativeRegistry(world) {
  world.platformRegistry = null;
  world.platformRegistryLoading = null;
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
    world.runtime.register('main', id, async (args, machine, task) => {
      if (world.nativeEngine || world.nativeEngineLoading)
        return (await world.getNativeFeature('registry')).apply(id, args, machine, task);
      return (await ordinaryRegistry(world)).applyOrdinary(id, args, machine);
    });
}

function ordinaryRegistry(world) {
  if (world.closed || world.disposalRequested) throw new Error('Registry World is closed');
  if (!world.storage?.readPlatform || !world.storage?.writePlatform)
    throw new Error('Registry requires persistent browser platform storage');
  if (!world.platformRegistryLoading)
    world.platformRegistryLoading = (async () => {
      const registry = new NativeRegistry(null, {
        world,
        read: () => world.storage.readPlatform('windows-hkcu'),
        write: (bytes) => world.storage.writePlatform('windows-hkcu', bytes),
      });
      await registry.load();
      if (world.closed || world.disposalRequested) throw new Error('Registry World is closed');
      world.platformRegistry = registry;
      return registry;
    })().catch((error) => {
      world.platformRegistryLoading = null;
      throw error;
    });
  return world.platformRegistryLoading;
}
export function snapshotNativeRegistry(world) {
  if (world.platformRegistryLoading && !world.platformRegistry)
    throw new Error('Registry checkpoint requires its platform load to settle');
  return world.platformRegistry &&
    world.nativeEngine?.features.get('registry') !== world.platformRegistry
    ? world.platformRegistry.snapshot()
    : null;
}
export async function restoreNativeRegistry(world, state) {
  if (state !== null) (await ordinaryRegistry(world)).restore(state);
}
export async function flushNativeRegistry(world) {
  if (world.platformRegistryLoading) await (await world.platformRegistryLoading).flush();
}
export async function closeNativeRegistry(world) {
  if (!world.platformRegistryLoading) return;
  const registry = await world.platformRegistryLoading;
  if (world.nativeEngine?.features.get('registry') !== registry) await registry.close();
}
