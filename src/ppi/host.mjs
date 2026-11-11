// SPDX-License-Identifier: MPL-2.0
import {
  degreeToRadian,
  radianToDegree,
  roundInteger,
  rotateVector,
  linearInterpolate,
  triangleWave,
} from './numeric.mjs';

const f = Math.fround;
// Public SDK vtable order; pointer/context arguments become JS values/references.
export const PPI_HOST_NAMES = Object.freeze([
  'GetScreenSize',
  'Exit',
  'rand',
  'frand',
  'Deg2Rad',
  'Rad2Deg',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'ceil',
  'fabs',
  'floor',
  'fmod',
  'sqrt',
  'pow',
  'abs',
  'round',
  'VecRotateX',
  'VecRotateY',
  'VecRotateZ',
  'VecRotateXYZ',
  'VecTrans',
  'VecScale',
  'VecGetDistance',
  'VecNormalize',
  'LinearInt',
  'TriWave',
  'SetZShift',
  'LoadParticleData',
  'SetRenderState',
  'SetSamplerState',
]);
const math = [
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
const setVector = (target, values) => {
  for (let i = 0; i < 3; i++) target[i] = f(values[i]);
};
const length = (v) => f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))));

export class PPIHost {
  constructor(instance, version) {
    this.instance = instance;
    this.version = version;
    for (const [slot, name] of PPI_HOST_NAMES.entries())
      this[name] = (...args) => this.call(slot, ...args);
  }
  call(slot, ...args) {
    const i = this.instance,
      name = PPI_HOST_NAMES[slot],
      minimum = slot >= 32 ? 0x20002 : slot === 31 ? 0x20001 : 0x20000;
    if (!name || this.version < minimum)
      throw new Error(
        `PPI host slot ${slot} (${name ?? 'unknown'}) is outside the JS implementation's host API`,
      );
    i.calls.set(slot, (i.calls.get(slot) ?? 0) + 1);
    if (math[slot]) return f(math[slot](...args.map(f)));
    switch (slot) {
      case 0:
        return [i.options.screenWidth >>> 0, i.options.screenHeight >>> 0];
      case 1:
        i.active = false;
        return;
      case 2:
        return i.random.rand();
      case 3:
        return i.random.frand();
      case 19:
        throw new Error(
          'PPI PPF.abs targets the original recursive virtual slot; execution cannot return',
        );
      case 20:
        return roundInteger(args[0]);
      case 21:
      case 22:
      case 23:
        setVector(args[0], rotateVector(Array.from(args[0]), ['x', 'y', 'z'][slot - 21], args[1]));
        return;
      case 24: {
        let value = Array.from(args[0]);
        for (const axis of ['x', 'y', 'z']) value = rotateVector(value, axis, args[1]);
        setVector(args[0], value);
        return;
      }
      case 25:
      case 26:
        for (let n = 0; n < 3; n++)
          args[0][n] = f(slot === 25 ? args[0][n] + f(args[n + 1]) : args[0][n] * f(args[n + 1]));
        return;
      case 27:
        return length(Array.from(args[0], (v, n) => f(v - args[1][n])));
      case 28: {
        const size = length(args[0]);
        for (let n = 0; n < 3; n++) args[0][n] = size ? f(args[0][n] / size) : 0;
        return;
      }
      case 29:
        return linearInterpolate(...args);
      case 30:
        return triangleWave(...args);
      case 31:
        if (args[0] >>> 0 < i.count) i.zShifts[args[0] >>> 0] = f(args[1]);
        return;
      case 32: {
        if (typeof i.options.readParticleData !== 'function')
          throw new Error('PPI requires a synchronous ptcldat resource service');
        const bytes = i.options.readParticleData(args[0]);
        if (bytes != null && !(bytes instanceof Uint8Array))
          throw new TypeError('PPI ptcldat service requires synchronous bytes');
        if (bytes && args[1]) args[1].set(bytes);
        return bytes?.length ?? 0;
      }
      case 33:
        i.renderStates.set(args[0] >>> 0, args[1] >>> 0);
        return;
      case 34:
        i.samplerStates.set(args[0] >>> 0, args[1] >>> 0);
        return;
      default:
        throw new Error(`Unhandled PPI host slot ${slot}`);
    }
  }
}
