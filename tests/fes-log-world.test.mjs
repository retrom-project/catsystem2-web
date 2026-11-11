// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { realFixture, profiles, append } from './fixtures/fes-log-model.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';

for (const profile of profiles)
  for (const type of nativeABI(profile).capabilities.utf8Text ? [24, 38] : [24])
    test(`${profile} raw${type} LOG draws real JS glyphs and restores ring/writer/tasks into fresh World`, async () => {
      const first = await realFixture(profile, type);
      let fresh;
      try {
        if (type === 38) await first.model.remake('ja', 'en');
        await first.model.display(1);
        for (let frame = 0; frame < 8; frame++) await first.frame(frame);
        const before = await first.frames();
        assert.ok(
          before.some((entry) => entry.rgba.some((v, i) => i % 4 === 3 && v)),
          'actual JS writer rasterized glyphs',
        );
        assert.ok(first.world.graphics.vramHandle, 'actual text task uploaded a graphics surface');
        assert.ok(
          (await first.world.graphics.images.get(first.world.graphics.vramHandle).pixels()).some(
            (v, i) => i % 4 === 3 && v,
          ),
        );
        const retained = first.model.slot(1).main,
          retainedChild = first.graph.get(retained),
          oldEvents = structuredClone(
            first.world.graphics.get(retainedChild.nativeTaskID).text.sourceEvents,
          );
        await first.model.next(1);
        await first.frame(8);
        assert.equal(first.object.head, 1);
        assert.deepEqual(
          first.world.graphics.get(retainedChild.nativeTaskID).text.sourceEvents,
          oldEvents,
          'retained writer was moved without source rebind',
        );
        const saved = first.snapshot();
        assert.equal(saved.world.nativeEngine, null);
        fresh = await realFixture(profile, type, structuredClone(saved));
        assert.equal(fresh.world.nativeEngine, undefined);
        assert.equal(fresh.children().length, type === 38 ? 6 : 3);
        assert.deepEqual(
          fresh.object.slots.map((s) => [s.main, s.secondary]),
          first.object.slots.map((s) => [s.main, s.secondary]),
        );
        assert.deepEqual(await fresh.frames(), await first.frames());
        for (let frame = 9; frame < 15; frame++) {
          await first.frame(frame);
          await fresh.frame(frame);
          assert.deepEqual(await fresh.frames(), await first.frames(), `restored frame ${frame}`);
        }
        assert.ok(first.children().every((child) => child.parentHandle === null));
        const taskIDs = first.children().map((child) => child.nativeTaskID);
        first.model.close();
        assert.ok(
          taskIDs.every((id) => first.world.objects.objects.has(id)),
          'ordinary LOG close preserves collection-owned STRING tasks',
        );
        await first.close();
        assert.ok(
          taskIDs.every((id) => !first.world.objects.objects.has(id)),
          'World owner teardown removes the real child tasks',
        );
        assert.equal(first.runtime.writers.size, 0, 'World child close releases actual JS writers');
      } finally {
        await fresh?.close();
        await first.close();
      }
    });

test('LOG line colors reach actual glyph RGBA and rebind restores the selected normal palette', async () => {
  const f = await realFixture(profiles[1]);
  try {
    await f.model.layout('color', [0, 255, 0]);
    await f.model.display(1);
    for (let frame = 0; frame < 12; frame++) await f.frame(frame);
    const main = f.graph.get(f.model.slot(0).main),
      task = f.world.graphics.get(main.nativeTaskID),
      writer = await task.writer(),
      green = writer.frame().rgba.slice();
    assert.ok(
      green.some(
        (v, i) =>
          i % 4 === 0 &&
          v === 0 &&
          green[i + 1] === 255 &&
          green[i + 2] === 0 &&
          green[i + 3] === 255,
      ),
      'green glyph pixels have nonzero alpha',
    );
    await f.model.lineColor(0, 0xff0000ff, 0, 0xff0000ff);
    for (let frame = 12; frame < 24; frame++) await f.frame(frame);
    const red = writer.frame().rgba.slice();
    assert.notDeepEqual(red, green);
    assert.ok(
      red.some(
        (v, i) =>
          i % 4 === 0 && v === 255 && red[i + 1] === 0 && red[i + 2] === 0 && red[i + 3] === 255,
      ),
      'packed ABGR produces red glyph pixels',
    );
    await f.model.display(1);
    for (let frame = 24; frame < 36; frame++) await f.frame(frame);
    assert.deepEqual(writer.frame().rgba, green);
  } finally {
    await f.close();
  }
});

test('LOGSTRING8 defers secondary layout to the next driver and preserves the pending end change through World restore', async () => {
  const first = await realFixture(profiles[1], 38);
  let fresh;
  try {
    await first.model.remake('ja', 'en');
    first.world.displayLogs.get(first.object.logHandle).rows[0].first = new TextEncoder().encode(
      'A\\nB',
    );
    await first.model.layout('shift_sub', [2, 3]);
    await first.model.display(1);
    await first.frame(0);
    const slot = first.object.slots[0],
      main = first.graph.get(slot.main),
      sub = first.graph.get(slot.secondary);
    assert.deepEqual(main.nativeTextState.end, [4, 4]);
    assert.equal(main.nativeTextState.endChanged, true);
    assert.deepEqual(
      [sub.x, sub.y],
      [4, 3],
      'same driver does not immediately consume the text phase result',
    );
    fresh = await realFixture(profiles[1], 38, structuredClone(first.snapshot()));
    assert.equal(fresh.graph.get(slot.main).nativeTextState.endChanged, true);
    for (const f of [first, fresh]) {
      await f.frame(1);
      assert.equal(f.graph.get(slot.main).nativeTextState.endChanged, false);
      assert.deepEqual([f.graph.get(slot.secondary).x, f.graph.get(slot.secondary).y], [4, 7]);
    }
    assert.deepEqual(await fresh.frames(), await first.frames());
  } finally {
    await fresh?.close();
    await first.close();
  }
});

test('registered ABI without UTF8 rejects generated STRING8 before allocating a World task', async () => {
  const f = await realFixture(profiles[0]);
  try {
    const count = f.world.objects.objects.size;
    await assert.rejects(
      f.service.create({ name: 'unsupported', nativeType: 37, owner: 0, parentHandle: null }),
      /no STRING8/,
    );
    assert.equal(f.world.objects.objects.size, count);
    assert.equal(f.world.nativeEngine, undefined);
  } finally {
    await f.close();
  }
});

test('generated name lookup preserves the old object type and identity before attempting another factory', async () => {
  const f = await realFixture(profiles[1], 24);
  try {
    const old = f.graph.get(f.object.slots[0].main),
      before = f.world.objects.objects.size,
      next = f.graph.nextHandle;
    const handle = await f.service.create({
      name: old.baseName,
      nativeType: 37,
      owner: 0,
      parentHandle: null,
    });
    assert.equal(handle, old.handle);
    assert.equal(f.graph.get(handle).nativeType, 21);
    assert.equal(f.world.objects.objects.get(old.nativeTaskID).kind, 48);
    assert.equal(f.world.objects.objects.size, before);
    assert.equal(
      f.graph.nextHandle,
      next,
      'discarded duplicate ctor does not become a hidden JS identity',
    );
  } finally {
    await f.close();
  }
});

for (const profile of profiles)
  for (const type of nativeABI(profile).capabilities.utf8Text ? [24, 38] : [24]) {
    test(`${profile} raw${type} approved PRI0/top0 defaults bind without pos and survive detach/rebind/fresh World`, async () => {
      const first = await realFixture(profile, type, null, {
        omitPriority: true,
        initialBind: false,
      });
      let fresh;
      try {
        assert.deepEqual([...first.model.positionQuery()], [0, 0, 0]);
        assert.equal(first.object.pri, 0);
        assert.ok(
          first.children().every((c) => c.pri === 0),
          'first configure did not require PRI',
        );
        const handle = first.sourceHandle;
        first.model.bind(handle);
        assert.deepEqual([...first.model.positionQuery()], [3, 0, 0]);
        await first.model.layout('size', [4]);
        await first.model.layout('shadow', [0]);
        await first.model.display(1); // No pos command after setlog.
        assert.deepEqual(
          first.object.slots.map((slot) => slot.sourceIndex),
          [3, 4, 5],
        );
        for (let frame = 0; frame < 8; frame++) await first.frame(frame);
        fresh = await realFixture(profile, type, structuredClone(first.snapshot()));
        assert.deepEqual(await fresh.frames(), await first.frames());
        for (const f of [first, fresh]) {
          const before = await f.frames();
          f.model.bind(0);
          assert.deepEqual([...f.model.positionQuery()], [3, 0, 0]);
          assert.equal(await f.model.position(0), false, 'unbound pos retains detached top');
          assert.deepEqual(await f.frames(), before, 'detach does not reset source/writer/reveal');
          const source = f.world.displayLogs.get(handle);
          append(f.world.displayLogs, source, 'G', 6);
          f.model.bind(handle);
          assert.deepEqual([...f.model.positionQuery()], [4, 0, 0]);
          await f.model.display(1);
          assert.deepEqual(
            f.object.slots.map((slot) => slot.sourceIndex),
            [4, 5, 6],
          );
          await f.frame(8);
          assert.equal(f.object.pri, 0);
          assert.equal(f.world.nativeEngine, undefined);
        }
        assert.deepEqual(await fresh.frames(), await first.frames());
      } finally {
        await fresh?.close();
        await first.close();
      }
    });

    test(`${profile} raw${type} live COUNT/size reuse preserves text tasks, keeps surplus groups, restores to World`, async () => {
      const first = await realFixture(profile, type);
      let fresh;
      try {
        if (type === 38) await first.model.remake('ja', 'en');
        await first.model.display(1);
        await first.frame(0);
        const initial = first.object.slots.map((s) => [s.main, s.secondary]),
          originalTaskIDs = first.children().map((c) => c.nativeTaskID),
          originalWriters = originalTaskIDs.map((id) => first.world.graphics.get(id).text.writer),
          nextHandle = first.graph.nextHandle;
        first.model.setCount(4);
        await first.model.allocate();
        assert.deepEqual(
          first.object.slots.slice(0, 3).map((s) => [s.main, s.secondary]),
          initial,
        );
        assert.equal(first.children().length, type === 38 ? 8 : 4);
        assert.equal(
          first.graph.nextHandle,
          nextHandle + (type === 38 ? 2 : 1),
          'identities only for successful new keys',
        );
        assert.ok(initial.every(([main]) => first.graph.get(main).disp));
        assert.equal(
          first.graph.get(first.object.slots[3].main).disp,
          false,
          'new groups do not inherit LOG shown state',
        );
        assert.ok(
          first.object.slots.every((s) => !s.secondaryEnabled),
          'new slot arrays reset per-slot bilingual flags',
        );
        const enlarged = first.object.slots.map((s) => [s.main, s.secondary]);
        first.model.setSize(32, 16);
        await first.model.allocate();
        assert.deepEqual(
          first.object.slots.map((s) => [s.main, s.secondary]),
          enlarged,
        );
        assert.equal(first.children().length, type === 38 ? 8 : 4);
        assert.deepEqual(
          originalTaskIDs.map((id) => first.world.graphics.get(id).text.writer),
          originalWriters,
        );
        // With no authored POS2, genuinely new positions remain unresolved.
        for (let i = 0; i < 4; i++) await first.model.setDisplayPosition(i, 2, i * 18);
        await first.model.display(1);
        await first.frame(1);
        assert.deepEqual(
          originalTaskIDs.map((id) => first.world.graphics.get(id).text.writer),
          originalWriters,
          'real D5 reconfiguration retains writer identities',
        );
        const surplus = enlarged.slice(2).map(([main]) => main);
        first.model.setCount(2);
        await first.model.allocate();
        assert.deepEqual(
          first.object.slots.map((s) => [s.main, s.secondary]),
          enlarged.slice(0, 2),
        );
        assert.ok(
          surplus.every((h) => first.graph.get(h).disp),
          'smaller COUNT does not hide surplus collection entries',
        );
        for (let i = 0; i < 2; i++) await first.model.setDisplayPosition(i, 2, i * 18);
        await first.frame(2);
        fresh = await realFixture(profile, type, structuredClone(first.snapshot()));
        assert.equal(fresh.object.count, 2);
        assert.equal(fresh.children().length, type === 38 ? 8 : 4);
        assert.ok(surplus.every((h) => fresh.graph.get(h).disp));
        assert.deepEqual(await fresh.frames(), await first.frames());
        const retainedHandles = first.children().map((child) => child.handle);
        for (const f of [first, fresh]) {
          f.model.setPositionReference('positions', 10);
          await f.model.drive((_kind, _name, selector) => [2, (selector - 10) * 18, 32, 16]);
          f.model.setCount(4);
        }
        // Restore an allocation still pending, without replaying construction,
        // source events or task clocks; the authored positions resolve on drive.
        const pending = await realFixture(profile, type, structuredClone(fresh.snapshot()));
        try {
          const calls = [];
          await pending.model.drive((kind, name, selector) => {
            calls.push([kind, name, selector]);
            return [2, (selector - 10) * 18, 32, 16];
          });
          assert.deepEqual(
            calls.map((call) => call[2]),
            [10, 11, 12, 13],
          );
          assert.deepEqual(
            pending.children().map((child) => child.handle),
            retainedHandles,
          );
          for (const f of [first, fresh])
            await f.model.drive((_kind, _name, selector) => [2, (selector - 10) * 18, 32, 16]);
          for (const f of [first, fresh, pending]) await f.frame(3);
          assert.deepEqual(await pending.frames(), await first.frames());
          assert.deepEqual(await fresh.frames(), await first.frames());
        } finally {
          await pending.close();
        }
      } finally {
        await fresh?.close();
        await first.close();
      }
    });
  }
