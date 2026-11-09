// SPDX-License-Identifier: MPL-2.0
// Original wrapper, formatter, permissive converter and wide CRT logger.
// Only verified individual OS transports are supplied by the old oracle facade.
import assert from 'node:assert/strict';
import { imageMemory, imageWrites } from './native-differential.mjs';
import { NativeUnicodeOutput } from '../../oracle/unicode-output.mjs';
import { NATIVE_EXE_PROFILES } from '../../src/native/catalog.mjs';
export function unicodeOutputOracle(engine, id) {
  const invoke = async (world, args, machine, task) => {
    const p = engine.process,
      feature = new NativeUnicodeOutput(engine, {
        objects: { machine: () => null },
        runtime: { services: world.runtime.services },
      }),
      gates = [0xb8f188, 0xb8f194, 0xb8f18c],
      previous = gates.map((a) => p.load(a)),
      target = p.load(NATIVE_EXE_PROFILES[engine.profile].tables.main.va + id * 4);
    let watch,
      entered = 0;
    const detach = p.beforeInstruction(target, 'observe original Unicode output entry', () => {
      entered++;
      const esp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
        out = p.load(esp + 16);
      assert.equal(p.load(out), 0xcccccccc);
      watch = p.watchWrites(out, 4);
    });
    const before = imageMemory(engine);
    try {
      const reply = await feature.invoke(id, args, machine, task);
      assert.equal(entered, 1);
      assert.equal(watch?.written, false, 'original void result is untouched');
      assert.deepEqual(
        gates.map((a) => p.load(a)),
        previous,
        'temporary debug console gates restore',
      );
      const writes = imageWrites(engine, before);
      for (const write of writes) {
        const section = before.find((s) => s.name === write.region),
          address = section.address + write.offset;
        assert.ok(
          address >= 0xb8fb50 && address < 0xb8fb50 + 4096,
          'only the reviewed original formatter scratch may persist in PE RAM',
        );
      }
      invoke.evidence.push(writes);
      return reply;
    } finally {
      watch?.close();
      detach();
      feature.close();
      engine.features.delete('unicode-output');
    }
  };
  invoke.evidence = [];
  return invoke;
}
