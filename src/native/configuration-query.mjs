// SPDX-License-Identifier: MPL-2.0
// Original Settings queries use the same configuration and archive declarations
// as the host. Their guest records are projections, not another settings model.
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { syncNativeStartupSoundConfiguration } from './engine-startup-sound.mjs';

export const NATIVE_CONFIGURATION_QUERY_CONTRACTS = Object.freeze(
  [
    [0x24d, 2, 2, 0x650480, 0x51bac0],
    [0x25d, 1, 1, 0x647990, 0x514cc0],
    [0x25e, 1, 1, 0x647950, 0x514c80],
    [0x25f, 1, 1, 0x647910, 0x514c40],
    [0x2a2, 2, 1, 0x650130, 0x51b780],
    [0x34c, 1, 1, 0x647b00, 0x514e10],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
export const NATIVE_CONFIGURATION_QUERY_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    archive: 5012,
    soundLoaded: 163260,
    soundParts: 163296,
    soundMaster: 163308,
    query24D: 51356,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    archive: 3192,
    soundLoaded: 135236,
    soundParts: 135272,
    soundMaster: 135284,
    query24D: 48172,
  }),
});
const byID = new Map(NATIVE_CONFIGURATION_QUERY_CONTRACTS.map((spec) => [spec.id, spec]));
const defaults = ['volume', 'play', 'sysplay', 'voicevol', 'mute', 'skipvol'];
const current = ['volume', 'play', 'sysplay', 'voicevol', 'skipvol', 'mute'];

export class NativeConfigurationQueries {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.layout = NATIVE_CONFIGURATION_QUERY_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error('Configuration queries require a reviewed engine');
    this.sdk = engine.profile.startsWith('sdk-');
    engine.refs.configurationQueries ??= {
      allocations: new Set(),
      vectors: new Map(),
      strings: new Map(),
    };
    engine.registerFeature('configuration-queries', this);
  }
  get refs() {
    return this.engine.refs.configurationQueries;
  }
  encode(value) {
    if (value instanceof Uint8Array) return value;
    return this.sdk ? encodeCP932(String(value)) : new TextEncoder().encode(String(value));
  }
  allocate(size) {
    const pointer = this.process.allocate(size, true);
    this.refs.allocations.add(pointer);
    return pointer;
  }
  free(pointer) {
    if (!this.refs.allocations.delete(pointer) || !this.process.free(pointer))
      throw new Error('Configuration mirror released an unknown allocation');
  }
  string(at, value, seen) {
    const bytes = this.encode(value),
      p = this.process;
    seen.add(at);
    let buffer = this.refs.strings.get(at);
    if (buffer && (bytes.length < 16 || bytes.length > buffer.capacity)) {
      this.free(buffer.pointer);
      this.refs.strings.delete(at);
      buffer = null;
    }
    if (bytes.length >= 16 && !buffer) {
      buffer = { pointer: this.allocate(bytes.length + 1), capacity: bytes.length };
      this.refs.strings.set(at, buffer);
    }
    const address = buffer ? buffer.pointer : at;
    p.write(address, bytes);
    p.write(address + bytes.length, [0]);
    if (buffer) p.store(at, address);
    p.store(at + 16, bytes.length);
    p.store(at + 20, buffer?.capacity ?? 15);
  }
  vector(at, nodes, vectors, strings) {
    const p = this.process;
    vectors.add(at);
    let allocation = this.refs.vectors.get(at);
    if (allocation && nodes.length > allocation.capacity) {
      this.free(allocation.pointer);
      this.refs.vectors.delete(at);
      allocation = null;
    }
    if (nodes.length && !allocation) {
      allocation = { pointer: this.allocate(nodes.length * 196), capacity: nodes.length };
      this.refs.vectors.set(at, allocation);
    }
    const base = allocation?.pointer ?? 0;
    p.store(at, base);
    p.store(at + 4, base + nodes.length * 196);
    p.store(at + 8, base + (allocation?.capacity ?? 0) * 196);
    nodes.forEach((node, index) => this.record(base + index * 196, node, vectors, strings));
  }
  record(at, node, vectors, strings) {
    const p = this.process;
    for (const [field, offset] of [
      ['key', 0],
      ['name', 24],
      ['type', 52],
      ['head', 76],
      ['int', 104],
    ])
      this.string(at + offset, node?.[field] ?? '', strings);
    p.store(at + 48, node?.id ?? -1);
    p.store(at + 100, node?.group ?? -1);
    p.store(at + 128, node?.mastervol ?? -1);
    p.store(at + 156, node?.sameid ?? 0);
    defaults.forEach((field, i) => p.store(at + 132 + i * 4, node?.defaults[field] ?? -1));
    current.forEach((field, i) => p.store(at + 160 + i * 4, node?.current[field] ?? -1));
    this.vector(at + 184, node?.children ?? [], vectors, strings);
  }
  beforeCall() {
    if (this.closed) return;
    const p = this.process,
      owner = this.engine.refs.owner,
      l = this.layout,
      entries = this.world.game.nativeResources?.entries ?? [];
    if (entries.length > 128) throw new Error('Native archive declarations exceed 128 records');
    for (let i = 0; i < 128; i++) {
      const row = entries[i],
        at = owner + l.archive + i * 332;
      for (const [field, offset, capacity] of [
        ['archive', 0, 32],
        ['extension', 32, 8],
        ['directory', 40, 260],
        ['name', 300, 32],
      ]) {
        const bytes = this.encode(row?.[field] ?? '');
        if (bytes.length >= capacity) throw new Error(`Native archive ${field} exceeds its record`);
        p.write(at + offset, bytes);
        p.write(at + offset + bytes.length, [0]);
      }
    }
    const sound = this.world.soundConfiguration;
    if (this.engine.refs.startupSoundConfiguration) {
      syncNativeStartupSoundConfiguration(this.engine, sound);
      return;
    }
    const vectors = new Set(),
      strings = new Set();
    p.store(owner + l.soundLoaded, Number(sound.loaded));
    if (sound.master) this.record(owner + l.soundMaster, sound.master, vectors, strings);
    this.vector(owner + l.soundParts, sound.parts, vectors, strings);
    for (const [key, value] of this.refs.strings)
      if (!strings.has(key)) {
        this.free(value.pointer);
        this.refs.strings.delete(key);
      }
    for (const [key, value] of this.refs.vectors)
      if (!vectors.has(key)) {
        this.free(value.pointer);
        this.refs.vectors.delete(key);
      }
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    const memory =
      this.world.objects.machine(task.id) === machine
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
        address = spec.handlers[Number(this.sdk)],
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, undefined, options)
          : await this.engine.call(address, parameters, undefined, options);
      if (control !== spec.control)
        throw new Error('Original configuration query changed its control');
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
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
    return {};
  }
  restore() {
    if (
      !(this.refs.allocations instanceof Set) ||
      !(this.refs.vectors instanceof Map) ||
      !(this.refs.strings instanceof Map)
    )
      throw new Error('Invalid configuration query mirror references');
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.engine.refs.nativeOwner) {
      for (const address of this.refs.vectors.keys()) this.process.zero(address, 12);
      for (const address of this.refs.strings.keys()) {
        this.process.zero(address, 24);
        this.process.store(address + 20, 15);
      }
    }
    for (const pointer of this.refs.allocations) this.free(pointer);
    this.refs.vectors.clear();
    this.refs.strings.clear();
  }
}
export function installNativeConfigurationQueries(world) {
  world.registerNativeFeature(
    'configuration-queries',
    (engine) => new NativeConfigurationQueries(engine, world),
  );
  for (const { id } of NATIVE_CONFIGURATION_QUERY_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('configuration-queries')).apply(id, args, machine, task),
    );
}
