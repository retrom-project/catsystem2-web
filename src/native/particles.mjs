// SPDX-License-Identifier: MPL-2.0
// PTCL and PPI banks share the JS engine-side task and render contract.
import { Particles, ParticleScriptResourceMissing } from '../particles.mjs';
import { quietFloat32Bits } from '../ppi/numeric.mjs';
import { nativeABI } from './abi/index.mjs';
import { readNativeResource } from './resource-file.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';
import { NativeParticleProjection } from './particle-projection.mjs';
import { NativeParticleTextures } from './particle-textures.mjs';
import { nativeParticleBounds } from './particle-bounds.mjs';
import {
  NATIVE_PARTICLE_COMMANDS,
  installNativeParticleCommands,
  nativeParticleMessageOffset,
} from './particle-commands.mjs';

export const NATIVE_PARTICLE_IDS = Object.freeze(NATIVE_PARTICLE_COMMANDS.map(({ id }) => id));

function registers(bytes, quietNaN = false) {
  if (bytes.length !== 128) throw new Error('Native particle registers require 128 bytes');
  const { buffer } = bytes.slice();
  if (quietNaN) {
    const words = new Uint32Array(buffer);
    for (let index = 0; index < words.length; index++)
      words[index] = quietFloat32Bits(words[index]);
  }
  return new Float32Array(buffer);
}

export class NativeParticles {
  constructor(world, options = {}) {
    this.world = world;
    this.tasks = new Map();
    this.textures = new NativeParticleTextures(world, {
      nullableFields: nativeABI(world.profile).particle?.taskFieldsPersistWithoutBank,
    });
    this.projection = new NativeParticleProjection();
    this.scriptUsesTaskFrameRate = nativeABI(world.profile).particle?.scriptUsesTaskFrameRate;
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
      profile: world.profile,
      deferGraphAttachment: nativeABI(world.profile).particle?.deferGraphAttachment,
      scriptLoadsBeforeTexture: nativeABI(world.profile).particle?.scriptLoadsBeforeTexture,
      readScript: nativeABI(world.profile).particle?.scriptLoadsBeforeTexture
        ? (name) => readNativeResource(world, name, 3)
        : undefined,
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
    for (const bank of this.host.banks.values()) {
      const task = [...this.tasks.values()].find((task) => task.key === bank.key);
      if (!task) throw new Error(`Particle checkpoint has no native task for ${bank.key}`);
      task.bindScriptFrameRate(bank);
    }
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
    this.persistTaskFields = nativeABI(this.world.profile).particle?.taskFieldsPersistWithoutBank;
    if (this.persistTaskFields)
      Object.assign(this.state, { registers: null, family: null, atlas: null });
  }
  get bank() {
    return this.owner.host.get(this.key);
  }
  get active() {
    return this.bank ? this.owner.host.busy(this.key) : this.state.active;
  }
  bindScriptFrameRate(bank) {
    if (this.owner.scriptUsesTaskFrameRate && bank.family === 'script')
      bank.instance.fps = this.record.frameRate;
  }
  async load(spec) {
    const active = this.active;
    if (this.persistTaskFields) {
      if (this.bank) this.state.atlas = this.atlasState();
      this.state.family = spec.family;
      this.state.registers = new Float32Array(32);
      this.state.registers.set(spec.registers ?? []);
    }
    let bank;
    try {
      bank = await this.owner.host.load(this.key, {
        ...spec,
        nativeAtlasState: this.persistTaskFields ? this.state.atlas : undefined,
        alpha: this.state.alpha,
        attachPlane: this.state.attachment,
        attachmentNamespace: 'graph',
        autoStart: false,
        autoRelease: false,
      });
    } catch (error) {
      if (
        nativeABI(this.world.profile).particle?.scriptLoadMissingReturnsUnwritten &&
        error instanceof ParticleScriptResourceMissing
      ) {
        this.state.active = active;
        return null;
      }
      throw error;
    }
    if (this.persistTaskFields) {
      this.state.registers = null;
      this.state.atlas = null;
    }
    this.bindScriptFrameRate(bank);
    // Native 13A resets clocks and resources but retains the active DWORD.
    // It does not implicitly call Init on a replacement DLL.
    this.state.active = active;
    bank.started = active;
    bank.instance.active = active;
    bank.instance.stopped = !active;
    this.owner.host.metadata(bank);
    return bank;
  }
  atlasState() {
    const atlas = this.bank.nativeAtlas;
    return atlas && ['width', 'height', 'priority'].every((k) => atlas[k] !== null)
      ? { width: atlas.width, height: atlas.height, priority: atlas.priority, near: atlas.near }
      : null;
  }
  source(sender, context) {
    const memory =
      context.payload ||
      context.machine ||
      this.world.objects.machine(context.nativeSenderWorldID ?? sender);
    if (!memory)
      throw new Error(`Particle task ${this.record.id} requires sender ${sender}'s VM memory`);
    return memory;
  }
  async message([sender, message, w, l], context = {}) {
    const host = this.owner.host,
      offset = nativeParticleMessageOffset(this.world.profile),
      rawTransport = nativeABI(this.world.profile).particle?.taskMessagesUseRawTransport,
      canonical = message - (rawTransport && !context.nativeRaw ? 0 : offset),
      unwritten = offset || rawTransport ? NATIVE_UNWRITTEN_WORD : 0;
    if (
      (offset || rawTransport) &&
      canonical >= 314 &&
      canonical <= 321 &&
      !this.world.graphics.device.attachment
    ) {
      context.nativeUnhandled = true;
      return NATIVE_UNWRITTEN_WORD;
    }
    switch (canonical) {
      case 0x13a: {
        if (context.spec) {
          await this.load(context.spec);
          return unwritten;
        }
        if (
          !l &&
          (context.nativePointer ||
            ((offset || rawTransport) && !context.payload && !context.machine))
        )
          return unwritten;
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
          texture = string(132),
          program = string(4),
          authoredCategory = new TextDecoder().decode(bytes.subarray(4, 9)) === '@cat/';
        await this.load({
          family: view.getUint32(0, true) ? 'plugin' : 'script',
          program,
          nativeProgramName:
            rawTransport && !authoredCategory && view.getUint32(0, true) === 0
              ? program
              : undefined,
          texture,
          nativeTextureName: texture ? bytes.slice(132, 260) : undefined,
          count: view.getUint32(260, true),
          priority: view.getFloat32(264, true),
          registers: registers(bytes.subarray(268, 396)),
          externalDraw: view.getUint32(396, true) !== 0,
        });
        return unwritten;
      }
      case 0x13b:
        if (this.persistTaskFields && this.state.family === null)
          throw new Error('Native particle start requires its initialized family');
        this.state.active = !(
          this.persistTaskFields &&
          this.state.family === 'plugin' &&
          !this.bank
        );
        if (this.bank) host.start(this.key);
        return unwritten;
      case 0x13c:
        this.state.active = false;
        if (this.bank) host.stop(this.key);
        return unwritten;
      case 0x13d:
        this.state.active = false;
        if (this.persistTaskFields && this.bank) {
          this.state.registers = this.bank.instance.registers.slice();
          this.state.atlas = this.atlasState();
        }
        host.end(this.key, { stop: false });
        return unwritten;
      case 0x13e:
        return Number(this.active);
      case 0x13f: {
        if (
          !l &&
          (context.nativePointer ||
            ((offset || rawTransport) &&
              !context.payload &&
              !context.machine &&
              !context.registers))
        )
          throw new RangeError('Native particle registers require a mapped VM address');
        const values =
          context.registers ||
          registers(this.source(sender, context).bytes(l, 128), Boolean(offset && !rawTransport));
        if (this.bank) host.set(this.key, values);
        else if (this.persistTaskFields) this.state.registers = values.slice();
        return unwritten;
      }
      case 0x140:
        this.state.alpha = (l | 0) >= 255 ? 256 : l | 0;
        if (this.bank) host.alpha(this.key, this.state.alpha);
        return unwritten;
      case 0x141:
        this.state.attachment = l ? l | 0 : -1;
        if (this.bank) host.attach(this.key, this.state.attachment);
        return unwritten;
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
    return this.persistTaskFields
      ? {
          ...this.state,
          registers: this.state.registers?.slice() ?? null,
          atlas: this.state.atlas && { ...this.state.atlas },
        }
      : { ...this.state };
  }
  restore(state) {
    if (
      this.persistTaskFields &&
      (!['script', 'plugin', null].includes(state.family) ||
        (state.atlas !== null &&
          (!state.atlas ||
            !['width', 'height', 'priority', 'near'].every((k) =>
              Number.isFinite(state.atlas[k]),
            ))) ||
        (state.registers !== null &&
          (!(state.registers instanceof Float32Array) || state.registers.length !== 32)))
    )
      throw new Error('Native particle task requires its unloaded resource state');
    this.state = this.persistTaskFields
      ? {
          ...state,
          registers: state.registers?.slice() ?? null,
          atlas: state.atlas && { ...state.atlas },
        }
      : { ...state };
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
  installNativeParticleCommands(world);
  return particles;
}

export async function nativeParticles(id, args, machine, task, world) {
  return world.particleCommands.apply(id, args, machine, task);
}
