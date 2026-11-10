// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeDisplayLogs } from '../../oracle/text-log.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';

export async function textLogFixture(
  fixture,
  configuration = new NativeConfiguration({ profile: fixture.profile }),
) {
  const engine = await NativeEngineProcess.open({
      bytes: fixture.bytes,
      profile: fixture.profile,
      configuration,
    }),
    handles = new NativeHandles();
  const world = {
    profile: fixture.profile,
    configuration,
    runtime: { handles, stringBank: () => null, variableBank: () => null },
    game: { read: async () => null },
  };
  new NativeDataBuffers(engine, { handles });
  new NativeEngineFiles(engine, world);
  let context;
  const fes = {
    async withContext(next, callback) {
      const previous = context;
      context = next;
      try {
        return await callback();
      } finally {
        context = previous;
      }
    },
  };
  const sdk = fixture.profile.startsWith('sdk-'),
    p = engine.process;
  engine.patch(
    sdk ? 0x5d9230 : 0x728d80,
    'authored log expression boundary',
    1,
    ([source]) => context.evaluate(p.string(source)),
    { calleePops: true },
  );
  engine.patch(
    sdk ? 0x5e1150 : 0x7402f0,
    'authored log string-bank boundary',
    2,
    ([source, out]) => {
      const bytes = context.expandBytes(p.stringBytes(source));
      p.write(out, Uint8Array.from([...bytes, 0]));
      return out;
    },
    { calleePops: true },
  );
  const logs = new NativeDisplayLogs(engine, world, fes),
    machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(8192));
  return {
    engine,
    process: engine.process,
    world,
    logs,
    machine,
    async bytes(handle) {
      const p = engine.process,
        pointer = logs.pointer(handle),
        size = await engine.call(logs.abi.save, [0], pointer),
        out = p.allocate(size, true);
      try {
        await engine.call(logs.abi.save, [out], pointer);
        return p.read(out, size).slice();
      } finally {
        p.free(out);
      }
    },
  };
}
