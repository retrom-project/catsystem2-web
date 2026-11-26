// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x7364623a;
for (const fixture of [
  'owner-rebind',
  'owner-anm-rebind',
  'owner-anm-update',
  'owner-affine-geometry',
  'owner-affine-layer-update',
]) {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-sdk23-draw-' + fixture + '.json', import.meta.url)),
    ),
    name = fixture + '.kcs',
    files = {
      ...Object.fromEntries(golden.resources.map((r) => [r.name, Buffer.from(r.base64, 'base64')])),
      [name]: kcsProgram(
        [
          [37, marker],
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
          [320, 'CPU Draw'],
          [384, 'replacement.hg3'],
          [448, 'empty.kcf'],
        ],
      ),
    };
  test(
    'SDK23 ' +
      fixture +
      ' retains the actual image owner, independent decoded frames and fallback through cold',
    async (t) => {
      const world = await dataWorld(profile, files);
      t.after(() => world.close({ flushFiles: false }));
      const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
        m = task.machine,
        floor = m.sp;
      m.store(88, world.nativeTaskID(world.main.id));
      let drawID,
        sourceID,
        ownerID,
        ownerBitmap,
        childIDs = [],
        program;
      const compare = async (w, current, row) => {
        const machine = current.machine;
        assert.equal(machine.sp, floor + 4);
        assert.equal(machine.load(floor), marker);
        assert.equal(
          [...w.runtime.handles.records.values()].filter(
            (r) => r.type === 'image-owner' && r.value.owner === task.id,
          ).length,
          row.scriptOwnerCount,
        );
        if (row.scriptBitmapCount !== undefined)
          assert.equal(
            [...w.runtime.handles.records.values()].filter(
              (r) => r.type === 'bitmap' && r.value.owner === task.id,
            ).length,
            row.scriptBitmapCount,
          );
        if (row.id === 462) assert.equal(machine.load(row.resultAddress), row.result);
        if (!drawID) return;
        const draw = w.objects.objects.get(drawID).implementation;
        assert.equal(draw.state.renderer?.items.length ?? null, row.itemCount);
        if (row.bitmap) {
          const bitmap = w.graphics.images.get(draw.state.renderer.bitmap);
          assert.deepEqual([bitmap.width, bitmap.height, bitmap.state.bpp], row.bitmap.shape);
          assert.equal(
            Buffer.from(await bitmap.pixels()).toString('base64'),
            row.bitmap.rgbaBase64,
            'Main' + row.id + ' step' + golden.rows.indexOf(row),
          );
        }
        if (row.retainedOwner) {
          const source = w.renderSources.get(sourceID),
            owner = w.imageOwners.get(ownerID);
          assert.equal(source.ownerHandle, ownerID);
          assert.equal(source.retainedOwner, true);
          assert.equal(owner.bitmap, ownerBitmap, 'actual nested bitmap identity');
          assert.equal(owner.refs, row.retainedOwner.refs, 'native image-owner references');
          assert.equal(
            Boolean(source.frames.length || source.bitmap),
            row.retainedOwner.currentBitmap,
          );
          if (row.retainedOwner.geometry) {
            const bitmap = w.graphics.images.get(w.renderSources.bitmap(sourceID));
            assert.deepEqual(
              [
                source.rasterGeometry?.width ?? bitmap.width,
                source.rasterGeometry?.height ?? bitmap.height,
              ],
              row.retainedOwner.geometry,
            );
          }
          assert.deepEqual(
            owner.retainedChildren,
            childIDs,
            'nested child identities survive encoded rebind',
          );
          if (row.nestedSources?.length)
            for (const [i, expected] of row.nestedSources.entries()) {
              const child = w.renderSources.get(childIDs[i]);
              assert.equal(child.refs, expected.refs);
              assert.equal(child.frames.length, expected.frameCount);
              assert(child.animation);
              assert.equal(owner.layerSources[i], childIDs[i]);
            }
          if (row.id === 657) {
            const borrow = machine.load(row.resultAddress);
            assert.equal(borrow, w.renderSources.bitmap(sourceID));
            assert.equal(borrow === ownerBitmap, row.borrowHolder);
            assert.equal(
              source.frames.some((frame) => frame.bitmap === borrow),
              row.borrowCurrent,
            );
          }
        } else if (sourceID && [258, 340, 67].includes(row.id)) {
          assert.equal(w.runtime.handles.records.has(sourceID), false);
          assert.equal(w.runtime.handles.records.has(ownerID), false);
          assert.equal(w.runtime.handles.records.has(ownerBitmap), false);
          for (const child of childIDs) assert.equal(w.runtime.handles.records.has(child), false);
        }
      };
      for (const [i, row] of golden.rows.entries()) {
        await world.runtime.scheduler.execute(task);
        if (row.id === 66) drawID = world.resolveTaskID(m.load(32), task.id);
        if (row.id === 710) {
          ownerID = m.load(36);
          const owner = world.imageOwners.get(ownerID);
          ownerBitmap = owner.bitmap;
          childIDs = [...owner.retainedChildren];
          program = world.renderSources.get(childIDs[0]).animation;
        }
        if (row.id === 731)
          sourceID = world.retainedDraw.record(
            world.objects.objects.get(drawID).implementation,
            (world.nativeTaskID(task.id) | (7 << 16)) >>> 0,
          ).source;
        await compare(world, task, row);
        if (fixture.startsWith('owner-affine') && row.id === 340) {
          const draw = world.objects.objects.get(drawID).implementation;
          await draw.render(null, true);
          const surface = world.graphics.surface(drawID);
          assert.equal(
            surface.handle,
            draw.state.renderer.bitmap,
            'capture and renderer use the CPU result bitmap',
          );
          assert.deepEqual([surface.width, surface.height], row.bitmap.shape.slice(0, 2));
          const vram = world.graphics.images.get(world.graphics.vramHandle),
            pixels = await vram.pixels(),
            expected = Buffer.from(row.bitmap.rgbaBase64, 'base64'),
            width = row.bitmap.shape[0],
            height = row.bitmap.shape[1];
          for (let y = 0; y < height; y++)
            assert.deepEqual(
              pixels.slice(y * vram.width * 4, (y * vram.width + width) * 4),
              new Uint8ClampedArray(
                expected.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
              ),
              'final output adapter physical texture row' + y,
            );
        }

        if (row.retainedOwner)
          assert.equal(
            world.renderSources.get(childIDs[0]).animation,
            program,
            'nested ANM identity',
          );
        if ([731, 623, 711].includes(row.id)) {
          const fresh = await dataWorld(profile, files, { initialize: false });
          try {
            await fresh.restore(structuredClone(world.snapshot()));
            const restored = fresh.runtime.scheduler.tasks.get(task.id),
              restoredProgram = fresh.renderSources.get(childIDs[0]).animation;
            await compare(fresh, restored, row);
            for (let next = i + 1; next < golden.rows.length; next++) {
              await fresh.runtime.scheduler.execute(restored);
              await compare(fresh, restored, golden.rows[next]);
              if (golden.rows[next].retainedOwner)
                assert.equal(fresh.renderSources.get(childIDs[0]).animation, restoredProgram);
            }
            await fresh.objects.tick(30);
            assert.equal(fresh.objects.objects.has(drawID), false);
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
      }
      await world.objects.tick(30);
      assert.equal(world.objects.objects.has(drawID), false);
    },
  );
}
