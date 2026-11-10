// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeSectionTables, nativeSectionTableCodec } from '../../oracle/section-table.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
export const SECTION_SOURCE =
  'before ignored\r\n#first\r\nkey first value\r\nkey second value\r\nempty\r\nspaces   keep two leading\r\ncomment before /* hidden */ after // removed\r\n// comment\r\n#second\r\nkey 日本語\r\n#first\r\nkey third value\r\n#First\r\nkey case distinct\r\n';
export function sectionFiles() {
  const basic = encodeCP932(SECTION_SOURCE),
    raw = Uint8Array.from([
      ...encodeCP932('#raw\r\n'),
      0x81,
      0x30,
      32,
      0xff,
      0x80,
      0x81,
      0x30,
      13,
      10,
    ]);
  return new Map([
    ['basic.txt', basic],
    ['raw.txt', raw],
    ['empty.txt', new Uint8Array()],
    [
      'syntax.txt',
      encodeCP932(
        '#one\nline one\nline two\n tab\tvalue\ncolon:value\nsemi ;value\n#one\nline three\n#empty\n#\nkey last\n',
      ),
    ],
    [
      'long.txt',
      encodeCP932(
        '#' + 'section'.repeat(16) + '\r\n' + 'key'.repeat(30) + ' ' + 'value'.repeat(100) + '\r\n',
      ),
    ],
    ['crlf.txt', encodeCP932('#x\r\na 1\r\n')],
    ['cr.txt', encodeCP932('#x\ra 2\r')],
    ['lf.txt', encodeCP932('#x\na 3\n')],
    [
      'nul.txt',
      Uint8Array.from([...encodeCP932('#x\na before'), 0, ...encodeCP932('\na after\n')]),
    ],
  ]);
}
export async function sectionFixture(bytes, profile, files = sectionFiles()) {
  const engine = await NativeEngineProcess.open({
      bytes,
      profile,
      readFile: async (name) => files.get(name) ?? null,
    }),
    handles = new NativeHandles(),
    world = {
      profile,
      runtime: { handles },
      objects: { machine: () => null },
      game: { read: async (name) => files.get(name) ?? null },
    };
  handles.registerType('section-table', nativeSectionTableCodec);
  world.getNativeFeature = async (name) => {
    if (engine.features.has(name)) return engine.features.get(name);
    if (name === 'data-buffers') return new NativeDataBuffers(engine, { handles });
    throw new Error('Section fixture missing ' + name);
  };
  new NativeEngineFiles(engine, world);
  const tables = new NativeSectionTables(engine, world),
    machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024));
  return { engine, handles, world, tables, machine, files };
}
