// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { nativeWindowDOM } from './fixtures/native-window-dom.mjs';
import { EngineHost } from '../src/host.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-fes-shell-errors-legacy-golden.json', import.meta.url)),
);
const ascii = (text) => new TextEncoder().encode(text);

for (const build of golden.builds) {
  test(`${build.profile} selected shell errors use their own inline text without a language table`, async () => {
    const world = await defaultFESWorld(build.profile, {
      'screen.fes': ascii('#START\nnext WAIT\n#WAIT\n'),
    });
    let row;
    const actions = [];
    world.host.nativeWindowAction = (action) => {
      actions.push(action);
      return action.type === 'fes-open-site' ? row.code : row.reply;
    };
    try {
      const h = await loadDefaultFES(world);
      assert.equal(nativeABI(build.profile).language.storage, null);
      for (row of build.rows) {
        actions.length = 0;
        h.instance.execute(ascii('opensite https controlled.invalid/ordinary'), [], 0);
        await h.instance.flushNativeRecords();
        assert.equal(actions[0].type, 'fes-open-site');
        assert.equal(
          new TextDecoder().decode(actions[0].bytes),
          'https://controlled.invalid/ordinary',
        );
        assert.deepEqual(
          actions.slice(1).map(({ caption, message, buttons }) => ({ caption, message, buttons })),
          row.messages,
          `platform result ${row.code}`,
        );
      }
      assert.equal(world.globalStrings.tables.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

  test(`${build.profile} blocked site reaches its owned DOM modal and release cancels it`, async (t) => {
    const dom = nativeWindowDOM();
    t.after(() => dom.dispose());
    const world = await defaultFESWorld(build.profile, {
      'screen.fes': ascii(
        '#START\nnext WAIT\n#WAIT\n#OPEN\nopensite https controlled.invalid/ordinary\nresult 123\nbreak\n',
      ),
    });
    world.host.engine = {};
    world.host.nativeWindowAction = function (action, owner) {
      return action.type === 'fes-open-site'
        ? 5
        : EngineHost.prototype.nativeWindowAction.call(this, action, owner);
    };
    let request;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      request = h.task.player.notify('OPEN');
      for (let i = 0; i < 50 && !world.host.windowService?.dialog?.open; i++)
        await Promise.resolve();
      assert.equal(world.host.windowService?.dialog?.open, true);
      assert.equal(world.host.windowService.dialogOwner, h.id);
      assert.equal(h.instance.resultValue, 0);
      assert.throws(() => world.snapshot(), /in flight/);
      await world.objects.release(h.id);
      await request;
      assert.equal(world.host.windowService.dialog, null);
      assert.equal(h.instance.resultValue, 0);
    } finally {
      world.host.windowService?.close();
      await request?.catch(() => {});
      await world.close({ flushFiles: false });
    }
  });
}
