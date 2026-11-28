// SPDX-License-Identifier: MPL-2.0
import { ParticleRandom } from '../../src/ppi/random.mjs';
export function fixtureRandom(initial = {}) {
  const spec = initial.random ?? {},
    random = new ParticleRandom(
      spec.integerSeed ?? 4357,
      spec.realSeed ?? spec.integerSeed ?? 4357,
    );
  for (const [name, override] of Object.entries(spec.overrides ?? {})) {
    const stream = random[name];
    if (override.index !== undefined) stream.index = override.index;
    if (override.firstWord !== undefined) stream.words[0] = override.firstWord;
  }
  return random;
}
export function randomStateBytes(random) {
  return Object.fromEntries(
    ['integer', 'real'].map((name) => {
      const stream = random[name],
        bytes = new Uint8Array(2500),
        view = new DataView(bytes.buffer);
      view.setUint32(0, stream.index, true);
      stream.words.forEach((word, i) => view.setUint32(4 + i * 4, word, true));
      return ['state:random.' + name, bytes];
    }),
  );
}
