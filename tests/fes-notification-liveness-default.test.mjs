// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineHost } from '../src/host.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { hg3 } from './helpers.mjs';

const utf8 = (s) => new TextEncoder().encode(s),
  source = `#DEFINE
IMAGE asset
#START
next IDLE
#IDLE
#CONFIG
config_open
$31=++$31
break
#FILE
asset load pending
$32=++$32
break
#BAD
$34=UNKNOWN_LIVE_IDENTIFIER
break
`;
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function until(predicate) {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail('The ordinary 337 operation did not reach its expected await');
}
async function open(profile) {
  const world = await defaultFESWorld(profile, {
    'screen.fes': utf8(source),
    'pending.hg3': hg3(2, 2, new Uint8Array(16).fill(255)),
  });
  world.ensureNativeEngine = () => {
    throw new Error('337 must use the default JavaScript path');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return { ...h, world, player: h.task.player, record: world.objects.objects.get(h.id) };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: fesLabelPayload(() => label) });
function observe(h, pause = null) {
  const calls = [],
    files = [],
    gate = deferred(),
    entered = deferred(),
    read = h.world.game.read.bind(h.world.game),
    graphics = h.world.graphics,
    sync = graphics.syncFES.bind(graphics),
    inputSync = h.task.input.sync.bind(h.task.input),
    redraw = graphics.flushFESRedraw.bind(graphics);
  let reached = false;
  h.world.game.read = (name) => {
    files.push(name);
    return read(name);
  };
  graphics.syncFES = async (...args) => {
    calls.push('syncFES');
    const result = await sync(...args);
    if (pause === 'syncFES' && !reached) {
      reached = true;
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  h.task.input.sync = async (...args) => {
    calls.push('input.sync');
    const result = await inputSync(...args);
    if (pause === 'input.sync' && !reached) {
      reached = true;
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  graphics.flushFESRedraw = (...args) => {
    calls.push('redraw');
    return redraw(...args);
  };
  return { calls, files, gate, entered: entered.promise };
}
for (const profile of profiles) {
  test(`${profile}: ordinary337 real config_open Host cancel on owner close returns unwritten without later resource/input/redraw work`, async (t) => {
    const dom = nativeWindowDOM();
    t.after(() => dom.dispose());
    const h = await open(profile);
    h.world.host.engine = {};
    h.world.host.nativeDefaultFontBytes = () => encodeCP932('DEFAULT');
    h.world.host.nativeWindowAction = EngineHost.prototype.nativeWindowAction;
    try {
      const seen = observe(h),
        request = notify(h, 'CONFIG');
      await until(() => h.world.host.windowService?.dialog?.open);
      assert.equal(h.world.host.windowService.dialogOwner, h.id);
      await h.world.objects.release(h.id);
      assert.equal(await request, NATIVE_UNWRITTEN_WORD);
      assert.deepEqual(seen.calls, []);
      assert.equal(h.world.host.windowService.dialog, null);
      assert.equal(h.instance.runtime.platform.closed, true);
      assert.equal(h.instance.runtime.platform.inFlight, null);
      assert.equal(h.instance.global(31), 0);
      assert.equal(h.instance.finished, null);
      assert.equal(h.record.exitCode, -1);
      assert.equal(h.task.player, null);
    } finally {
      h.world.host.windowService?.close();
      await h.world.close();
    }
  });
  for (const stage of ['syncFES', 'input.sync']) {
    test(`${profile}: ordinary337 real IMAGE FILE then pending ${stage} stops after owner close and preserves already completed effects`, async () => {
      const h = await open(profile),
        seen = observe(h, stage);
      try {
        const request = notify(h, 'FILE');
        await seen.entered;
        assert.ok(seen.files.includes('pending.hg3'));
        assert.equal(h.instance.global(32), 1);
        await h.world.objects.release(h.id);
        seen.gate.resolve();
        assert.equal(await request, NATIVE_UNWRITTEN_WORD);
        assert.deepEqual(seen.calls, stage === 'syncFES' ? ['syncFES'] : ['syncFES', 'input.sync']);
        assert.equal(h.instance.global(32), 1);
        assert.equal(h.instance.finished, null);
        assert.equal(h.record.exitCode, -1);
      } finally {
        seen.gate.resolve();
        await h.world.close();
      }
    });
  }
  test(`${profile}: ordinary337 live notify/resource/input errors propagate without closing or replacing the owner`, async () => {
    for (const stage of ['notify', 'syncFES', 'input.sync']) {
      const h = await open(profile),
        seen = observe(h);
      try {
        if (stage !== 'notify') {
          const owner = stage === 'syncFES' ? h.world.graphics : h.task.input,
            name = stage === 'syncFES' ? 'syncFES' : 'sync',
            operation = owner[name].bind(owner);
          owner[name] = async (...args) => {
            await operation(...args);
            throw new Error('live337 ' + stage);
          };
        }
        await assert.rejects(
          notify(h, stage === 'notify' ? 'BAD' : 'FILE'),
          stage === 'notify' ? /UNKNOWN_LIVE_IDENTIFIER/ : new RegExp('live337 ' + stage),
        );
        assert.equal(h.world.objects.objects.get(h.id), h.record);
        assert.equal(h.record.state, 'active');
        assert.equal(h.task.player, h.player);
        assert.equal(h.instance.runtime.closed, false);
        assert.equal(seen.calls.includes('redraw'), false);
      } finally {
        await h.world.close();
      }
    }
  });
}
