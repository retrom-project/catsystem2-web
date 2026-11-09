// SPDX-License-Identifier: MPL-2.0
import { KCSMachine, nativeReply, floatBits, bitsFloat, formatNative } from '../kcs.mjs';
import { nativeCatalog } from '../native/catalog.mjs';
import { ParticleRandom } from '../ppi/random.mjs';
import {
  degreeToRadian,
  radianToDegree,
  linearInterpolate,
  roundInteger,
  triangleWave,
  rotateVector,
} from '../ppi/numeric.mjs';
import { MOTION_ABI, initialMotionObject } from './abi.mjs';
import {
  identity,
  inverse,
  multiply,
  transform,
  normalize,
  lengthSquared,
  translation,
  scaling,
  rotation,
  rotationAxis,
  yawPitchRoll,
} from './matrix.mjs';

const f = Math.fround;
const unary = new Map([
  [1, Math.sin],
  [2, Math.cos],
  [3, Math.tan],
  [4, Math.asin],
  [5, Math.acos],
  [6, Math.atan],
  [8, Math.ceil],
  [9, Math.abs],
  [10, Math.floor],
  [12, Math.sqrt],
  [14, degreeToRadian],
  [15, radianToDegree],
]);

export class MotionInstance {
  constructor(
    script,
    {
      profile,
      registers = [],
      registerWords = null,
      extra = null,
      delay = 0,
      flags = 0,
      random = new ParticleRandom(),
      onDebug = null,
      budget = 5000000 /* exe-address-check: non-address - instruction budget */,
    } = {},
  ) {
    this.script = script;
    this.profile = profile;
    this.contracts = nativeCatalog(profile, 'generic');
    this.shared = new Uint8Array(MOTION_ABI.sharedSize);
    this.view = new DataView(this.shared.buffer);
    this.object.set(initialMotionObject());
    this.delay = delay >>> 0;
    this.random = random;
    this.onDebug = onDebug;
    this.budget = budget;
    this.calls = new Map();
    this.messages = [];
    this.machine = new KCSMachine(script, this, this.shared);
    this.view.setInt32(MOTION_ABI.active, 1, true);
    this.view.setUint32(MOTION_ABI.flags, flags, true);
    this.setRegisters(registers);
    if (registerWords) this.setRegisterWords(registerWords);
    if (extra) this.setExtra(extra);
  }
  get object() {
    return this.shared.subarray(0, MOTION_ABI.objectSize);
  }
  get frame() {
    return this.view.getInt32(MOTION_ABI.frame, true);
  }
  get active() {
    return this.view.getInt32(MOTION_ABI.active, true) !== 0;
  }
  get skip() {
    return this.view.getInt32(MOTION_ABI.skip, true) !== 0;
  }
  setRegisters(registers) {
    for (let i = 0; i < MOTION_ABI.registerCount; i++)
      this.view.setFloat32(MOTION_ABI.registers + i * 4, registers[i] ?? 0, true);
    this.view.setInt32(MOTION_ABI.active, 1, true);
  }
  setRegisterWords(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length % 4)
      throw new TypeError('MOT register words must be raw DWORDs');
    this.shared.fill(0, MOTION_ABI.registers, MOTION_ABI.registers + 1024);
    this.shared.set(bytes.subarray(0, 1024), MOTION_ABI.registers);
    this.view.setInt32(MOTION_ABI.active, 1, true);
  }
  setExtra(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('MOT extra data must be bytes');
    const old = this.view.getUint32(MOTION_ABI.extraData, true);
    if (old) this.machine.free(old);
    const address = bytes.length ? this.machine.allocate(bytes.length) : 0;
    if (bytes.length) this.machine.bytes(address, bytes.length).set(bytes);
    this.view.setUint32(MOTION_ABI.extraData, address, true);
    this.view.setUint32(MOTION_ABI.extraSize, bytes.length, true);
  }
  setSkip(enabled = true) {
    this.view.setInt32(MOTION_ABI.skip, Number(enabled), true);
  }
  run() {
    // Native sub_8773A0 resets PC/SP/floor/FP, retaining data and heap allocations.
    this.machine.start();
    const result = this.machine.run({ budget: this.budget });
    if (result.status !== 'halted' && !(result.status === 'yielded' && !this.active))
      throw new Error(
        `MOT ${this.script.name || '<script>'} ${result.status} at frame ${this.frame}`,
      );
    return { ...result, active: this.active, frame: this.frame };
  }
  update(elapsed) {
    if (!Number.isInteger(elapsed) || elapsed < 0 || elapsed > 0xffffffff)
      throw new RangeError('MOT elapsed frame must be uint32');
    if (!this.skip && elapsed < this.delay)
      return { active: this.active, executed: 0, delayed: true };
    this.view.setUint32(MOTION_ABI.frame, elapsed - this.delay, true);
    // Native updates still execute inactive records until their owner removes them.
    return this.run();
  }
  finish() {
    const saved = this.shared.slice(MOTION_ABI.frame, MOTION_ABI.registers);
    this.view.setInt32(MOTION_ABI.frame, -1, true);
    this.setSkip();
    try {
      return this.run();
    } finally {
      this.shared.set(saved, MOTION_ABI.frame);
    }
  }
  native(id, args, machine) {
    const contract = this.contracts[id];
    if (!contract || contract.status === 'unknown' || !contract.parameters)
      throw new Error(`Unrecovered MOT native ${this.profile}:${id.toString(16)}`);
    if (id !== 0 && args.length !== contract.parameters.length)
      throw new Error(
        `MOT ${contract.name} expects ${contract.parameters.length} arguments, got ${args.length}`,
      );
    const word = (value) => nativeReply(1, value >>> 0),
      real = (value) => word(floatBits(f(value))),
      done = () => nativeReply(2),
      values = () => args.map(bitsFloat);
    const vector = (address, count) =>
      Array.from({ length: count }, (_, i) => bitsFloat(machine.load(address + i * 4)));
    const put = (address, numbers) =>
      numbers.forEach((value, i) => machine.store(address + i * 4, floatBits(value)));
    this.calls.set(id, (this.calls.get(id) || 0) + 1);
    if (unary.has(id)) return real(unary.get(id)(bitsFloat(args[0])));
    switch (id) {
      case 0: {
        const text = formatNative(machine.string(args[0]), machine);
        this.messages.push({ frame: this.frame, text });
        this.onDebug?.(text);
        return done();
      }
      case 7:
        return real(Math.atan2(...values()));
      case 11: {
        const [a, b] = values();
        return real(a % b);
      }
      case 13:
        return real(Math.pow(...values()));
      case 16:
        return word(Math.abs(args[0] | 0));
      case 17:
        return word(roundInteger(bitsFloat(args[0])));
      case 18:
      case 19:
      case 20: {
        const vector = args.slice(0, 3).map((address) => bitsFloat(machine.load(address)));
        const rotated = rotateVector(vector, ['x', 'y', 'z'][id - 18], bitsFloat(args[3]));
        args.slice(0, 3).forEach((address, i) => machine.store(address, floatBits(rotated[i])));
        return done();
      }
      case 21:
      case 22: {
        const vector = args.slice(0, 3).map((address) => bitsFloat(machine.load(address)));
        args
          .slice(0, 3)
          .forEach((address, i) =>
            machine.store(
              address,
              floatBits(
                f(
                  id === 21
                    ? vector[i] + bitsFloat(args[i + 3])
                    : vector[i] * bitsFloat(args[i + 3]),
                ),
              ),
            ),
          );
        return done();
      }
      case 23: {
        let matrix = vector(args[0], 16);
        args.slice(1).forEach((angle, i) => {
          matrix = multiply(matrix, rotation(['x', 'y', 'z'][i], bitsFloat(angle)));
        });
        put(args[0], matrix);
        return done();
      }
      case 24:
      case 25:
        put(
          args[0],
          multiply(
            vector(args[0], 16),
            (id === 24 ? translation : scaling)(...args.slice(1).map(bitsFloat)),
          ),
        );
        return done();
      case 26:
        put(args[0], identity());
        return done();
      case 27: {
        const inverted = inverse(vector(args[0], 16));
        if (inverted) put(args[0], inverted);
        return done();
      }
      case 28:
        machine.bytes(args[0], 64).set(machine.bytes(args[1], 64).slice());
        return done();
      case 29:
        put(args[0], multiply(vector(args[0], 16), vector(args[1], 16)));
        return done();
      case 30:
        put(
          args[0],
          vector(args[0], 16).map((n, i) => f(n - vector(args[1], 16)[i])),
        );
        return done();
      case 31:
        put(args[0], normalize(vector(args[0], 4)));
        return done();
      case 32:
      case 33:
        put(
          args[0],
          vector(args[0], 4).map((n, i) =>
            f(id === 32 ? n + vector(args[1], 4)[i] : n - vector(args[1], 4)[i]),
          ),
        );
        return done();
      case 34:
        return real(Math.sqrt(lengthSquared(vector(args[0], 4))));
      case 35:
        return real(lengthSquared(vector(args[0], 4)));
      case 36:
        put(
          args[0],
          vector(args[0], 4).map((n) => f(n * bitsFloat(machine.load(args[1])))),
        );
        return done();
      case 37:
        put(args[0], transform(vector(args[0], 4), vector(args[1], 16)));
        return done();
      case 43:
        put(args[0], multiply(vector(args[0], 16), yawPitchRoll(...args.slice(1).map(bitsFloat))));
        return done();
      case 44: {
        const reference = vector(args[1], 16),
          angles = vector(args[2], 3);
        const x = transform([-1, 0, 0, 0], reference);
        x[1] = 0;
        const axes = [normalize(x), [0, -1, 0, 0], normalize(transform([0, 0, -1, 0], reference))];
        let matrix = vector(args[0], 16);
        axes.forEach((axis, i) => {
          matrix = multiply(matrix, rotationAxis(axis.slice(0, 3), angles[i]));
        });
        put(args[0], matrix);
        return done();
      }
      case 38:
        this.view.setInt32(MOTION_ABI.active, 0, true);
        return nativeReply(4);
      case 39:
        return word(this.random.rand());
      case 40:
        return real(this.random.frand());
      case 41:
        return real(linearInterpolate(...values()));
      case 42:
        return real(triangleWave(...values()));
      default:
        throw new Error(`MOT native ${contract.name} is not implemented`);
    }
  }
  snapshot() {
    return {
      profile: this.profile,
      name: this.script.name || null,
      shared: this.shared.slice(),
      delay: this.delay,
      machine: this.machine.snapshot(),
      random: this.random.snapshot(),
      calls: [...this.calls],
      messages: structuredClone(this.messages),
    };
  }
  restore(state) {
    if (
      state.profile !== this.profile ||
      state.name !== (this.script.name || null) ||
      !(state.shared instanceof Uint8Array) ||
      state.shared.length !== this.shared.length
    )
      throw new Error('MOT checkpoint profile/script/shared-state mismatch');
    this.shared.set(state.shared);
    this.delay = state.delay >>> 0;
    this.machine.restore(state.machine);
    this.random.restore(state.random);
    this.calls = new Map(state.calls);
    this.messages = structuredClone(state.messages);
  }
}
