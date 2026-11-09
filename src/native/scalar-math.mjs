// SPDX-License-Identifier: MPL-2.0
// Transitional scalar wrappers. Arithmetic remains original until phase 3.
import { nativeABI } from './abi/index.mjs';
import { requireTransitionalHost } from './transitional-exe.mjs';
export const NATIVE_SCALAR_MATH_CONTRACTS = Object.freeze(
  [
    { id: 50, name: 'sin', words: 1, control: 1, memory: false },
    { id: 51, name: 'cos', words: 1, control: 1, memory: false },
    { id: 52, name: 'tan', words: 1, control: 1, memory: false },
    { id: 53, name: 'asin', words: 1, control: 1, memory: false },
    { id: 54, name: 'acos', words: 1, control: 1, memory: false },
    { id: 55, name: 'atan', words: 1, control: 1, memory: false },
    { id: 56, name: 'ceil', words: 1, control: 1, memory: false },
    { id: 57, name: 'abs', words: 1, control: 1, memory: false },
    { id: 58, name: 'floor', words: 1, control: 1, memory: false },
    { id: 59, name: 'fmod', words: 2, control: 1, memory: false },
    { id: 60, name: 'sqrt', words: 1, control: 1, memory: false },
    { id: 61, name: 'pow', words: 2, control: 1, memory: false },
    { id: 62, name: 'degreeToRadian', words: 1, control: 1, memory: false },
    { id: 63, name: 'radianToDegree', words: 1, control: 1, memory: false },
    { id: 64, name: 'integerAbs', words: 1, control: 1, memory: false },
    { id: 321, name: 'triangleWave', words: 2, control: 1, memory: false },
    { id: 397, name: 'atan2', words: 2, control: 1, memory: false },
    { id: 461, name: 'log10', words: 1, control: 1, memory: false },
    { id: 874, name: 'packWords', words: 2, control: 1, memory: false },
    { id: 875, name: 'unpackWords', words: 3, control: 2, memory: true },
  ].map((spec) => Object.freeze(spec)),
);
const byID = new Map(NATIVE_SCALAR_MATH_CONTRACTS.map((spec) => [spec.id, spec]));
export class NativeScalarMath {
  constructor(engine, world, transitionalExe = world?.transitionalExe ?? engine.transitionalExe) {
    Object.assign(this, { engine, world });
    this.host = requireTransitionalHost(
      transitionalExe,
      engine.profile,
      'scalar-math',
      'invokeNative',
    );
    engine.registerFeature('scalar-math', this);
  }
  async apply(id, args, machine, task) {
    if (!byID.has(id)) return undefined;
    const operation = nativeABI(this.engine.profile).tables.main.entries[id].name;
    return this.host.invokeNative(operation, {
      engine: this.engine,
      world: this.world,
      args,
      machine,
      task,
    });
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeScalarMath(world) {
  world.registerNativeFeature('scalar-math', (engine) => new NativeScalarMath(engine, world));
  for (const { id } of NATIVE_SCALAR_MATH_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('scalar-math')).apply(id, args, machine, task),
    );
}
