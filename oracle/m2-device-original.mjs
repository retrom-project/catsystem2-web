// SPDX-License-Identifier: MPL-2.0
// Executes the user-supplied PE32 E-mote driver. No proprietary DLL is shipped.
import { PE32Process } from '../src/ppi/pe32.mjs';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { EmoteD3D9 } from '../src/emote/native-d3d.mjs';
import { Binary, inflate } from '../src/binary.mjs';
import { floatBits } from '../src/kcs.mjs';

const createExport = '?EmoteCreate@@YAPAVIEmoteDevice@@ABUInitParam@1@@Z';
const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
const utf8 = (process, address) => new TextDecoder().decode(process.stringBytes(address));

export class NativeEmoteDevice {
  static async open(bytes, options = {}) {
    const device = new NativeEmoteDevice(await (options.unicornFactory ?? loadUnicorn)(), options);
    try {
      await device.load(bytes);
      return device;
    } catch (error) {
      if (device.ownsD3D) device.d3d.close();
      if (device.ownsProcess) device.process.close();
      throw error;
    }
  }
  constructor(unicorn, options) {
    this.options = options;
    this.ownsProcess = !options.process && !options.d3d;
    this.process =
      options.process ??
      options.d3d?.process ??
      new PE32Process(unicorn, { budget: 200000000, ...options });
    this.services = options.services ?? new NativeEngineWindows(this.process, options);
    this.ownsD3D = !options.d3d;
    this.d3d = options.d3d ?? new EmoteD3D9(this.process, options);
    if (this.d3d.process !== this.process)
      throw new Error('E-mote and its shared Direct3D device require the same guest process');
    this.players = new Map();
    this.current = null;
  }
  async load(bytes, { initialize = true, createDevice = true } = {}) {
    this.ownsDevice = createDevice;
    this.identity = await digest(bytes);
    const p = this.process;
    this.module = p.loadModule(
      bytes,
      (symbol) => this.services.resolve(symbol),
      this.options.name ?? 'emotedriver.dll',
    );
    if (this.module.pe.tls.address)
      throw new Error('E-mote static TLS initialization is not yet recovered');
    if (
      initialize &&
      this.module.pe.entry &&
      !p.call(this.module.base + this.module.pe.entry, [this.module.base, 1, 0])
    )
      throw new Error('E-mote DLL_PROCESS_ATTACH failed');
    if (initialize && createDevice) {
      const init = p.allocate(12, true);
      p.store(init, this.d3d.device);
      this.pointer = p.call(this.module.export(createExport), [init]);
      p.free(init);
      if (!this.pointer) throw new Error('E-mote driver could not create its device');
    }
    this.floatResult = p.allocate(4, true);
    this.floatReturn = p.trap('Emote read float return', 0, () => undefined);
    p.write(this.floatReturn, [
      0xd9,
      0x1d,
      this.floatResult & 255,
      (this.floatResult >>> 8) & 255,
      (this.floatResult >>> 16) & 255,
      this.floatResult >>> 24,
      0xc3,
    ]);
  }
  snapshot({ includeProcess = this.ownsProcess } = {}) {
    if (this.current) throw new Error('Cannot checkpoint E-mote during native execution');
    return {
      identity: this.identity,
      name: this.module.name,
      pointer: this.pointer,
      floatResult: this.floatResult,
      floatReturn: this.floatReturn,
      ...(includeProcess
        ? { process: this.process.snapshot(), services: this.services.snapshot() }
        : {}),
      d3d: this.ownsD3D ? this.d3d.snapshot() : null,
      players: [...this.players.values()].map(({ pointer, buffers, sizes, name }) => ({
        pointer,
        buffers: [...buffers],
        sizes: [...sizes],
        name,
      })),
    };
  }
  restore(state) {
    if (state.identity !== this.identity)
      throw new Error('E-mote checkpoint driver identity differs');
    if (this.ownsD3D) this.d3d.restore(state.d3d);
    Object.assign(this, {
      pointer: state.pointer,
      floatResult: state.floatResult,
      floatReturn: state.floatReturn,
    });
    this.players = new Map(
      state.players.map((player) => [
        player.pointer,
        new NativeEmotePlayer(this, structuredClone(player)),
      ]),
    );
  }
  recoverTrap(trap) {
    return (
      this.d3d.recoverTrap(trap) ??
      (trap.name === 'Emote read float return'
        ? { args: 0, real: false, handler: () => undefined }
        : null)
    );
  }
  static async fromSnapshot(state, { readDriver, ...options }) {
    if (typeof readDriver !== 'function')
      throw new Error('E-mote checkpoint requires its driver source');
    const bytes = await readDriver({ name: state.name, identity: state.identity });
    if ((await digest(bytes)) !== state.identity)
      throw new Error('E-mote checkpoint driver identity differs');
    const device = new NativeEmoteDevice(await (options.unicornFactory ?? loadUnicorn)(), {
      ...options,
      heapSize: state.process.heapLimit - 0x20000000,
      width: state.d3d.width,
      height: state.d3d.height,
      name: state.name,
    });
    try {
      await device.load(bytes, { initialize: false });
      for (const trap of state.process.traps)
        if (!device.process.traps.has(trap.address)) {
          const match = /^Emote D3D (\w+)\./.exec(trap.name);
          if (match) device.d3d.table(match[1]);
          else throw new Error(`Unknown E-mote checkpoint host function ${trap.name}`);
        }
      device.process.restore(state.process);
      device.services.restore(state.services);
      device.d3d.restore(state.d3d);
      Object.assign(device, {
        pointer: state.pointer,
        floatResult: state.floatResult,
        floatReturn: state.floatReturn,
      });
      device.players = new Map(
        state.players.map((player) => [
          player.pointer,
          new NativeEmotePlayer(device, structuredClone(player)),
        ]),
      );
      return device;
    } catch (error) {
      device.process.close();
      throw error;
    }
  }
  member(pointer, slot, words = [], { real = false } = {}) {
    if (this.closed) throw new Error('E-mote device is closed');
    if (this.current) throw new Error('E-mote native execution cannot be reentered');
    this.current = { pointer, slot };
    try {
      const p = this.process,
        result = p.call(p.load(p.load(pointer) + slot * 4), words, pointer);
      if (!real) return result;
      p.call(this.floatReturn);
      return new DataView(p.read(this.floatResult, 4).buffer).getFloat32(0, true);
    } catch (cause) {
      throw new Error(
        `E-mote ${this.module.name} SHA256=${this.identity} member ${slot}: ${cause.message}`,
        { cause },
      );
    } finally {
      this.current = null;
    }
  }
  async createPlayer(sources, { name = '' } = {}) {
    if (!Array.isArray(sources)) sources = [sources];
    if (!sources.length) throw new Error('E-mote player requires at least one model');
    const p = this.process,
      buffers = [],
      sizes = [];
    try {
      for (let bytes of sources) {
        const binary = new Binary(bytes, 'E-mote PSB/PSZ');
        if (binary.magic('PSZ\0'))
          bytes = await inflate(binary.range(16, binary.u32(4)), binary.u32(8));
        if (!new Binary(bytes).magic('PSB\0')) throw new Error('E-mote model is not a PSB');
        const pointer = p.allocate(bytes.length);
        p.write(pointer, bytes);
        buffers.push(pointer);
        sizes.push(bytes.length);
      }
      const vectors = p.allocate(sources.length * 8 + 4, true),
        output = vectors + sources.length * 8;
      buffers.forEach((pointer, i) => {
        p.store(vectors + i * 4, pointer);
        p.store(vectors + sources.length * 4 + i * 4, sizes[i]);
      });
      this.member(this.pointer, 8, [sources.length, vectors, vectors + sources.length * 4, output]);
      const pointer = p.load(output);
      p.free(vectors);
      if (!pointer) throw new Error('E-mote driver rejected its model');
      const player = new NativeEmotePlayer(this, { pointer, buffers, sizes, name });
      this.players.set(pointer, player);
      return player;
    } catch (error) {
      for (const buffer of buffers) p.free(buffer);
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    const errors = [],
      attempt = (callback) => {
        try {
          callback();
        } catch (error) {
          errors.push(error);
        }
      };
    if (this.ownsD3D) attempt(() => this.d3d.endSceneBatch());
    for (const player of [...this.players.values()]) attempt(() => player.close());
    if (this.pointer && this.ownsDevice) attempt(() => this.member(this.pointer, 2));
    if (this.module?.pe.entry)
      attempt(() =>
        this.process.call(this.module.base + this.module.pe.entry, [this.module.base, 0, 0]),
      );
    if (this.ownsD3D) attempt(() => this.d3d.close());
    if (this.ownsProcess) attempt(() => this.process.close());
    this.closed = true;
    if (errors.length) throw new AggregateError(errors, 'Native E-mote device cleanup failed');
  }
}

export class NativeEmotePlayer {
  constructor(device, state) {
    this.device = device;
    Object.assign(this, state);
  }
  call(slot, words = [], options) {
    if (this.closed) throw new Error('E-mote player is closed');
    return this.device.member(this.pointer, slot, words, options);
  }
  string(value, callback) {
    const p = this.device.process,
      bytes = new TextEncoder().encode(value + '\0'),
      pointer = p.allocate(bytes.length);
    p.write(pointer, bytes);
    try {
      return callback(pointer);
    } finally {
      p.free(pointer);
    }
  }
  variables() {
    const p = this.device.process;
    return Array.from({ length: this.call(31) }, (_, i) => utf8(p, this.call(32, [i])));
  }
  setVariable(name, value, frames = 0, easing = 0) {
    return this.string(name, (pointer) =>
      this.call(36, [pointer, floatBits(value), floatBits(frames), floatBits(easing)]),
    );
  }
  variable(name) {
    return this.string(name, (pointer) => this.call(37, [pointer], { real: true }));
  }
  update(frames) {
    return this.call(63, [floatBits(frames)]);
  }
  draw() {
    return this.call(65);
  }
  collectDraw() {
    this.device.d3d.commands = [];
    this.draw();
    return this.device.d3d.commands;
  }
  show() {
    return this.call(6);
  }
  hide() {
    return this.call(7);
  }
  get hidden() {
    return Boolean(this.call(8));
  }
  close() {
    if (this.closed) return;
    this.call(2);
    for (const buffer of this.buffers) this.device.process.free(buffer);
    this.device.players.delete(this.pointer);
    this.closed = true;
  }
}
