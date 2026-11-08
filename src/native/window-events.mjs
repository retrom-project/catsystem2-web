// SPDX-License-Identifier: MPL-2.0
// Original application-to-root event envelopes, sharing the canonical router.
import { NATIVE_PROFILES } from './catalog.mjs';
export class NativeWindowEvents {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk');
    this.helpers = this.sdk ? [0x4b8970, 0x4b8a70] : [0x5dc540, 0x5dc640];
    this.route = this.sdk ? 0x4bafc0 : 0x5dec00;
    const p = this.process;
    this.traps = this.helpers.map((helper, index) => {
      const bytes = p.read(helper, 128),
        sites = [];
      for (let i = 0; i < bytes.length - 4; i++)
        if (bytes[i] === 0xe8) {
          const target =
            (helper +
              i +
              5 +
              new DataView(bytes.buffer, bytes.byteOffset + i + 1, 4).getInt32(0, true)) >>>
            0;
          if (target === this.route) sites.push(helper + i);
        }
      if (sites.length !== 1) throw new Error('Original window-event route call has changed');
      const trap = p.trap(`window root event transport ${index}`, 7, (args) => this.dispatch(args));
      const jump = new Uint8Array(4);
      new DataView(jump.buffer).setInt32(0, trap - sites[0] - 5, true);
      p.write(sites[0] + 1, jump);
      return trap;
    });
    engine.registerFeature('window-events', this);
  }
  async dispatch([sender, target, message, w, packet, flags, out]) {
    if (sender !== 0 || flags !== 0)
      throw new Error('Window event transport changed its original sender/flags');
    if (message !== 11 && message !== 12)
      throw new Error('Window event uses an unexpected envelope');
    const p = this.process,
      raw = p.load(packet + 8),
      canonical = this.sdk && [156, 160].includes(raw) ? raw + 2 : raw,
      memory = {
        load: (address) => (address === packet + 8 ? canonical : p.load(address)),
        read: (address, size) => p.read(address, size),
        write: (address, bytes) => p.write(address, bytes),
        store: (address, value) => p.store(address, value),
      },
      context = { payload: memory, nativePointer: true, fromHost: true, flags },
      result = await this.world.sendNativeEngine(
        target,
        this.world.root,
        message,
        w,
        packet,
        context,
      );
    if (out && Number.isInteger(result)) p.store(out, result);
    return Number(context.nativeRouted);
  }
  async send(event, w = 0, l = 0, { taskType } = {}) {
    const world = this.world;
    if (world.root === undefined || !world.objects.objects.has(world.root)) return 0;
    const taskMemory = await world.getNativeFeature('task-memory'),
      p = this.process,
      root = await taskMemory.pointer(world.root),
      core = p.allocate(12, true),
      filtered = taskType !== undefined;
    p.store(core + 8, root);
    try {
      const raw = this.sdk && [158, 162].includes(event) ? event - 2 : event;
      return await this.engine.call(
        this.helpers[Number(filtered)],
        filtered ? [taskType, raw, w, l] : [raw, w, l],
        core,
        { task: world.root },
      );
    } finally {
      p.free(core);
    }
  }
  recoverTrap(trap) {
    if (/^window root event transport [01]$/.test(trap.name))
      return { args: 7, real: false, handler: (args) => this.dispatch(args) };
    return null;
  }
  snapshot() {
    return { traps: [...this.traps] };
  }
  restore(state) {
    this.traps = [...state.traps];
  }
}
export function installNativeWindowEvents(world) {
  if (!NATIVE_PROFILES[world.profile])
    throw new Error('Window events require a reviewed engine profile');
  world.registerNativeFeature('window-events', (engine) => new NativeWindowEvents(engine, world));
}
