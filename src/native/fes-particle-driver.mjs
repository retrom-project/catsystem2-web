// SPDX-License-Identifier: MPL-2.0
// FES PARTICLE owns authored state; the real kind16 task owns PTCL/PPI execution.
const f = Math.fround;

export function initializeFESParticle(object) {
  if (object.nativeType !== 23) throw new TypeError('Expected FES PARTICLE');
  Object.assign(object, {
    program: '',
    texture: '',
    count: 0,
    priority: 0,
    family: 0,
    registers: new Float32Array(32),
    alpha: 255,
    allocationDirty: false,
    dirty: false,
    pendingStart: false,
    pendingStop: false,
    running: false,
    attachment: null,
    attachmentDirty: false,
    particleResourceEntryID: null,
  });
  return object;
}

export function configureFESParticle(object, { family, program, texture, count, priority }) {
  if (object.nativeType !== 23) throw new TypeError('Expected FES PARTICLE');
  Object.assign(object, {
    family: family | 0,
    program: String(program),
    texture: String(texture),
    count: count >>> 0,
    priority: priority | 0,
    allocationDirty: true,
  });
}

export function setFESParticleRegisters(object, values) {
  if (!(object.registers instanceof Float32Array) || object.registers.length !== 32)
    throw new TypeError('FES particle requires its 32 float32 registers');
  object.registers.fill(0);
  for (let index = 0; index < Math.min(values.length, 32); index++)
    object.registers[index] = f(values[index] | 0);
  object.dirty = true;
}

export class FESParticleDriver {
  constructor(world) {
    this.world = world;
    // Native 314 starts from a zeroed 0x290 packet, even after a previous param.
    this.zeroRegisters = new Float32Array(32);
  }
  supports(object) {
    return object.nativeType === 23;
  }
  initialize(_instance, object) {
    if (!this.supports(object)) throw new TypeError('Expected FES PARTICLE');
    if (!(object.registers instanceof Float32Array) || object.registers.length !== 32)
      throw new TypeError('FES particle requires its typed initializer');
    return object;
  }
  async allocate(instance, object) {
    const resource = object.particleResource;
    if (resource) {
      const child = this.world.objects.objects.get(resource.taskID);
      if (
        !child ||
        child.state !== 'active' ||
        child.kind !== 16 ||
        resource.owner !== instance.runtimeID ||
        child.parent !== instance.runtimeID
      )
        throw new Error('FES particle resource lost its owning World task');
      return resource;
    }
    const taskID = await this.world.objects.create({
      kind: 16,
      parent: instance.runtimeID,
      creator: instance.runtimeID,
      name: 'FE Particle',
    });
    return (object.particleResource = { owner: instance.runtimeID, taskID, detached: false });
  }
  async allocateEntry(instance, object, entry) {
    this.initialize(instance, object);
    if (entry.particle) throw new Error('FES resource entry already has a particle task');
    const taskID = await this.world.objects.create({
      kind: 16,
      parent: instance.runtimeID,
      creator: instance.runtimeID,
      name: 'FE Particle',
    });
    entry.particle = { owner: instance.runtimeID, taskID, detached: false };
    object.particleResource = entry.particle;
    object.particleResourceEntryID = entry.id;
    return entry.particle;
  }
  validateEntry(instance, object, entry) {
    const resource = entry.particle,
      child = resource && this.world.objects.objects.get(resource.taskID);
    if (
      !child ||
      child.kind !== 16 ||
      child.parent !== instance.runtimeID ||
      resource.owner !== instance.runtimeID
    )
      throw new Error('FES particle entry has no owned kind16 task');
    if (object?.particleResourceEntryID === entry.id) object.particleResource = resource;
  }
  cleanupEntry(entry) {
    // The explicitly cleared native entry never assigns the guard used by
    // PARTICLE cleanup. Its saved child remains with the owning World task.
    if (entry.particle) entry.particle.detached = true;
  }
  send(instance, object, message, l = 0, context = {}) {
    const resource = object.particleResource,
      child = resource && this.world.objects.objects.get(resource.taskID);
    if (!child || child.kind !== 16 || child.parent !== instance.runtimeID)
      throw new Error('FES particle message requires its live owned kind16 task');
    return this.world.sendEngine(resource.taskID, instance.runtimeID, message, 0, l, context);
  }
  start(object) {
    if (!this.supports(object)) throw new TypeError('Expected FES PARTICLE');
    object.pendingStart = true;
  }
  stop(object) {
    if (!this.supports(object)) throw new TypeError('Expected FES PARTICLE');
    // The common command must stop the real MOT program before calling this.
    object.pendingStop = true;
  }
  attach(_instance, object, target) {
    if (!this.supports(object)) throw new TypeError('Expected FES PARTICLE');
    if (!target || target.deleted || ![3, 4, 33].includes(target.nativeType))
      throw new Error('FES particle attachment requires a live CPLANE, PLANE or M2SPRITE');
    if (target.nativeTaskID == null)
      throw new Error('FES particle attachment target has no World task');
    object.attachment = this.world.nativeTaskID(target.nativeTaskID) >>> 0;
    object.attachmentDirty = true;
  }
  async update(instance, object, { restoring = false } = {}) {
    this.initialize(instance, object);
    if (restoring) {
      if (object.particleResource) this.validate(instance, object);
      return;
    }
    if (object.deleted) return this.close(object);
    const resource = await this.allocate(instance, object);
    if (resource.detached) throw new Error('Deleted FES particle resource cannot be reused');
    if (object.allocationDirty) {
      await this.send(instance, object, 314, 0, {
        spec: {
          family: object.family ? 'plugin' : 'script',
          program: object.program,
          texture: object.texture,
          count: object.count >>> 0,
          // FES stores an integer priority; this conversion is signed.
          priority: f(object.priority | 0),
          registers: this.zeroRegisters,
          externalDraw: false,
        },
      });
      object.allocationDirty = false;
    }
    if (object.dirty) {
      await this.send(instance, object, 319, 0, { registers: object.registers });
      await this.send(instance, object, 320, object.alpha);
      object.dirty = false;
    }
    if (object.pendingStart) {
      object.pendingStart = false;
      await this.send(instance, object, 315);
      object.running = true;
    }
    if (object.pendingStop) {
      object.pendingStop = false;
      await this.send(instance, object, 316);
      object.running = false;
    }
    if (object.running && !(await this.send(instance, object, 318))) object.running = false;
    if (object.attachmentDirty) {
      object.attachmentDirty = false;
      await this.send(instance, object, 321, object.attachment);
    }
  }
  validate(instance, object) {
    const resource = object.particleResource,
      child = resource && this.world.objects.objects.get(resource.taskID);
    if (
      !child ||
      child.kind !== 16 ||
      resource.owner !== instance.runtimeID ||
      child.parent !== instance.runtimeID
    )
      throw new Error('FES particle checkpoint has no live owned kind16 task');
  }
  close(object) {
    // Original 62DEF6 checks the unused entry+80, while the child lives at +72.
    // Ordinary FES deletion therefore leaves this child owned by the FES task.
    if (object.particleResource) object.particleResource.detached = true;
  }
}
