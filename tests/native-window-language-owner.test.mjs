// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_ABIS, nativeABI, validateABI } from '../src/native/abi/index.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { parseXML } from '../src/xml.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76';
const xml = (text) => parseXML(`<document>${text}</document>`);
const startup = () =>
  xml(
    '<language><default>0</default><OPTTABLE>options_%LANG_M%.txt</OPTTABLE>' +
      '<L00><code>1033</code><prefix>en</prefix><lang>English</lang><accelsub>XS</accelsub></L00>' +
      '<L01><code>1041</code><prefix>jp</prefix><lang>Japanese</lang><accel>JS</accel></L01>' +
      '<L02><code>1036</code><prefix>fr</prefix><lang>French</lang><accel>FS</accel><accelsub>CS</accelsub></L02>' +
      '</language>',
  );
const event = (code, key, extra = {}) => ({ code, key, shiftKey: true, ...extra });
async function fixture(initialize = true, fixtureProfile = profile) {
  const files = { 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) };
  for (const [prefix, value] of [
    ['en', 'English'],
    ['jp', 'Japanese'],
    ['fr', 'French'],
  ]) {
    files[`language_${prefix}.txt`] = new TextEncoder().encode(`$UI$\r\n${value} UI\r\n`);
    files[`options_${prefix}.txt`] = new TextEncoder().encode(`$CHOICE$\r\n${value} option\r\n`);
  }
  const game = memoryGame(files),
    reads = [],
    checks = [],
    configuration = new NativeConfiguration({
      profile: fixtureProfile,
      startup: startup(),
      uiLanguage: 1033,
      preferences: xml('<language><id><UI>0</UI><main>2</main><sub>0</sub></id></language>'),
    }),
    random = new ParticleRandom(19, 23),
    world = new NativeWorld({
      profile: fixtureProfile,
      game,
      images: {},
      configuration,
      random,
      motionLibrary: new MotionLibrary(game, { profile: fixtureProfile, random }),
      storage: { read: async () => null, write: async () => true },
      host: { nativeMenuChecked: (command, checked) => checks.push([command, checked]) },
    });
  for (const method of ['read', 'require']) {
    const original = game[method].bind(game);
    game[method] = async (name) => {
      reads.push(name);
      return original(name);
    };
  }
  world.inputBindings = new NativeInputBindings(world.input, configuration);
  world.ensureNativeEngine = () => {
    throw new Error('typed language input must not open an EXE');
  };
  if (initialize) await world.initialize('main.kcs');
  return { world, files, reads, checks };
}
function keydown(world, input) {
  // Same public producer and choice as web/app.mjs: a handled shortcut enters
  // the window queue, while an unmatched physical key remains InputBindings'.
  const packet = world.window.keyboardShortcut(input);
  if (packet) world.window.post(...packet);
  else world.inputBindings.keyboard(input, true);
  return packet;
}
function checkedPass(checks, selected) {
  // Own Game530EB0: clear the three ten-item ranges, then UI/main/sub in order.
  assert.deepEqual(checks.splice(0), [
    ...Array.from({ length: 30 }, (_, i) => [40065 + i, false]),
    ...selected.map((command) => [command, true]),
  ]);
}

test('Game language shortcuts route real keyboard metadata through the World with packed indexes and derived menu checks', async () => {
  const { world, checks, reads } = await fixture();
  try {
    const { language } = world.configuration;
    assert.equal(world.globalStrings.get('$CHOICE$'), 'French option');
    const packet = keydown(world, event('KeyJ', 'J'));
    // post owns its metadata; retaining or modifying a browser tuple cannot
    // change the later physical message consumed by the World.
    if (packet) {
      packet[3].modifiers = 16;
      packet[3].character = 88;
    }
    await world.tick();
    assert.equal(language.main, 0);
    assert.equal(world.globalStrings.get('$CHOICE$'), 'English option');
    assert.equal(reads.at(-1), 'options_en.txt');
    checkedPass(checks, [40065, 40075, 40085]);
    // Independent own52CDCB rows: zero keys are skipped and main/sub counters
    // pack separately. No invented resource101 base rows are included here.
    assert.deepEqual(world.window.languageAccelerators, [
      [5, 88, 40085],
      [5, 74, 40075],
      [5, 70, 40076],
      [5, 67, 40086],
      [4, 78, 40087],
    ]);
    keydown(world, event('KeyC', 'C'));
    await world.tick();
    assert.equal(language.sub, 1);
    checkedPass(checks, [40065, 40075, 40086]);
    keydown(world, event('KeyN', 'N'));
    await world.tick();
    // Two configured nonzero sub keys yield suffix2, still a valid language
    // index in this three-language fixture: Shift-N must not force "none".
    assert.equal(language.sub, 2);
    checkedPass(checks, [40065, 40075, 40087]);
    keydown(world, event('KeyF', 'F'));
    await world.tick();
    assert.equal(language.main, 1);
    assert.equal(world.globalStrings.get('$CHOICE$'), 'Japanese option');
    checkedPass(checks, [40065, 40076, 40087]);
    world.window.post(0x111, 0x10000 | 40066);
    await world.tick();
    assert.equal(language.ui, 1);
    assert.equal(world.globalStrings.get('$UI$'), 'Japanese UI');
    checkedPass(checks, [40066, 40076, 40087]);
    world.window.post(0x111, 40074);
    world.window.post(0x111, 40084);
    world.window.post(0x111, 40094);
    await world.tick();
    assert.deepEqual([language.ui, language.main, language.sub], [1, 1, 0xffffffff]);
    checkedPass(checks, [40066, 40076, 40088]);
    const unmatched = event('KeyZ', 'z', { shiftKey: false });
    assert.equal(keydown(world, unmatched), null);
    assert.equal(world.inputBindings.browserKeys.get('KeyZ'), 90);
    assert.deepEqual(world.inputBindings.events.at(-1), {
      category: 'keyboard',
      code: 90,
      down: true,
    });
    assert.equal(world.windowMessages.length, 0);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('Game pending language shortcuts restore into a fresh World without replay and close isolates their input owner', async () => {
  const source = await fixture(),
    fresh = await fixture(false);
  try {
    await source.world.tick();
    keydown(source.world, event('KeyJ', 'J'));
    const pending = source.world.snapshot(),
      immutable = structuredClone(pending),
      restoreReads = [],
      methods = [];
    const trap = (object, name) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, name);
      methods.push(() =>
        descriptor ? Object.defineProperty(object, name, descriptor) : delete object[name],
      );
      object[name] = () => {
        throw new Error(`restore replayed ${name}`);
      };
    };
    for (const method of ['read', 'require']) {
      const original = fresh.world.game[method],
        descriptor = Object.getOwnPropertyDescriptor(fresh.world.game, method);
      methods.push(() => Object.defineProperty(fresh.world.game, method, descriptor));
      fresh.world.game[method] = async (name) => {
        const allowed = ['main.kcs', 'm2view.cnf'];
        assert.equal(
          name,
          allowed[restoreReads.length],
          'only normal program/M2 revalidation is allowed',
        );
        restoreReads.push(name);
        const bytes = await original.call(fresh.world.game, name);
        if (name === 'main.kcs') assert.deepEqual(bytes, fresh.files['main.kcs']);
        else assert.equal(bytes, null, 'the authored fixture has no M2 configuration');
        return bytes;
      };
    }
    trap(fresh.world.window, 'command');
    trap(fresh.world.globalStrings, 'reload');
    trap(fresh.world.runtime, 'native');
    trap(fresh.world.random, 'rand');
    trap(fresh.world.random, 'frand');
    try {
      await fresh.world.restore(pending);
    } finally {
      for (const restore of methods.reverse()) restore();
    }
    assert.deepEqual(restoreReads, ['main.kcs', 'm2view.cnf']);
    assert.deepEqual(fresh.checks, []);
    const before = fresh.world.snapshot();
    for (const field of [
      'frame',
      'runtime',
      'configuration',
      'globalStrings',
      'random',
      'inputBindings',
      'windowMessages',
    ])
      assert.deepEqual(before[field], pending[field], `fresh ${field} before any warm tick`);
    await fresh.world.tick();
    assert.equal(fresh.world.configuration.language.main, 0);
    assert.equal(fresh.world.globalStrings.get('$CHOICE$'), 'English option');
    checkedPass(fresh.checks, [40065, 40075, 40085]);
    assert.deepEqual(pending.windowMessages, [
      { message: 0x100, wParam: 74, lParam: 1, keyboard: { modifiers: 4, character: 74 } },
    ]);
    assert.equal(source.world.configuration.language.main, 2);
    await source.world.tick();
    assert.equal(source.world.configuration.language.main, 0);
    checkedPass(source.checks, [40065, 40075, 40085]);
    keydown(source.world, event('KeyN', 'N'));
    assert.equal(source.world.windowMessages.length, 1);
    await source.world.close({ flushFiles: false });
    assert.equal(source.world.window.keyboardShortcut(event('KeyF', 'F')), null);
    source.world.window.post(0x111, 40076);
    await source.world.processWindowMessages();
    assert.deepEqual(source.world.windowMessages, []);
    assert.deepEqual(source.checks, []);
    keydown(fresh.world, event('KeyF', 'F'));
    await fresh.world.tick();
    assert.equal(fresh.world.configuration.language.main, 1);
    assert.equal(fresh.world.globalStrings.get('$CHOICE$'), 'Japanese option');
    checkedPass(fresh.checks, [40065, 40076, 40085]);
    assert.equal(source.world.configuration.language.main, 0);
    assert.equal(fresh.world.nativeEngine, undefined);
    assert.deepEqual(
      pending,
      immutable,
      'later frames/close cannot mutate the obtained checkpoint',
    );
  } finally {
    await source.world.close({ flushFiles: false });
    await fresh.world.close({ flushFiles: false });
  }
});

test('language accelerators require an explicit per-version capability and stay disabled for the SDK', async () => {
  const sdk = 'sdk-4.01-engine-2.6.1.74',
    { world, checks } = await fixture(true, sdk);
  try {
    const packet = keydown(world, event('KeyJ', 'J'));
    await world.tick();
    assert.equal(packet, null);
    assert.equal(world.inputBindings.browserKeys.get('KeyJ'), 74);
    assert.equal(world.configuration.language, undefined);
    assert.deepEqual(world.window.languageAccelerators, []);
    world.window.refreshLanguageMenu();
    assert.deepEqual(checks, []);
    assert.equal(world.nativeEngine, undefined);
    assert.equal(nativeABI(sdk).capabilities.windowLanguageAccelerators, false);
    assert.equal(nativeABI(profile).capabilities.windowLanguageAccelerators, true);
    for (const abi of Object.values(NATIVE_ABIS)) {
      const missing = structuredClone(abi);
      delete missing.capabilities.windowLanguageAccelerators;
      assert.throws(() => validateABI(missing), /Invalid ABI behavior data/);
    }
    for (const value of [null, 0, 'true']) {
      const invalid = structuredClone(nativeABI(sdk));
      invalid.capabilities.windowLanguageAccelerators = value;
      assert.throws(() => validateABI(invalid), /Invalid ABI behavior data/);
    }
    assert.throws(() => nativeABI('unregistered'), /provide reviewed per-version ABI data/);
  } finally {
    await world.close({ flushFiles: false });
  }
});
