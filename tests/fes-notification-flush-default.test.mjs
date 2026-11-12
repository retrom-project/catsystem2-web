// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { EngineHost } from '../src/host.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
const utf8 = (s) => new TextEncoder().encode(s),
  decode = (b) => new TextDecoder().decode(b),
  deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
function source(after = 'a setact') {
  return `#DEFINE
BUTTON a
#START
next IDLE
#IDLE
#SELECT
a setact
break
#RESET
resetactive
break
#OPEN
config_open
$40=++$40
break
#AFTER
$20=++$20
${after}
$21=++$21
break
#a.UNFOCUS
$10=++$10
config_open
$11=++$11
break
#MES_CHANGECONFIG
a setact
$23=++$23
break
`;
}
async function open(profile, after) {
  const dom = nativeWindowDOM(),
    world = await defaultFESWorld(profile, { 'screen.fes': utf8(source(after)) }),
    opened = deferred();
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const player = h.task.player,
      runtime = h.instance.runtime;
    await player.notify('SELECT');
    await runtime.flushRecords();
    world.host.engine = {};
    world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
    world.host.nativeWindowAction = function (action, owner) {
      const result = EngineHost.prototype.nativeWindowAction.call(this, action, owner);
      if (action.type === 'fes-configuration') opened.resolve();
      return result;
    };
    return { ...h, world, dom, player, runtime, opened, record: world.objects.objects.get(h.id) };
  } catch (error) {
    await world.close();
    dom.dispose();
    throw error;
  }
}
const notify = (h, label) =>
    h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: { string: () => label } }),
  pending = (h) =>
    h.runtime.pendingRecords.map((r) => ({
      operation: r.operation,
      reference:
        r.reference === null
          ? null
          : r.reference
            ? { name: decode(r.reference.nameBytes), index: r.reference.index }
            : undefined,
    }));
async function begin(h, entry = 'tick') {
  if (entry === 'tick') {
    await h.player.notify('RESET');
    const running = h.task.tick();
    await h.opened.promise;
    return { running };
  }
  const running = notify(h, 'OPEN');
  await h.opened.promise;
  return { running };
}
function closeDialog(h) {
  const close = h.dom.all().find((n) => n.tagName === 'button' && n.textContent === 'Close');
  assert.ok(close);
  close.onclick();
}
async function dispose(h, running) {
  await h.world.close();
  await running?.catch(() => {});
  h.dom.dispose();
}
async function fresh(h) {
  const snapshot = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('notification restore replayed ' + name);
    return read(name);
  };
  try {
    await world.restore(snapshot);
    const task = world.objects.objects.get(h.id).implementation;
    return { world, task, instance: task.player.root, reads };
  } catch (error) {
    await world.close();
    throw error;
  }
}
for (const profile of profiles) {
  test(
    `${profile}: tick and337 keep return0 notification records pending and cancel their owner without borrowing an old flush`,
    { timeout: 5000 },
    async () => {
      for (const entry of ['tick', '337'])
        for (const rejected of [false, true]) {
          const h = await open(profile);
          let running;
          try {
            const action = h.world.host.nativeWindowAction.bind(h.world.host);
            if (rejected)
              h.world.host.nativeWindowAction = (request, world) => {
                const result = action(request, world);
                return request.type === 'fes-configuration'
                  ? Promise.resolve(result).then(() => {
                      throw new Error('C3 canceled Host rejection');
                    })
                  : result;
              };
            ({ running } = await begin(h, entry));
            assert.throws(() => h.world.snapshot(), /platform action is in flight/);
            await notify(h, 'AFTER');
            assert.deepEqual(pending(h), [
              { operation: 'active-reference', reference: { name: 'a', index: 0 } },
            ]);
            assert.equal(h.instance.global(20), 1);
            assert.equal(h.instance.global(21), 1);
            assert.equal(h.instance.global(11), 0);
            assert.equal(h.instance.global(40), 0);
            assert.equal(h.instance.nativeQueuePending, false);
            await Promise.all([running, h.world.objects.release(h.id)]);
            assert.equal(h.runtime.closed, true);
            assert.deepEqual(h.runtime.pendingRecords, []);
            assert.equal(h.instance.global(11), 0);
            assert.equal(h.instance.global(40), 0);
            assert.equal(h.instance.finished, null);
            assert.equal(h.record.exitCode, -1);
            assert.equal(h.world.nativeEngine, undefined);
          } finally {
            await dispose(h, running);
          }
        }
    },
  );
  test(
    `${profile}: separate async return0 continuations execute once, retain the outer wait and restore settled state without replay`,
    { timeout: 5000 },
    async () => {
      const h = await open(profile, 'a enable 1\n$22=++$22\na enable 1');
      let running, restored;
      try {
        ({ running } = await begin(h));
        await notify(h, 'AFTER');
        assert.deepEqual(
          [10, 11, 20, 21, 22].map((i) => h.instance.global(i)),
          [1, 0, 1, 1, 1],
        );
        assert.deepEqual(h.runtime.pendingRecords, []);
        closeDialog(h);
        await running;
        assert.deepEqual(
          [10, 11, 20, 21, 22].map((i) => h.instance.global(i)),
          [1, 1, 1, 1, 1],
        );
        assert.equal(h.instance.label, 'IDLE');
        assert.equal(h.task.input.state.focus, null);
        assert.equal(h.instance.nativeQueuePending, false);
        restored = await fresh(h);
        assert.deepEqual(restored.reads, ['case.kcs']);
        assert.deepEqual(
          [10, 11, 20, 21, 22].map((i) => restored.instance.global(i)),
          [1, 1, 1, 1, 1],
        );
        assert.equal(restored.instance.nativeQueuePending, false);
        assert.deepEqual(restored.instance.runtime.pendingRecords, []);
        assert.equal(restored.task.player.focused, null);
        assert.equal(restored.world.host.windowService, undefined);
      } finally {
        await restored?.world.close();
        await dispose(h, running);
      }
    },
  );
  test(
    `${profile}: a genuine new -3 consumes nonplatform work while a second modal remains an explicit single-dialog rejection`,
    { timeout: 5000 },
    async () => {
      for (const modal of [false, true]) {
        const h = await open(profile, modal ? 'config_open' : 'baseimg');
        let running;
        try {
          if (!modal) {
            const image = h.world.graphics.images.create(1, 1, h.id);
            await h.draw.setBaseImage(image);
            await h.world.graphics.images.release(image);
            assert.equal(h.draw.state.baseVisible, true);
          }
          ({ running } = await begin(h));
          const flight = h.runtime.platform.inFlight,
            dialog = h.world.host.windowService.dialog;
          if (modal) {
            await assert.rejects(notify(h, 'AFTER'), /FES platform FIFO is already being drained/);
            assert.equal(h.runtime.platform.inFlight, flight);
            assert.equal(h.world.host.windowService.dialog, dialog);
            assert.equal(h.instance.global(21), 0);
          } else {
            await notify(h, 'AFTER');
            assert.equal(h.draw.state.baseVisible, false);
            assert.equal(h.instance.global(21), 1);
          }
          assert.equal(h.instance.global(11), 0);
          assert.equal(h.instance.nativeQueuePending, false);
          closeDialog(h);
          await running;
          assert.equal(h.instance.global(10), 1);
          assert.equal(h.instance.global(11), 1);
        } finally {
          await dispose(h, running);
        }
      }
    },
  );
  test(
    `${profile}: live Host errors preserve pending work and Task19 keeps its frozen notification gate`,
    { timeout: 5000 },
    async () => {
      const h = await open(profile);
      let running;
      try {
        const action = h.world.host.nativeWindowAction.bind(h.world.host);
        h.world.host.nativeWindowAction = (request, world) => {
          const result = action(request, world);
          return request.type === 'fes-configuration'
            ? Promise.resolve(result).then(() => {
                throw new Error('C3 live Host failure');
              })
            : result;
        };
        ({ running } = await begin(h));
        await notify(h, 'AFTER');
        const rejected = assert.rejects(running, /C3 live Host failure/);
        closeDialog(h);
        await rejected;
        assert.equal(h.instance.nativeQueuePending, false);
        assert.deepEqual(pending(h), [
          { operation: 'active-reference', reference: { name: 'a', index: 0 } },
        ]);
        assert.equal(h.runtime.closed, false);
        assert.equal(h.instance.global(11), 0);
        assert.equal(h.instance.finished, null);
        assert.equal(h.record.exitCode, -1);
      } finally {
        await dispose(h, running);
      }
      const config = await open(profile);
      let updated;
      try {
        ({ running: updated } = await begin(config));
        await config.world.sendEngine(config.id, config.world.main.id, 19, 0, 0);
        const notified = Boolean(nativeABI(profile).fes.configurationMessage.notification);
        assert.equal(config.instance.global(23), Number(notified));
        assert.equal(config.runtime.pendingRecords.length, Number(notified));
        if (notified)
          assert.deepEqual(pending(config), [
            { operation: 'active-reference', reference: { name: 'a', index: 0 } },
          ]);
        assert.equal(config.instance.global(11), 0);
        await Promise.all([updated, config.world.objects.release(config.id)]);
        assert.equal(config.instance.finished, null);
        assert.equal(config.record.exitCode, -1);
      } finally {
        await dispose(config, updated);
      }
    },
  );
}
