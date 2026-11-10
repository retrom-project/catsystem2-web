// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeNameTables, nativeNameTableCodec } from '../../src/native/nametable.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { KCSMachine } from '../../src/kcs/vm.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { Binary } from '../../src/binary.mjs';
export function nameTableFiles() {
  return new Map([
    [
      '@cat/fes/names.tsv',
      encodeCP932(
        'header\tname\r\n7\t猫\tbg*.hg2\t%f-%n-%s-%c-%r\tAlias\tSame\r\n8\t犬\tpc??.hg3\t%f%n\tSame\r\n9\tplain\t*.ogg\t%s\tDup\r\n10\tOther\t*.ogg\t%s\tDup\r\n0x10\tHex\t*.*\t%r\r\n12.5\tDecimal\t\t\r\n',
      ),
    ],
    [
      '@cat/fes/quoted.tsv',
      encodeCP932('1\t"猫,犬"suffix\t"a""b"\t"line\r\nline"\r\n2\tplain\t\r3\t""'),
    ],
    [
      '@cat/fes/raw.tsv',
      Uint8Array.from([...new TextEncoder().encode('1\t猫é\t*.a\t%s\t'), 0x81, 0x7f, 13, 10]),
    ],
    ['@cat/fes/empty.tsv', new Uint8Array()],
    ['@cat/fes/header.tsv', encodeCP932('header\tname\r\n-1\tskip\r\n')],
  ]);
}
export async function nameTableFixture(bytes, profile, files = nameTableFiles()) {
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
  handles.registerType('nametable', nativeNameTableCodec);
  world.getNativeFeature = async (name) => {
    if (engine.features.has(name)) return engine.features.get(name);
    if (name === 'data-buffers') return new NativeDataBuffers(engine, { handles });
    throw new Error('Name table fixture missing ' + name);
  };
  new NativeEngineFiles(engine, world);
  new NativeDataBuffers(engine, { handles });
  const tables = new NativeNameTables(engine, world),
    machine = new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(4096),
        stackSize: 4096,
      },
      {},
      new Uint8Array(1024),
    );
  return { engine, process: engine.process, handles, world, tables, machine, files };
}
