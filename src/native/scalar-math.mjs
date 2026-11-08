// SPDX-License-Identifier: MPL-2.0
// Scalar math executes in the same original CPU/FPU thread as native plugins.
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_SCALAR_MATH_CONTRACTS = Object.freeze(
  [
    [0x32, 'sin', 1, 0x659a30, 0x526b20],
    [0x33, 'cos', 1, 0x65b5f0, 0x526a80],
    [0x34, 'tan', 1, 0x65b8e0, 0x527170],
    [0x35, 'asin', 1, 0x65b580, 0x52b4f0],
    [0x36, 'acos', 1, 0x65b550, 0x52b4c0],
    [0x37, 'atan', 1, 0x659890, 0x526a10],
    [0x38, 'ceil', 1, 0x6598c0, 0x526a40],
    [0x39, 'abs', 1, 0x65b640, 0x52b540],
    [0x3a, 'floor', 1, 0x659900, 0x526ab0],
    [0x3b, 'fmod', 2, 0x659940, 0x52b570],
    [0x3c, 'sqrt', 1, 0x65a050, 0x527140],
    [0x3d, 'pow', 2, 0x6599b0, 0x52b5b0],
    [0x3e, 'degreeToRadian', 1, 0x659720, 0x52ad90],
    [0x3f, 'radianToDegree', 1, 0x659800, 0x52b280],
    [0x40, 'integerAbs', 1, 0x659870, 0x5269b0],
    [0x18d, 'atan2', 2, 0x65b5b0, 0x5269d0],
    [0x1cd, 'log10', 1, 0x659980, 0x526af0],
    [0x36a, 'packWords', 2, 0x6597e0, 0x526950],
  ].map(([id, name, words, game, sdk]) =>
    Object.freeze({ id, name, words, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_SCALAR_MATH_CONTRACTS.map((spec) => [spec.id, spec]));

export class NativeScalarMath {
  constructor(engine) {
    Object.assign(this, { engine, process: engine.process });
    this.profileIndex = Number(engine.profile.startsWith('sdk-'));
    engine.registerFeature('scalar-math', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    const p = this.process,
      argv = p.allocate(words.length * 4),
      out = p.allocate(12);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      const parameters = [0, 0, argv, out + 4],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(
              spec.handlers[this.profileIndex],
              parameters,
              undefined,
              options,
            )
          : await this.engine.call(
              spec.handlers[this.profileIndex],
              parameters,
              undefined,
              options,
            );
      if (control !== 1 || p.load(out) !== 0xcccccccc || p.load(out + 8) !== 0xcccccccc)
        throw new Error('Native scalar math changed its reviewed output contract');
      return nativeReply(control, p.load(out + 4));
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeScalarMath(world) {
  world.registerNativeFeature('scalar-math', (engine) => new NativeScalarMath(engine));
  for (const { id } of NATIVE_SCALAR_MATH_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('scalar-math')).apply(id, args, machine, task),
    );
}
