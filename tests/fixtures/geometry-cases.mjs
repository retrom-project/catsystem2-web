// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../../src/kcs.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
const words = (values) => values.map(floatBits);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function nativeGeometryCases(profile) {
  const cases = [],
    abi = nativeABI(profile);
  function add(operation, name, args, initial = {}, ranges = [], result = false) {
    const entry = abi.tables.main.entries.find((e) => e.name === operation);
    const policy = {
      ...(result ? { result: 'f32', ulp: 1, nan: 'exact' } : {}),
      memory: [
        ...ranges,
        { region: 'state:current-matrix', offset: 0, words: 16, ulp: 1, atol: 0, rtol: 0 },
        ...(result ? [{ region: 'memory', offset: 4096, words: 1, ulp: 1 }] : []),
      ],
    };
    cases.push({
      profile,
      table: 'main',
      id: entry.id,
      domain: 'matrix',
      operation,
      name,
      args,
      initial,
      policy,
      oracle: {
        boundaries: [
          'kernel32.dll!GetLastError',
          'kernel32.dll!SetLastError',
          'kernel32.dll!TlsGetValue',
          'kernel32.dll!TlsSetValue',
        ],
      },
    });
  }
  const range = (offset, count = 16) => ({
    region: 'memory',
    offset,
    words: count,
    ulp: 1,
    atol: 0,
    rtol: 0,
  });
  const affine = [2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 5, -3, 7, 1],
    dense = [1, 2, 3, 0, 2, 5, 7, 0, 3, 7, 11, 0, 5, -3, 7, 1];
  for (const operation of [
    'matrix.identity',
    'matrix.rotateXYZ',
    'matrix.translate',
    'matrix.scale',
  ])
    for (const [name, matrix, xyz] of [
      ['zero', new Array(16).fill(0), [0, 0, 0]],
      ['identity', identity, [0.2, -0.7, 1.1]],
      ['affine', affine, [3, 4, -2]],
      ['dense', dense, [0.5, -0.25, 2]],
    ]) {
      const args = operation === 'matrix.identity' ? [64] : [64, ...words(xyz)];
      add(operation, `${operation} ${name}`, args, { words: [[64, words(matrix)]] }, [range(64)]);
      add(operation, `${operation} ${name} current`, [0xffffffff, ...args.slice(1)], {
        matrixWords: words(matrix),
      });
    }
  for (const [name, matrix] of [
    ['affine', affine],
    ['dense', dense],
    ['singular', new Array(16).fill(0)],
    ['tiny', [1e-10, 0, 0, 0, 0, 1e-10, 0, 0, 0, 0, 1e-10, 0, 0, 0, 0, 1]],
  ]) {
    add('matrix.inverse', `inverse ${name}`, [64], { words: [[64, words(matrix)]] }, [range(64)]);
    add('matrix.inverse', `inverse ${name} current`, [0xffffffff], { matrixWords: words(matrix) });
  }
  for (const [dest, source] of [
    [64, 128],
    [64, 64],
    [80, 64],
    [64, 80],
    [65, 64],
  ])
    add('matrix.copy', `copy ${dest}/${source}`, [dest, source], {
      words: [[64, words([...dense, ...affine])]],
    });
  for (const operation of ['vector4.normalize', 'vector4.length', 'vector4.lengthSquared'])
    for (const vector of [
      [0, 0, 0, 0],
      [3, 4, 0, 0],
      [1, 0, 0, 0],
      [1.1, -2.3, 0.25, 4.7],
      [1e30, 1e30, 0, 0],
      [1e-30, 1e-30, 0, 0],
    ])
      add(
        operation,
        `${operation} ${vector}`,
        [64],
        { words: [[64, words(vector)]] },
        operation.endsWith('normalize') ? [range(64, 4)] : [],
        !operation.endsWith('normalize'),
      );
  for (const operation of ['vector4.add', 'vector4.subtract'])
    for (const [a, b] of [
      [64, 128],
      [64, 64],
      [64, 68],
      [68, 64],
    ])
      add(
        operation,
        `${operation} ${a}/${b}`,
        [a, b],
        {
          words: [
            [64, words([1, 2, 3, 4, 5, 6, 7, 8])],
            [128, words([-3, 0.5, 8, 2])],
          ],
        },
        [range(a, 4)],
      );
  for (const factor of [0, -1, 0.125, 3.7])
    add(
      'vector4.scale',
      `scale pointer ${factor}`,
      [64, 128],
      {
        words: [
          [64, words([1.1, -2, 3, 0.25])],
          [128, words([factor])],
        ],
      },
      [range(64, 4)],
    );
  for (const matrix of [identity, affine, dense])
    add(
      'vector4.transform',
      `transform ${matrix}`,
      [64, 128],
      {
        words: [
          [64, words([1.25, -2.5, 3.1, 4])],
          [128, words(matrix)],
        ],
      },
      [range(64, 4)],
    );
  add('matrix.copy', 'copy shared to heap', [8200, 0x80000080], {
    blocks: [96],
    words: [[0x80000080, words(dense)]],
  });
  add(
    'vector4.normalize',
    'normalize heap',
    [8200],
    { blocks: [48], words: [[8200, words([3, 4, 0, 0])]] },
    [{ region: 'block:1', offset: 8, words: 4, ulp: 1 }],
  );
  const fractional = [
    1.1, -0.7, 0.2, 0.03, 0.3, 2.9, -1.4, -0.02, -0.6, 0.4, 0.9, 0.1, 3.7, -2.1, 4.3, 1,
  ];
  for (const operation of [
    'matrix.rotateXYZ',
    'matrix.translate',
    'matrix.scale',
    'matrix.inverse',
  ]) {
    const args = operation === 'matrix.inverse' ? [64] : [64, ...words([0.2, -0.7, 1.1])];
    add(operation, `${operation} fractional`, args, { words: [[64, words(fractional)]] }, [
      range(64),
    ]);
  }
  add(
    'vector4.transform',
    'transform fractional',
    [64, 128],
    {
      words: [
        [64, words([1.25, -2.5, 3.1, 4])],
        [128, words(fractional)],
      ],
    },
    [range(64, 4)],
  );
  add(
    'matrix.rotateXYZ',
    'rotate large argument',
    [64, ...words([1e30, 0, 0])],
    { words: [[64, words(identity)]] },
    [range(64)],
  );
  for (const operation of ['vector4.normalize', 'vector4.length', 'vector4.lengthSquared'])
    for (const vector of [
      [Infinity, 0, 0, 0],
      [NaN, 1, 0, 0],
    ])
      add(
        operation,
        `${operation} exceptional ${vector}`,
        [64],
        { words: [[64, words(vector)]] },
        operation.endsWith('normalize') ? [range(64, 4)] : [],
        !operation.endsWith('normalize'),
      );
  return cases;
}
