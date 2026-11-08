// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import {
  AuthoredClipboard,
  UNICODE_OUTPUT_PROFILE as profile,
  unicodeOutputFixture,
} from './fixtures/unicode-output-fixture.mjs';
const encoder = new TextEncoder(),
  gates = [0xb8f188, 0xb8f194, 0xb8f18c];
const put = (machine, bytes, address = 256) =>
  machine.bytes(address, bytes.length + 1).set([...bytes, 0]);

test(
  'Unicode output executes original formatting, UTF-8 walker, newline and percent/CRT semantics',
  {
    skip: !process.env.CATSYSTEM2_ENGINE_EXE,
  },
  async () => {
    const fixture = await unicodeOutputFixture(
        new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      ),
      { engine, feature, machine, clipboard, logs } = fixture,
      prior = [0x1234, 0, 0x5678];
    gates.forEach((at, i) => engine.process.store(at, prior[i]));
    try {
      put(machine, encoder.encode('日本語\\n %s[G1024]'));
      put(machine, encoder.encode('100%%'), 1024);
      assert.deepEqual(await feature.invoke(0x410, [256], machine, { id: 9 }), { control: 2 });
      assert.deepEqual(logs, [encodeCP932('日本語\\n 100%')]);
      assert.deepEqual(
        gates.map((at) => engine.process.load(at)),
        prior,
      );
      assert.deepEqual(await feature.invoke(0x40f, [256], machine, { id: 9 }), { control: 2 });
      assert.equal(clipboard.contents, '日本語\r\n 100%');
      assert.deepEqual(clipboard.events, [
        ['open', 0x12345678],
        ['empty'],
        ['write', '日本語\r\n 100%'],
        ['close'],
      ]);
      put(machine, encoder.encode('\ufeff😀tail'));
      await feature.invoke(0x40f, [256], machine, { id: 9 });
      assert.deepEqual(
        [...clipboard.contents].map((c) => c.charCodeAt(0)),
        [0xfeff, 0xd83d, 116, 97, 105, 108],
        'original converter retains only the first UTF-16 unit of a four-byte UTF-8 sequence',
      );
      clipboard.available = false;
      clipboard.events.length = 0;
      await feature.invoke(0x40f, [256], machine, { id: 9 });
      assert.deepEqual(clipboard.events, [['open', 0x12345678]]);
      clipboard.available = true;
      clipboard.acceptWrite = false;
      const old = new Set(engine.process.allocations.keys());
      await feature.invoke(0x40f, [256], machine, { id: 9 });
      assert.equal(clipboard.contents, '');
      const retained = [...feature.globalAllocations];
      assert.equal(
        retained.length,
        1,
        'original failed SetClipboardData leaves its caller allocation',
      );
      assert.equal(old.has(retained[0][0]), false);
      assert.equal(engine.process.allocations.has(retained[0][0]), true);
      const saved = structuredClone(engine.snapshot()),
        fresh = await unicodeOutputFixture(
          new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
        );
      try {
        fresh.engine.restore(saved);
        assert.deepEqual([...fresh.feature.globalAllocations], retained);
        assert.equal(
          fresh.clipboard.contents,
          'previous',
          'checkpoint restore does not overwrite the external OS clipboard',
        );
        put(fresh.machine, encoder.encode('after restore'));
        await fresh.feature.invoke(0x410, [256], fresh.machine, { id: 9 });
        assert.deepEqual(fresh.logs, [encodeCP932('after restore')]);
        assert.deepEqual(
          gates.map((at) => fresh.engine.process.load(at)),
          prior,
        );
      } finally {
        await fresh.engine.close();
      }
      const failure = new Error('authored debug host error');
      fixture.world.runtime.services.nativeDebugOutput = () => {
        throw failure;
      };
      await assert.rejects(
        () => feature.invoke(0x410, [256], machine, { id: 9 }),
        (error) => error === failure,
      );
      assert.deepEqual(
        gates.map((at) => engine.process.load(at)),
        prior,
        'failed side effect restores the original globals',
      );
    } finally {
      await engine.close();
    }
  },
);

test(
  'World Unicode output uses its native window and survives a fresh World with current VM RAM',
  {
    skip: !process.env.CATSYSTEM2_ENGINE_EXE,
  },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      make = async () => {
        const game = memoryGame({ 'main.kcs': kcsProgram([[37, 2048], [43, 0x47, 4], [59]]) }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          clipboard = new AuthoredClipboard(),
          logs = [],
          world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: { nativeClipboard: clipboard, nativeDebugOutput: (b) => logs.push(b.slice()) },
            storage: { read: async () => null, write: async () => true },
            motionLibrary: new MotionLibrary(game, { profile, random }),
          });
        const engine = await NativeEngineProcess.open({ bytes, profile, configuration });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return { world, clipboard, logs };
      },
      first = await make();
    let fresh;
    const invoke = (world, id) =>
      world.runtime.native(
        'main',
        id,
        [256],
        world.main.machine,
        world.main,
        world.runtime.scheduler,
      );
    try {
      await first.world.initialize('main.kcs');
      put(first.world.main.machine, encoder.encode('World 日本語'));
      await invoke(first.world, 0x410);
      await invoke(first.world, 0x40f);
      assert.deepEqual(first.logs, [encodeCP932('World 日本語')]);
      assert.equal(first.clipboard.events[0][1], first.world.window.handle);
      fresh = await make();
      await fresh.world.restore(structuredClone(first.world.snapshot()));
      assert.equal(fresh.clipboard.contents, 'previous');
      put(fresh.world.main.machine, encoder.encode('new live bytes'));
      await invoke(fresh.world, 0x410);
      await invoke(fresh.world, 0x40f);
      assert.deepEqual(fresh.logs, [encodeCP932('new live bytes')]);
      assert.equal(fresh.clipboard.contents, 'new live bytes');
      assert.equal(first.clipboard.contents, 'World 日本語');
    } finally {
      await fresh?.world.close({ flushFiles: false });
      await first.world.close({ flushFiles: false });
    }
  },
);
