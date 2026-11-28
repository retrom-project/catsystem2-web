// SPDX-License-Identifier: MPL-2.0
import {
  KCSMachine,
  nativeReply,
  floatBits,
  bitsFloat,
  formatNative,
  formatNativeAt,
  nativeLogBytes,
} from '../kcs.mjs';
import { nativeABI } from '../native/abi/index.mjs';
import { nativeScalarMath, nativeTrigWord, scalarArgumentWords } from '../native/scalar-math.mjs';
import {
  PTCL_ABI,
  PTCL_REF_BUFFERS,
  ParticleRefBuffers,
  initialParticle,
  readPTCLQuad,
  writePTCLQuad,
} from './abi.mjs';
import { particleNativeContract } from './contracts.mjs';
import { ParticleRandom } from './random.mjs';
import { sortParticleDepths } from './geometry.mjs';
import { roundX87Single } from './x87.mjs';
import {
  linearInterpolateSSEWords,
  rotateVectorSSEWords,
  sseFloat32Arithmetic,
} from '../motion/native-sse.mjs';
import {
  calcFrame,
  degreeToRadian,
  radianToDegree,
  x87Atan2Word,
  x87RemainderWord,
  x87TriangleWaveWord,
  x87AddWords,
  x87MultiplyWords,
  x87DistanceWord,
  x87RotateVectorWords,
  linearInterpolate,
  x87LinearInterpolate,
  roundInteger,
  triangleWave,
  rotateVector,
  projectionBounds,
  x87ProjectionBoundsWords,
  particleDistanceSSEWord,
  particleProjectionSSEWords,
} from './numeric.mjs';

const f = Math.fround;
const scalarMath = new Map([
  [6, Math.sin],
  [7, Math.cos],
  [8, Math.tan],
  [9, Math.asin],
  [10, Math.acos],
  [11, Math.atan],
  [13, Math.ceil],
  [14, Math.abs],
  [15, Math.floor],
  [17, Math.sqrt],
  [19, degreeToRadian],
  [20, radianToDegree],
]);
const particleScalarNames = new Map([
  [14, 'abs'],
  [19, 'degreeToRadian'],
  [20, 'radianToDegree'],
  [21, 'integerAbs'],
]);
const stateFrameIds = new Set([
  1, 2, 3, 4, 5, 27, 28, 30, 31, 32, 33, 34, 35, 36, 39, 40, 44, 45, 46, 47, 48, 49, 50,
]);
const geometryFrameIds = new Set([22, 23, 24, 25, 26, 29, 37, 38]);
// Components read by FMUL directly from a vertex, ordered by vertex index.
const quadScaleMemoryOperands = [0b101, 0, 0, 0b110];

function updatePTCLQuadWords(machine, address, components, transform) {
  const stride = PTCL_ABI.vertex.size,
    accessedBytes = PTCL_ABI.quadSize - stride + components * 4,
    bytes = machine.bytes(address, accessedBytes),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let vertex = 0; vertex < 4; vertex++) {
    const start = vertex * stride;
    const words = Array.from({ length: components }, (_, i) => view.getUint32(start + i * 4, true));
    transform(words, vertex).forEach((word, i) => view.setUint32(start + i * 4, word, true));
  }
}

export class ParticleScriptInstance {
  constructor(script, options = {}) {
    const {
      profile,
      count,
      width,
      height,
      screenWidth,
      screenHeight,
      fps = 60,
      priority = 0,
      near,
      registers = [],
      attachPlane = -1,
      attachment = () => undefined,
      attachmentDevicePresent,
      random = new ParticleRandom(),
      shared = new Uint8Array(0),
      onDebug = null,
      budget = 5000000 /* instruction budget  */,
      screenBounds = projectionBounds,
      refBufferMemory,
      refBufferSnapshot,
      nativeTaskBuffers = false,
      externalDraw = false,
    } = options;
    const abi = profile === undefined ? null : nativeABI(profile),
      nullableTexture = abi?.particle?.taskFieldsPersistWithoutBank;
    this.nativeRefBuffers = abi?.particle?.refBuffersFollowNativeHeap;
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > (this.nativeRefBuffers ? 0xffffffff : 1000000)
    )
      throw new RangeError('Invalid PTCL particle count');
    for (const [key, value] of Object.entries({ width, height, screenWidth, screenHeight }))
      if (
        !(nullableTexture && (key === 'width' || key === 'height') && value === null) &&
        (!Number.isFinite(value) || value < 0)
      )
        throw new RangeError(`Invalid PTCL ${key}`);
    this.script = script;
    this.profile = profile;
    this.table = script.scriptVersion === 0x20000 ? 'particle-v2' : 'particle-v1';
    this.nativeEntries = abi?.tables[this.table].entries ?? null;
    this.math = abi?.math;
    this.interpreterMath = this.math?.interpreterUsesNativeScalarMath ? this.math : null;
    this.frameScale = abi?.particle?.frameScale;
    this.debugUsesNativeLogger = abi?.particle?.debugUsesNativeLogger;
    this.stateArgumentsReadFrame = abi?.particle?.stateArgumentsReadFrame;
    this.stateCopiesRawWords = abi?.particle?.stateCopiesRawWords;
    this.geometryUsesSSEWords = abi?.particle?.geometryUsesSSEWords;
    this.geometryArgumentsReadFrame = abi?.particle?.geometryArgumentsReadFrame;
    this.quadUsesX87 = abi?.particle?.quadUsesX87;
    this.textureCoordinatesUseX87 = abi?.particle?.textureCoordinatesUseX87;
    this.distanceUsesX87 = abi?.particle?.distanceUsesX87;
    this.projectionBoundsUseX87 = abi?.particle?.projectionBoundsUseX87;
    this.projectionBoundsUseSSE = abi?.particle?.projectionBoundsUseSSE;
    this.attachmentPositionRequiresOwner = abi?.particle?.attachmentPositionRequiresOwner;
    this.attachmentReadsRegistrationWord = abi?.particle?.attachmentReadsRegistrationWord;
    this.missingAttachmentGroupWritesZero = abi?.particle?.missingAttachmentGroupWritesZero;
    this.attachmentRequiresProvider = abi?.particle?.attachmentRequiresProvider;
    this.attachmentCopiesRawWords = abi?.particle?.attachmentCopiesRawWords;
    this.count = count;
    this.width = nullableTexture && width === null ? null : f(width);
    this.height = nullableTexture && height === null ? null : f(height);
    this.screenWidth = screenWidth >>> 0;
    this.screenHeight = screenHeight >>> 0;
    this.fps = fps >>> 0;
    this.priority = nullableTexture && priority === null ? null : f(priority);
    this.near = near;
    this.attachPlane = attachPlane | 0;
    this.attachment = attachment;
    this.attachmentDevicePresent = attachmentDevicePresent;
    this.random = random;
    this.onDebug = onDebug;
    this.budget = budget;
    this.screenBounds = screenBounds;
    this.registers = new Float32Array(32);
    this.nativeTaskBuffers = Boolean(nativeTaskBuffers);
    this.externalDraw = Boolean(externalDraw);
    if (this.nativeRefBuffers) {
      this.refBuffers = new ParticleRefBuffers(count, {
        memory: refBufferMemory,
        auxiliary: this.nativeTaskBuffers && !this.externalDraw,
        snapshot: refBufferSnapshot,
      });
      this.bindRefBuffers();
    } else {
      this.quads = new Uint8Array(count * PTCL_ABI.quadSize);
      this.backupQuads = new Uint8Array(this.quads.length);
      for (const key of ['positions', 'bases', 'rotations', 'scales'])
        this[key] = new Float32Array(count * 4);
      this.visibility = new Int32Array(count);
    }
    this.calls = new Map();
    this.messages = [];
    this.blendMode = 0;
    try {
      this.machine = new KCSMachine(script, this, shared);
      this.setRegisters(registers);
      if (!refBufferSnapshot) this.start();
    } catch (error) {
      this.refBuffers?.close();
      throw error;
    }
  }
  bindRefBuffers() {
    this.refBufferMemory = this.refBuffers.memory;
    for (const { name } of PTCL_REF_BUFFERS.slice(0, 7)) this[name] = this.refBuffers.get(name);
    this.partialBuffers = !this.refBuffers.dataReady;
  }
  requireBuffer(name, offset, size, read = false) {
    if (this.closed) throw new Error('Particle instance is released');
    if (this.partialBuffers) this.refBuffers.span(name, offset, size, read);
  }
  markBuffer(name, offset, size) {
    if (this.partialBuffers) this.refBuffers.mark(name, offset, size);
  }
  static fromSnapshot(script, state, options) {
    if (
      !state ||
      state.count !== options.count ||
      state.scriptVersion !== script.scriptVersion ||
      state.codeSize !== script.codeSize ||
      (options.profile &&
        nativeABI(options.profile).particle?.refBuffersFollowNativeHeap &&
        !state.buffers)
    )
      throw new Error(
        'Particle checkpoint requires its matching script, count and RefBuffer owners',
      );
    const instance = new ParticleScriptInstance(script, {
      ...options,
      refBufferSnapshot: state.buffers,
    });
    try {
      instance.restore(state, { restoreBuffers: false });
      return instance;
    } catch (error) {
      instance.close();
      throw error;
    }
  }
  start({ preserveState = false } = {}) {
    if (this.closed) throw new Error('Particle instance is released');
    this.active = true;
    if (preserveState) {
      this.hasFrame = false;
      return;
    }
    this.frame = 0;
    this.before = 0xffffffff;
    this.hasFrame = false;
    this.now = 0;
    if (this.refBuffers) {
      if (PTCL_REF_BUFFERS.slice(0, 7).some(({ name }) => this[name] === null)) return;
      for (const { name, stride } of PTCL_REF_BUFFERS.slice(0, 7))
        this.refBuffers.span(name, 0, this.count * stride);
    }
    if (this.count) {
      if (this.width === null || this.height === null)
        throw new Error(
          'Native particle texture dimensions are uninitialized at particle initialization',
        );
      const quad = initialParticle(this.width, this.height).vertices;
      for (let i = 0; i < this.count; i++) writePTCLQuad(this.quads, quad, i * 112);
    }
    this.backupQuads.set(this.quads);
    for (const key of ['positions', 'bases', 'rotations', 'scales']) this[key].fill(0);
    for (let i = 0; i < this.count; i++) this.scales.set([1, 1, 1, 0], i * 4);
    this.visibility.fill(1);
    if (this.refBuffers) {
      for (const { name, stride } of PTCL_REF_BUFFERS.slice(0, 7))
        this.refBuffers.mark(name, 0, this.count * stride);
      this.partialBuffers = false;
    }
  }
  stop() {
    this.active = false;
  }
  setRegisters(values) {
    if (values.length > 32) throw new RangeError('PTCL accepts 32 initialization registers');
    this.registers.fill(0);
    this.registers.set(values);
  }
  update(frame) {
    if (this.closed) throw new Error('Particle instance is released');
    if (!this.active) return { active: false, executed: 0 };
    if (!Number.isInteger(frame) || frame < 0 || frame > 0xffffffff)
      throw new RangeError('Invalid PTCL frame counter');
    this.before = this.hasFrame ? this.frame : 0xffffffff;
    this.frame = frame >>> 0;
    let executed = 0;
    // The original task completes its current particle loop even if exit()
    // deactivates the emitter in an earlier particle's main invocation.
    for (this.now = 0; this.now < this.count; this.now++) {
      this.machine.start();
      const result = this.machine.run({ budget: this.budget });
      executed += result.executed;
      if (result.status !== 'halted' && !(result.status === 'yielded' && !this.active))
        throw new Error(
          `PTCL ${this.script.name || 'script'} ${result.status} at particle ${this.now}, frame ${this.frame}`,
        );
    }
    this.hasFrame = true;
    return { active: this.active, executed };
  }
  vertices(index) {
    if (this.closed) throw new Error('Particle instance is released');
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new RangeError('PTCL particle index');
    this.requireBuffer('quads', index * 112, 112, true);
    return readPTCLQuad(this.quads, index * 112);
  }
  finishNativeTaskFrame() {
    // Native task idle commits its completion stamp after every VM invocation.
    this.before = this.frame;
    if (!this.refBuffers || !this.nativeTaskBuffers) return;
    if (this.externalDraw || this.refBuffers.get('depthPairs') === null) return;
    const owner = this.refBuffers,
      pairs = owner.get('depthPairs'),
      view = new DataView(pairs.buffer, pairs.byteOffset, pairs.byteLength),
      order = [],
      base = owner.entries.get('depthPairs').pointer + 4;
    const sources = new Map();
    const word = (name, at) => {
      this.requireBuffer(name, at, 4, true);
      if (!sources.has(name)) {
        const bytes = this[name];
        sources.set(name, new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
      }
      return sources.get(name)[at / 4];
    };
    for (let i = 0; i < this.count; i++) {
      owner.span('depthPairs', i * 8 + 4, 4);
      view.setUint32(i * 8 + 4, i, true);
      owner.mark('depthPairs', i * 8 + 4, 4);
      let depth = sseFloat32Arithmetic(
        'add',
        sseFloat32Arithmetic('add', word('positions', i * 16 + 8), word('bases', i * 16 + 8)),
        word('quads', i * 112 + 8),
      );
      if (this.zShifts)
        depth = sseFloat32Arithmetic(
          'subtract',
          depth,
          sseFloat32Arithmetic('multiply', floatBits(this.zShifts[i]), floatBits(65000)),
        );
      owner.span('depthPairs', i * 8, 4);
      view.setUint32(i * 8, depth, true);
      owner.mark('depthPairs', i * 8, 4);
      owner.span('sortIndices', i * 4, 4);
      owner.get('sortIndices')[i] = base + i * 8;
      owner.mark('sortIndices', i * 4, 4);
      order.push({ index: i, depth: bitsFloat(depth) });
    }
    sortParticleDepths(order, 0, order.length - 1);
    for (let i = 0; i < order.length; i++) owner.get('sortIndices')[i] = base + order[i].index * 8;
  }
  nativeDrawOrder() {
    if (!this.refBuffers || !this.nativeTaskBuffers || this.externalDraw) return undefined;
    const owner = this.refBuffers,
      base = owner.entries.get('depthPairs').pointer + 4,
      order = [];
    let view;
    for (let i = 0; i < this.count; i++) {
      owner.span('sortIndices', i * 4, 4, true);
      const offset = owner.get('sortIndices')[i] - base;
      if (offset < 0 || offset % 8)
        throw new Error('Particle sorting reference has no live depth owner');
      const pairs = owner.span('depthPairs', offset + 4, 4, true);
      view ??= new DataView(pairs.buffer, pairs.byteOffset, pairs.byteLength);
      const index = view.getUint32(offset + 4, true);
      if (index >= this.count)
        throw new Error('Particle sorting reference exceeds its particle count');
      order.push({ index });
    }
    return order;
  }
  currentAttachment() {
    return this.attachPlane === -1 ? null : this.attachment(this.attachPlane);
  }
  native(id, args, machine) {
    if (this.closed) throw new Error('Particle instance is released');
    const entry = this.nativeEntries?.[id];
    if (this.nativeEntries && entry?.status !== 'declared' && entry?.status !== 'recovered')
      throw new Error(`Unreviewed PTCL native ${this.profile}/${this.table}/${id}`);
    const contract = entry ?? particleNativeContract(this.script.scriptVersion, id),
      argumentWords = entry ? entry.signature.argumentWords : contract.parameters.length;
    const scalarFrame =
      this.math?.scalarArgumentsReadFrame && ((id >= 6 && id <= 21) || (id >= 41 && id <= 43));
    const stateFrame = this.stateArgumentsReadFrame && stateFrameIds.has(id);
    const geometryFrame = this.geometryArgumentsReadFrame && geometryFrameIds.has(id);
    if (
      argumentWords !== null &&
      !scalarFrame &&
      !stateFrame &&
      !geometryFrame &&
      !(id === 0 && this.debugUsesNativeLogger) &&
      args.length !== argumentWords
    )
      throw new Error(
        `PTCL ${contract.name} requires ${argumentWords} arguments, received ${args.length}`,
      );
    if (scalarFrame || stateFrame || geometryFrame)
      args = scalarArgumentWords(args, machine, argumentWords);
    this.calls.set(id, (this.calls.get(id) || 0) + 1);
    const scalar = (value) => nativeReply(1, value >>> 0);
    const real = (value) => scalar(floatBits(value));
    const voidReply = () => nativeReply(2);
    const floats = () => args.map(bitsFloat);
    const putFloat = (address, value) => machine.store(address, floatBits(value));
    const vectorOut = (values) => {
      args.forEach((address, i) => putFloat(address, values[i]));
    };
    const base = this.now * 4,
      quadOffset = this.now * 112;
    if (this.math?.atan2UsesX87 && id === 12) return scalar(x87Atan2Word(...args));
    if (this.interpreterMath && id === 16) return scalar(x87RemainderWord(...args));
    if (this.interpreterMath?.triangleWaveUsesX87 && id === 43)
      return scalar(x87TriangleWaveWord(...args));
    if (this.math?.lerpUsesSSEWords && id === 41) return scalar(linearInterpolateSSEWords(...args));
    const scalarReply =
      this.interpreterMath &&
      nativeScalarMath(
        particleScalarNames.get(id) ?? contract.name,
        args,
        machine,
        argumentWords,
        this.interpreterMath.anglesUseX87,
        this.interpreterMath.atan2UsesX87,
        this.interpreterMath.powUsesSSE2Identities,
        this.interpreterMath.trigUsesNativeReduction,
      );
    if (scalarReply) return scalarReply;
    if (scalarMath.has(id)) return real(scalarMath.get(id)(bitsFloat(args[0])));
    switch (id) {
      case 0: {
        const text = this.debugUsesNativeLogger
          ? new TextDecoder('shift_jis').decode(
              nativeLogBytes(formatNativeAt(args[0] ?? machine.nativeArgument(0), machine)),
            )
          : formatNative(machine.string(args[0]), machine);
        this.messages.push({ frame: this.frame, particle: this.now, text });
        this.onDebug?.(text);
        return voidReply();
      }
      case 1:
        return scalar(this.frame);
      case 2:
        return scalar(this.before);
      case 3:
        return scalar(calcFrame(args[0], this.fps, this.frameScale));
      case 4:
        return scalar(this.fps);
      case 5:
        machine.store(args[0], this.screenWidth);
        machine.store(args[1], this.screenHeight);
        return voidReply();
      case 12:
        return real(Math.atan2(...floats()));
      case 16: {
        const [a, b] = floats();
        return real(a % b);
      }
      case 18:
        return real(Math.pow(...floats()));
      case 21:
        return scalar(Math.abs(args[0] | 0));
      case 22:
      case 23:
      case 24: {
        if (this.geometryUsesSSEWords) {
          const sine = nativeTrigWord('sin', args[1], this.math?.trigUsesNativeReduction),
            cosine = nativeTrigWord('cos', args[1], this.math?.trigUsesNativeReduction);
          updatePTCLQuadWords(machine, args[0], 4, (words) =>
            rotateVectorSSEWords(words, id - 22, sine, cosine),
          );
          return voidReply();
        }
        if (this.quadUsesX87) {
          const sine = nativeTrigWord('sin', args[1], this.math?.trigUsesNativeReduction),
            cosine = nativeTrigWord('cos', args[1], this.math?.trigUsesNativeReduction);
          updatePTCLQuadWords(machine, args[0], 4, (words) =>
            x87RotateVectorWords(words, id - 22, sine, cosine),
          );
          return voidReply();
        }
        const quad = readPTCLQuad(machine.bytes(args[0], 112));
        for (const vertex of quad) {
          const rotated = rotateVector(
            [vertex.x, vertex.y, vertex.z],
            ['x', 'y', 'z'][id - 22],
            bitsFloat(args[1]),
          );
          [vertex.x, vertex.y, vertex.z] = rotated;
        }
        writePTCLQuad(machine.bytes(args[0], 112), quad);
        return voidReply();
      }
      case 25:
        if (this.geometryUsesSSEWords) {
          const [, dx, dy, dz] = args;
          updatePTCLQuadWords(machine, args[0], 4, ([x, y, z, w]) => [
            sseFloat32Arithmetic('add', x, dx),
            sseFloat32Arithmetic('add', dy, y),
            sseFloat32Arithmetic('add', dz, z),
            sseFloat32Arithmetic('add', 0, w),
          ]);
          return voidReply();
        }
        if (this.quadUsesX87) {
          const [, dx, dy, dz] = args;
          updatePTCLQuadWords(machine, args[0], 4, ([x, y, z, w]) => [
            x87AddWords(x, dx),
            x87AddWords(dy, y, true),
            x87AddWords(dz, z, true),
            x87AddWords(0, w, true),
          ]);
          return voidReply();
        }
      // Fall through to the shared quad transform on other profiles.
      case 26: {
        if (this.geometryUsesSSEWords) {
          const scale = args.slice(1);
          updatePTCLQuadWords(machine, args[0], 3, (words, vertex) =>
            words.map((word, i) =>
              vertex === 0 && i === 0
                ? sseFloat32Arithmetic('multiply', scale[i], word)
                : sseFloat32Arithmetic('multiply', word, scale[i]),
            ),
          );
          return voidReply();
        }
        if (this.quadUsesX87) {
          const scale = args.slice(1);
          updatePTCLQuadWords(machine, args[0], 3, (words, vertex) =>
            words.map((word, i) =>
              x87MultiplyWords(scale[i], word, Boolean(quadScaleMemoryOperands[vertex] & (1 << i))),
            ),
          );
          return voidReply();
        }
        const quad = readPTCLQuad(machine.bytes(args[0], 112));
        const values = args.slice(1).map(bitsFloat);
        for (const vertex of quad) {
          for (const [i, key] of ['x', 'y', 'z'].entries())
            vertex[key] = f(id === 25 ? vertex[key] + values[i] : vertex[key] * values[i]);
          if (id === 25) vertex.w = f(vertex.w + 0);
        }
        writePTCLQuad(machine.bytes(args[0], 112), quad);
        return voidReply();
      }
      case 27:
        this.requireBuffer('positions', base * 4, 16);
        if (this.stateCopiesRawWords) {
          new Uint32Array(
            this.positions.buffer,
            this.positions.byteOffset,
            this.positions.length,
          ).set([...args, 0], base);
          this.markBuffer('positions', base * 4, 16);
          return voidReply();
        }
        this.positions.set([...floats(), 0], base);
        this.markBuffer('positions', base * 4, 16);
        return voidReply();
      case 28:
        this.requireBuffer('positions', base * 4, 12, true);
        if (this.stateCopiesRawWords) {
          const words = new Uint32Array(
            this.positions.buffer,
            this.positions.byteOffset,
            this.positions.length,
          );
          args.forEach((address, i) => machine.store(address, words[base + i]));
          return voidReply();
        }
        vectorOut(this.positions.subarray(base, base + 3));
        return voidReply();
      case 29: {
        this.requireBuffer('quads', quadOffset + 20, 92);
        if (this.width === null || this.height === null)
          throw new Error(
            'Native particle texture dimensions are uninitialized at texture coordinates',
          );
        if (this.geometryUsesSSEWords) {
          const lo = sseFloat32Arithmetic('subtract', args[0], floatBits(0.5)),
            hi = sseFloat32Arithmetic('subtract', args[2], floatBits(0.5)),
            values = [
              [lo, lo],
              [hi, lo],
              [lo, hi],
              [hi, hi],
            ],
            view = new DataView(this.quads.buffer, this.quads.byteOffset, this.quads.byteLength);
          values.forEach(([u, v], i) => {
            view.setUint32(
              quadOffset + i * 28 + 20,
              sseFloat32Arithmetic('divide', u, floatBits(this.width)),
              true,
            );
            view.setUint32(
              quadOffset + i * 28 + 24,
              sseFloat32Arithmetic('divide', v, floatBits(this.height)),
              true,
            );
          });
          for (let i = 0; i < 4; i++) this.markBuffer('quads', quadOffset + i * 28 + 20, 8);
          return voidReply();
        }
        // The native slot reads two diagonal values as raw float32 words.
        const lo = f(bitsFloat(args[0]) - 0.5),
          hi = f(bitsFloat(args[2]) - 0.5),
          divideResult = this.textureCoordinatesUseX87 ? roundX87Single : f;
        const values = [
          [lo, lo],
          [hi, lo],
          [lo, hi],
          [hi, hi],
        ];
        const b = new DataView(this.quads.buffer, this.quads.byteOffset, this.quads.byteLength);
        for (let i = 0; i < 4; i++) {
          b.setFloat32(quadOffset + i * 28 + 20, divideResult(values[i][0] / this.width), true);
          b.setFloat32(quadOffset + i * 28 + 24, divideResult(values[i][1] / this.height), true);
        }
        for (let i = 0; i < 4; i++) this.markBuffer('quads', quadOffset + i * 28 + 20, 8);
        return voidReply();
      }
      case 30:
        this.requireBuffer('quads', quadOffset, 112, true);
        machine.bytes(args[0], 112).set(this.quads.subarray(quadOffset, quadOffset + 112));
        return voidReply();
      case 31:
        this.requireBuffer('quads', quadOffset, 112);
        this.quads.set(machine.bytes(args[0], 112), quadOffset);
        this.markBuffer('quads', quadOffset, 112);
        return voidReply();
      case 32:
        this.active = false;
        return nativeReply(4);
      case 33:
        return scalar(this.random.rand());
      case 34:
        return real(this.random.frand(this.interpreterMath?.randomFloatUsesX87));
      case 35:
        if (this.stateCopiesRawWords) {
          const words = new Uint32Array(this.registers.buffer);
          for (let i = 0; i < 32; i++) machine.store(args[0] + i * 4, words[i]);
          return voidReply();
        }
        for (let i = 0; i < 32; i++) putFloat(args[0] + i * 4, this.registers[i]);
        return voidReply();
      case 36:
        return scalar(this.now);
      case 37: {
        if (this.geometryUsesSSEWords) return scalar(particleDistanceSSEWord(args));
        if (this.distanceUsesX87) return scalar(x87DistanceWord(args));
        const [x1, y1, z1, x2, y2, z2] = floats();
        const dx = f(x1 - x2),
          dy = f(y1 - y2),
          dz = f(z1 - z2);
        return real(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
      }
      case 38: {
        if (this.priority === null)
          throw new Error('Native particle texture priority is uninitialized at projection bounds');
        const outputs = args.slice(1);
        if (this.geometryUsesSSEWords) {
          outputs.forEach((address) => machine.region(address, 4));
          const words = particleProjectionSSEWords(
            args[0],
            this.screenWidth,
            this.screenHeight,
            this.priority,
            this.near,
          );
          outputs.forEach((address, i) => machine.store(address, words[i]));
          return voidReply();
        }
        if (this.projectionBoundsUseX87) {
          outputs.forEach((address) => machine.region(address, 4));
          const words = x87ProjectionBoundsWords(
            args[0],
            this.screenWidth,
            this.screenHeight,
            this.priority,
            this.near,
            this.projectionBoundsUseSSE,
          );
          outputs.forEach((address, i) => machine.store(address, words[i]));
          return voidReply();
        }
        const bounds = this.screenBounds(
          bitsFloat(args[0]),
          this.screenWidth,
          this.screenHeight,
          this.priority,
          this.near,
        );
        outputs.forEach((address, i) => putFloat(address, bounds[i]));
        return voidReply();
      }
      case 39:
        if (args[0] < this.count) {
          this.requireBuffer('visibility', args[0] * 4, 4);
          this.visibility[args[0]] = args[1] | 0;
          this.markBuffer('visibility', args[0] * 4, 4);
        }
        return voidReply();
      case 40:
        return scalar(this.count - 1);
      case 41:
        return real(
          (this.math?.lerpUsesX87 ? x87LinearInterpolate : linearInterpolate)(...floats()),
        );
      case 42:
        return scalar(roundInteger(bitsFloat(args[0]), this.interpreterMath?.roundIntegerResult));
      case 43:
        return real(triangleWave(...floats()));
      case 44:
        if (this.partialBuffers) this.refBuffers.copy('quads', 'backupQuads');
        else this.quads.set(this.backupQuads);
        return voidReply();
      case 45:
        if (this.partialBuffers) this.refBuffers.copy('backupQuads', 'quads');
        else this.backupQuads.set(this.quads);
        return voidReply();
      case 46:
        return scalar(this.attachPlane);
      case 47: {
        if (!this.attachmentReadsRegistrationWord)
          return scalar(this.currentAttachment()?.disp || 0);
        if (this.attachmentDevicePresent?.() === false) return scalar(0);
        const attachment = this.currentAttachment();
        if (attachment === undefined && this.attachmentRequiresProvider)
          throw new Error('Particle attachment graph mapping is unavailable');
        if (!attachment) return scalar(0);
        const word = attachment.registrationWord;
        if (!Number.isInteger(word) || word < 0 || word > 0xffffffff)
          throw new Error('Particle attachment registration word is unavailable');
        return scalar(word);
      }
      case 48:
      case 49: {
        const field = id === 48 ? 'base' : 'pos';
        let position, attachment;
        if (this.attachmentPositionRequiresOwner) {
          if (this.attachPlane !== -1 && this.attachmentDevicePresent?.() !== false) {
            attachment = this.currentAttachment();
            position = attachment?.[field];
            // The native owner lookup reports null for a missing group. A
            // resolved group can still lack its model and leave scratch unwritten.
            if (!position && !(this.missingAttachmentGroupWritesZero && attachment === null))
              throw new Error('Particle position requires a live attachment graph');
          }
          args.forEach((address) => machine.region(address, 4));
        } else position = this.currentAttachment()?.[field];
        const words = this.attachmentCopiesRawWords && attachment?.[`${field}Words`];
        if (words) {
          if (
            words.length < args.length ||
            !Array.from(words).every(
              (word) => Number.isInteger(word) && word >= 0 && word <= 0xffffffff,
            )
          )
            throw new Error('Particle attachment vector words are unavailable');
          args.forEach((address, index) => machine.store(address, words[index]));
        } else vectorOut(position || [0, 0, 0]);
        return voidReply();
      }
      case 50:
        this.blendMode = args[0] >= 1 && args[0] <= 5 ? args[0] : 0;
        return voidReply();
      default:
        throw new Error(`Unhandled PTCL native ${id}`);
    }
  }
  snapshot() {
    if (this.closed) throw new Error('Particle instance is released');
    return {
      scriptVersion: this.script.scriptVersion,
      codeSize: this.script.codeSize,
      count: this.count,
      machine: this.machine.snapshot(),
      shared: this.machine.shared.slice(),
      ...(this.refBuffers
        ? {
            buffers: this.refBuffers.snapshot(),
            nativeTaskBuffers: this.nativeTaskBuffers,
            externalDraw: this.externalDraw,
          }
        : {
            quads: this.quads.slice(),
            backupQuads: this.backupQuads.slice(),
            positions: this.positions.slice(),
            bases: this.bases.slice(),
            rotations: this.rotations.slice(),
            scales: this.scales.slice(),
            visibility: this.visibility.slice(),
          }),
      registers: this.registers.slice(),
      frame: this.frame,
      before: this.before,
      hasFrame: this.hasFrame,
      now: this.now,
      active: this.active,
      blendMode: this.blendMode,
      attachPlane: this.attachPlane,
      random: this.random.snapshot(),
    };
  }
  restore(state, { restoreBuffers = true } = {}) {
    if (this.closed) throw new Error('Particle instance is released');
    if (
      state.scriptVersion !== this.script.scriptVersion ||
      state.codeSize !== this.script.codeSize ||
      state.count !== this.count
    )
      throw new Error('PTCL checkpoint does not match script or particle count');
    if (this.refBuffers) {
      if (
        state.nativeTaskBuffers !== this.nativeTaskBuffers ||
        state.externalDraw !== this.externalDraw
      )
        throw new Error('Particle RefBuffer checkpoint task ownership mismatch');
      if (restoreBuffers) {
        const options = {
          memory: this.refBufferMemory,
          auxiliary: this.nativeTaskBuffers && !this.externalDraw,
        };
        this.refBuffers.validateSnapshot(state.buffers, [...this.refBuffers.entries.values()]);
        this.refBuffers.close();
        this.refBuffers = new ParticleRefBuffers(this.count, {
          ...options,
          snapshot: state.buffers,
        });
        this.bindRefBuffers();
      }
    }
    for (const key of this.refBuffers
      ? ['registers']
      : [
          'quads',
          'backupQuads',
          'positions',
          'bases',
          'rotations',
          'scales',
          'visibility',
          'registers',
        ]) {
      if (state[key]?.length !== this[key].length) throw new Error(`PTCL checkpoint ${key} length`);
      this[key].set(state[key]);
    }
    if (state.shared.length !== this.machine.shared.length)
      throw new Error('PTCL checkpoint shared length');
    this.machine.restore(state.machine);
    this.machine.shared.set(state.shared);
    this.random.restore(state.random);
    for (const key of ['frame', 'before', 'hasFrame', 'now', 'active', 'blendMode', 'attachPlane'])
      this[key] = state[key];
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.refBuffers?.close();
  }
}
