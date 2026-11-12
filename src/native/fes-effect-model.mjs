// SPDX-License-Identifier: MPL-2.0
// FES state only. Canonical task services own the D6 algorithms and rendering.
// Supported FES types: DRAW7, WIPE8, RDRAW26, RWIPE27, WBREAK30, RWMOS31, RFMOS32.
const definitions = new Map([
  [7, { name: '__drawobj__', taskName: 'FE Draw', area: true }],
  [8, { name: '__wipeobj__', taskName: 'FE Wipe', area: true }],
  [26, { name: '__rdrawobj__', taskName: 'FE RDraw', kind: 38, init: 384, start: 385 }],
  [27, { name: '__rwipeobj__', taskName: 'FE RWipe', kind: 39, init: 387, start: 388 }],
  [30, { name: '__wbreakobj__', taskName: 'FE WBreak', kind: 52, init: 521, start: 522 }],
  [31, { name: '__rwmosobj__', taskName: 'FE RWMos', kind: 50, init: 516, start: 518 }],
  [32, { name: '__rfmosobj__', taskName: 'FE RWMos', kind: 51, init: 519, start: 520 }],
]);
const screenCommands = new Map([
  ['rdraw', 26],
  ['rwipe', 27],
  ['wbreak', 30],
  ['rwmos', 31],
  ['rfmos', 32],
]);
const imageTypes = new Set([1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25]);
const converted = new DataView(new ArrayBuffer(4));
const bits = (value) => {
  converted.setFloat32(0, value, true);
  return converted.getUint32(0, true);
};
const fromBits = (word) => {
  converted.setUint32(0, word, true);
  return converted.getFloat32(0, true);
};
const unsignedFloat = (value) => Math.fround(value >>> 0);
const coordinate = (value) => {
  value = Math.fround(value);
  return Number.isFinite(value) && value >= -2147483648 && value < 2147483648
    ? Math.trunc(value)
    : -2147483648;
};
const typeDefinition = (type) => {
  const definition = definitions.get(type);
  if (!definition) throw new Error(`FES effect type ${type} is outside this model`);
  return definition;
};

export function fesEffectClock(owner) {
  return ((owner.effectiveFrame ?? 0) - (owner.pausedFrames ?? 0)) >>> 0;
}

export function snapshotFESPlaneCounts(objects) {
  for (const object of objects)
    if (!object.deleted && object.nativeType === 4) object.beforeCount = object.currentCount;
}

export function reconcileFESPlaneCounts(objects, associatedPlane) {
  for (const object of objects) {
    const delta = object.displayDelta | 0;
    if (object.deleted || !imageTypes.has(object.nativeType) || !delta) continue;
    const plane = associatedPlane(object);
    if (!plane) continue;
    plane.currentCount = (plane.currentCount + (delta > 0 ? 1 : -1)) | 0;
    object.displayDelta = 0;
  }
}

export function fesScreenEffectOptions(type, args, { evaluate, text = String } = {}) {
  const definition = typeDefinition(type);
  if (definition.area) throw new Error('Screen options require a screen FES effect');
  const result = { duration: 30, minimum: 0, maximum: 50000, mask: '', level: 16, flags: [0, 0] };
  const number = (index) => {
    if (typeof evaluate !== 'function') throw new Error('FES effect expression service is missing');
    return evaluate(args[index]) | 0;
  };
  if (args[0] !== undefined) result.duration = Math.max(1, number(0));
  let range = 1;
  if (type === 27) {
    if (args[1] !== undefined) result.mask = text(args[1]);
    range = 2;
  } else if (type === 30) {
    result.shardSize = [32, 32];
    result.shardSpeed = [300, 300];
    for (let index = 0; index < 2; index++)
      if (args[1 + index] !== undefined) result.shardSize[index] = number(1 + index) >>> 0;
    for (let index = 0; index < 2; index++)
      if (args[3 + index] !== undefined)
        result.shardSpeed[index] = unsignedFloat(number(3 + index));
    range = 5;
  } else if (type === 31 || type === 32) {
    if (args[1] !== undefined) result.level = number(1) >>> 0;
    if (args[2] !== undefined) result.flags[0] = number(2) >>> 0;
    range = 3;
    if (type === 32) {
      if (args[3] !== undefined) result.flags[1] = number(3) >>> 0;
      range = 4;
    }
  }
  if (args[range] !== undefined) result.minimum = unsignedFloat(number(range));
  if (args[range + 1] !== undefined) result.maximum = unsignedFloat(number(range + 1));
  return result;
}

export class FESEffectModel {
  constructor(services) {
    this.services = services;
    this.entries = new Map();
    this.packets = new Map();
    this.sleeping = false;
    this.pending = 0;
  }
  need(name) {
    const operation = this.services[name];
    if (typeof operation !== 'function') throw new Error(`FES effect service ${name} is missing`);
    return operation;
  }
  async operation(callback) {
    this.pending++;
    try {
      return await callback();
    } finally {
      this.pending--;
    }
  }
  hasName(name) {
    for (const effect of this.entries.values())
      if (!effect.deleted && effect.name === name) return true;
    return this.need('objectExists')(name);
  }
  declare({ identity, name, type, parent = null, ...options }) {
    typeDefinition(type);
    if (identity === undefined || this.entries.has(identity))
      throw new Error('FES effect identity must be new and explicit');
    const effect = {
      identity,
      name,
      type,
      parent,
      duration: 30,
      minimum: 0,
      maximum: 50000,
      mask: '',
      level: 16,
      flags: [0, 0],
      ...(type === 30 ? { shardSize: [32, 32], shardSpeed: [300, 300] } : {}),
      ...options,
      phase: 'unallocated',
      remaining: 0,
      startClock: null,
      taskId: 0,
      taskKind: 0,
      initMessage: 0,
      startMessage: 0,
      drawTaskId: 0,
      borrowedBitmap: 0,
      ownedBitmaps: [],
      packetWords: null,
      deleted: false,
      failure: null,
    };
    this.entries.set(identity, effect);
    return effect;
  }
  screenCommand(verb, args, { top, ...expressions } = {}) {
    return this.operation(async () => {
      const type = screenCommands.get(verb);
      if (type === undefined) throw new Error(`FES screen command ${verb} is outside this model`);
      const definition = typeDefinition(type);
      if (this.hasName(definition.name)) return { created: false };
      if (top === undefined || top === null)
        throw new Error('FES screen command requires its Top object');
      const options = fesScreenEffectOptions(type, args, expressions);
      const identity = await this.need('createObject')({
        type,
        name: definition.name,
        parent: top,
      });
      const effect = this.declare({ identity, name: definition.name, type, parent: top });
      // Original command captures before writing the new object's configuration.
      await this.captureFirst(options.minimum, options.maximum);
      Object.assign(effect, options);
      await this.need('addDummyMotion')(effect, { category: 'mot', name: 'dummy', registers: [] });
      return { created: true, effect };
    });
  }
  areaCommand(verb, target, args, { evaluate, text = String } = {}) {
    return this.operation(async () => {
      if (verb !== 'draw' && verb !== 'wipe')
        throw new Error(`FES area command ${verb} is outside this model`);
      const type = verb === 'draw' ? 7 : 8,
        definition = typeDefinition(type);
      // These are established command no-op gates, not unknown-command fallback.
      if (
        !target ||
        target.deleted ||
        target.nativeType !== 4 ||
        !(target.index >= 0) ||
        this.hasName(definition.name)
      )
        return { created: false };
      if (target.identity === undefined)
        throw new Error('FES area command requires its PLANE identity');
      let duration = 30;
      if (args[0] !== undefined) {
        if (typeof evaluate !== 'function')
          throw new Error('FES effect expression service is missing');
        duration = evaluate(args[0]) | 0;
        if (type === 7) duration = Math.max(1, duration);
      }
      const identity = await this.need('createObject')({
        type,
        name: definition.name,
        parent: target.identity,
      });
      const effect = this.declare({
        identity,
        name: definition.name,
        type,
        parent: target.identity,
        duration,
        mask: type === 8 && args[1] !== undefined ? text(args[1]) : '',
      });
      await this.need('addDummyMotion')(effect, { category: 'mot', name: 'dummy', registers: [] });
      if (type === 8) await this.need('queueWipeRecord')(effect, [13, 1, 0, 0, 0]);
      return { created: true, effect };
    });
  }
  async captureFirst(minimum, maximum) {
    if (!this.need('hasView')()) return;
    await this.need('prepareCaptures')(1);
    await this.need('capture')(0, minimum, maximum);
  }
  setPacket(effect, words) {
    effect.packetWords = Uint32Array.from(words, (word) => word >>> 0);
    this.packets.set(effect.identity, this.need('packet')(effect.packetWords));
  }
  send(effect, message, l = 0, payload = null) {
    return this.need('send')(effect.taskId, message, l, payload);
  }
  async rejectAllocation(effect, reason) {
    effect.phase = 'failed';
    effect.failure = reason;
    await this.need('clearMotion')(effect);
    throw new Error(`FES effect ${effect.name}: ${reason}`);
  }
  allocate(effect) {
    return this.operation(async () => {
      if (effect.deleted || effect.phase !== 'unallocated') return false;
      const definition = typeDefinition(effect.type);
      effect.phase = 'allocating';
      try {
        if (definition.area) await this.allocateArea(effect);
        else await this.allocateScreen(effect, definition);
      } catch (error) {
        effect.phase = 'failed';
        effect.failure ??= error.message;
        throw error;
      }
      return true;
    });
  }
  async allocateArea(effect) {
    const plane = this.need('plane')(effect.parent);
    if (!plane || plane.nativeType !== 4 || plane.deleted)
      return this.rejectAllocation(effect, 'a live PLANE parent is required');
    const drawing = this.need('drawing')();
    if (!drawing?.bitmap || !drawing.taskId)
      return this.rejectAllocation(effect, 'the live Draw bitmap is required');
    const vx = coordinate(plane.vram[0]),
      vy = coordinate(plane.vram[1]);
    const [ox, oy] = drawing.offset;
    const px = (ox + vx) | 0,
      py = (oy + vy) | 0,
      [width, height] = plane.size;
    const live = drawing.bitmap;
    effect.drawTaskId = drawing.taskId;
    effect.borrowedBitmap = live;
    if (effect.type === 7) {
      // DRAW allocates the child before copying its source.
      effect.taskKind = 27;
      effect.taskId = await this.need('createTask')(27, 'FE Draw');
      const old = await this.need('snapshotBitmap')(live, [vx, vy, width, height]);
      if (!old) throw new Error('FES DRAW source snapshot is unavailable');
      effect.ownedBitmaps.push(old);
      effect.initMessage = 275;
      this.setPacket(effect, [effect.duration, old, 0, 0, live, vx, vy, px, py, width, height]);
    } else {
      // WIPE decodes/converts the mask before child construction.
      const mask = await this.need('loadMask')(effect.mask);
      if (!mask) return this.rejectAllocation(effect, 'the WIPE mask could not be loaded');
      effect.ownedBitmaps.push(mask);
      let words;
      if (plane.beforeCount === 0) {
        effect.taskKind = 28;
        words = [effect.duration, live, vx, vy, mask, px, py, width, height, 1, 0, 0];
      } else {
        const outgoing = plane.currentCount === 0;
        effect.taskKind = outgoing ? 28 : 26;
        effect.taskId = await this.need('createTask')(
          effect.taskKind,
          outgoing ? 'FE Wipe out' : 'FE Wipe',
        );
        const old = await this.need('snapshotBitmap')(live, [
          outgoing ? 0 : px,
          outgoing ? 0 : py,
          width,
          height,
        ]);
        if (!old) throw new Error('FES WIPE source snapshot is unavailable');
        effect.ownedBitmaps.push(old);
        words = outgoing
          ? [effect.duration, old, 0, 0, mask, px, py, width, height, 0, 0, 0]
          : [effect.duration, old, 0, 0, live, px, py, mask, px, py, width, height, 0, 0];
      }
      if (!effect.taskId)
        effect.taskId = await this.need('createTask')(effect.taskKind, 'FE Wipe in');
      effect.initMessage = effect.taskKind === 26 ? 274 : 276;
      this.setPacket(effect, words);
    }
    if (!effect.taskId) throw new Error('FES area task allocation returned no World task');
    effect.startMessage = 257;
    effect.phase = 'waiting';
    effect.remaining = 2;
    await this.need('send')(effect.drawTaskId, 286, 0, null);
  }
  async allocateScreen(effect, definition) {
    let mask = 0;
    if (effect.type === 27) {
      mask = await this.need('loadMask')(effect.mask);
      if (!mask) return this.rejectAllocation(effect, 'the RWIPE mask could not be loaded');
      effect.ownedBitmaps.push(mask);
      // Declaration allocation has this capture too; command-time capture is separate.
      await this.captureFirst(effect.minimum, effect.maximum);
    }
    const range = [bits(effect.minimum), bits(effect.maximum)];
    const words =
      effect.type === 26
        ? [...range, effect.duration]
        : effect.type === 27
          ? [...range, effect.duration, mask, 0]
          : effect.type === 30
            ? [...range, effect.duration, ...effect.shardSize, ...effect.shardSpeed.map(bits)]
            : effect.type === 31
              ? [...range, effect.duration, effect.level, effect.flags[0]]
              : [...range, effect.duration, effect.level, effect.flags[0], effect.flags[1]];
    // Both mosaic range words are explicit by the approved deterministic policy.
    this.setPacket(effect, words);
    effect.taskKind = definition.kind;
    effect.taskId = await this.need('createTask')(definition.kind, definition.taskName);
    if (!effect.taskId) throw new Error('FES screen task allocation returned no World task');
    effect.initMessage = definition.init;
    effect.startMessage = definition.start;
    effect.phase = 'waiting';
    effect.remaining = effect.type === 31 ? 5 : 2;
    await this.send(effect, effect.initMessage, 0, this.packets.get(effect.identity));
  }
  visit(effect, clock) {
    return this.operation(async () => {
      if (this.sleeping) return;
      await this.advance(effect, clock >>> 0);
    });
  }
  async advance(effect, clock) {
    if (effect.deleted) return this.cleanupEntry(effect);
    if (effect.phase === 'unallocated' || effect.phase === 'failed') return;
    const area = typeDefinition(effect.type).area;
    if (effect.phase === 'waiting') {
      if (effect.type === 31) {
        if (effect.remaining === 4)
          await this.send(effect, effect.initMessage, 0, this.packets.get(effect.identity));
        if (effect.remaining === 2) {
          // Read the same retained range as both initializer messages/checkpoint.
          await this.need('capture')(
            1,
            fromBits(effect.packetWords[0]),
            fromBits(effect.packetWords[1]),
          );
          await this.send(effect, 517);
        }
      } else if (effect.remaining === 1)
        await this.send(effect, effect.initMessage, 0, this.packets.get(effect.identity));
      if (--effect.remaining === 0) effect.phase = 'ready';
      return;
    }
    if (effect.phase === 'ready') {
      effect.startClock = clock;
      // Native phase zero remains zero when the owner clock is zero.
      if (clock !== 0) effect.phase = 'running';
      await this.send(effect, effect.startMessage, area ? 0 : 1);
      return;
    }
    if (effect.phase !== 'running') throw new Error(`Unknown FES effect phase ${effect.phase}`);
    if (!(await this.send(effect, area ? 259 : 377))) {
      effect.deleted = true;
      effect.phase = 'cleanup';
      await this.need('deleteObject')(effect.identity);
      if (area) await this.need('send')(effect.drawTaskId, 286, 1, null);
      return;
    }
    if (!this.need('busy')(effect)) await this.send(effect, area ? 258 : effect.startMessage, 0);
  }
  markDeleted(effect) {
    effect.deleted = true;
    effect.phase = 'cleanup';
  }
  cleanup(effect) {
    return this.operation(() => this.cleanupEntry(effect));
  }
  async cleanupEntry(effect) {
    if (!this.entries.has(effect.identity)) return;
    // Original normal cleanup: mosaic31/32 deliberately does not send child3.
    if (effect.taskId && [7, 8, 26, 27, 30].includes(effect.type)) await this.send(effect, 3);
    for (const handle of effect.ownedBitmaps) await this.need('releaseBitmap')(handle);
    effect.ownedBitmaps = [];
    this.packets.delete(effect.identity);
    this.entries.delete(effect.identity);
  }
  setSleeping(sleeping, clock) {
    return this.operation(async () => {
      sleeping = Boolean(sleeping);
      if (sleeping === this.sleeping) return;
      await this.need('notify')(sleeping ? '_FES_SLEEP_' : '_FES_WAKE_');
      // A transition performs exactly one resource visit before masking output.
      for (const effect of this.entries.values()) await this.advance(effect, clock >>> 0);
      if (sleeping)
        for (const effect of this.entries.values())
          if (!effect.deleted && effect.taskId && (effect.type === 7 || effect.type === 8))
            await this.send(effect, 258);
      await this.need('maskOutputs')(sleeping);
      if (!sleeping) await this.need('flushDraw')();
      this.sleeping = sleeping;
    });
  }
  snapshot() {
    if (this.pending) throw new Error('FES effect checkpoint requires settled service operations');
    return structuredClone({ sleeping: this.sleeping, entries: [...this.entries] });
  }
  restore(state) {
    if (this.pending) throw new Error('FES effect restore requires settled service operations');
    if (this.entries.size) throw new Error('FES effect restore requires a fresh model');
    this.sleeping = state.sleeping;
    for (const [identity, saved] of state.entries) {
      const effect = structuredClone(saved);
      typeDefinition(effect.type);
      if (identity !== effect.identity) throw new Error('FES effect checkpoint identity mismatch');
      if (effect.taskId) this.need('rebindTask')(effect.taskId, effect.taskKind);
      if (effect.borrowedBitmap) this.need('requireBitmap')(effect.borrowedBitmap);
      for (const handle of effect.ownedBitmaps) this.need('requireBitmap')(handle);
      if (effect.packetWords) this.packets.set(identity, this.need('packet')(effect.packetWords));
      this.entries.set(identity, effect);
    }
  }
}
