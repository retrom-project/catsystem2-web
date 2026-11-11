// SPDX-License-Identifier: MPL-2.0
// PTCL and PPI banks share the JS engine-side task and render contract.
import { Particles } from '../particles.mjs';
import { NativeParticleProjection } from './particle-projection.mjs';
import { NativeParticleTextures } from './particle-textures.mjs';
import { nativeParticleBounds } from './particle-bounds.mjs';
import { NATIVE_PARTICLE_COMMANDS, installNativeParticleCommands } from './particle-commands.mjs';
import { installNativeFESParticles } from './fes-particles.mjs';

export const NATIVE_PARTICLE_IDS = Object.freeze(NATIVE_PARTICLE_COMMANDS.map(({ id }) => id));

function registers(bytes) {
  if (bytes.length !== 128) throw new Error('Native particle registers require 128 bytes');
  return new Float32Array(bytes.slice().buffer);
}

export class NativeParticles {
  constructor(world, options = {}) {
    this.world = world;
    this.tasks = new Map();
    this.textures = new NativeParticleTextures(world);
    this.projection = new NativeParticleProjection();
    this.host = new Particles(world.graphics.stage, {
      game: world.game,
      images: world.images,
      random: world.random,
      clock: world.clock,
      onDebug: (message) => world.host.nativeLog?.(message),
      atlas: this.textures,
      scriptBounds: nativeParticleBounds,
      projectGeometry: (particles, geometry) => this.projection.geometry(particles, geometry),
      attachment: (handle) => {
        const graph = world.graphics.attachment(handle);
        return graph && { id: handle, ...graph, disp: Number(graph.display) };
      },
      ...options,
    });
  }
  get(id) {
    return this.tasks.get(id >>> 0) || null;
  }
  create(record) {
    const task = new NativeParticleTask(this, record);
    this.tasks.set(record.id, task);
    return task;
  }
  async send(target, sender, message, w = 0, l = 0, context) {
    const record = this.world.objects.objects.get(target >>> 0);
    if (!record || record.state !== 'active') return 0;
    return record.implementation.message([sender, message, w, l], context);
  }
  drawItems() {
    return this.host.drawItems();
  }
  snapshot() {
    return { ...this.host.snapshot(), textures: this.textures.snapshot() };
  }
  async restore(state) {
    this.host.close();
    this.textures.restore(state.textures);
    await this.host.restore(state);
    for (const bank of this.host.banks.values())
      if (![...this.tasks.values()].some((task) => task.key === bank.key))
        throw new Error(`Particle checkpoint has no native task for ${bank.key}`);
  }
  close() {
    this.host.close();
  }
}

export class NativeParticleTask {
  constructor(owner, record) {
    this.owner = owner;
    this.world = owner.world;
    this.record = record;
    this.key = `task:${record.id}`;
    this.base = this.world.base(record);
    this.state = { active: false, alpha: 256, attachment: -1 };
  }
  get bank() {
    return this.owner.host.get(this.key);
  }
  get active() {
    return this.bank ? this.owner.host.busy(this.key) : this.state.active;
  }
  async load(spec) {
    const active = this.active;
    const bank = await this.owner.host.load(this.key, {
      ...spec,
      alpha: this.state.alpha,
      attachPlane: this.state.attachment,
      attachmentNamespace: 'graph',
      autoStart: false,
      autoRelease: false,
    });
    // Native 13A resets clocks and resources but retains the active DWORD.
    // It does not implicitly call Init on a replacement DLL.
    this.state.active = active;
    bank.started = active;
    bank.instance.active = active;
    bank.instance.stopped = !active;
    this.owner.host.metadata(bank);
    return bank;
  }
  source(sender, context) {
    const memory = context.payload || context.machine || this.world.objects.machine(sender);
    if (!memory)
      throw new Error(`Particle task ${this.record.id} requires sender ${sender}'s VM memory`);
    return memory;
  }
  async message([sender, message, w, l], context = {}) {
    const host = this.owner.host;
    switch (message) {
      case 0x13a: {
        if (context.spec) {
          await this.load(context.spec);
          return 0;
        }
        if (context.nativePointer && !l) return 0;
        const memory = this.source(sender, context),
          bytes = memory.bytes(l, 0x290),
          view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          string = (at) => {
            const part = bytes.subarray(at, at + 128),
              end = part.indexOf(0);
            return new TextDecoder('shift_jis')
              .decode(end < 0 ? part : part.subarray(0, end))
              .replace(/^@cat\/(?:ptcl|ptclpi|image)\//, '');
          },
          texture = string(132);
        await this.load({
          family: view.getUint32(0, true) ? 'plugin' : 'script',
          program: string(4),
          texture,
          nativeTextureName: texture ? bytes.slice(132, 260) : undefined,
          count: view.getUint32(260, true),
          priority: view.getFloat32(264, true),
          registers: registers(bytes.subarray(268, 396)),
          externalDraw: view.getUint32(396, true) !== 0,
        });
        return 0;
      }
      case 0x13b:
        this.state.active = true;
        if (this.bank) host.start(this.key);
        return 0;
      case 0x13c:
        this.state.active = false;
        if (this.bank) host.stop(this.key);
        return 0;
      case 0x13d:
        this.state.active = false;
        host.end(this.key, { stop: false });
        return 0;
      case 0x13e:
        return Number(this.active);
      case 0x13f: {
        if (context.nativePointer && !l)
          throw new RangeError('Native particle registers require a mapped VM address');
        const values = context.registers || registers(this.source(sender, context).bytes(l, 128));
        if (this.bank) host.set(this.key, values);
        return 0;
      }
      case 0x140:
        this.state.alpha = (l | 0) >= 255 ? 256 : l | 0;
        if (this.bank) host.alpha(this.key, this.state.alpha);
        return 0;
      case 0x141:
        this.state.attachment = l ? l | 0 : -1;
        if (this.bank) host.attach(this.key, this.state.attachment);
        return 0;
      default:
        return this.base.message([sender, message, w, l], context);
    }
  }
  tick(frame) {
    if (!this.bank) return;
    this.owner.host.updateBank(this.key, frame);
    this.state.active = this.owner.host.busy(this.key);
  }
  snapshot() {
    return { ...this.state };
  }
  restore(state) {
    this.state = { ...state };
  }
  close() {
    this.owner.host.end(this.key, { stop: false });
    this.owner.tasks.delete(this.record.id);
  }
}

export function installNativeParticles(world, options) {
  if (!world.graphics) throw new Error('Native particles require the shared graph manager');
  const particles = new NativeParticles(world, options);
  world.particles = particles;
  world.objects.register(16, (record) => particles.create(record));
  if (world.game.names?.('exe').length) installNativeFESParticles(world);
  installNativeParticleCommands(world);
  return particles;
}

export async function nativeParticles(id, args, machine, task, world) {
  return world.particleCommands.apply(id, args, machine, task);
}
