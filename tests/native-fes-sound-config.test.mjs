// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  NativeFESSoundConfiguration,
  FES_SOUND_CONFIGURATION_GET_FIELDS,
  FES_SOUND_CONFIGURATION_SET_FIELDS,
  tokenizeNativeFESSoundConfiguration,
  expandNativeFESSoundConfigurationToken,
} from '../src/native/fes-sound-config.mjs';
import { EngineHost } from '../src/host.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import {
  fesSoundConfigurationFixture,
  fesSoundConfigurationCases,
  fesSoundConfigurationTokenCases,
  fesSoundConfigurationState,
  fesSoundExpression,
} from './fixtures/fes-sound-config-fixture.mjs';

const golden = JSON.parse(
    await fs.readFile(new URL('fixtures/fes-sound-config-golden.json', import.meta.url)),
  ),
  hash = (data) => createHash('sha256').update(data).digest('hex');

for (const profile of golden.profiles) {
  test(`all FES sound fields and token grammar match the original ${profile.profile}`, async () => {
    const results = [];
    for (const row of fesSoundConfigurationCases()) {
      const { configuration, soundConfiguration } = fesSoundConfigurationFixture(
          profile.profile,
          row.seed,
        ),
        expressions = [],
        writes = [];
      let dirty = 0;
      const service = new NativeFESSoundConfiguration({
          configuration,
          soundConfiguration,
          changed: () => {
            dirty = 1;
          },
        }),
        context = { evaluate: (token) => fesSoundExpression(token, row, expressions) };
      if (row.tokens[0] !== undefined) {
        const first = context.evaluate(row.tokens[0]);
        if (row.tokens[1] !== undefined) {
          if (row.operation === 'get') {
            const value = service.get(row.tokens.slice(1), context);
            if (value !== undefined) writes.push({ index: first >>> 0, value: value >>> 0 });
          } else await service.set(row.tokens.slice(1), first, context);
        }
      }
      results.push({
        control: 0,
        writes,
        expressions,
        dirty,
        stateSHA256: hash(fesSoundConfigurationState(configuration, soundConfiguration)),
      });
    }
    assert.equal(hash(JSON.stringify(results)), profile.nativeResultsSHA256);
    const tokens = [...fesSoundConfigurationTokenCases()].map((source) =>
      tokenizeNativeFESSoundConfiguration(source, profile.profile),
    );
    assert.equal(results.length + tokens.length, profile.total);
    assert.equal(hash(JSON.stringify(tokens)), profile.lexerResultsSHA256);
  });

  test(`FES commands share their native tree and evaluate expressions once (${profile.profile})`, async () => {
    const { configuration, soundConfiguration } = fesSoundConfigurationFixture(profile.profile),
      events = [],
      service = new NativeFESSoundConfiguration({
        configuration,
        soundConfiguration,
        changed: async (name, context, result) => {
          await Promise.resolve();
          events.push({ name, instance: context.instance, ...result });
        },
      }),
      host = new EngineHost({ world: { fesSoundConfiguration: service } }),
      source = `#START
getsndconfex ++$10 volume 123
getsndconfex ++$10 unknown ++$12
setsndconfex ++$10 volume_id (6 + 1) (+3)
getsndconfex ++$10 volume_id (6 + 1) (+3)
getsndconfex 22 volume_id
getsndconfex 23 sysplay master
getsndconfex 24 volume MASTER
setsndconfex 44 reset master
getsndconfex 25 voicevol voice
getsndconfex 26 volume $str0x10
getsndconfex 27 volume $str-1
getsndconfex 28 $str18 $str19
getsndconfex ++$10
setsndconfex -1 volume_type
setsndconfex -1 unknown ++$12
exit 0
`,
      game = memoryGame({ 'sound.fes': new TextEncoder().encode(source) }),
      globals = { 10: 10, 12: 90, 25: 925 },
      player = new FESPlayer(game, {}, host, globals, {
        16: 'voice',
        0xffffffff: '123',
        18: 'volume',
        19: '%LANG_M%',
      });
    player.languageMain = 'voice';
    await player.start('sound');
    await player.step();
    assert.equal(player.error, null);
    assert.equal(player.root.finished, 0);
    assert.equal(globals[10], 15);
    assert.equal(globals[11], 120);
    assert.equal(globals[12], 90);
    assert.equal(globals[14], 13);
    assert.equal(globals[22], profile.profile.startsWith('sdk-') ? -1 : 100);
    assert.equal(globals[23], 115);
    assert.equal(globals[24], 113);
    assert.equal(globals[25], 925);
    assert.equal(globals[26], 78);
    assert.equal(globals[27], 120);
    assert.equal(globals[28], 78);
    assert.equal(soundConfiguration.parts[0].children[0].current.volume, 13);
    assert.equal(
      soundConfiguration.master.current.volume,
      soundConfiguration.master.defaults.volume,
    );
    assert.equal(soundConfiguration.master.current.skipvol, 75);
    assert.deepEqual(
      events.map(({ name, recognized }) => [name, recognized]),
      [
        ['volume_id', true],
        ['reset', true],
        ['unknown', false],
      ],
    );
    assert(events.every(({ instance }) => instance === player.root));
    assert.equal(service.soundConfiguration, soundConfiguration);
    assert.deepEqual(host.soundSelector(['sysplay', 'master']), {
      field: 'sysplay',
      selector: { by: 'key', query: 'master' },
    });
    assert.equal(host.soundSelector(['voicevol', 'voice']), undefined);
  });
}

test('sound configuration has exact field lists and updates the existing restored backing', () => {
  assert.equal(FES_SOUND_CONFIGURATION_GET_FIELDS.length, 15);
  assert.equal(FES_SOUND_CONFIGURATION_SET_FIELDS.length, 18);
  const profile = golden.profiles[0].profile,
    { configuration, soundConfiguration } = fesSoundConfigurationFixture(profile),
    service = new NativeFESSoundConfiguration({ configuration, soundConfiguration });
  const saved = soundConfiguration.snapshot();
  service.set(['volume', 'voice'], 12);
  assert.equal(soundConfiguration.get('volume', { by: 'key', query: 'voice' }), 12);
  soundConfiguration.restore(saved);
  assert.equal(service.get(['volume', 'voice']), 78);
  assert.equal(service.get(['volume', '123']), 120);
  assert.equal(service.get(['volume_type', 'VOICE']), 78);
  service.set(['volume_type', 'VOICE'], 12);
  assert.equal(service.get(['volume_type', 'VOICE']), 78);
  assert.throws(() => new EngineHost({}).soundConfig(['volume', 'voice']), /native world/);
  assert.throws(() => service.get(['volume_id', '7']), /expression service/);
});

test('sound token expansion is one pass, accepts native signed/hex indices and preserves escapes', () => {
  const entries = { 0: 'zero', 16: '$str0', 0xffffffff: 'negative' },
    expand = (token) =>
      expandNativeFESSoundConfigurationToken(token, { string: (index) => entries[index] });
  assert.equal(expand('$str0x10'), '$str0');
  assert.equal(expand('$str-1'), 'negative');
  assert.equal(expand('$str+0'), 'zero');
  assert.equal(expand('$str99'), '');
  assert.equal(expand('\\_\\n$strx'), '\\_\\n$strx');
  assert.throws(() => tokenizeNativeFESSoundConfiguration('get 1 volume_id 7'), /profile/);
});

test('World FES configuration and KCS read one sound tree after a fresh-world checkpoint', async () => {
  for (const { profile } of golden.profiles) {
    const game = memoryGame({
        'main.kcs': kcsProgram([[37, 32], [43, 0xd1, 4], [37, 64], [43, 0x47, 4], [59]]),
        'settings.fes': new TextEncoder().encode(
          '#START\nsetsndconfex 31 volume voice\ngetsndconfex 6 volume voice\nnext HOLD\n#HOLD\nwait 1\nnext HOLD\n#CHANGE\nsetsndconfex 47 volume_id 7 3\ngetsndconfex 7 volume a\n',
        ),
      }),
      makeWorld = () => {
        const { configuration, soundConfiguration } = fesSoundConfigurationFixture(profile),
          random = new ParticleRandom();
        return new NativeWorld({
          game,
          images: {},
          profile,
          configuration,
          soundConfiguration,
          random,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          // These inherited services must not be used by a World-bound FES host.
          host: {
            soundConfig() {
              throw new Error('Wrong World');
            },
          },
          storage: {
            read: (name) => game.read(name),
            write: async () => true,
            remove: async () => true,
          },
        });
      },
      first = makeWorld(),
      second = makeWorld();
    try {
      await first.initialize('main.kcs');
      const id = await first.objects.create({ kind: 34, parent: first.main.id }),
        implementation = first.objects.objects.get(id).implementation;
      await implementation.load('settings.fes', first.main);
      await implementation.tick();
      assert.equal(first.runtime.variableBank(first.main).get(6), 31);
      assert.equal(first.soundConfiguration.get('volume', { by: 'key', query: 'voice' }), 31);
      assert.equal(first.configurationDirty, true);
      await second.restore(structuredClone(first.snapshot()));
      const restored = second.objects.objects.get(id).implementation;
      await restored.player.notify('CHANGE');
      assert.equal(second.runtime.variableBank(second.main).get(7), 47);
      second.main.machine.writeString('a', 64);
      const reply = second.runtime.native(
        'main',
        0x3bd,
        [64],
        second.main.machine,
        second.main,
        second.runtime.scheduler,
      );
      assert.equal(reply.value, 47);
      assert.equal(first.soundConfiguration.get('volume', { by: 'key', query: 'a' }), 85);
      assert.equal(second.fesSoundConfiguration.soundConfiguration, second.soundConfiguration);
      assert.equal(restored.player.host.soundConfig(['volume', 'a']), 47);
    } finally {
      await first.close({ flushFiles: false });
      await second.close({ flushFiles: false });
    }
  }
});
