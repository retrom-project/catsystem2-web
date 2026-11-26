// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x64727331;
const readGolden = async (name) =>
  JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-draw-' + name + '.json', import.meta.url)),
  );
function inputs(golden, name, arrays = false) {
  const initialize = [];
  if (arrays) {
    for (let at = 512; at < 656; at += 4) initialize.push([37, 0x34343434], [38, at]);
    for (let at = 800; at < 840; at += 4) initialize.push([37, 0x35353535], [38, at]);
  }
  return {
    ...Object.fromEntries(golden.resources.map((r) => [r.name, Buffer.from(r.base64, 'base64')])),
    [name]: kcsProgram(
      [
        [37, marker],
        ...initialize,
        ...golden.rows.flatMap((row) => [
          ...row.args.map((arg, i) => [37, row.id === 66 && i === 1 ? [0x13, 88] : arg]),
          [43, row.id, row.args.length * 4],
          ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
          [43, 65, 0],
        ]),
        [59],
      ],
      [
        [256, golden.resources[0].name],
        [320, 'Draw sources'],
        [384, 'source.hg3'],
      ],
    ),
  };
}
async function pixels(world, handle, expected, label) {
  const bitmap = world.graphics.images.get(handle);
  assert.deepEqual(
    [bitmap.width, bitmap.height, bitmap.state.bpp],
    expected.shape,
    label + ' shape',
  );
  assert.equal(
    Buffer.from(await bitmap.pixels()).toString('base64'),
    expected.rgbaBase64,
    label + ' pixels',
  );
}

test('SDK23 source arrays and real Draw GCALLs preserve tags, ordinal frames and retained references through cold', async (t) => {
  const golden = await readGolden('sources'),
    files = inputs(golden, 'draw-sources.kcs', true),
    world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('draw-sources.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  m.store(88, world.nativeTaskID(world.main.id));
  let drawID, source;
  const compare = async (w, currentTask, row, label) => {
    const machine = currentTask.machine;
    for (let i = 0; i < 36; i++) {
      if (i % 18 === 1)
        assert.equal(
          Boolean(machine.load(512 + i * 4)),
          Boolean(row.records[i]),
          label + ' record handle',
        );
      else assert.equal(machine.load(512 + i * 4), row.records[i], label + ' array word' + i);
    }
    assert.deepEqual(
      Array.from({ length: 10 }, (_, i) => machine.load(800 + i * 4)),
      row.metadata,
      label + ' metadata',
    );
    if (source) {
      assert.equal(
        w.runtime.handles.records.has(source),
        row.sourceLive,
        label + ' source lifetime',
      );
      if (row.sourceLive) {
        assert.equal(w.renderSources.get(source).refs, row.sourceRef, label + ' refs');
        assert.equal(
          Boolean(w.renderSources.get(source).animation),
          row.sourceHasProgram,
          label + ' explicit ANM load',
        );
      }
    }
    if (drawID) {
      const renderer = w.objects.objects.get(drawID).implementation.state.renderer;
      assert.equal(renderer?.items.length ?? null, row.itemCount, label + ' Draw count');
      if (row.bitmap) await pixels(w, renderer.bitmap, row.bitmap, label);
    }
  };
  for (const [index, row] of golden.rows.entries()) {
    await world.runtime.scheduler.execute(task);
    const label = 'Main' + row.id + ' at' + index;
    assert.equal(m.sp, floor + 4, label + ' control');
    assert.equal(m.load(floor), marker, label + ' marker');
    if (row.id === 703 && m.load(512) === 2) source = m.load(516);
    if (row.id === 66) drawID = world.resolveTaskID(m.load(32), task.id);
    if ([703, 706].includes(row.id)) assert.equal(m.load(row.resultAddress), row.result);
    if (row.id === 709) {
      const handle = m.load(row.resultAddress);
      assert.equal(handle, world.renderSources.bitmap(source, { ordinal: row.args[1] }));
      await pixels(world, handle, row.borrowed, label + ' borrowed ordinal');
    }
    await compare(world, task, row, label);
    if (row.id === 704 && drawID) {
      const fresh = await dataWorld(profile, files, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        await compare(fresh, restored, row, 'independent array-release cold');
        for (let next = index + 1; next < golden.rows.length; next++) {
          await fresh.runtime.scheduler.execute(restored);
          assert.equal(restored.machine.load(floor), marker);
          await compare(fresh, restored, golden.rows[next], 'cold continuation ' + next);
        }
        await fresh.objects.tick(40);
        assert.equal(fresh.objects.objects.has(drawID), false);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  await world.objects.tick(40);
  assert.equal(world.objects.objects.has(drawID), false);
  assert.equal(
    world.runtime.handles.records.has(m.load(52)),
    false,
    'borrowed source frame ends with retained source',
  );
});

for (const scenario of ['source-rebind', 'source-program'])
  test(
    'SDK23 ' +
      scenario +
      ' rebuilds borrowed frames while preserving its program and earlier owned pixels',
    async (t) => {
      const golden = await readGolden(scenario),
        files = inputs(golden, 'source-rebind.kcs'),
        world = await dataWorld(profile, files);
      t.after(() => world.close({ flushFiles: false }));
      const task = await world.spawnScript('source-rebind.kcs', {
          parent: world.main.id,
          initialExecute: false,
        }),
        m = task.machine,
        floor = m.sp;
      m.store(88, world.nativeTaskID(world.main.id));
      let drawID,
        oldBorrow,
        oldFrame,
        oldPixels,
        program = null,
        retainedSource;
      for (const [index, row] of golden.rows.entries()) {
        await world.runtime.scheduler.execute(task);
        const label = 'Main' + row.id + ' at' + index;
        assert.equal(m.sp, floor + 4, label + ' control');
        assert.equal(m.load(floor), marker);
        if (row.id === 66) drawID = world.resolveTaskID(m.load(32), task.id);
        const draw = world.objects.objects.get(drawID).implementation;
        assert.equal(draw.state.renderer?.items.length ?? null, row.itemCount);
        if (row.bitmap) await pixels(world, draw.state.renderer.bitmap, row.bitmap, label);
        if (row.id === 622)
          retainedSource = world.retainedDraw.record(
            draw,
            (world.nativeTaskID(task.id) | (8 << 16)) >>> 0,
          ).source;
        if (row.id === 624) {
          program = world.renderSources.get(retainedSource).animation;
          const fresh = await dataWorld(profile, files, { initialize: false });
          try {
            await fresh.restore(structuredClone(world.snapshot()));
            const restoredSource = fresh.renderSources.get(retainedSource),
              restoredProgram = restoredSource.animation,
              restoredTask = fresh.runtime.scheduler.tasks.get(task.id);
            assert.deepEqual(restoredProgram.snapshot(), program.snapshot());
            await fresh.runtime.scheduler.execute(restoredTask);
            assert.equal(restoredTask.machine.load(floor), marker);
            assert.equal(restoredSource.animation, restoredProgram, 'cold rebind keeps ANM owner');
            assert.equal(fresh.runtime.handles.records.has(oldBorrow), false);
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
        if (
          row.entryHasProgram !== undefined &&
          retainedSource &&
          world.runtime.handles.records.has(retainedSource)
        )
          assert.equal(
            Boolean(world.renderSources.get(retainedSource).animation),
            row.entryHasProgram,
          );
        if (row.id === 657 && !oldBorrow) {
          oldBorrow = m.load(row.resultAddress);
          oldFrame = await world.graphics.images.get(oldBorrow).frame();
          oldPixels = oldFrame.rgba.slice();
        } else if (row.id === 657) assert.notEqual(m.load(row.resultAddress), oldBorrow);
        if (row.id === 623) {
          assert.equal(
            world.retainedDraw.record(draw, (world.nativeTaskID(task.id) | (8 << 16)) >>> 0).source,
            retainedSource,
            'retained source identity',
          );
          assert.equal(
            world.renderSources.get(retainedSource).animation,
            program,
            'existing ANM owner identity',
          );
          assert.equal(
            world.runtime.handles.records.has(oldBorrow),
            false,
            'previous borrowed wrapper released',
          );
          assert.deepEqual(oldFrame.rgba, oldPixels, 'previous owned frame remains stable');
        }
      }
      await world.objects.tick(40);
      assert.equal(world.objects.objects.has(drawID), false);
    },
  );
