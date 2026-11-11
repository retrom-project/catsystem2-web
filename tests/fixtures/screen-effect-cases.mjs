// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../../src/kcs.mjs';
import { identity } from '../../src/motion/matrix.mjs';
export const screenEffectCases = [
  [
    35,
    378,
    379,
    [
      ...identity().map(floatBits),
      ...[-2, 3, 0].map(floatBits),
      0x80ffffff,
      floatBits(0),
      floatBits(60000),
    ],
    2,
  ],
  [36, 380, 381, [...[3, 4, 32, 24, 2, 3, 0, 60000].map(floatBits), 0x80ffffff], 1],
  [37, 382, 383, [3, floatBits(0), floatBits(60000)], 1],
  [38, 384, 385, [floatBits(0), floatBits(60000), 8], 2],
  [52, 521, 522, [floatBits(0), floatBits(60000), 8, 32, 20, floatBits(1), floatBits(5)], 2],
  [
    57,
    390,
    391,
    [floatBits(0), floatBits(60000), 8, floatBits(0.3), floatBits(8), floatBits(2)],
    2,
  ],
  [
    58,
    394,
    395,
    [
      floatBits(0),
      floatBits(60000),
      8,
      32,
      20,
      floatBits(0.2),
      floatBits(16),
      floatBits(0.1),
      0xff102030,
    ],
    2,
  ],
];
screenEffectCases.push(
  [37, 382, 383, [0, floatBits(0), floatBits(60000)], 1],
  [37, 382, 383, [0xffffffff, floatBits(0), floatBits(60000)], 1],
  [37, 382, 383, [5, floatBits(0), floatBits(60000)], 1],
  [52, 521, 522, [floatBits(0), floatBits(60000), 8, 32, 20, 0, 0], 2],
  [57, 390, 391, [floatBits(0), floatBits(60000), 8, 0, 0, 0], 2],
  [
    57,
    390,
    391,
    [floatBits(0), floatBits(60000), 0, floatBits(0.3), floatBits(8), floatBits(2)],
    1,
  ],
  [
    58,
    394,
    395,
    [
      floatBits(0),
      floatBits(60000),
      0,
      32,
      1,
      floatBits(0.2),
      floatBits(16),
      floatBits(0.1),
      0xff102030,
    ],
    1,
  ],
);
