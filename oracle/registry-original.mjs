// SPDX-License-Identifier: MPL-2.0
// Explicit Win32/native wrapper over the existing ordinary HKCU data owner.
import { NativeRegistry as RegistryData, ordinaryRegistry } from '../src/native/registry.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { nativeReply } from '../src/kcs/vm.mjs';
import { registryDecodeANSI } from '../src/native/registry-codepage.mjs';
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
function attachRegistry(registry, engine) {
  Object.assign(registry, { engine, process: engine.process });
  for (const name of ['name', 'setValue', 'queryValue', 'installWindows', 'apply'])
    registry[name] = NativeRegistry.prototype[name];
  return registry;
}
export class NativeRegistry {
  constructor(engine, options) {
    return attachRegistry(new RegistryData(options), engine);
  }
  static async open(engine, options = {}) {
    const registry = options.world
      ? await ordinaryRegistry(options.world)
      : new NativeRegistry(engine, options);
    if (!options.world) await registry.load();
    if (registry.engine && registry.engine !== engine)
      throw new Error('Registry is already attached to another engine');
    attachRegistry(registry, engine);
    registry.installWindows();
    engine.registerFeature('registry', registry);
    return registry;
  }
  name(pointer, wide) {
    if (!pointer) return '';
    if (wide) return this.process.string(pointer, true);
    const bytes = this.process.stringBytes(pointer);
    return registryDecodeANSI(bytes);
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
}
