// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { nativeABI, validateABI } from '../src/native/abi/index.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-fes-config.json', import.meta.url)),
);
const files = {
  'case.kcs': kcsProgram([[43, 65, 0], [59]]),
  'config-case.kcs': kcsProgram(golden.instructions),
  'config-live.fes': new TextEncoder().encode(golden.source),
};
const glyphs = {
  measure: () => ({ width: 4, height: 6, ascent: 6, descent: 0, averageWidth: 4, maximumWidth: 4 }),
  glyph: () => ({
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 4,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};
async function open(source = golden.source) {
  const world = await dataWorld(
    golden.profile,
    { ...files, 'config-live.fes': new TextEncoder().encode(source) },
    { glyphs },
  );
  await world.runtime.native('main', 209, [512], world.main.machine, world.main);
  world.main.machine.writeString('config-case.kcs', 800);
  await world.runtime.native(
    'main',
    143,
    [world.nativeTaskID(world.main.id), 800, 0],
    world.main.machine,
    world.main,
  );
  return world;
}
function owner(world) {
  return world.objects.objects.get(world.resolveTaskID(world.main.machine.load(32), world.main.id));
}
function capture(instance) {
  const strings = instance.runtime.strings;
  return [
    ['text', 0],
    ['text', 1],
    ['nv', 0],
  ].map(([name, index]) => {
    const object = instance.runtime.collection.lookup(name, index),
      state = strings.state(object),
      layout = strings.layout(object);
    const fields = (bytes, offset = 0) => {
      const v = new DataView(bytes.buffer, bytes.byteOffset + offset),
        start = offset + 128,
        end = bytes.indexOf(0, start);
      assert(end >= start, 'bounded initialized face');
      return {
        face: [...bytes.subarray(start, end + 1)],
        weight: v.getUint32(160, true),
        rightdown: v.getUint32(164, true),
        around: v.getUint32(168, true),
        fixed: v.getUint32(172, true),
      };
    };
    // This state is the driver's pending configuration authority. The JS
    // parser layout record is a projection, not the native allocation layout.
    return {
      type: object.nativeType - 1,
      name,
      index,
      dirty: Number(state.dirty),
      defaults: layout
        ? Array.from({ length: 4 }, (_, i) => layout.word(layout.abi.flags - 1 + i))
        : [
            state.nvFixedDefault,
            state.nvFontDefault,
            state.nvWeightDefault,
            state.nvShadowDefault,
          ].map(Number),
      configs: layout ? [fields(layout.config())] : [fields(state.nv, 24), fields(state.nv, 224)],
    };
  });
}
for (const coldAt of [null, 3, 4, 6]) {
  test(`SDK23 loaded configuration callbacks match native frames${coldAt === null ? '' : ` across cold after ${coldAt}`}`, async () => {
    let world = await open();
    try {
      for (const [index, row] of golden.rows.entries()) {
        if (row.configurationMessage) {
          const record = owner(world),
            bank = world.runtime.variableBank(world.main),
            selected = bank.selectedContext;
          const reply = await world.sendNativeEngine(
            world.nativeTaskID(record.id),
            world.main.id,
            19,
          );
          assert.equal(
            reply,
            NATIVE_UNWRITTEN_WORD,
            'native raw18 leaves the output word unwritten',
          );
          assert.equal(
            bank.selectedContext,
            selected,
            'configuration callbacks do not switch private context',
          );
        }
        if (row.drive === 'parent') await world.objects.tick(row.frame);
        else await world.runtime.scheduler.execute(world.main);
        const machine = world.main.machine,
          bank = world.runtime.variableBank(world.main);
        assert.deepEqual([machine.load(96), machine.load(100)], row.outputs, row.label);
        assert.deepEqual(
          Array.from({ length: 8 }, (_, i) => bank.get(16 + i)),
          row.queriedGlobalWords,
          row.label,
        );
        if (row.settings) {
          const font = world.configuration.fields.font;
          assert.deepEqual(
            {
              weight: font.weight,
              proportional: font.prop,
              fixed: font.fix,
              around: font.around,
              rightdown: font.rightdown,
            },
            Object.fromEntries(Object.entries(row.settings).filter(([key]) => key !== 'dirty')),
            row.label,
          );
        }
        for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row.vm[key], row.label);
        if (index >= 2 && index < 9)
          assert.deepEqual(
            capture(owner(world).implementation.player.root),
            row.objects,
            row.label,
          );
        if (index === coldAt) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await dataWorld(golden.profile, files, { initialize: false, glyphs });
          await world.restore(state);
        }
      }
      assert.equal(world.runtime.variableBank(world.main).contexts.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('SDK23 loaded configuration operands precede the callback and capture its destination', async () => {
  // Static native getter calls are ordered 1,3,4,2. This Core callback
  // reentry control checks that order; it is not a native alias experiment.
  const source = golden.source.replace(
    /#MANUAL[\s\S]*?#CHANGE/,
    '#MANUAL\r\ngetconf $16 fontweight 31 32\r\nsetconf $19 fontweight 33 34\r\ngetconf 100 NotAField 35 36\r\nbreak\r\n#CHANGE',
  );
  const world = await open(source);
  try {
    await world.runtime.scheduler.execute(world.main);
    await world.objects.tick(golden.rows[1].frame);
    const instance = owner(world).implementation.player.root,
      bank = world.runtime.variableBank(world.main),
      calls = [];
    bank.set(16, 100);
    bank.set(19, 1);
    bank.set(100, 0x12345678);
    bank.set(101, 0x23456789);
    const value = instance.value.bind(instance),
      text = instance.text.bind(instance),
      host = instance.player.host,
      get = host.config.bind(host),
      set = host.setConfig.bind(host);
    instance.value = (...args) => {
      calls.push(['value', args[0]]);
      return value(...args);
    };
    instance.text = (...args) => {
      calls.push(['key']);
      return text(...args);
    };
    host.config = (...args) => {
      calls.push(['get', ...args.slice(0, 3)]);
      bank.set(16, 101);
      return get(...args);
    };
    host.setConfig = (...args) => {
      calls.push(['set', ...args.slice(0, 4)]);
      return set(...args);
    };
    await world.runtime.scheduler.execute(world.main);
    assert.deepEqual(calls, [
      ['value', '$16'],
      ['value', '31'],
      ['value', '32'],
      ['key'],
      ['get', 'fontweight', 31, 32],
      ['value', '$19'],
      ['value', '33'],
      ['value', '34'],
      ['key'],
      ['set', 'fontweight', 1, 33, 34],
      ['value', '100'],
      ['value', '35'],
      ['value', '36'],
      ['key'],
      ['get', 'NotAField', 35, 36],
    ]);
    assert.equal(bank.get(100), 0, 'write uses the index captured before host callback');
    assert.equal(bank.get(101), 0x23456789, 'callback mutation cannot redirect the output');
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('SDK23 configuration and absent FILELIST policies remain explicit', () => {
  const abi = nativeABI(golden.profile);
  assert.equal(abi.fes.configurationMessage.liveObjects, false);
  assert.equal(abi.fes.configurationMessage.notification, null);
  assert.equal(abi.fes.definitionTypes.includes('FILELIST'), false);
  assert.equal(abi.fes.definitionTypes.includes('STRTABLE'), false);
  for (const mutate of [
    (a) => {
      a.fes.configurationOperandOrder = 'key-first';
    },
    (a) => {
      a.fes.fileList.patternEncoding = 'cp932';
    },
    (a) => {
      a.fes.definitionTypes.push('FILELIST');
    },
  ]) {
    const changed = structuredClone(abi);
    mutate(changed);
    assert.throws(() => validateABI(changed), /Invalid ABI/);
  }
});
