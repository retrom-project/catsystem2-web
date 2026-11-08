// SPDX-License-Identifier: MPL-2.0
import { KCSMachine, nativeReply, floatBits, bitsFloat, formatNative } from '../kcs.mjs';
import { PTCL_ABI, initialParticle, readPTCLQuad, writePTCLQuad } from './abi.mjs';
import { particleNativeContract } from './contracts.mjs';
import { ParticleRandom } from './random.mjs';
import {
  calcFrame,
  degreeToRadian,
  radianToDegree,
  linearInterpolate,
  roundInteger,
  triangleWave,
  rotateVector,
  projectionBounds,
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

export class ParticleScriptInstance {
  constructor(script, options = {}) {
    const {
      count,
      width,
      height,
      screenWidth,
      screenHeight,
      fps = 60,
      priority = 0,
      registers = [],
      attachPlane = -1,
      attachment = () => null,
      random = new ParticleRandom(),
      shared = new Uint8Array(0),
      onDebug = null,
      budget = 5000000,
    } = options;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000)
      throw new RangeError('Invalid PTCL particle count');
    for (const [key, value] of Object.entries({ width, height, screenWidth, screenHeight }))
      if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid PTCL ${key}`);
    this.script = script;
    this.count = count;
    this.width = f(width);
    this.height = f(height);
    this.screenWidth = screenWidth >>> 0;
    this.screenHeight = screenHeight >>> 0;
    this.fps = fps >>> 0;
    this.priority = f(priority);
    this.attachPlane = attachPlane | 0;
    this.attachment = attachment;
    this.random = random;
    this.onDebug = onDebug;
    this.budget = budget;
    this.registers = new Float32Array(32);
    this.quads = new Uint8Array(count * PTCL_ABI.quadSize);
    this.backupQuads = new Uint8Array(this.quads.length);
    for (const key of ['positions', 'bases', 'rotations', 'scales'])
      this[key] = new Float32Array(count * 4);
    this.visibility = new Int32Array(count);
    this.calls = new Map();
    this.messages = [];
    this.blendMode = 0;
    this.machine = new KCSMachine(script, this, shared);
    this.setRegisters(registers);
    this.start();
  }
  start() {
    this.active = true;
    this.frame = 0;
    this.before = 0xffffffff;
    this.hasFrame = false;
    this.now = 0;
    const quad = initialParticle(this.width, this.height).vertices;
    for (let i = 0; i < this.count; i++) writePTCLQuad(this.quads, quad, i * 112);
    this.backupQuads.set(this.quads);
    for (const key of ['positions', 'bases', 'rotations', 'scales']) this[key].fill(0);
    for (let i = 0; i < this.count; i++) this.scales.set([1, 1, 1, 0], i * 4);
    this.visibility.fill(1);
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
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new RangeError('PTCL particle index');
    return readPTCLQuad(this.quads, index * 112);
  }
  currentAttachment() {
    return this.attachPlane === -1 ? null : this.attachment(this.attachPlane);
  }
  native(id, args, machine) {
    const contract = particleNativeContract(this.script.scriptVersion, id);
    if (args.length !== contract.parameters.length)
      throw new Error(
        `PTCL ${contract.name} requires ${contract.parameters.length} arguments, received ${args.length}`,
      );
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
    if (scalarMath.has(id)) return real(scalarMath.get(id)(bitsFloat(args[0])));
    switch (id) {
      case 0: {
        const text = formatNative(machine.string(args[0]), machine);
        this.messages.push({ frame: this.frame, particle: this.now, text });
        this.onDebug?.(text);
        return voidReply();
      }
      case 1:
        return scalar(this.frame);
      case 2:
        return scalar(this.before);
      case 3:
        return scalar(calcFrame(args[0], this.fps));
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
      case 26: {
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
        this.positions.set([...floats(), 0], base);
        return voidReply();
      case 28:
        vectorOut(this.positions.subarray(base, base + 3));
        return voidReply();
      case 29: {
        // Native 2.6.1.76 reads raw float words despite SDK's long declaration.
        const lo = f(bitsFloat(args[0]) - 0.5),
          hi = f(bitsFloat(args[2]) - 0.5);
        const values = [
          [lo, lo],
          [hi, lo],
          [lo, hi],
          [hi, hi],
        ];
        const b = new DataView(this.quads.buffer);
        for (let i = 0; i < 4; i++) {
          b.setFloat32(quadOffset + i * 28 + 20, f(values[i][0] / this.width), true);
          b.setFloat32(quadOffset + i * 28 + 24, f(values[i][1] / this.height), true);
        }
        return voidReply();
      }
      case 30:
        machine.bytes(args[0], 112).set(this.quads.subarray(quadOffset, quadOffset + 112));
        return voidReply();
      case 31:
        this.quads.set(machine.bytes(args[0], 112), quadOffset);
        return voidReply();
      case 32:
        this.active = false;
        return nativeReply(4);
      case 33:
        return scalar(this.random.rand());
      case 34:
        return real(this.random.frand());
      case 35:
        for (let i = 0; i < 32; i++) putFloat(args[0] + i * 4, this.registers[i]);
        return voidReply();
      case 36:
        return scalar(this.now);
      case 37: {
        const [x1, y1, z1, x2, y2, z2] = floats();
        const dx = f(x1 - x2),
          dy = f(y1 - y2),
          dz = f(z1 - z2);
        return real(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
      }
      case 38: {
        const bounds = projectionBounds(
          bitsFloat(args[0]),
          this.screenWidth,
          this.screenHeight,
          this.priority,
        );
        args.slice(1).forEach((address, i) => putFloat(address, bounds[i]));
        return voidReply();
      }
      case 39:
        if (args[0] < this.count) this.visibility[args[0]] = args[1] | 0;
        return voidReply();
      case 40:
        return scalar(this.count - 1);
      case 41:
        return real(linearInterpolate(...floats()));
      case 42:
        return scalar(roundInteger(bitsFloat(args[0])));
      case 43:
        return real(triangleWave(...floats()));
      case 44:
        this.quads.set(this.backupQuads);
        return voidReply();
      case 45:
        this.backupQuads.set(this.quads);
        return voidReply();
      case 46:
        return scalar(this.attachPlane);
      case 47:
        return scalar(this.currentAttachment()?.disp || 0);
      case 48:
        vectorOut(this.currentAttachment()?.base?.slice(0, 2) || [0, 0]);
        return voidReply();
      case 49:
        vectorOut(this.currentAttachment()?.pos || [0, 0, 0]);
        return voidReply();
      case 50:
        this.blendMode = args[0] >= 1 && args[0] <= 5 ? args[0] : 0;
        return voidReply();
      default:
        throw new Error(`Unhandled PTCL native ${id}`);
    }
  }
  snapshot() {
    return {
      scriptVersion: this.script.scriptVersion,
      codeSize: this.script.codeSize,
      count: this.count,
      machine: this.machine.snapshot(),
      shared: this.machine.shared.slice(),
      quads: this.quads.slice(),
      backupQuads: this.backupQuads.slice(),
      positions: this.positions.slice(),
      bases: this.bases.slice(),
      rotations: this.rotations.slice(),
      scales: this.scales.slice(),
      visibility: this.visibility.slice(),
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
  restore(state) {
    if (
      state.scriptVersion !== this.script.scriptVersion ||
      state.codeSize !== this.script.codeSize ||
      state.count !== this.count
    )
      throw new Error('PTCL checkpoint does not match script or particle count');
    for (const key of [
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
}
