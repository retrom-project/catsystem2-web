// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomFillSync } from 'node:crypto';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import {
  transferCheckpointBytes,
  checkpointTransferChunkBytes,
} from './browser/touch-evidence.mjs';

test('touch checkpoint transfer preserves every production byte and graph alias in bounded blocks', async () => {
  const bytes = randomFillSync(new Uint8Array(checkpointTransferChunkBytes * 2 + 17)),
    saved = { bytes, alias: bytes, view: new Uint16Array(bytes.buffer, 2, 41), negativeZero: -0 };
  saved.self = saved;
  saved.map = new Map([[saved.view, new Set([bytes])]]);
  const encoded = await serializeCheckpoint(saved),
    sha256 = createHash('sha256').update(encoded).digest('hex'),
    slot = '__ownedCheckpoint',
    window = { [slot]: encoded },
    dir = await mkdtemp(join(tmpdir(), 'touch-checkpoint-')),
    path = join(dir, 'complete.cs2web');
  let calls = 0;
  const page = {
    async evaluate(callback, args) {
      const previous = globalThis.window;
      globalThis.window = window;
      try {
        calls++;
        return await callback(args);
      } finally {
        globalThis.window = previous;
      }
    },
  };
  try {
    const result = await transferCheckpointBytes(page, {
        slot,
        path,
        bytes: encoded.length,
        sha256,
      }),
      actual = await readFile(path),
      restored = await deserializeCheckpoint(actual);
    assert.deepEqual(actual, Buffer.from(encoded));
    assert.deepEqual(restored, saved);
    assert.equal(restored.alias, restored.bytes);
    assert.equal(restored.view.buffer, restored.bytes.buffer);
    assert.equal(restored.self, restored);
    assert.equal(restored.map.get(restored.view).has(restored.bytes), true);
    assert.equal(result.sha256, sha256);
    assert.equal(result.transferChunks, 3);
    assert.equal(calls, 4, 'three binary blocks plus slot cleanup, without per-byte arrays');
    assert.equal(Object.hasOwn(window, slot), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('touch checkpoint transfer rejects truncation, altered bytes and malformed encoding before accepting a file', async () => {
  const bytes = Uint8Array.from({ length: 257 }, (_, i) => i),
    sha256 = createHash('sha256').update(bytes).digest('hex'),
    dir = await mkdtemp(join(tmpdir(), 'touch-checkpoint-invalid-'));
  try {
    for (const kind of ['truncated', 'altered', 'malformed']) {
      const slot = '__ownedCheckpoint',
        window = { [slot]: bytes },
        page = {
          async evaluate(callback, args) {
            const previous = globalThis.window;
            globalThis.window = window;
            try {
              const result = await callback(args);
              if (typeof args === 'string') return result;
              if (kind === 'truncated') return result.slice(0, -4);
              if (kind === 'malformed') return '*' + result.slice(1);
              const altered = Buffer.from(result, 'base64');
              altered[0] ^= 1;
              return altered.toString('base64');
            } finally {
              globalThis.window = previous;
            }
          },
        };
      await assert.rejects(
        transferCheckpointBytes(page, { slot, path: join(dir, kind), bytes: bytes.length, sha256 }),
        /Touch checkpoint (byte transfer|browser\/file digest) differs/,
      );
      assert.equal(Object.hasOwn(window, slot), false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const source = `#DEFINE
BUTTON b
#OBJECT SIZE POS
b 16,16 10,10,0
#START
$41=++$41
next IDLE
#IDLE
break
next IDLE
#b.TOUCH
$40=++$40
break
`;
function javascriptOnly(world) {
  world.ensureNativeEngine = () => {
    throw new Error('TOUCH checkpoint must stay JavaScript');
  };
}
for (const profile of profiles) {
  test(`${profile}: real TOUCH survives portable checkpoint and fresh World without source or event replay`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': new TextEncoder().encode(source),
    });
    javascriptOnly(world);
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const input = h.task.input.input,
        button = h.instance.collection.lookup('b', 0),
        initialSavedTouch = h.task.player.snapshot().root.touch,
        receive = h.task.input.message.bind(h.task.input);
      let callbacks = 0;
      h.task.input.message = (words, context) => {
        if (words[1] === 65) callbacks++;
        return receive(words, context);
      };
      assert.equal(h.instance.system('_TOUCH_'), 0);
      input.pointer(12, 12, 1);
      await world.tick();
      input.pointerActivation = true;
      await world.tick();
      assert.equal(callbacks, 2, 'real BUTTON and low-button Graph callbacks ran');
      assert.equal(input.pointerActivation, false);
      assert.equal(h.instance.system('_TOUCH_'), button.handle);
      assert.equal(h.instance.global(40), 1);
      assert.equal(h.instance.global(41), 1);
      await world.tick();
      assert.equal(callbacks, 2);
      assert.equal(
        h.instance.system('_TOUCH_'),
        button.handle,
        'ordinary frame does not clear TOUCH',
      );

      const file = await serializeCheckpoint(world.snapshot()),
        saved = await deserializeCheckpoint(file);
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      javascriptOnly(fresh);
      const reads = [],
        messages = [],
        read = fresh.game.read.bind(fresh.game),
        dispatch = fresh.engineMessages.dispatch.bind(fresh.engineMessages),
        dispatchNative = fresh.engineMessages.dispatchNative.bind(fresh.engineMessages);
      fresh.game.read = (name) => {
        reads.push(name);
        return read(name);
      };
      fresh.engineMessages.dispatch = (target, sender, code, ...args) => {
        messages.push(code);
        return dispatch(target, sender, code, ...args);
      };
      fresh.engineMessages.dispatchNative = (sender, target, code, ...args) => {
        messages.push(code);
        return dispatchNative(sender, target, code, ...args);
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        instance = task.player.root;
      assert.equal(
        instance.system('_TOUCH_'),
        button.handle,
        'fresh restore preserves sole TOUCH owner',
      );
      assert.equal(instance.collection.lookup('b', 0).handle, button.handle);
      assert.equal(instance.global(40), 1, 'restoring does not replay the TOUCH label');
      assert.equal(instance.global(41), 1, 'restoring does not replay START');
      assert.equal(
        initialSavedTouch,
        0,
        'before-event snapshot uses existing system zero semantics',
      );
      await fresh.tick();
      assert.equal(
        instance.system('_TOUCH_'),
        button.handle,
        'restored ordinary frame retains TOUCH',
      );
      assert.equal(instance.value('_TOUCH_'), button.handle);
      assert.equal(instance.global(40), 1);
      assert.equal(instance.global(41), 1);
      assert.equal(
        messages.includes(65),
        false,
        'neither restore nor its frame replays TOUCH delivery',
      );
      assert.equal(messages.includes(332), false, 'restore does not request a new FES source');
      assert.ok(
        reads.every((name) => name === 'case.kcs'),
        `no FES/FILE replay: ${reads}`,
      );
      assert.equal(task.input.input.pointerActivation, false);
      assert.equal(fresh.nativeEngine, undefined);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await world.close();
    }
  });
}
