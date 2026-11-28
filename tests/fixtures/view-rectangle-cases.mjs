// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../../src/native/abi/index.mjs';
export function nativeViewRectangleCases(profile) {
  const cases = [],
    abi = nativeABI(profile);
  const add = (operation, name, args, initial = {}, domain = 'rectangle') => {
    const entry = abi.tables.main.entries.find((e) => e.name === operation);
    cases.push({
      profile,
      table: 'main',
      id: entry.id,
      operation,
      name,
      args: args.map((word) => word >>> 0),
      initial,
      domain,
      policy: {},
      oracle: {
        boundaries: [
          'engine:user32.dll!SetRectEmpty',
          'engine:user32.dll!UnionRect',
          'engine:user32.dll!IntersectRect',
          'engine:user32.dll!IsRectEmpty',
        ],
      },
    });
  };
  const rectangles = [
    [0, 0, 0, 0],
    [-9, -7, 5, 8],
    [10, 20, -10, 50],
    [-2147483648, -2147483648, 2147483647, 2147483647],
  ];
  for (const [i, r] of rectangles.entries()) {
    add('rectangle.clear', 'clear ' + i, [64], { words: [[64, r]] });
    add('rectangle.isEmpty', 'empty ' + i, [64], { words: [[64, r]] });
    add('rectangle.union', 'union ' + i, [64, 128], {
      words: [
        [64, r],
        [128, [-4, -3, 50, 60]],
      ],
    });
    add('rectangle.intersect', 'intersect ' + i, [64, -8, -5, 8, 10], { words: [[64, r]] });
  }
  for (const shift of [0, 1, 4, 12])
    add('rectangle.union', 'overlap ' + shift, [64, 64 + shift], {
      words: [
        [64, [-9, -7, 23, 30]],
        [64 + shift, [-4, -3, 50, 60]],
      ],
    });
  for (const bitmap of [
    null,
    { handle: 2, width: 7, height: 9 },
    { handle: 2, width: 0, height: 9 },
  ])
    for (const [x, y] of [
      [-11, -13],
      [2147483646, 2147483647],
    ])
      add(
        'rectangle.unionBitmap',
        `bitmap ${bitmap?.width}/${x}`,
        [64, bitmap?.handle ?? 0, x, y],
        { words: [[64, [0, 0, 0, 0]]], ...(bitmap ? { bitmap } : {}) },
      );
  const view = {
    virtualWidth: 640,
    virtualHeight: 480,
    clientWidth: 640,
    clientHeight: 480,
    deviceOffset: [5.75, -3.25],
    deviceScale: 2,
    windowShift: [-2, 3],
    active: true,
    drawingRectangle: [-17, 9, 300, 480],
  };
  const screen = {
    currentWidth: 640,
    currentHeight: 480,
    fullHeight: 600,
    virtualHeight: 432,
    fullPosition: 0,
  };
  const initial = (overrides = {}) => ({ view, screen, ...overrides });
  for (const outputs of [
    [64, 68],
    [64, 64],
    [64, 66],
    [0x80000020, 64],
  ]) {
    add('view.dimensions', 'dimensions ' + outputs, outputs, initial(), 'view');
    add('view.borderOffset', 'border ' + outputs, outputs, initial(), 'view');
  }
  for (const outputs of [
    [64, 68, 72, 76],
    [64, 64, 64, 64],
    [0, 0x80000020, 64, 66],
  ])
    add('view.drawingRectangle', 'rectangle ' + outputs, outputs, initial(), 'view');
  for (const active of [true, false])
    for (const mode of [0, 1, 2, 3, 0xffffffff])
      add(
        'view.fullPositionCoordinates',
        `position ${active}/${mode}`,
        [64, 64],
        initial({
          view: { ...view, active },
          screen: { ...screen, fullPosition: mode },
          words: [[64, [0x12345678]]],
        }),
        'view',
      );
  for (const mode of [0, 1, 2])
    add(
      'view.fullPositionCoordinates',
      'distinct position ' + mode,
      [64, 68],
      initial({ screen: { ...screen, fullPosition: mode } }),
      'view',
    );
  for (const word of [
    0, 0x80000000, 0x3f800000, 0x443b8000, 0x7f800000, 0xff800000, 0x7fa01234, 0x7fc01234,
    0xffc01234,
  ])
    add('view.setCameraNear', 'camera ' + word.toString(16), [word], initial(), 'view');
  add(
    'view.borderOffset',
    'border disabled',
    [64, 66],
    initial({ view: { ...view, active: false } }),
    'view',
  );
  add(
    'view.drawingRectangle',
    'rectangle disabled',
    [64, 68, 72, 76],
    initial({ view: { ...view, active: false } }),
    'view',
  );
  for (const [scale, offset] of [
    [0, [2147483648, -2147483648]],
    [-2.75, [-5.125, -9.5]],
  ])
    add(
      'view.borderOffset',
      'boundary scale ' + scale,
      [64, 66],
      initial({ view: { ...view, deviceScale: scale, deviceOffset: offset } }),
      'view',
    );
  for (const mode of [0, 1])
    add(
      'view.fullPositionCoordinates',
      'partial position ' + mode,
      [64, 66],
      initial({ screen: { ...screen, fullPosition: mode } }),
      'view',
    );
  add('rectangle.clear', 'shared rectangle', [0x80000020], {});
  add('rectangle.union', 'heap rectangle', [8192, 64], {
    blocks: [64],
    words: [
      [8192, [-4, -3, 8, 10]],
      [64, [2, 3, 14, 9]],
    ],
  });
  return cases;
}
