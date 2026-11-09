// SPDX-License-Identifier: MPL-2.0
import { NativePPIRuntime } from './native-runtime.mjs';
export { NativePPIRuntime } from './native-runtime.mjs';
import { initialParticle, readPPIRecord, writePPIRecord, writePPIParameters } from './abi.mjs';
import { bitsFloat } from '../kcs/vm.mjs';
import {
  degreeToRadian,
  radianToDegree,
  roundInteger,
  rotateVector,
  linearInterpolate,
  triangleWave,
} from './numeric.mjs';

const f = Math.fround;
const functions = [
  null,
  null,
  null,
  null,
  degreeToRadian,
  radianToDegree,
  Math.sin,
  Math.cos,
  Math.tan,
  Math.asin,
  Math.acos,
  Math.atan,
  Math.atan2,
  Math.ceil,
  Math.abs,
  Math.floor,
  (a, b) => a % b,
  Math.sqrt,
  Math.pow,
];

export class NativePPI {
  static async open(bytes, options) {
    const runtime = await NativePPIRuntime.open(options);
    try {
      const instance = await runtime.create(bytes, options);
      instance.ownsRuntime = true;
      return instance;
    } catch (error) {
      runtime.close();
      throw error;
    }
  }
  static async fromSnapshot(state, options) {
    const runtime = await NativePPIRuntime.fromSnapshot(state, options);
    if (runtime.instances.size !== 1) {
      runtime.close();
      throw new Error('NativePPI snapshot requires one instance');
    }
    const instance = [...runtime.instances.values()][0];
    instance.ownsRuntime = true;
    return instance;
  }
  constructor(runtime, options) {
    this.runtime = runtime;
    this.options = options;
    this.count = options.count;
    if (!Number.isSafeInteger(this.count) || this.count < 0 || this.count > 1000000)
      throw new RangeError('Invalid native PPI particle count');
    this.process = runtime.process;
    this.services = runtime.services;
    this.random = runtime.random;
    this.registers = new Float32Array(32);
    this.setRegisters(options.registers || []);
    this.attachPlane = options.attachPlane ?? -1;
    this.attachment = options.attachment || (() => null);
    this.zShifts = new Float32Array(this.count);
    this.renderStates = new Map();
    this.samplerStates = new Map();
    this.calls = new Map();
    this.active = true;
    this.frame = 0;
    this.before = 0xffffffff;
    this.hasFrame = false;
  }
  load(module) {
    const p = this.process;
    this.module = module;
    this.identity = module.identity;
    this.version = module.version;
    this.context = p.allocate(4, true);
    this.id = this.context;
    this.runtime.instances.set(this.id, this);
    this.instance = this.invoke(
      () => p.call(this.module.export(1), [this.context]),
      'MakeInstance',
    );
    if (!this.instance) throw new Error('PPI MakeInstance returned null');
    this.hostFunctions = p.allocate(4);
    p.store(this.hostFunctions, this.runtime.hostTable);
    this.particleAddress = p.allocate(this.count * 148, true);
    this.parameterAddress = p.allocate(148, true);
    p.store(this.instance + 8, this.hostFunctions);
    p.store(this.instance + 12, this.particleAddress);
    for (let i = 0; i < this.count; i++) {
      const record = new Uint8Array(148);
      writePPIRecord(record, initialParticle(this.options.width, this.options.height));
      p.write(this.particleAddress + i * 148, record);
    }
    if (this.options.autoStart !== false) this.start();
    else {
      this.active = false;
      this.stopped = true;
    }
  }
  invoke(callback, entry) {
    return this.runtime.invoke(this, callback, entry);
  }
  setRegisters(values) {
    if (values.length > 32) throw new RangeError('PPI accepts32 parameters');
    this.registers.fill(0);
    this.registers.set(values);
  }
  prepareCallback() {
    const p = this.process,
      attachment = this.attachPlane === -1 ? null : this.attachment(this.attachPlane);
    const record = new Uint8Array(148);
    writePPIParameters(record, {
      count: this.count,
      screenWidth: this.options.screenWidth,
      screenHeight: this.options.screenHeight,
      width: this.options.width,
      height: this.options.height,
      values: this.registers,
    });
    p.write(this.parameterAddress, record);
    p.store(this.instance + 20, this.attachPlane);
    // The native graph getters preserve the fields of an unresolved model.
    if (this.attachPlane === -1) p.zero(this.instance + 24, 28);
    else if (attachment) {
      this.writeVector(this.instance + 24, attachment.base || [0, 0, 0]);
      this.writeVector(this.instance + 36, attachment.pos || [0, 0, 0]);
      p.store(this.instance + 48, attachment.disp || 0);
    }
  }
  virtual(slot, args) {
    return this.invoke(
      () =>
        this.process.call(
          this.process.load(this.process.load(this.instance) + slot * 4),
          args,
          this.instance,
        ),
      ['destructor', 'Init', 'Exec', 'Stop'][slot] || `virtual[${slot}]`,
    );
  }
  start() {
    this.active = true;
    this.frame = 0;
    this.before = 0xffffffff;
    this.hasFrame = false;
    this.stopped = false;
    this.prepareCallback();
    this.virtual(1, [this.parameterAddress]);
  }
  exec(before, frame) {
    if (!this.active) return;
    this.before = before >>> 0;
    this.frame = frame >>> 0;
    this.prepareCallback();
    this.virtual(2, [this.parameterAddress, this.before, this.frame]);
    this.hasFrame = true;
  }
  update(frame) {
    this.exec(this.hasFrame ? this.frame : 0xffffffff, frame);
  }
  stop() {
    this.prepareCallback();
    this.virtual(3, [this.parameterAddress]);
    this.active = false;
    this.stopped = true;
  }
  records() {
    return this.process.read(this.particleAddress, this.count * 148);
  }
  particles() {
    const bytes = this.records();
    return Array.from({ length: this.count }, (_, i) => readPPIRecord(bytes, i * 148));
  }
  get blendMode() {
    return this.process.load(this.instance + 16);
  }
  readVector(address) {
    const bytes = this.process.read(address, 12),
      b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [0, 4, 8].map((i) => b.getFloat32(i, true));
  }
  writeVector(address, vector) {
    const bytes = new Uint8Array(12),
      b = new DataView(bytes.buffer);
    vector.forEach((n, i) => b.setFloat32(i * 4, n, true));
    this.process.write(address, bytes);
  }
  host(slot, args) {
    this.calls.set(slot, (this.calls.get(slot) || 0) + 1);
    const p = this.process,
      values = args.map(bitsFloat);
    if (functions[slot]) return functions[slot](...values);
    switch (slot) {
      case 0:
        p.store(args[1], this.options.screenWidth);
        p.store(args[2], this.options.screenHeight);
        return;
      case 1:
        this.active = false;
        return;
      case 2:
        return this.random.rand();
      case 3:
        return this.random.frand();
      case 19:
        throw new Error(
          'PPI PPF.abs targets the original recursive virtual slot; execution cannot return',
        );
      case 20:
        return roundInteger(values[0]);
      case 21:
      case 22:
      case 23:
        this.writeVector(
          args[0],
          rotateVector(this.readVector(args[0]), ['x', 'y', 'z'][slot - 21], values[1]),
        );
        return;
      case 24: {
        let vector = this.readVector(args[0]);
        for (const axis of ['x', 'y', 'z']) vector = rotateVector(vector, axis, values[1]);
        this.writeVector(args[0], vector);
        return;
      }
      case 25:
      case 26:
        this.writeVector(
          args[0],
          this.readVector(args[0]).map((n, i) =>
            f(slot === 25 ? n + values[i + 1] : n * values[i + 1]),
          ),
        );
        return;
      case 27: {
        const a = this.readVector(args[0]),
          b = this.readVector(args[1]),
          d = a.map((n, i) => f(n - b[i]));
        return f(Math.sqrt(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2]))));
      }
      case 28: {
        const a = this.readVector(args[0]),
          length = f(Math.sqrt(f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]))));
        this.writeVector(
          args[0],
          a.map((n) => (length ? f(n / length) : 0)),
        );
        return;
      }
      case 29:
        return linearInterpolate(...values);
      case 30:
        return triangleWave(...values);
      case 31:
        if (args[1] < this.count) this.zShifts[args[1]] = values[2];
        return;
      case 32: {
        if (typeof this.options.readParticleData !== 'function')
          throw new Error('PPI requires a synchronous ptcldat resource service');
        const name = p.string(args[0]),
          bytes = this.options.readParticleData(name);
        if (bytes && !(bytes instanceof Uint8Array))
          throw new TypeError('PPI ptcldat service must supply bytes before native execution');
        if (!bytes) return 0;
        if (args[1]) p.write(args[1], bytes);
        return bytes.length;
      }
      case 33:
        this.renderStates.set(args[1], args[2]);
        return;
      case 34:
        this.samplerStates.set(args[1], args[2]);
        return;
      default:
        throw new Error(`Unhandled PPI host slot ${slot}`);
    }
  }
  saveState() {
    const options = Object.fromEntries(
      ['name', 'count', 'width', 'height', 'screenWidth', 'screenHeight'].map((key) => [
        key,
        this.options[key],
      ]),
    );
    return {
      id: this.id,
      identity: this.identity,
      moduleKey: this.module.key,
      version: this.version,
      options,
      instance: this.instance,
      particleAddress: this.particleAddress,
      parameterAddress: this.parameterAddress,
      context: this.context,
      hostFunctions: this.hostFunctions,
      registers: this.registers.slice(),
      zShifts: this.zShifts.slice(),
      renderStates: [...this.renderStates],
      samplerStates: [...this.samplerStates],
      active: this.active,
      stopped: this.stopped,
      frame: this.frame,
      before: this.before,
      hasFrame: this.hasFrame,
      attachPlane: this.attachPlane,
    };
  }
  loadState(state) {
    if (
      state.identity !== this.identity ||
      state.version !== this.version ||
      state.options.count !== this.count
    )
      throw new Error('PPI snapshot does not match loaded DLL/count');
    this.registers.set(state.registers);
    this.zShifts.set(state.zShifts);
    this.renderStates = new Map(state.renderStates);
    this.samplerStates = new Map(state.samplerStates);
    for (const key of [
      'id',
      'instance',
      'particleAddress',
      'parameterAddress',
      'context',
      'hostFunctions',
      'active',
      'stopped',
      'frame',
      'before',
      'hasFrame',
      'attachPlane',
    ])
      this[key] = state[key];
  }
  snapshot() {
    if (this.runtime.instances.size !== 1)
      throw new Error('Use runtime.snapshot() for shared native PPI state');
    return this.runtime.snapshot();
  }
  restore(state) {
    if (this.runtime.instances.size !== 1)
      throw new Error('Use runtime.restore() for shared native PPI state');
    this.runtime.restore(state);
  }
  close({ stop = true } = {}) {
    if (this.closed) return;
    if (stop && !this.stopped) this.stop();
    this.invoke(() => this.process.call(this.module.export(2), [this.instance]), 'ReleaseInstance');
    this.runtime.instances.delete(this.id);
    for (const address of [
      this.context,
      this.particleAddress,
      this.parameterAddress,
      this.hostFunctions,
    ])
      this.process.free(address);
    this.active = false;
    this.closed = true;
    this.runtime.releaseModule(this.module);
    if (this.ownsRuntime) this.runtime.close();
  }
}
