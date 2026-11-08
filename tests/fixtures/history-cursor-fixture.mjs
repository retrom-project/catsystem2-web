// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { NativeSceneData } from '../../src/native/scene-data.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { nativeHistoryCursorCodec } from '../../src/native/history-cursor.mjs';

export function historyCursorScene(blocks) {
  const offsets = [],
    strings = [],
    records = [];
  for (const lines of blocks) {
    records.push(lines.length, offsets.length);
    for (const [kind, text] of lines) {
      offsets.push(strings.length);
      strings.push(1, kind, ...(typeof text === 'string' ? encodeCP932(text) : text), 0);
    }
  }
  const bytes = new Uint8Array(16 + 16 + records.length * 4 + offsets.length * 4 + strings.length),
    view = new DataView(bytes.buffer),
    bodySize = bytes.length - 16;
  bytes.set(new TextEncoder().encode('CatScene'));
  view.setUint32(12, bodySize, true);
  [
    bodySize - 16,
    blocks.length,
    records.length * 4,
    (records.length + offsets.length) * 4,
    ...records,
    ...offsets,
  ].forEach((value, i) => view.setUint32(16 + i * 4, value, true));
  bytes.set(strings, 32 + (records.length + offsets.length) * 4);
  return bytes;
}

export function historyCursorFixture() {
  const handles = new NativeHandles(),
    memory = new Uint8Array(4096),
    scene = new NativeSceneData(),
    files = new Map([
      [
        'a',
        historyCursorScene([
          [
            [0x30, 'voice a0'],
            [0x21, 'Alice'],
            [0x20, 'A0'],
            [0x20, '+'],
            [0x30, 'voice a1'],
          ],
          [[0x30, 'voice without message']],
          [
            [0x21, 'Bob'],
            [0x20, 'A2'],
          ],
          [[0x20, 'A3']],
        ]),
      ],
      [
        'b',
        historyCursorScene([
          [[0x20, 'B0']],
          [],
          [
            [0x30, 'voice b2'],
            [0x21, 'B'],
            [0x20, 'B2'],
          ],
        ]),
      ],
      ['empty', historyCursorScene([[], [[0x30, 'command only']]])],
      ['bad', Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)],
      [
        '日本',
        historyCursorScene([
          [
            [0x21, '名前'],
            [0x20, '日本語 $str1'],
            [0x20, Uint8Array.of(0x81, 0x5c, 0xff, 0x80)],
            [0x30, 'pcm 声'],
          ],
          [[0x20, '']],
          [[0x21, 'speaker only']],
          [
            [0x21, 'A'],
            [0x21, 'B'],
            [0x20, 'C'],
            [0x20, 'D'],
          ],
        ]),
      ],
    ]);
  handles.registerType('scene-data', {
    snapshot: (s) => s.snapshot(),
    restore: (s) => new NativeSceneData().restore(s),
  });
  handles.registerType('history-cursor', nativeHistoryCursorCodec);
  const sceneHandle = handles.add('scene-data', scene),
    machine = {
      region(address, size) {
        address >>>= 0;
        if (address + size > memory.length)
          throw new RangeError('Authored history cursor pointer is unmapped');
        return { bytes: memory, offset: address };
      },
      bytes(address, size) {
        this.region(address, size);
        return memory.subarray(address, address + size);
      },
      store(address, value, width = 4) {
        this.region(address, width);
        if (width === 1) memory[address] = value;
        else new DataView(memory.buffer).setUint32(address, value >>> 0, true);
      },
    },
    services = {
      handles,
      read: async (name) => files.get(name) ?? null,
    };
  return { handles, memory, scene, sceneHandle, files, machine, services };
}

export const historyCursorScenarios = [
  [],
  [['a', 3]],
  [['a', 0]],
  [
    ['a', 3],
    ['b', 2],
  ],
  [
    ['a', 2],
    ['b', 0],
  ],
  [['empty', 1]],
  [['missing', 4]],
  [
    ['a', 3],
    ['missing', 2],
    ['b', 2],
  ],
  [
    ['b', 2],
    ['a', 3],
    ['b', 2],
  ],
  [['a', 100]],
  [
    ['bad', 1],
    ['a', 3],
  ],
  [['日本', 3]],
  [
    ['a', 3],
    ['日本', 3],
    ['b', 2],
  ],
];
