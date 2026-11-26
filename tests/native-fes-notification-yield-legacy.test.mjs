// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const golden = JSON.parse(
  await readFile(
    new URL('./fixtures/native-fes-notification-yield-legacy-golden.json', import.meta.url),
  ),
);
const ascii = (text) => new TextEncoder().encode(text),
  cp932 = (bytes) => new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)),
  marker = 0xa1caa17e;

for (const own of golden.cases) {
  test(`${own.profile} ${own.family}/${own.shellResult} native yields end the notification while frame execution and cold ownership continue`, async (t) => {
    const files = {
        'authored.fes': ascii(own.source),
        'authored-start.fes': ascii(own.startSource),
        'notify.kcs': kcsProgram([
          [37, marker],
          ...own.calls.flatMap((row) => [
            ...row.args.map((arg, index) => [37, index === 0 ? [0x13, 80] : arg]),
            [43, row.id, row.args.length * 4],
            ...(row.control === 1 ? [[45]] : []),
          ]),
          [59],
        ]),
      },
      world = await dataWorld(own.profile, files),
      actions = [];
    t.after(() => world.close({ flushFiles: false }));
    world.host.nativeWindowAction = (action) => {
      actions.push(action);
      return action.type === 'fes-open-site' ? own.shellResult : 1;
    };
    const invoke = (id, args) =>
      world.runtime.native('main', id, args, world.main.machine, world.main);
    world.runtime.variableBank(world.main).initialize(512);
    const made = await invoke(66, [34, world.nativeTaskID(world.main.id), 0]),
      id = world.resolveTaskID(made.value, world.main.id),
      target = world.nativeTaskID(id),
      fes = world.objects.objects.get(id).implementation;
    world.main.machine.writeString('authored', 256);
    await invoke(447, [target, 256]);
    await invoke(448, [target]);
    const task = await world.spawnScript('notify.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      machine = task.machine;
    machine.store(80, target);
    machine.writeString('', 320);
    const dispatch = world.runtime.scheduler.dispatch;
    let at = 0;
    world.runtime.scheduler.dispatch = async (table, raw, args, m, caller, ...rest) => {
      if (caller !== task) return dispatch(table, raw, args, m, caller, ...rest);
      const row = own.calls[at++];
      assert.equal(raw, row.id);
      if (row.label === 'own OPEN notification queues normal external-open work')
        machine.writeString('OPEN', 256);
      if (row.label === 'independent known non-IO notification') machine.writeString('AFTER', 256);
      if (row.label === 'reload true START source with platform command')
        machine.writeString('authored-start', 384);
      const reply = await dispatch(table, raw, args, m, caller, ...rest);
      assert.equal(reply.control, row.control, row.label);
      if (row.control === 1) assert.equal(reply.value, row.result, row.label);
      return reply;
    };
    try {
      await world.runtime.scheduler.execute(task);
    } finally {
      world.runtime.scheduler.dispatch = dispatch;
    }
    assert.equal(at, own.calls.length);
    assert.equal(machine.pop(), marker);
    assert.deepEqual(
      actions.map((action) =>
        action.type === 'fes-open-site'
          ? { api: 'ShellExecuteA', file: [...action.bytes] }
          : {
              api: 'MessageBoxA',
              caption: action.caption,
              message: action.message,
              buttons: action.buttons,
            },
      ),
      own.traffic.map((action) =>
        action.api === 'ShellExecuteA'
          ? { api: action.api, file: action.file }
          : {
              api: action.api,
              caption: cp932(action.caption),
              message: cp932(action.text),
              buttons: action.buttons,
            },
      ),
    );
    assert.equal(fes.player.root.resultValue, 789);
    const saved = structuredClone(world.snapshot()),
      fresh = await dataWorld(own.profile, files, { initialize: false }),
      coldActions = [];
    t.after(() => fresh.close({ flushFiles: false }));
    fresh.host.nativeWindowAction = (action) => {
      coldActions.push(action);
      return 33;
    };
    await fresh.restore(saved);
    const restored = fresh.objects.objects.get(id).implementation;
    await restored.tick();
    assert.equal(restored.player.root.resultValue, 789);
    await restored.player.notify('AFTER');
    assert.deepEqual(coldActions, [], 'completed external work is not serialized or replayed');
    assert.equal(restored.player.root.runtime.closed, false);
    await world.objects.release(id);
    assert.equal(fes.player, null);
    assert(fresh.objects.objects.has(id));
    await fresh.objects.release(id);
  });
}

for (const profile of new Set(golden.cases.map((own) => own.profile))) {
  test(`${profile} a zero-return object command resumes after its JavaScript async boundary`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': ascii(
        '#DEFINE\nBASE BOX\n#OBJECT BOX\nPRI 1\n#START\nnext WAIT\n#WAIT\n#MOVE\nBOX pri 7\n\\0=321\nbreak\n',
      ),
    });
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const command = h.instance.runtime.command.bind(h.instance.runtime);
      let commands = 0;
      h.instance.runtime.command = (...args) => {
        commands++;
        const pending = command(...args);
        assert.equal(typeof pending.then, 'function');
        return pending;
      };
      await h.task.player.notify('MOVE');
      assert.equal(commands, 1);
      assert.equal(h.instance.local(0), 321);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
