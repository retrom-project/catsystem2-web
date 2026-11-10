// SPDX-License-Identifier: MPL-2.0
// Authored KCDB question/selection/mission tables and independent native fixtures.
import { compiledDatabase } from './database-fixture.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import {
  NativeContentDatabases,
  nativeContentDatabaseCodec,
} from '../../src/native/content-databases.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { NativeRandomMemory } from '../../src/native/random-memory.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
export function contentDatabase(rows, columns) {
  return compiledDatabase(
    rows.map((row) =>
      Object.fromEntries(
        columns.map(([name, size]) => {
          const value = row[name];
          if (typeof value !== 'number') return [name, value ?? ''];
          const bytes = new Uint8Array(size),
            view = new DataView(bytes.buffer);
          if (size < 4) throw new Error('Authored numeric database fields require four bytes');
          view.setUint32(0, value >>> 0, true);
          return [name, name === 'ID' ? value : bytes];
        }),
      ),
    ),
    columns,
  );
}
export const QUESTION_COLUMNS = [
  ['G_A', 4],
  ['G_B', 4],
  ['G_C', 4],
  ['ID', 4],
  ['IMG', 4],
  ['Q', 256],
  ...Array.from({ length: 4 }, (_, i) => ['A' + (i + 1), 64]),
];
export const QUESTION_ROWS = [
  {
    G_A: 1,
    G_B: 2,
    G_C: 3,
    ID: 11,
    IMG: 7,
    Q: 'First authored question?',
    A1: 'Right',
    A2: 'Second',
    A3: 'Third',
    A4: 'Fourth',
  },
  {
    G_A: 1,
    G_B: 2,
    G_C: 4,
    ID: 12,
    IMG: 8,
    Q: '日本語の設問',
    A1: '答え',
    A2: 'に',
    A3: 'さん',
    A4: 'よん',
  },
  {
    G_A: 2,
    G_B: 5,
    G_C: 6,
    ID: 22,
    IMG: 9,
    Q: 'Another question?',
    A1: 'A',
    A2: 'B',
    A3: 'C',
    A4: 'D',
  },
];
export const SELECTION_COLUMNS = [
  ['TBL', 4],
  ...Array.from({ length: 19 }, (_, i) => ['P' + String(i).padStart(2, '0'), 32]),
];
export const SELECTION_ROWS = [
  { TBL: 1, P00: 'alpha', P01: 'beta', P02: 'gamma', P18: 'alpha' },
  { TBL: 2, P00: 'gamma', P01: 'unknown', P02: 'alpha' },
  { TBL: 1, P00: 'ignored duplicate' },
];
export const MISSION_COLUMNS = [
  ['TBL', 4],
  ['TYPE', 4],
  ['CLIENT', 4],
  ['REWARD', 4],
  ['FILE', 64],
  ['LV_MIN', 4],
  ['LV_MAX', 4],
  ['PLACE', 4],
  ['COND', 4],
  ['PRI', 4],
  ['EXP', 4],
  ['SECCNT', 4],
  ['KEY', 4],
  ['CPARAM', 64],
  ['CHAR', 64],
  ...Array.from({ length: 4 }, (_, i) => ['QZTBL' + (i + 1), 32]),
  ...Array.from({ length: 20 }, (_, i) => ['PT' + String(i).padStart(2, '0'), 4]),
];
export const MISSION_ROWS = [
  {
    TBL: 10,
    TYPE: 1,
    CLIENT: 2,
    REWARD: 50,
    FILE: 'first.cst',
    LV_MIN: 1,
    LV_MAX: 10,
    PLACE: 1,
    COND: 1,
    PRI: 5,
    EXP: 100,
    SECCNT: 3,
    KEY: 1,
    CPARAM: '0',
    CHAR: '0',
    QZTBL1: 'alpha',
    QZTBL2: 'beta',
    PT00: 1,
    PT01: 1,
  },
  {
    TBL: 20,
    TYPE: 2,
    CLIENT: 4,
    REWARD: 70,
    FILE: '日本語.cst',
    LV_MIN: 2,
    LV_MAX: 20,
    PLACE: 2,
    COND: 2,
    PRI: 2,
    EXP: 200,
    SECCNT: 4,
    KEY: 2,
    CPARAM: '1',
    CHAR: '1',
    QZTBL1: 'gamma',
    PT01: 1,
  },
  { TBL: 10, TYPE: 99, CLIENT: 99, FILE: 'duplicate.cst' },
];
export const MISSION_CONDITION_ROWS = [
  ...[0, 1, 2, 3, 10, 11, 20, 21, 30, 40, 41, 99].map((condition, i) => ({
    TBL: 100 + i,
    TYPE: 1,
    FILE: `condition-${condition}.cst`,
    LV_MIN: 1,
    LV_MAX: 99,
    COND: condition,
    PRI: i,
    KEY: 0xffffffff,
    CPARAM:
      condition === 3
        ? '[0,1][3]'
        : [10, 11].includes(condition)
          ? '[100,102]'
          : [30, 40, 41].includes(condition)
            ? '[2]'
            : '[0,2][1,1]',
    CHAR: '[0,1]',
    QZTBL1: 'alpha',
    PT00: 1,
    PT01: 1,
  })),
  ...[0, 5, 6, 0xffffffff].map((type, i) => ({
    TBL: 200 + i,
    TYPE: type,
    LV_MIN: 0,
    LV_MAX: 0xffffffff,
    KEY: 0xffffffff,
    COND: 0,
    FILE: `type-${i}.cst`,
  })),
];
export function contentFiles() {
  return new Map([
    ['questions', contentDatabase(QUESTION_ROWS, QUESTION_COLUMNS)],
    ['selections', contentDatabase(SELECTION_ROWS, SELECTION_COLUMNS)],
    ['missions', contentDatabase(MISSION_ROWS, MISSION_COLUMNS)],
    ['conditions', contentDatabase(MISSION_CONDITION_ROWS, MISSION_COLUMNS)],
    [
      'configurations',
      encodeCP932(
        '#alpha\r\nCNT 2\r\nNORMA 1\r\nRIVAL 7\r\nRTYPE 2\r\nRIMG rival.png\r\nRPOS 10 20\r\nMEMBER 0 1\r\nPARTNER 2\r\nBG field.png\r\nBGM 6\r\nEXP 30\r\nPWIN 1\r\nPLOSE 2\r\nRWIN 3\r\nRLOSE 4\r\n$GEN\r\nGENRE_A @\r\nGENRE_B @\r\nGENRE_C @\r\n#beta\r\nCNT 1\r\nNORMA 2\r\n$GEN\r\nGENRE_A 2\r\nGENRE_B 5\r\nGENRE_C 6\r\n',
      ),
    ],
    ['empty', contentDatabase([], QUESTION_COLUMNS)],
    ['badmagic', new Uint8Array(16).fill(0xa5)],
  ]);
}
export async function contentFixture(bytes, profile, files = contentFiles()) {
  const random = new ParticleRandom(),
    engine = await NativeEngineProcess.open({ bytes, profile, readFile: async () => null }),
    handles = new NativeHandles(),
    world = {
      profile,
      random,
      runtime: { handles },
      objects: { machine: () => null },
      game: {
        read: async () => null,
        readCategory: async (name, category) =>
          category === 'database' ? (files.get(name) ?? null) : null,
      },
    };
  handles.registerType('content-database', nativeContentDatabaseCodec);
  world.getNativeFeature = async (name) => {
    const existing = engine.features.get(name);
    if (existing) return existing;
    if (name === 'data-buffers') return new NativeDataBuffers(engine, { handles });
    throw new Error('Authored content fixture has no feature ' + name);
  };
  new NativeEngineFiles(engine, world);
  new NativeRandomMemory(engine, random);
  const content = new NativeContentDatabases(engine, world),
    machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024));
  return { engine, handles, world, content, machine, files, random };
}
export function contentAllocations(process) {
  return [...process.allocations]
    .sort(([a], [b]) => a - b)
    .map(([pointer, size]) => ({ pointer, size, bytes: process.read(pointer, size) }));
}
