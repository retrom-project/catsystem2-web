// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeScalarMath, NATIVE_SCALAR_MATH_CONTRACTS } from '../oracle/scalar-math.mjs';
import { NATIVE_ABIS } from '../src/native/abi/index.mjs';
import { scalarHandler } from '../oracle/scalar-handlers.mjs';
import { invokeNative } from '../oracle/scalar-invoke.mjs';
import { invokeRegion } from '../oracle/transitional-exe.mjs';
import { TRANSITIONAL_HEAP_POLICY } from '../oracle/transitional-heap.mjs';
import { transitionalExe } from '../web/transitional-entry.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';

test('only the explicit mixed host selects the temporary M2 heap capacity', async () => {
  const open = NativeEngineProcess.open;
  NativeEngineProcess.open = async (options) => ({ options });
  try {
    for (const abi of Object.values(NATIVE_ABIS)) {
      const engine = await transitionalExe.open({ profile: abi.profile });
      assert.equal(
        engine.options.heapSize,
        abi.plugins.emoteDriver === 'native' ? 512 * 1024 * 1024 : 256 * 1024 * 1024,
      );
      assert.equal(engine.transitionalExe, transitionalExe);
      const overridden = await transitionalExe.open({ profile: abi.profile, heapSize: 65536 });
      assert.equal(overridden.options.heapSize, 65536);
    }
    assert.equal(TRANSITIONAL_HEAP_POLICY.removeInPhase, 10);
  } finally {
    NativeEngineProcess.open = open;
  }
});

test('scalar template dispatches semantic operations through the explicitly injected capability', async () => {
  for (const abi of Object.values(NATIVE_ABIS)) {
    const calls = [],
      engine = {
        profile: abi.profile,
        process: {},
        registerFeature: (name, feature) => calls.push({ name, feature }),
      };
    const host = {
      invokeNative: async (operation, context) => {
        calls.push({ operation, context });
        return { control: 1, value: 7 };
      },
    };
    const math = new NativeScalarMath(engine, undefined, host),
      args = [1],
      task = { id: 42 },
      machine = {};
    assert.deepEqual(await math.apply(0x32, args, machine, task), { control: 1, value: 7 });
    assert.equal(calls[0].name, 'scalar-math');
    assert.equal(calls[1].operation, 'math.sin');
    assert.equal(calls[1].context.args, args);
    assert.equal(calls[1].context.task, task);
    assert.equal(calls[1].context.machine, machine);
    assert.equal(await math.apply(0xffff, [], machine, task), undefined);
    assert.throws(() => new NativeScalarMath(engine), /explicitly injected transitional EXE host/);
    for (const spec of NATIVE_SCALAR_MATH_CONTRACTS) {
      const name = abi.tables.main.entries[spec.id].name;
      assert.ok(Number.isInteger(scalarHandler(abi.profile, name)));
      assert.equal(scalarHandler(abi.profile, name), scalarHandler(abi.profile, spec.id));
      assert.ok(!Object.hasOwn(spec, 'handlers'));
    }
    assert.throws(() => scalarHandler(abi.profile, 'toString'), /Unreviewed/);
    await assert.rejects(invokeNative('unknown', { engine }), /Unreviewed/);
    await assert.rejects(invokeNative(0x32, { engine }), /semantic operation name/);
    await assert.rejects(invokeRegion('unknown', { engine }), /Unreviewed/);
  }
});
