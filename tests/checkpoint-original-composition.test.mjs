// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioMixer } from '../src/audio.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { audioFixture as fixture } from './fixtures/audio-context.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';
import {
  hasOriginalWorldCheckpoint,
  restoreOriginalWorld,
  snapshotOriginalWorld,
} from '../oracle/native-world-runtime.mjs';

test('checkpoint composition rejects unowned physical state before mutation and keeps an explicit restore owner', async () => {
  const environment = startupEnvironment(),
    { context } = fixture();
  let core, cold, direct, explicit;
  try {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      game = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'cue.wav': new Uint8Array([1]) },
      }),
      make = (options = {}) =>
        new CatSystem2({
          game,
          canvas: new StartupCanvas(),
          audioContext: fixture().context,
          nativeProfile: profile,
          randomSeed: 17,
          ...options,
        });
    core = make({ audioContext: context });
    await core.initialize();
    assert.equal(await core.world.sound.load(0, 'cue.wav', 1), true);
    assert.equal(await core.world.sound.play(0, 1, {}), true);
    context.advance(0.125);
    const saved = await core.snapshot(),
      previous = core.world,
      audio = core.audio,
      channel = audio.channels.get('native:0'),
      source = channel.source,
      previousState = structuredClone(previous.snapshot()),
      handles = previous.runtime.handles,
      previousClosed = previous.closed,
      physical = { features: [], heap: Uint8Array.of(3, 1, 4, 1), registers: { pc: 17, sp: 64 } };
    let io = 0,
      stages = 0;
    for (const name of ['read', 'require', 'fingerprint']) {
      const original = game[name];
      game[name] = function (...args) {
        io++;
        return original.apply(this, args);
      };
    }
    const create = core.createNativeWorld;
    core.createNativeWorld = function (...args) {
      stages++;
      return create.apply(this, args);
    };
    for (const payload of [physical, 0, false]) {
      const bad = structuredClone(saved);
      bad.world.nativeEngine = payload;
      await assert.rejects(core.restore(bad), /physical checkpoint.*restore owner/i);
      assert.strictEqual(core.world, previous);
      assert.strictEqual(core.audio, audio);
      assert.strictEqual(core.audio.channels.get('native:0'), channel);
      assert.strictEqual(channel.source, source);
      assert.notEqual(source.stopped, true);
      assert.strictEqual(previous.runtime.handles, handles);
      assert.equal(previous.closed, previousClosed);
      assert.deepEqual(previous.snapshot(), previousState);
    }
    assert.equal(stages, 0);
    assert.equal(io, 0);
    cold = make();
    const bad = structuredClone(saved);
    bad.world.nativeEngine = physical;
    await assert.rejects(
      cold.initialize({ checkpoint: bad }),
      /physical checkpoint.*restore owner/i,
    );
    assert.equal(cold.world, undefined);
    assert.equal(io, 0, 'Cold import must reject before fingerprint/resources/saves');
    direct = create.call(core, {
      audio: new AudioMixer(game, fixture().context, { deferPlayback: true }),
    });
    const beforeWindow = direct.window.snapshot();
    await assert.rejects(direct.restore(bad.world), /physical checkpoint.*restore owner/i);
    assert.deepEqual(direct.window.snapshot(), beforeWindow);
    assert.equal(direct.objects.objects.size, 0);
    assert.equal(direct.runtime.scheduler.tasks.size, 0);
    assert.equal(direct.frame, 0);
    assert.equal(io, 0);
    // Function presence alone is not an owner: it must recognize this state.
    for (const adapter of [
      {
        open() {
          throw new Error('Original open must not be called');
        },
      },
      {
        hasWorldCheckpoint: () => false,
        restoreWorld() {
          throw new Error('Unclaimed state restored');
        },
      },
      { hasWorldCheckpoint: () => true },
    ]) {
      cold.transitionalExe = adapter;
      await assert.rejects(
        cold.initialize({ checkpoint: bad }),
        /physical checkpoint.*restore owner/i,
      );
    }
    assert.equal(io, 0);
    const nullable = structuredClone(saved);
    nullable.world.nativeEngine = null;
    await core.restore(nullable);
    assert.equal(Object.hasOwn(core.world.snapshot(), 'nativeEngine'), false);
    let restored = null,
      restoreCalls = 0,
      starts = 0,
      recognized = 0;
    const owner = {
        restore(value) {
          restored = structuredClone(value);
        },
        snapshot() {
          return structuredClone(restored);
        },
      },
      adapter = {
        hasWorldCheckpoint(state) {
          assert.strictEqual(this, adapter);
          recognized++;
          return hasOriginalWorldCheckpoint(state);
        },
        restoreWorld(world, state) {
          assert.strictEqual(this, adapter);
          restoreCalls++;
          return restoreOriginalWorld(world, state);
        },
        snapshotWorld: snapshotOriginalWorld,
        installWorldRuntime(world) {
          world.ensureNativeEngine = async () => {
            starts++;
            world.nativeEngine = owner;
            return owner;
          };
        },
      };
    explicit = make({ transitionalExe: adapter });
    await explicit.initialize({ checkpoint: bad });
    assert.equal(starts, 1);
    assert.equal(restoreCalls, 1);
    assert.ok(recognized >= 1);
    assert.deepEqual(restored, physical);
    assert.deepEqual(explicit.world.snapshot().nativeEngine, physical);
  } finally {
    if (direct) await direct.close({ flushFiles: false });
    await explicit?.dispose();
    await cold?.dispose();
    await core?.dispose();
    environment.restore();
  }
});
