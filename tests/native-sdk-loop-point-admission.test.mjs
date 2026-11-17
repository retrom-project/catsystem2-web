// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { NativeSoundConfiguration } from '../src/native/sound-config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { GameFiles } from '../src/files.mjs';
import { parseXML } from '../src/xml.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const profiles = [
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
  'rebellions-jp-engine-2.6.1.63',
];
const sentinel = 0x24681357;
const callerProgram = kcsProgram(
  [
    [37, sentinel],
    [37, 19],
    [37, 1024],
    [43, 400, 8],
    [37, 73],
    [38, [0x13, 512]],
    [37, 0x80000000],
    [37, 1100],
    [43, 400, 8],
    [37, 74],
    [38, [0x13, 516]],
    [59],
  ],
  [
    [1024, 'bgm.int/Loop%d[G200].txt'],
    [1100, 'bgm.int/missing.txt'],
  ],
);
const table = new TextEncoder().encode(
  'music 10 0x100000002\r\nmusic +0x20 0x200000003\r\ndefault\r\nsigned -3 -1\r\ninvalid 30 20\r\nunclassified 7 9\r\n',
);

async function makeWorld(profile) {
  const startup = parseXML(
    '<document><INT><int00><name>bgm</name><int>bgm.int</int><ext>ogg</ext></int00><int01><name>kcs</name><ext>kcs</ext></int01></INT></document>',
  );
  const game = memoryGame({
    'case.kcs': kcsProgram([[37, 240], [43, 0x47, 4], [59]]),
    'caller.kcs': callerProgram,
    'bgm.int/loop7.txt': table,
  });
  game.nativeResources = new NativeResources(startup);
  game.resolveCategory = GameFiles.prototype.resolveCategory;
  game.readCategory = GameFiles.prototype.readCategory;
  const random = new ParticleRandom();
  const soundConfiguration = new NativeSoundConfiguration({
    profile,
    document: parseXML(
      '<document><MASTER/><PART>' +
        ['music', 'default', 'signed', 'invalid']
          .map((name) => `<${name}><head>${name}</head><int>bgm</int></${name}>`)
          .join('') +
        '<unclassified><head>unclassified</head><int>absent</int></unclassified>' +
        '</PART></document>',
    ),
  });
  const world = new NativeWorld({
    profile,
    game,
    random,
    configuration: new NativeConfiguration({ profile, startup }),
    soundConfiguration,
    host: {},
    images: {},
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
  world.ensureNativeEngine = () => {
    throw new Error('Loop-point GCALL attempted to load an EXE');
  };
  await world.initialize('case.kcs');
  return world;
}

for (const profile of profiles) {
  test(`${profile} loop-point GCALL resolves each record through sound resources without a result word`, async () => {
    const world = await makeWorld(profile);
    try {
      const sound = world.sound.primary();
      assert.ok(sound, 'The ordinary World created its real Sound child');
      assert.strictEqual(world.sound.get(sound.record.id), sound);
      assert.equal(world.objects.objects.get(sound.record.id).kind, 13);
      const callerID = await world.objects.create({
        kind: 12,
        parent: world.main.id,
        name: 'loop-table',
      });
      const record = world.objects.objects.get(callerID);
      await record.implementation.loadScript('caller.kcs');
      const caller = record.implementation.task;
      const machine = caller.machine;
      machine.store(200, 7);
      const initialSP = machine.sp;
      const calls = [],
        reads = [],
        diagnostics = [];
      const native = world.runtime.native;
      const read = world.runtime.services.read;
      world.runtime.native = function (channel, id, ...args) {
        if (channel !== 'main' || id !== 400) return native.call(this, channel, id, ...args);
        const call = { args: [...args[0]].map((word) => word >>> 0) };
        calls.push(call);
        const reply = native.call(this, channel, id, ...args);
        call.reply = reply;
        return reply;
      };
      world.runtime.services.read = function (name, category) {
        reads.push([name, category]);
        return read.call(this, name, category);
      };
      world.runtime.services.diagnostic = (detail) => diagnostics.push(detail);
      await world.runtime.scheduler.execute(caller);
      // Actual GCALL comes first: SDK baseline must fail at dispatch; Game
      // baseline must expose its unexpanded resource key, not merely metadata.
      assert.deepEqual(sound.loopPoints.get('bgm.int/music.ogg'), {
        file: 'bgm.int/music.ogg',
        start: 32n,
        end: 0x100000002n,
      });
      const defaultPoint = sound.loopPoints.get('bgm.int/default.ogg');
      if (profile === 'rebellions-jp-engine-2.6.1.63') assert.equal(defaultPoint, undefined);
      else
        assert.deepEqual(defaultPoint, {
          file: 'bgm.int/default.ogg',
          start: 0n,
          end: -1n,
        });
      assert.deepEqual(sound.loopPoints.get('bgm.int/signed.ogg'), {
        file: 'bgm.int/signed.ogg',
        start: -3n,
        end: -1n,
      });
      assert.deepEqual(sound.loopPoints.get(''), { file: '', start: 7n, end: 9n });
      assert.equal(sound.loopPoints.has('bgm.int/invalid.ogg'), false);
      assert.equal(sound.loopPoints.has('music'), false);
      assert.equal(sound.loopPoints.has('unclassified'), false);
      assert.equal(sound.loopPoints.size, defaultPoint ? 4 : 3);
      assert.deepEqual(
        calls.map((call) => call.args),
        [
          [19, 1024],
          [0x80000000, 1100],
        ],
      );
      assert.deepEqual(await Promise.all(calls.map((call) => call.reply)), [
        { control: 2 },
        { control: 2 },
      ]);
      assert.deepEqual(reads, [
        ['bgm.int/Loop7.txt', 'sound'],
        ['bgm.int/missing.txt', 'sound'],
      ]);
      assert.deepEqual(diagnostics, [
        {
          native: 400,
          resource: 'bgm.int/missing.txt',
          error: 'Loop point resource was not found',
        },
      ]);
      assert.equal(machine.load(512), 73);
      assert.equal(machine.load(516), 74);
      assert.equal(machine.halted, true);
      assert.equal(
        machine.pop(),
        sentinel,
        'A void GCALL cannot push a value over the guest sentinel',
      );
      assert.equal(machine.sp, initialSP);
      const entry = nativeABI(profile).tables.main.entries[400];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'sound.readLoopPointTable');
      assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[400].signature);
      assert.deepEqual(entry.controlCodes, [2]);
      if (profile === profiles[0]) {
        assert.match(entry.evidence, /SDK-2\.6\.1\.74-main400-loop-table-wrapper/);
        assert.notEqual(entry.evidence, nativeABI(profiles[1]).tables.main.entries[400].evidence);
      }
    } finally {
      await world.close();
    }
  });
}
