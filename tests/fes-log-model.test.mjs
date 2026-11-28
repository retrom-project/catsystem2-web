// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FESLogModel,
  initializeFESLog,
  snapshotFESLog,
  restoreFESLog,
} from '../src/native/fes-log-model.mjs';
import { fixture, append, text, traceService } from './fixtures/fes-log-model.mjs';

test('LOG defaults, COUNT/size readiness, exact generated names and owner0 remain semantic', async () => {
  const f = await fixture({ rows: [] });
  try {
    const o = initializeFESLog({ nativeType: 38, baseName: 'log', handle: 33 }),
      trace = traceService(),
      model = new FESLogModel(o, f.logs, trace.service);
    assert.deepEqual([o.count, o.top, o.pri, o.head, o.disp, o.readyFlags], [0, 0, 0, 0, false, 0]);
    assert.deepEqual(
      o.palettes.map((p) => [...p]),
      [
        [-1, -16777216, -1],
        [-1, -16777216, -1],
        [-1, -16777216, -1],
        [-1, -16777216, -1],
        [-1, -16777216, -1],
        [0, 0, 0],
      ],
    );
    model.setCount(2);
    assert.equal(await model.allocate(), false);
    model.setSize(24, 16);
    await model.allocate();
    assert.deepEqual([...model.positionQuery()], [0, 0, 0], 'approved unbound JS top default');
    assert.ok(
      [...trace.children.values()].every((c) => c.priority === 0),
      'first configure uses approved omitted PRI0',
    );
    await model.setPriority(60000);
    assert.deepEqual(
      [...trace.children.values()].map((c) => [c.name, c.nativeType, c.owner, c.parentHandle]),
      [
        ['log_cs_0', 37, 0, null],
        ['log_cs_sub_0', 37, 0, null],
        ['log_cs_1', 37, 0, null],
        ['log_cs_sub_1', 37, 0, null],
      ],
    );
    assert.deepEqual(
      [...trace.children.values()].map((c) => [c.priority, c.vramX, c.vramY]),
      [
        [60000, 0, 0],
        [60000, 24, 0],
        [60000, 0, 18],
        [60000, 24, 18],
      ],
    );
    const identities = o.slots.map((slot) => [slot.main, slot.secondary]);
    model.setCount(2);
    await model.allocate();
    assert.deepEqual(
      o.slots.map((slot) => [slot.main, slot.secondary]),
      identities,
    );
    assert.equal(trace.children.size, 4, 'no hidden child replacement or suffix protocol');
  } finally {
    await f.close();
  }
});

test('raw source queries preserve pruned block/row bases, scene/path identity and voice flag4', async () => {
  const f = await fixture({ rows: [], count: 2 });
  try {
    Object.assign(f.source.config, { col: 5, prof: 0, space: 1 });
    append(f.logs, f.source, 'AA', 10, { scene: 'One', path: 7 });
    append(f.logs, f.source, 'BBBBBBBB', 11, {
      scene: 'Two',
      voice: true,
      paragraph: true,
      path: 8,
    });
    append(f.logs, f.source, 'CC', 12, { scene: 'Three', paragraph: true, path: 9 });
    f.source.limit = 2;
    f.logs.prune(f.source);
    f.model.bind(f.handle);
    assert.deepEqual(
      [f.source.blockBase, f.source.rowBase, f.model.max(), f.object.top],
      [1, 2, 4, 2],
    );
    assert.equal(text(f.model.lineInfo(0).scene), 'Two');
    assert.equal(f.model.lineInfo(0).block, 11);
    assert.deepEqual([...f.model.blockInfo(0)], [0, 0, 1, 4]);
    assert.deepEqual([...f.model.pathInfo(0)], [8, 11]);
    assert.deepEqual([...f.model.blockInfo(2)], [-1, -1, -1, 0]);
    assert.deepEqual([...f.model.pathInfo(2)], [-1, -1]);
    assert.deepEqual([text(f.model.lineInfo(2).scene), f.model.lineInfo(2).block], ['', -1]);
    assert.deepEqual([...f.model.blockInfo(-1)], [-1, -1, -1, 0]);
    assert.deepEqual([...f.model.positionQuery()], [2, 0, 0]);
    const packet = f.model.blockInfo(0);
    assert.strictEqual(f.model.blockInfo(3), packet);
    assert.deepEqual([...packet], [1, 3, 3, 0]);
    await f.model.position(0);
    assert.equal(text(f.model.lineInfo(0).scene), 'Two', 'query never adds top');
  } finally {
    await f.close();
  }
});

test('setlog/detach do not refresh, show, hide or reset the cached children', async () => {
  const f = await fixture();
  try {
    assert.equal(f.object.disp, false);
    assert.equal(f.events.filter(([name]) => name === 'source').length, 0);
    await f.model.display(1);
    const original = [...f.children.values()].map((c) => text(c.source)),
      top = f.object.top;
    f.events.length = 0;
    f.model.bind(0);
    assert.equal(f.object.top, top);
    assert.equal(f.object.disp, true);
    assert.equal(await f.model.display(0), false, 'unbound display does not update disp');
    assert.deepEqual(
      [...f.children.values()].map((c) => text(c.source)),
      original,
    );
    assert.deepEqual(f.events, []);
    assert.throws(() => f.model.bind(0x7fffffff), /Invalid or released/);
    assert.equal(f.object.logHandle, 0);
    f.model.bind(f.handle);
    assert.deepEqual(f.events, []);
  } finally {
    await f.close();
  }
});

test('next/rev rotates only edge sources, retaining other child reveal state and identity', async () => {
  const f = await fixture();
  try {
    await f.model.position(0);
    await f.model.display(1);
    const identities = f.object.slots.map((s) => s.main),
      retained = f.children.get(identities[1]);
    retained.reveal = 17;
    const sourceEvents = retained.sourceEvents;
    f.events.length = 0;
    await f.model.next();
    assert.deepEqual([f.object.top, f.object.head], [1, 1]);
    assert.deepEqual(
      f.events.filter(([n]) => n === 'source').map(([, h, b]) => [h, text(b)]),
      [[identities[0], 'D']],
    );
    assert.deepEqual([retained.reveal, retained.sourceEvents], [17, sourceEvents]);
    assert.deepEqual(
      [0, 1, 2].map((i) => text(f.children.get(f.model.slot(i).main).source)),
      ['B', 'C', 'D'],
    );
    f.events.length = 0;
    await f.model.rev();
    assert.deepEqual([f.object.top, f.object.head], [0, 0]);
    assert.equal(f.events.filter(([n]) => n === 'source').length, 1);
    await f.model.rev(1);
    assert.equal(f.object.top, 1, 'explicit rev argument is used as-is');
    f.events.length = 0;
    assert.equal(await f.model.next(1, -1), false);
    assert.deepEqual(f.events, []);
    assert.deepEqual(
      f.object.slots.map((s) => s.main),
      identities,
    );
  } finally {
    await f.close();
  }
});

test('next uses requested delta at partial clamp and preserves the original duplicated cached row', async () => {
  const f = await fixture();
  try {
    await f.model.position(3);
    await f.model.display(1);
    await f.model.next(2);
    assert.deepEqual([f.object.top, f.object.head], [4, 2]);
    assert.deepEqual(
      [0, 1, 2].map((i) => f.model.slot(i).sourceIndex),
      [5, 5, 6],
    );
    assert.deepEqual(
      [0, 1, 2].map((i) => text(f.children.get(f.model.slot(i).main).source)),
      ['F', 'F', 'G'],
    );
    await f.model.position(1);
    assert.equal(f.object.head, 0, 'pos performs a full display reset');
    await f.model.page(1);
    assert.equal(f.object.top, 4);
    await f.model.page(-99);
    assert.equal(f.object.top, 0);
    await f.model.position(999);
    assert.equal(f.object.top, 4);
  } finally {
    await f.close();
  }
});

test('short source clears tail text while next rejects the negative M-COUNT bound', async () => {
  const f = await fixture({ rows: ['A'], count: 3 });
  try {
    await f.model.display(1);
    assert.deepEqual(
      [...f.children.values()].map((c) => text(c.source)),
      ['A', '', ''],
    );
    assert.equal(await f.model.next(1), false);
    assert.deepEqual([f.object.top, f.object.head], [0, 0]);
    await f.model.position(-999);
    assert.equal(f.object.top, 0);
    await f.model.display(0);
    const sourceCount = f.events.filter(([n]) => n === 'source').length;
    await f.model.position(1);
    assert.equal(
      f.events.filter(([n]) => n === 'source').length,
      sourceCount,
      'hidden pos does not bind text',
    );
  } finally {
    await f.close();
  }
});

test('LOGSTRING8 small-edge scroll reads secondary even disabled; big reload checks enable without showing', async () => {
  const f = await fixture({ type: 38, count: 2 });
  try {
    f.source.rows.forEach((r, i) => {
      r.second = new TextEncoder().encode(`sub${i}`);
    });
    await f.model.position(0);
    await f.model.display(1);
    const subHandles = f.object.slots.map((s) => s.secondary);
    assert.ok(subHandles.every((h) => !f.children.get(h).shown));
    f.events.length = 0;
    await f.model.next(1);
    assert.equal(f.events.filter(([n, h]) => n === 'source' && subHandles.includes(h)).length, 1);
    assert.ok(subHandles.every((h) => !f.children.get(h).shown));
    f.events.length = 0;
    await f.model.next(2);
    assert.equal(f.events.filter(([n, h]) => n === 'source' && subHandles.includes(h)).length, 0);
    assert.equal(f.events.filter(([n]) => n === 'display').length, 0);
  } finally {
    await f.close();
  }
});

test('linecolor uses display/ring indices, negative means head; palette change waits for rebind', async () => {
  const f = await fixture();
  try {
    await f.model.position(0);
    await f.model.display(1);
    await f.model.next(1);
    const target = f.model.slot(1),
      head = f.model.slot(0);
    await f.model.lineColor(1, 11, 22, 33);
    assert.deepEqual(f.children.get(target.main).colors, [11, 22, 33]);
    await f.model.lineColor(-20, 44, 55, 66);
    assert.deepEqual(f.children.get(head.main).colors, [44, 55, 66]);
    assert.equal(await f.model.lineColor(3, 1, 2, 3), false);
    f.events.length = 0;
    await f.model.layout('color', [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.children.get(head.main).colors, [44, 55, 66]);
    await f.model.display(1);
    assert.deepEqual(
      f.children.get(f.model.slot(0).main).colors.map((v) => v >>> 0),
      [0xff030201, 0xff060504, 0xff090807],
    );
  } finally {
    await f.close();
  }
});

test('blockcolor traverses the full block and selects exact normal/voice/type palettes', async () => {
  const f = await fixture({ rows: [], count: 2 });
  try {
    f.source.config.col = 5;
    append(f.logs, f.source, 'ABCDEFGHIJKL', 0, { voice: true });
    append(f.logs, f.source, 'M', 1);
    f.model.bind(f.handle);
    await f.model.position(1);
    await f.model.display(1);
    for (const [mode, r] of [
      ['color', 1],
      ['vcolor', 2],
      ['acolor', 3],
      ['vacolor', 4],
      ['pcolor', 5],
      ['vpcolor', 6],
    ])
      await f.model.layout(mode, [r]);
    for (const [type, expected] of [
      [0, 2],
      [1, 4],
      [2, 6],
      [99, 1],
    ]) {
      f.events.length = 0;
      await f.model.blockColor(0, type);
      assert.equal(
        f.events.filter(([name]) => name === 'colors').length,
        3,
        'full 3-row block, not 2-row viewport intersection',
      );
      assert.ok([...f.children.values()].every((c) => (c.colors[0] & 255) === expected));
    }
    assert.equal(await f.model.blockColor(-1), false);
  } finally {
    await f.close();
  }
});

test('ordinary layout/reset uses physical slots up to min(source rows,COUNT) and leaves LOG state', async () => {
  const f = await fixture({ rows: ['A'], type: 38 });
  try {
    f.events.length = 0;
    await f.model.layout('size', [12]);
    assert.equal(f.events.filter(([n]) => n === 'layout').length, 2);
    const before = snapshotFESLog(f.object);
    f.events.length = 0;
    await f.model.reset();
    assert.equal(f.events.filter(([n]) => n === 'reset').length, 2);
    assert.deepEqual(snapshotFESLog(f.object), before);
    f.model.bind(0);
    f.events.length = 0;
    assert.deepEqual(await f.model.layout('size', [18]), { recognized: true, applied: false });
    await f.model.reset();
    assert.deepEqual(f.events, []);
    assert.deepEqual(await f.model.layout('made-up-mode', []), {
      recognized: false,
      applied: false,
    });
  } finally {
    await f.close();
  }
});

test('remake updates authoritative rows and secondary flags without replaying visible text', async () => {
  const f = await fixture({ type: 38, rows: ['A', 'B', 'C'] });
  try {
    await f.model.position(0);
    await f.model.display(1);
    const child = f.children.get(f.object.slots[0].main),
      oldSource = child.source.slice();
    f.events.length = 0;
    await f.model.remake('ja', 'en');
    assert.equal(new TextDecoder().decode(f.source.rows[0].first), 'J0');
    assert.equal(new TextDecoder().decode(f.source.rows[0].second), 'E0');
    assert.ok(f.object.slots.every((s) => s.secondaryEnabled));
    assert.deepEqual(child.source, oldSource);
    assert.deepEqual(f.events, []);
    await f.model.display(1);
    assert.equal(new TextDecoder().decode(child.source), 'J0');
    await f.model.remake('', '');
    assert.equal(new TextDecoder().decode(f.source.rows[0].first), 'A');
    assert.equal(new TextDecoder().decode(f.source.rows[0].second), 'A');
    assert.ok(
      f.object.slots.every((s) => s.secondaryEnabled),
      'empty language strings remain non-null',
    );
    await f.model.remake(null, null);
    assert.ok(f.source.rows.every((r) => !r.first.length && !r.second.length));
    assert.equal(new TextDecoder().decode(child.source), 'J0');
    assert.ok(f.object.slots.every((s) => !s.secondaryEnabled));
  } finally {
    await f.close();
  }
});

test('secondary end changes are consumed once in the next LOG driver with exact float32 association', async () => {
  const f = await fixture({ type: 38 });
  try {
    await f.model.position(0);
    await f.model.display(1);
    await f.model.setDisplayPosition(0, 16777216, 16777216);
    await f.model.layout('shift_sub', [1, 1]);
    const slot = f.object.slots[0],
      main = f.children.get(slot.main),
      sub = f.children.get(slot.secondary);
    slot.secondaryEnabled = true;
    main.endY = 1;
    main.endChanged = true;
    f.events.length = 0;
    await f.model.advance();
    assert.deepEqual([sub.x, sub.y], [16777216, 16777216]);
    assert.equal(main.endChanged, false);
    f.events.length = 0;
    await f.model.advance();
    assert.deepEqual(f.events, []);
    const snapshot = structuredClone(snapshotFESLog(f.object)),
      restored = restoreFESLog({ nativeType: 38, baseName: 'history' }, snapshot);
    assert.deepEqual(snapshotFESLog(restored), snapshot);
    assert.notStrictEqual(restored.positions, f.object.positions);
    assert.notStrictEqual(restored.slots, f.object.slots);
    assert.notStrictEqual(restored.palettes[0], f.object.palettes[0]);
  } finally {
    await f.close();
  }
});

test('reference resolution allocates after size+COUNT and close preserves collection-owned children/log handle', async () => {
  const f = await fixture({ rows: [] });
  try {
    const o = initializeFESLog({ nativeType: 24, baseName: 'other', handle: 33 }),
      trace = traceService(),
      model = new FESLogModel(o, f.logs, trace.service),
      calls = [];
    model.setCount(2);
    model.setSizeReference('areas', 7);
    model.setPositionReference('positions', 10);
    await model.setPriority(9);
    await model.drive((kind, name, selector) => {
      calls.push([kind, name, selector]);
      return [selector, selector + 1, 24, 16];
    });
    assert.deepEqual(calls, [
      ['size', 'areas', 7],
      ['position', 'positions', 10],
      ['position', 'positions', 11],
    ]);
    assert.deepEqual([...o.positions], [10, 11, 11, 12]);
    model.bind(f.handle);
    const children = [...trace.children.keys()];
    model.close();
    assert.equal(o.slots, null);
    assert.deepEqual([...trace.children.keys()], children);
    assert.strictEqual(
      f.logs.get(f.handle),
      f.source,
      'LOG did not release a borrowed typed handle',
    );
    await assert.rejects(model.drive(), /closed/);
  } finally {
    await f.close();
  }
});

test('live slot allocation preserves top/head and re-resolves explicit POS2 while retaining shared generated groups', async () => {
  const f = await fixture({ type: 38 });
  try {
    await f.model.position(0);
    await f.model.display(1);
    await f.model.next(1);
    const original = f.object.slots.map((s) => [s.main, s.secondary]);
    f.object.slots.forEach((s) => {
      s.secondaryEnabled = true;
    });
    f.model.setCount(4);
    f.model.setPositionReference('positions', 10);
    const calls = [];
    await f.model.drive((kind, name, selector) => {
      calls.push([kind, name, selector]);
      return [selector, selector + 1, 24, 16];
    });
    assert.deepEqual(
      [f.object.top, f.object.head],
      [1, 1],
      'allocation does not reset viewport/ring',
    );
    assert.deepEqual(
      f.object.slots.slice(0, 3).map((s) => [s.main, s.secondary]),
      original,
    );
    assert.ok(
      f.object.slots.every((s) => !s.secondaryEnabled),
      'the new slot table starts with disabled secondary flags',
    );
    assert.deepEqual(
      calls.map((c) => c[2]),
      [10, 11, 12, 13],
    );
    assert.deepEqual([...f.object.positions], [10, 11, 11, 12, 12, 13, 13, 14]);
    const secondObject = initializeFESLog({ nativeType: 38, baseName: 'history', handle: 0x1100 }),
      second = new FESLogModel(secondObject, f.logs, f.service);
    second.setCount(4);
    second.setSize(24, 16);
    await second.allocate();
    assert.deepEqual(
      secondObject.slots.map((s) => [s.main, s.secondary]),
      f.object.slots.map((s) => [s.main, s.secondary]),
    );
    assert.equal(f.children.size, 8, 'same generated names share the existing collection entries');
    second.close();
    assert.equal(f.children.size, 8);
    assert.deepEqual(
      f.object.slots.slice(0, 3).map((s) => [s.main, s.secondary]),
      original,
    );
  } finally {
    await f.close();
  }
});

test('reallocation retains known positions, leaves new slots unresolved and bounds head including COUNT0', async () => {
  const f = await fixture({ type: 38 });
  try {
    await f.model.display(1);
    f.model.setSize(32, 16);
    await f.model.allocate();
    assert.deepEqual([...f.object.positionsReady], [1, 1, 1]);
    assert.deepEqual([...f.object.positions], [2, 0, 2, 18, 2, 36]);
    f.model.setCount(4);
    await f.model.allocate();
    assert.deepEqual([...f.object.positionsReady], [1, 1, 1, 0]);
    f.events.length = 0;
    await assert.rejects(f.model.display(1), /position has not been resolved/);
    assert.equal(
      f.children.get(f.object.slots[3].main).sourceEvents,
      0,
      'new zero-filled storage never supplies a display-position default',
    );
    f.object.head = 2;
    f.model.setCount(2);
    await f.model.allocate();
    for (let i = 0; i < 2; i++) await f.model.setDisplayPosition(i, 2, i * 18);
    await f.model.advance();
    assert.equal(f.object.head, 0, 'approved reset of an invalid head retains top');
    await f.model.display(1);
    const top = f.object.top,
      children = [...f.children.keys()];
    f.model.setCount(0);
    await f.model.drive();
    assert.equal(f.object.head, 0);
    assert.equal(f.object.top, top);
    assert.equal(f.object.disp, false);
    assert.equal(f.model.slot(0), null);
    assert.equal(await f.model.display(1), false);
    assert.equal(await f.model.next(1), false);
    assert.deepEqual([...f.children.keys()], children, 'COUNT0 retains collection-owned children');
    f.model.setCount(3);
    await f.model.allocate();
    assert.deepEqual([...f.object.positionsReady], [0, 0, 0]);
    await assert.rejects(f.model.display(1), /position has not been resolved/);
  } finally {
    await f.close();
  }
});

test('authored POS2 re-resolves after resize and fresh restore, with missing positions reported', async () => {
  const f = await fixture({ type: 38 });
  try {
    const calls = [],
      resolve = (kind, name, selector) => {
        calls.push([kind, name, selector]);
        return [selector, selector * 3, 24, 16];
      };
    f.model.setPositionReference('positions', 10);
    await f.model.drive(resolve);
    f.object.head = 2;
    f.model.setCount(2);
    await f.model.drive(resolve);
    assert.equal(f.object.head, 0);
    assert.deepEqual(calls.slice(-2), [
      ['position', 'positions', 10],
      ['position', 'positions', 11],
    ]);
    f.model.setCount(4);
    const object = restoreFESLog(
        { nativeType: 38, baseName: 'history' },
        structuredClone(snapshotFESLog(f.object)),
      ),
      restored = new FESLogModel(object, f.logs, f.service);
    calls.length = 0;
    await restored.drive(resolve);
    assert.deepEqual(
      calls.map((call) => call[2]),
      [10, 11, 12, 13],
    );
    assert.deepEqual([...object.positions], [10, 30, 11, 33, 12, 36, 13, 39]);
    restored.setSize(32, 16);
    await assert.rejects(
      restored.drive((_kind, _name, selector) => (selector === 12 ? null : [0, 0, 32, 16])),
      /POS2 resource has no recovered rectangle/,
    );
    assert.equal(object.positionDirty, true, 'failed authored lookup remains pending');
  } finally {
    await f.close();
  }
});
