// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';

const source = new TextEncoder().encode('#START\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n');

async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': source });
  try {
    const h = await loadDefaultFES(world);
    assert.equal(world.objects.objects.get(h.id).kind, 34);
    assert.ok(h.task.player.root.runtime instanceof FESCoordinator);
    return { world, ...h };
  } catch (error) {
    await world.close();
    throw error;
  }
}

function observe(world) {
  const sends = [],
    send = world.sendNativeEngine;
  world.sendNativeEngine = function (...args) {
    sends.push(args.slice(0, 5));
    return send.apply(this, args);
  };
  return sends;
}

function assertDeclaration(profile, id) {
  const entry = nativeABI(profile).tables.main.entries[id];
  assert.equal(entry.status, 'recovered');
  assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[id].signature);
  assert.equal(entry.signature.argumentWords, 2);
  assert.deepEqual(entry.controlCodes, [2]);
  assert.equal(entry.signature.result.kind, 'void');
  assert.equal(entry.signature.resultWritten, false);
  if (profile === profiles[0]) {
    assert.match(entry.evidence, new RegExp('SDK-2\\.6\\.1\\.74-main' + id + '-full-wrapper'));
    assert.notEqual(entry.evidence, nativeABI(profiles[1]).tables.main.entries[id].evidence);
  }
}

test('main449 binds real FES surfaces through both explicit profiles', async () => {
  for (const [profileIndex, profile] of profiles.entries()) {
    const h = await open(profile);
    try {
      const { world, task } = h,
        owner = world.main,
        machine = owner.machine,
        nativeTarget = world.nativeTaskID(h.id),
        second = await world.objects.create({ kind: 15, parent: owner.id });
      await world.sendEngine(second, owner.id, 279, 64, 32);
      await world.sendEngine(second, owner.id, 283);
      const sends = observe(world);
      let previous = h.surface;
      for (const surface of [second, h.surface]) {
        const nativeSurface = world.nativeTaskID(surface),
          args = [nativeTarget, nativeSurface],
          before = machine.snapshot();
        const reply = await world.runtime.native(
          'main',
          449,
          args,
          machine,
          owner,
          world.runtime.scheduler,
        );
        assert.deepEqual(reply, { control: 2 });
        assert.equal(task.surface, surface, 'The actual kind34 receiver changed its surface');
        assert.strictEqual(world.graphics.fesSurfaces.get(surface).get(h.id), task.player);
        assert.equal(world.graphics.fesSurfaces.get(previous).has(h.id), false);
        assert.deepEqual(sends.at(-1), [nativeTarget, owner.id, 334, 0, nativeSurface]);
        assert.equal(task.player.nativeDraw.target, nativeSurface);
        assert.deepEqual(
          [task.player.nativeDraw.width, task.player.nativeDraw.height],
          surface === second ? [64, 32] : [128, 96],
        );
        assert.deepEqual(machine.snapshot(), before, 'The void call did not write the caller VM');
        assert.deepEqual(args, [nativeTarget, nativeSurface]);
        previous = surface;
      }
      assert.equal(sends.length, 2);
      assert.equal(mapABIMessage(profile, 'control', 'raw', 334, 34), [329, 334][profileIndex]);
      assertDeclaration(profile, 449);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  }
});

test('main451 sets real FES save objects through both explicit profiles', async () => {
  for (const [profileIndex, profile] of profiles.entries()) {
    const h = await open(profile);
    try {
      const { world, task } = h,
        owner = world.main,
        machine = owner.machine,
        nativeTarget = world.nativeTaskID(h.id),
        files = [];
      for (const tag of [0x1357, 0x2468]) {
        const created = await world.runtime.native(
          'main',
          0xee,
          [tag],
          machine,
          owner,
          world.runtime.scheduler,
        );
        assert.equal(created.control, 1);
        const handle = created.value,
          file = world.runtime.handles.get(handle, 'global-file');
        assert.equal(file.tag, tag);
        files.push({ handle, file });
      }
      assert.notEqual(files[0].handle, files[1].handle);
      const sends = observe(world);
      for (const value of [files[0].handle, 0, files[1].handle]) {
        const args = [nativeTarget, value],
          before = machine.snapshot();
        const reply = await world.runtime.native(
          'main',
          451,
          args,
          machine,
          owner,
          world.runtime.scheduler,
        );
        assert.deepEqual(reply, { control: 2 });
        assert.equal(
          task.player.saveObject,
          value,
          'The actual kind34 receiver kept the raw handle',
        );
        assert.deepEqual(sends.at(-1), [nativeTarget, owner.id, 336, 0, value]);
        if (value)
          assert.strictEqual(
            world.runtime.handles.get(task.player.saveObject, 'global-file'),
            files.find(({ handle }) => handle === value).file,
          );
        assert.deepEqual(machine.snapshot(), before, 'The void call did not write the caller VM');
        assert.deepEqual(args, [nativeTarget, value]);
      }
      assert.equal(sends.length, 3);
      assert.equal(mapABIMessage(profile, 'control', 'raw', 336, 34), [331, 336][profileIndex]);
      assertDeclaration(profile, 451);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  }
});
