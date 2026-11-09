// SPDX-License-Identifier: MPL-2.0
// Seed and draw are original instructions; JS never binds to this state.
import { NATIVE_RANDOM_LAYOUTS } from '../../src/native/random-memory.mjs';
export const randomOracle = {
  prepare(engine, fixture) {
    const p = engine.process,
      layout = NATIVE_RANDOM_LAYOUTS[fixture.profile],
      spec = fixture.initial.random;
    for (const name of ['integer', 'real']) {
      p.call(layout[name].seed, [
        name === 'integer' ? spec.integerSeed : (spec.realSeed ?? spec.integerSeed),
      ]);
      const override = spec.overrides?.[name];
      if (override?.index !== undefined) p.store(layout[name].index, override.index);
      if (override?.firstWord !== undefined) p.store(layout[name].words, override.firstWord);
    }
    return {
      projectedRanges: ['integer', 'real'].flatMap((name) => [
        { address: layout[name].words, bytes: 2496 },
        { address: layout[name].index, bytes: 4 },
      ]),
      memory() {
        return Object.fromEntries(
          ['integer', 'real'].map((name) => {
            const bytes = new Uint8Array(2500);
            new DataView(bytes.buffer).setUint32(0, p.load(layout[name].index), true);
            bytes.set(p.read(layout[name].words, 2496), 4);
            return ['state:random.' + name, bytes];
          }),
        );
      },
    };
  },
};
