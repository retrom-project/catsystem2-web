// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { findFESInitialButton } from '../src/native/fes-button-navigation.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { EngineHost } from '../src/host.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const utf8 = (s) => new TextEncoder().encode(s),
  decode = (b) => new TextDecoder().decode(b),
  ref = (r) => (r === null ? null : [decode(r.nameBytes), r.index]),
  source = `#DEFINE
BUTTON b
BUTTON a
BUTTON c
#KEYBLOCK 1
0 3,1 -1,-1,-1,-1
#OBJECT SIZE POS TYPE PRI DISP ENABLE
b 4,3 10,10 0 1 0 1
a 4,3 10,10 0 65000 1 1
c 4,3 50,20 0 60000 1 1
#START
next IDLE
#IDLE
`,
  labels = {
    DEF: 'c noact',
    SET_B: 'b setact',
    SET_C: 'c setact',
    OFF_B: 'b enable 0',
    OFF_C: 'c enable 0',
    'b.FOCUS': '$10=++$10',
    'b.UNFOCUS': '$11=++$11',
    'c.FOCUS': '$12=++$12',
    'c.UNFOCUS': '$13=++$13',
    'b.PUSH_RIGHT': '$14=99',
    'c.PUSH_RIGHT': '$15=99',
    HOLD: 'config_open\n$40=99',
  };
const rgba = new Uint8Array(4 * 3 * 4);
for (let y = 0; y < 3; y++)
  for (let x = 0; x < 4; x++) rgba.set([20, 40, 60, x === 1 || x === 2 ? 255 : 0], (y * 4 + x) * 4);
const crop = new Uint8Array(4 * 3 * 4);
crop.set([70, 80, 90, 255], (1 * 4 + 1) * 4);
crop.set([71, 81, 91, 255], (1 * 4 + 2) * 4);
const assets = {
  'alpha.hg2': await encodeHG2({ width: 4, height: 3, rgba }, { crop: false }),
  'rgb.hg2': await encodeHG2({ width: 4, height: 3, rgba, bpp: 3 }, { crop: false }),
  'crop.hg2': await encodeHG2({ width: 4, height: 3, rgba: crop }),
};
async function open(profile, { file = '', type = 0, btype = 0 } = {}) {
  const header = `#OBJECT TYPE BTYPE${file ? ' FILE' : ''}\nb ${type} ${btype}${file ? ' ' + file : ''}\n`;
  const script =
    source.replace('#START', header + '#START') +
    Object.entries(labels)
      .map(([n, body]) => `#${n}\n${body}\nbreak\n`)
      .join('');
  const world = await defaultFESWorld(profile, { ...assets, 'screen.fes': utf8(script) });
  Object.assign(world.configuration.screen, {
    width: 128,
    height: 96,
    currentWidth: 128,
    currentHeight: 96,
    virtualWidth: 128,
    virtualHeight: 96,
  });
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return {
      ...h,
      world,
      input: h.task.input,
      get: (n, i = 0) => h.instance.collection.lookup(n, i),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, n) => h.task.player.notify(n),
  drain = (h) => h.instance.runtime.flushRecords(),
  point = (h, x, y) => h.input.input.pointer(x, y, 1),
  key = (h) => h.world.sendEngine(h.id, h.world.main.id, 9, 0, 7),
  command = (h, verb, args, name = 'b') =>
    h.instance.runtime.command(verb, { name, nameBytes: utf8(name), index: 0 }, args.map(utf8));
function trace(h) {
  const calls = [],
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
  h.world.engineMessages.dispatch = (target, sender, message, w, l, context = {}) => {
    if ([125, 138, 94].includes(message))
      calls.push({ target, sender, message, w, l, flags: context.flags });
    return dispatch(target, sender, message, w, l, context);
  };
  return calls;
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function declare(h, name, type = 'BUTTON') {
  const bytes = new Uint8Array(36),
    view = new DataView(bytes.buffer);
  bytes.set(utf8(name));
  view.setUint32(32, 1, true);
  await h.world.sendEngine(
    h.id,
    h.world.main.id,
    338,
    0,
    FES_OBJECT_DEFINITION_ORDER.indexOf(type),
    {
      payload: {
        string: (at) => decode(bytes.subarray(at, bytes.indexOf(0, at))),
        load: (at) => view.getUint32(at, true),
      },
    },
  );
  await h.instance.runtime.initializeResources();
}
async function fresh(h, snapshot = h.world.snapshot()) {
  const world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('initial selection restored resource ' + name);
    return read(name);
  };
  try {
    await world.restore(snapshot);
    const task = world.objects.objects.get(h.id).implementation;
    return {
      world,
      task,
      id: h.id,
      input: task.input,
      instance: task.player.root,
      reads,
      get: (n, i = 0) => task.player.root.collection.lookup(n, i),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
for (const profile of profiles) {
  test(`${profile}: direction initial FIFO hit ignores region priority/display and no-hit default skips navigation`, async () => {
    for (const mode of [
      'hit',
      'outside-hit',
      'default',
      'missing-default',
      'disabled-default',
      'disabled-hit',
    ]) {
      const h = await open(profile);
      try {
        if (mode === 'default' || mode === 'disabled-default' || mode === 'disabled-hit') {
          await notify(h, 'DEF');
          await drain(h);
        }
        if (mode === 'disabled-hit') await notify(h, 'OFF_B');
        if (mode === 'disabled-default') {
          await notify(h, 'OFF_C');
          assert.deepEqual(ref(h.instance.defaultButton), ['c', 0]);
          assert.equal(h.get('c').enable, false);
        }
        if (mode === 'default') {
          await command(h, 'keyblock', ['0', '0', '0'], 'c');
          await command(h, 'keyblock', ['0', '1', '0'], 'a');
        }
        const calls = trace(h),
          old = h.instance.pushRight;
        point(
          h,
          ...(mode === 'default' || mode === 'missing-default' || mode === 'disabled-default'
            ? [90, 80]
            : [10, 10]),
        );
        if (mode === 'outside-hit') h.input.input.pointer(10, 10, 0);
        await key(h);
        assert.equal(
          calls.filter((c) => c.message === 125).length,
          1,
          'only the extra real caller query',
        );
        assert.deepEqual(
          [10, 11, 12, 13, 14, 15].map((i) => h.instance.global(i)),
          [0, 0, 0, 0, 0, 0],
        );
        if (mode === 'hit' || mode === 'outside-hit') {
          assert.deepEqual(ref(h.input.state.focus), ['b', 0]);
          assert.equal(h.instance.pushRight, old);
          assert.equal(
            calls.some((c) => c.message === 138),
            false,
          );
          assert.equal(calls.filter((c) => c.message === 94).length, 1);
          if (mode === 'outside-hit')
            assert.deepEqual(h.task.player.mouse, { x: -2147483648, y: -2147483648 });
          assert.equal(h.get('b').displayValue, 0);
          assert.ok(
            h.input.input.get(h.get('b').nativeInputTaskID).priority <
              h.input.input.get(h.get('a').nativeInputTaskID).priority,
          );
        } else if (mode === 'missing-default' || mode === 'disabled-default') {
          assert.equal(h.input.state.focus, null);
          assert.equal(h.instance.pushRight, old);
          assert.equal(
            calls.some((c) => c.message === 138),
            false,
          );
          assert.equal(calls.filter((c) => c.message === 94).length, 1);
        } else {
          assert.deepEqual(ref(h.input.state.focus), ['c', 0]);
          assert.equal(h.instance.pushRight, h.get('c').handle);
          const warps = calls.filter((c) => c.message === 138);
          assert.equal(warps.length, 1);
          assert.deepEqual(
            [warps[0].w, warps[0].l, warps[0].flags],
            [1, ((20 + 3 - 8) << 16) | (50 + 4 - 16), 0],
          );
          assert.equal(
            calls.some((c) => c.message === 94),
            false,
          );
        }
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: disabled and non-BUTTON current skip mouse, while an absent current queries the helper`, async () => {
    for (const mode of [
      'disabled-default',
      'disabled-none',
      'other-default',
      'other-none',
      'absent',
    ]) {
      const h = await open(profile);
      try {
        await notify(h, 'SET_B');
        if (mode.startsWith('other')) {
          await h.instance.collection.remove(h.get('b'));
          await declare(h, 'b', 'STRTABLE');
        }
        await drain(h);
        if (mode.startsWith('disabled')) await notify(h, 'OFF_B');
        if (mode === 'absent') {
          await h.instance.collection.remove(h.get('b'));
          await h.task.syncObjects();
        }
        if (mode.endsWith('default')) {
          await notify(h, 'DEF');
          await drain(h);
        }
        point(h, 10, 10);
        const calls = trace(h),
          old = h.instance.pushRight,
          events = [10, 11, 12, 13].map((i) => h.instance.global(i));
        await key(h);
        assert.equal(calls.filter((c) => c.message === 125).length, mode === 'absent' ? 1 : 0);
        assert.deepEqual(
          [10, 11, 12, 13].map((i) => h.instance.global(i)),
          events,
        );
        if (mode.endsWith('default')) {
          assert.deepEqual(ref(h.input.state.focus), ['c', 0]);
          assert.equal(h.instance.pushRight, h.get('c').handle);
          assert.equal(calls.filter((c) => c.message === 138).length, 1);
        } else if (mode === 'absent') {
          assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
          assert.equal(h.instance.pushRight, old);
          assert.equal(calls.filter((c) => c.message === 94).length, 1);
        } else {
          assert.deepEqual(ref(h.input.state.focus), ['b', 0]);
          assert.equal(h.instance.pushRight, old);
          assert.equal(
            calls.some((c) => c.message === 138 || c.message === 94),
            false,
          );
        }
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: original packed-color hit uses exclusive rectangles, source offsets, RGB alpha0 and wrapper boundaries`, async () => {
    for (const [file, btype, cases] of [
      [
        'alpha',
        0,
        [
          [10, 10, 'a'],
          [11, 10, 'b'],
          [13, 12, 'a'],
          [14, 10, null],
          [10, 13, null],
        ],
      ],
      ['rgb', 0, [[11, 10, 'a']]],
      [
        'crop',
        2,
        [
          [10, 10, 'a'],
          [11, 11, 'b'],
        ],
      ],
    ]) {
      const h = await open(profile, { file, type: 1, btype });
      try {
        const b = h.get('b'),
          handle = h.world.imagesFES.currentBitmap(b),
          bitmap = h.world.graphics.images.get(handle);
        assert.equal(bitmap.state.bpp, file === 'rgb' ? 3 : 4);
        if (file === 'crop')
          assert.deepEqual(
            [bitmap.state.offsetX, bitmap.state.offsetY, bitmap.width, bitmap.height],
            [1, 1, 2, 1],
          );
        for (const [x, y, expected] of cases) {
          const hit = await findFESInitialButton(
            h.instance,
            h.world,
            Int32Array.of(x, y),
            () => true,
          );
          assert.deepEqual(
            ref(hit),
            expected === null ? null : [expected, 0],
            `${file} at ${x},${y}`,
          );
          if (hit) {
            hit.nameBytes.fill(0);
            assert.ok(
              h.instance.runtime.resources.entries.every((e) => e.nameBytes[0] !== 0),
              'returned reference owns its bytes',
            );
          }
        }
        if (file === 'alpha') {
          point(h, 11, 10);
          const calls = trace(h);
          await key(h);
          assert.deepEqual(ref(h.input.state.focus), ['b', 0]);
          assert.equal(calls.filter((c) => c.message === 125).length, 1);
          // Explicit typed-consumer NULL-wrapper branch, not a claimed FES producer.
          const wrapper = b.imageResource;
          b.imageResource = null;
          try {
            assert.deepEqual(
              ref(
                await findFESInitialButton(h.instance, h.world, Int32Array.of(10, 10), () => true),
              ),
              ['b', 0],
            );
          } finally {
            b.imageResource = wrapper;
          }
        }
      } finally {
        await h.world.close();
      }
    }
    const empty = await open(profile, { type: 1 });
    try {
      await assert.rejects(
        findFESInitialButton(empty.instance, empty.world, Int32Array.of(10, 10), () => true),
        /NULL bitmap buffer/,
      );
      const b = empty.get('b'),
        bitmap = empty.world.graphics.images.create(0, 0, empty.id);
      // Explicit wrapper consumer only: refex itself does not admit BUTTON.
      await empty.world.imagesFES.replace(b, bitmap, 0);
      assert.deepEqual(
        ref(
          await findFESInitialButton(
            empty.instance,
            empty.world,
            Int32Array.of(10, 10),
            () => true,
          ),
        ),
        ['a', 0],
        'non-NULL bitmap with no pixels returns color0',
      );
      await empty.world.imagesFES.replace(b, 0, 0);
    } finally {
      await empty.world.close();
    }
  });
  test(
    `${profile}: initial weak identities survive fresh, diagnose actual stale reads, and real awaits cancel on owner close`,
    { timeout: 5000 },
    async () => {
      const h = await open(profile, { file: 'alpha', type: 1 });
      let f;
      try {
        const handle = h.get('b').handle,
          allocate = h.world.imagesFES.allocateEntry.bind(h.world.imagesFES);
        let allocated = 0;
        h.world.imagesFES.allocateEntry = async (instance, object, entry) => {
          assert.equal(
            entry.initialHandle,
            object.handle,
            'initial identity was copied before the first allocation await',
          );
          allocated++;
          return allocate(instance, object, entry);
        };
        await declare(h, 'b');
        assert.equal(allocated, 1);
        const entries = h.instance.runtime.resources.entries.filter(
          (e) => e.savedType === 6 && decode(e.nameBytes) === 'b',
        );
        assert.equal(entries.length, 2);
        assert.deepEqual(
          entries.map((e) => e.initialHandle),
          [handle, handle],
        );
        // Current-format structural validation does not require the weak handle to be alive.
        for (const initialHandle of [undefined, -1, 0x1000, 0xffffffff, 1.5])
          assert.throws(
            () => h.instance.runtime.validateEntry({ ...entries[0], initialHandle }, h.get('b')),
            /initial semantic handle/,
          );
        for (const initialHandle of [0, 0x1001, 0xfffffffe])
          h.instance.runtime.validateEntry({ ...entries[0], initialHandle }, h.get('b'));
        // NULL is a typed-consumer input; ordinary raw6 allocation above produced a real handle.
        entries.forEach((e) => {
          e.initialHandle = 0;
        });
        try {
          assert.deepEqual(
            ref(await findFESInitialButton(h.instance, h.world, Int32Array.of(10, 10), () => true)),
            ['a', 0],
          );
        } finally {
          entries.forEach((e) => {
            e.initialHandle = handle;
          });
        }
        f = await fresh(h);
        assert.deepEqual(f.reads, ['case.kcs']);
        assert.equal(f.get('b').handle, handle);
        assert.deepEqual(
          f.instance.runtime.resources.entries
            .filter((e) => e.savedType === 6 && decode(e.nameBytes) === 'b')
            .map((e) => e.initialHandle),
          [handle, handle],
        );
        await f.instance.collection.remove(f.get('b'));
        await declare(f, 'b');
        assert.notEqual(f.get('b').handle, handle);
        await assert.rejects(
          findFESInitialButton(f.instance, f.world, Int32Array.of(10, 10), () => true),
          /deleted initial BUTTON/,
        );
        const stale = await fresh(f);
        try {
          assert.equal(stale.get('b').handle, f.get('b').handle);
          await assert.rejects(
            findFESInitialButton(stale.instance, stale.world, Int32Array.of(10, 10), () => true),
            /deleted initial BUTTON/,
          );
        } finally {
          await stale.world.close();
        }
        await f.instance.collection.remove(f.get('b'));
        await f.task.syncObjects();
        assert.equal(
          f.instance.runtime.resources.entries.some((e) => decode(e.nameBytes) === 'b'),
          false,
        );
        assert.deepEqual(
          ref(await findFESInitialButton(f.instance, f.world, Int32Array.of(10, 10), () => true)),
          ['a', 0],
        );
      } finally {
        await f?.world.close();
        await h.world.close();
      }
      for (const seam of ['point', 'pixels'])
        for (const resolution of ['resolve', 'reject', 'live-error']) {
          const modal = await open(profile, { file: 'alpha', type: 1 }),
            dom = nativeWindowDOM(),
            opened = deferred(),
            canceled = deferred(),
            gate = deferred(),
            entered = deferred(),
            queryGate = deferred(),
            calls = trace(modal);
          modal.world.host.engine = {};
          modal.world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
          modal.world.host.nativeWindowAction = function (action, owner) {
            const result = EngineHost.prototype.nativeWindowAction.call(this, action, owner);
            if (action.type === 'fes-configuration') opened.resolve();
            if (action.type === 'fes-owner-close') {
              canceled.resolve();
              return gate.promise.then(() => result);
            }
            return result;
          };
          let request, hold, closing, restoreQuery;
          try {
            point(modal, 11, 10);
            if (seam === 'point') {
              const dispatch = modal.world.engineMessages.dispatch.bind(modal.world.engineMessages);
              modal.world.engineMessages.dispatch = async (...args) => {
                const result = await dispatch(...args);
                if (args[2] === 125 && args[1] === modal.id) {
                  entered.resolve();
                  await queryGate.promise;
                  if (resolution !== 'resolve') throw new Error('initial-point-error');
                }
                return result;
              };
            } else {
              const bitmap = modal.world.graphics.images.get(
                  modal.world.imagesFES.currentBitmap(modal.get('b')),
                ),
                pixels = bitmap.pixels.bind(bitmap);
              restoreQuery = () => {
                bitmap.pixels = pixels;
              };
              bitmap.pixels = async () => {
                const result = await pixels();
                entered.resolve();
                await queryGate.promise;
                if (resolution !== 'resolve') throw new Error('initial-pixels-error');
                return result;
              };
            }
            const player = modal.task.player,
              old = modal.instance.pushRight;
            request = key(modal);
            await entered.promise;
            if (resolution === 'live-error') {
              const failure = assert.rejects(request, /initial-(point|pixels)-error/);
              queryGate.resolve();
              await failure;
              assert.equal(modal.input.state.focus, null);
              assert.equal(modal.instance.pushRight, old);
              assert.equal(
                calls.some((c) => c.message === 138 || c.message === 94),
                false,
              );
              continue;
            }
            hold = notify(modal, 'HOLD');
            await opened.promise;
            const record = modal.world.objects.objects.get(modal.id);
            closing = modal.world.objects.release(modal.id);
            await canceled.promise;
            assert.equal(modal.task.player, player);
            assert.equal(record.state, 'releasing');
            assert.equal(modal.instance.runtime.closed, true);
            queryGate.resolve();
            await request;
            await hold;
            assert.equal(modal.input.state.focus, null);
            assert.equal(modal.instance.pushRight, old);
            assert.equal(
              calls.some((c) => c.message === 138 || c.message === 94),
              false,
            );
            assert.equal(modal.instance.global(40), 0);
            assert.equal(record.exitCode, -1);
            assert.equal(modal.instance.finished, null);
            restoreQuery?.();
            gate.resolve();
            await closing;
          } finally {
            restoreQuery?.();
            queryGate.resolve();
            gate.resolve();
            modal.world.host.windowService?.close();
            await request?.catch(() => {});
            await hold?.catch(() => {});
            await closing?.catch(() => {});
            await modal.world.close();
            dom.dispose();
          }
        }
    },
  );
}
