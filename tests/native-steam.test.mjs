// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSteam } from '../src/native/steam.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { FESPlayer } from '../src/fes/player.mjs';

test('failed Steam initialization retains its singleton and does not retry or invent platform availability', async () => {
  let attempts = 0;
  const steam = new NativeSteam({
    initialize: () => {
      attempts++;
      return false;
    },
  });
  assert.equal(steam.managerExists, false);
  assert.deepEqual(await Promise.all([steam.initialize(), steam.initialize()]), [0, 0]);
  assert.equal(attempts, 1);
  assert.equal(steam.managerExists, true);
  assert.equal(steam.enabled, false);
  assert.equal(steam.achievementState('missing'), 0);
  assert.equal(await steam.achievement('missing'), 0);
  await steam.close();
  assert.equal(steam.managerExists, false);
});

test('Steam cache updates precede platform calls, retain byte-exact keys and reset even without a stats interface', async () => {
  const trace = [],
    provider = {
      achievements: new Map([
        ['locked', false],
        ['猫', true],
      ]),
      achievement: (name) => {
        trace.push(['unlock', name, steam.achievementState(name)]);
        return false;
      },
      resetAllStats: (all) => {
        trace.push(['reset', all, steam.achievementState('猫')]);
        return false;
      },
    },
    steam = new NativeSteam(provider);
  await steam.initialize();
  await steam.achievement('locked');
  await steam.achievement('locked');
  assert.equal(steam.achievementState('LOCKED'), 0);
  assert.equal(steam.achievementState(Uint8Array.of(0xff, 0x81)), 0);
  assert.equal(steam.achievementState(new TextEncoder().encode('猫')), 1);
  assert.deepEqual(trace, [['unlock', 'locked', 1]]);
  await steam.resetAllStats();
  assert.deepEqual(trace.at(-1), ['reset', 1, 0]);
  steam.refreshAchievements(new Map([['猫', 255]]));
  provider.statsReady = false;
  await steam.resetAllStats();
  provider.statsReady = true;
  assert.equal(steam.achievementState('猫'), 0);
  assert.equal(trace.length, 2);
  await steam.close();
});

function make(steam) {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    game = memoryGame({ 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) }),
    configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom();
  configuration.fields.texture.size.set([2, 2]);
  configuration.fields.texture.grid.set([1, 1]);
  configuration.fields.texture.areas[0].set([0, 0, 1, 1]);
  configuration.fields.texture.bppY.set([0, 1]);
  return new NativeWorld({
    game,
    images: {},
    host: {},
    profile,
    configuration,
    random,
    steam,
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
}
test('World KCS and FES share one Steam cache across fresh checkpoint restoration and close it only with its Engine owner', async () => {
  let initialized = 0,
    shutdown = 0;
  const trace = [],
    steam = new NativeSteam({
      initialize: () => {
        initialized++;
        return true;
      },
      achievements: new Map([['one', false]]),
      achievement: (name) => trace.push(name),
      resetAllStats: () => {},
      shutdown: () => shutdown++,
    }),
    first = make(steam),
    fresh = make(steam);
  try {
    await first.initialize('main.kcs');
    const before = structuredClone(first.snapshot()),
      m = first.main.machine;
    m.writeString('one', 0);
    assert.deepEqual(await first.runtime.native('main', 0x413, [0], m, first.main), {
      control: 1,
      value: 0,
    });
    await first.runtime.native('main', 0x412, [0], m, first.main);
    assert.deepEqual(trace, ['one']);
    const host = first.fesHost(first.objects.objects.get(first.main.id)),
      bank = first.runtime.stringBank(first.main),
      utf8 = new TextEncoder().encode('猫');
    bank.setBytes(0, utf8);
    bank.setBytes(1, Uint8Array.of(0xff, 0x81));
    bank.set(2, '$str0');
    first.configuration.scriptReplacements.add(new TextEncoder().encode('%name%'), utf8);
    assert.deepEqual(host.nativeFESArgumentBytes('$str0'), utf8);
    assert.deepEqual(host.nativeFESArgumentBytes('$str1'), Uint8Array.of(0xff, 0x81));
    assert.deepEqual(host.nativeFESArgumentBytes('$str2'), new TextEncoder().encode('$str0'));
    assert.deepEqual(host.nativeFESArgumentBytes('%name%'), utf8);
    await host.initializeSteam();
    assert.equal(host.steam, steam);
    assert.equal(host.steam.achievementState('one'), 1);
    await first.close({ flushFiles: false });
    assert.equal(shutdown, 0);
    await fresh.restore(before);
    fresh.main.machine.writeString('one', 0);
    assert.deepEqual(
      await fresh.runtime.native('main', 0x413, [0], fresh.main.machine, fresh.main),
      { control: 1, value: 1 },
    );
    assert.equal(initialized, 1);
    await fresh.runtime.native('main', 0x414, [], fresh.main.machine, fresh.main);
    assert.equal(steam.achievementState('one'), 0);
  } finally {
    await first.close({ flushFiles: false });
    await fresh.close({ flushFiles: false });
    await steam.close();
  }
  assert.equal(shutdown, 1);
});

test('ordinary Game broadcast state follows actual FES queries, menu toggles and fresh-world checkpoints without an EXE', async () => {
  let queries = 0;
  const steam = new NativeSteam({
      isBroadcasting: async () => {
        queries++;
        return false;
      },
    }),
    first = make(steam),
    fresh = make(steam),
    rejected = make(steam),
    checks = [];
  for (const world of [first, fresh, rejected]) {
    world.ensureNativeEngine = () => {
      throw new Error('Ordinary broadcast attempted original CPU execution');
    };
    world.host.nativeMenuChecked = (...args) => checks.push(args);
  }
  const query = async (world) => {
    const globals = {},
      player = new FESPlayer(
        memoryGame({
          'broadcast.fes': new TextEncoder().encode(
            '#START\nsteam_isbroadcast 7\nnext WAIT\n#WAIT\n',
          ),
        }),
        {},
        world.fesHost(world.objects.objects.get(world.main.id)),
        globals,
      );
    await player.start('broadcast');
    await player.step();
    return globals[7];
  };
  try {
    await first.initialize('main.kcs');
    first.configuration.authorMode = 1;
    assert.equal(await query(first), 0, 'The actual constructor initializes the raw flag to zero');
    assert.equal(queries, 1);
    first.window.post(0x111, 0xabcd0000 | 40096);
    await first.processWindowMessages();
    assert.deepEqual(checks, [[40096, true]]);
    assert.equal(await query(first), 1, 'The platform observation result is ignored');
    assert.equal(queries, 2);
    first.configuration.authorMode = 0;
    assert.equal(await query(first), 0, 'An allocated manager uses the author gate');
    assert.equal(queries, 3);
    const absent = new NativeSteam(null);
    first.steamService = absent;
    assert.equal(await query(first), 1, 'A missing singleton bypasses the author gate');
    assert.equal(queries, 3);
    first.steamService = steam;
    first.window.post(0x111, 40096);
    await first.processWindowMessages();
    assert.deepEqual(
      checks,
      [[40096, true]],
      'Toggling still changes state without refreshing a gated checkmark',
    );
    first.configuration.authorMode = 1;
    assert.equal(await query(first), 0);
    first.window.post(0x111, 40096);
    await first.processWindowMessages();
    const saved = structuredClone(first.snapshot()),
      beforeQueries = queries;
    assert.equal(saved.window.broadcastFlag, 1);
    await first.close({ flushFiles: false });
    const reads = [],
      load = fresh.runtime.scheduler.load;
    fresh.runtime.scheduler.load = function (...args) {
      reads.push(args[0]);
      return load.apply(this, args);
    };
    await fresh.restore(structuredClone(saved));
    assert.deepEqual(fresh.snapshot(), saved, 'The entire DTO is present before a warm frame');
    assert.equal(queries, beforeQueries, 'Restoration does not replay the platform query or menu');
    assert.deepEqual(reads, ['main.kcs'], 'Only the immutable scheduler program is rebound');
    assert.equal(fresh.frame, saved.frame);
    assert.equal(fresh.nativeEngine, undefined);
    assert.equal(await query(fresh), 1);
    first.window.post(0x111, 40096);
    assert.equal(first.windowMessages.length, 0, 'The old closed owner cannot queue a new toggle');
    const invalid = structuredClone(saved);
    invalid.window.broadcastFlag = -1;
    await assert.rejects(rejected.restore(invalid), /broadcast.*checkpoint/i);
    assert.equal(rejected.objects.objects.size, 0);
    assert.equal(rejected.nativeEngine, undefined);
    const raw = structuredClone(saved);
    raw.window.broadcastFlag = 0x80000000;
    await rejected.restore(raw);
    assert.equal(await rejected.window.broadcast(), 0x80000000, 'The window returns the raw DWORD');
    assert.equal(
      await query(rejected),
      -2147483648,
      'FES setGlobal preserves its signed32 storage',
    );
    rejected.window.post(0x111, 40096);
    await rejected.processWindowMessages();
    assert.equal(
      await query(rejected),
      0,
      'The actual menu toggle writes logical-not of the old raw word',
    );
  } finally {
    for (const world of [first, fresh, rejected]) await world.close({ flushFiles: false });
    await steam.close();
  }
});
