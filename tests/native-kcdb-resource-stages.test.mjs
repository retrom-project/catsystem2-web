// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeCompiledTable } from '../src/native/compiled-table.mjs';
import { contentFiles } from './fixtures/content-database-data.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

async function withOutputAllocation(size, allocate, action) {
  const original = globalThis.Uint8Array;
  let attempts = 0;
  globalThis.Uint8Array = new Proxy(original, {
    construct(target, args) {
      if (args.length === 1 && args[0] === size) {
        attempts++;
        return allocate(size);
      }
      return Reflect.construct(target, args);
    },
  });
  try {
    await action();
  } finally {
    globalThis.Uint8Array = original;
  }
  return attempts;
}

test('KCDB validates the source span before reserving declared output, with no artificial high-size gate or large test allocation', async () => {
  const bytes = new Uint8Array(13),
    view = new DataView(bytes.buffer),
    failure = new RangeError('controlled output storage exhaustion');
  bytes.set([75, 67, 68, 66]);
  view.setUint32(4, 1, true);
  for (const size of [0x10000000, 0x10000001, 0x7fffffff]) {
    view.setUint32(8, size, true);
    assert.equal(
      await withOutputAllocation(
        size,
        () => {
          throw failure;
        },
        async () => {
          await assert.rejects(new NativeCompiledTable().load(bytes), (error) => error === failure);
        },
      ),
      1,
    );
  }
  view.setUint32(4, 2, true);
  assert.equal(
    await withOutputAllocation(
      0x7fffffff,
      () => {
        throw failure;
      },
      async () => {
        await assert.rejects(new NativeCompiledTable().load(bytes), /range/);
      },
    ),
    0,
  );
});

test('KCDB discards partial output when its reader fails and rejects shorter or overflowing declared output', async () => {
  const bytes = contentFiles().get('questions'),
    size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true),
    OriginalArray = Uint8Array,
    original = globalThis.DecompressionStream,
    prefix = Uint8Array.of(51, 52, 53, 54),
    failure = new RangeError('controlled inflater resource failure');
  let output;
  globalThis.DecompressionStream = class {
    constructor() {
      return new TransformStream({
        start(controller) {
          controller.enqueue(prefix);
        },
        transform() {
          throw failure;
        },
      });
    }
  };
  try {
    const table = new NativeCompiledTable();
    assert.equal(
      await withOutputAllocation(
        size,
        (length) => (output = new OriginalArray(length)),
        async () => {
          assert.equal(await table.load(bytes), false);
        },
      ),
      1,
    );
    assert.deepEqual(output.subarray(0, 4), prefix);
    assert.deepEqual(table.snapshot(), { columns: [], rows: [], stride: 0 });
  } finally {
    globalThis.DecompressionStream = original;
  }
  for (const delta of [-1, 1]) {
    const altered = bytes.slice();
    new DataView(altered.buffer).setUint32(8, size + delta, true);
    assert.equal(await new NativeCompiledTable().load(altered), false);
  }
});

for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(
    profile +
      ' GCALL distinguishes output exhaustion from inflater failure and retries all four families through cold ownership',
    async () => {
      const files = contentFiles(),
        first = await dataWorld(profile, Object.fromEntries(files)),
        owners = {};
      let fresh, latestProgram;
      async function call(world, id, args = [], strings = [], writesResult = true, beforeExecute) {
        latestProgram = kcsProgram([
          [37, 0x36eb67a5],
          ...args.map((word) => [37, word]),
          [43, id, args.length * 4],
          [59],
        ]);
        const task = world.main,
          program = await readKCS(latestProgram),
          machine = (task.machine = new KCSMachine(
            program,
            {
              native: (number, words, vm) =>
                world.runtime.scheduler.native(task, number, words, vm),
            },
            world.runtime.scheduler.shared,
          ));
        task.status = 'ready';
        task.io = null;
        for (const [address, string] of strings) machine.writeString(string, address);
        machine.store(512, 0xa5a5a5a5);
        const cleanup = beforeExecute?.();
        try {
          assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
        } finally {
          cleanup?.();
        }
        const value = writesResult ? machine.pop() : undefined;
        assert.equal(machine.pop(), 0x36eb67a5);
        assert.equal(machine.load(512), 0xa5a5a5a5);
        return value;
      }
      try {
        owners.question = await call(first, 742);
        owners.selection = await call(first, 779);
        for (const [family, id, name] of [
          ['compiled', 791, 'questions'],
          ['question', 744, 'questions'],
          ['mission', 795, 'missions'],
          ['selection', 782, 'selections'],
        ]) {
          const args = ['question', 'selection'].includes(family) ? [owners[family], 64] : [64],
            size = new DataView(files.get(name).buffer, files.get(name).byteOffset).getUint32(
              8,
              true,
            ),
            before = first.runtime.handles.snapshot(),
            failure = new RangeError('controlled output storage exhaustion');
          assert.equal(
            await withOutputAllocation(
              size,
              () => {
                throw failure;
              },
              async () => {
                await assert.rejects(
                  call(first, id, args, [[64, name]]),
                  (error) => error === failure,
                );
              },
            ),
            1,
          );
          assert.deepEqual(first.runtime.handles.snapshot(), before);
          const original = globalThis.DecompressionStream;
          assert.equal(
            await call(first, id, args, [[64, name]], true, () => {
              globalThis.DecompressionStream = class {
                constructor() {
                  throw new RangeError('controlled inflater allocation failure');
                }
              };
              return () => {
                globalThis.DecompressionStream = original;
              };
            }),
            0,
          );
          assert.deepEqual(first.runtime.handles.snapshot(), before);
          const value = await call(first, id, args, [[64, name]]);
          if (['compiled', 'mission'].includes(family)) {
            assert(value);
            owners[family] = value;
          } else assert.equal(value, 1);
        }
        fresh = await dataWorld(profile, { 'case.kcs': latestProgram }, { initialize: false });
        await fresh.restore(
          await deserializeCheckpoint(await serializeCheckpoint(first.snapshot())),
        );
        for (const handle of Object.values(owners))
          assert.deepEqual(
            fresh.runtime.handles.get(handle, 'content-database').data.snapshot(),
            first.runtime.handles.get(handle, 'content-database').data.snapshot(),
          );
        assert.equal(await call(fresh, 793, [owners.compiled, 64, 0], [[64, 'ID']]), 11);
        for (const [family, id] of [
          ['compiled', 792],
          ['question', 743],
          ['mission', 796],
          ['selection', 780],
        ])
          await call(fresh, id, [owners[family]], [], false);
        for (const handle of Object.values(owners))
          assert(first.runtime.handles.get(handle, 'content-database'));
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
