// SPDX-License-Identifier: MPL-2.0
// Original FES dispatch and lexer; Steam manager operations, expression lookup,
// variable storage and SCRIPT replacement are declared boundary services.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { parseProgram } from '../src/fes/program.mjs';
import { evaluate } from '../src/fes/expression.mjs';
import { tokenizeNativeFESSoundConfiguration } from '../src/native/fes-sound-config.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
const [exe, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-fes-steam.mjs GAME_EXE IGNORED_REPORT');
const profile = 'nekopara-vol3-engine-2.6.1.76',
  engine = await NativeEngineProcess.open({ profile, bytes: new Uint8Array(await readFile(exe)) }),
  p = engine.process,
  scope = p.allocate(64, true),
  tokenizer = p.allocate(64, true),
  source = p.allocate(4096, true),
  manager = p.allocate(16, true),
  events = [],
  names = [
    ['steam_init', 0x785db0],
    ['steam_achievement', 0x785dc0],
    ['steam_achievement_reset', 0x785e20],
    ['steam_isbroadcast', 0x785e40],
    ['steam_isenable', 0x785ec0],
    ['steam_enablescreenshot', 0x785f40],
  ];
p.store(scope, tokenizer);
p.store(scope + 36, 1);
p.store(tokenizer + 24, 1);
p.store(engine.refs.owner + 163524, 7);
const patch = (at, name, count, fn) => engine.patch(at, name, count, fn, { calleePops: true });
const strings = new NativeStringBank();
patch(0x7402f0, 'authored FES string-bank boundary', 2, ([input, out]) => {
  engine.kernel.writeString(out, strings.expand(p.string(input)));
  return 1;
});
patch(0x728d80, 'authored FES expression service', 1, ([ptr]) => evaluate(p.string(ptr), {}));
patch(0x728c40, 'authored FES variable storage', 2, ([index, value]) =>
  events.push(['store', index, value]),
);
patch(0x713680, 'authored identity SCRIPT replacement', 2, ([out, src]) => {
  engine.kernel.writeString(out, p.string(src));
  return 1;
});
engine.patch(0x5aea30, 'authored Steam singleton initialization', 0, () => {
  events.push(['initialize']);
  return manager;
});
patch(0x5aed20, 'authored Steam achievement manager', 1, ([ptr]) =>
  events.push(['achievement', [...p.stringBytes(ptr)]]),
);
patch(0x5aed60, 'authored Steam reset manager', 0, () => events.push(['reset']));
patch(0x5aed80, 'authored Steam screenshot manager', 1, ([value]) =>
  events.push(['screenshot', value]),
);
patch(0x5aedc0, 'authored Steam broadcast manager', 0, () => {
  events.push(['broadcast']);
  return 19;
});
let comparisons = 0;
try {
  for (const state of ['null', 'failed', 'ready'])
    for (const [name, address] of names)
      for (const argument of ['', '3', '(1 + 2)', '0x7fffffff', '"authored text"', '$str0']) {
        if (
          (name === 'steam_isenable' || name === 'steam_isbroadcast') &&
          ['"authored text"', '$str0'].includes(argument)
        )
          continue;
        if (name === 'steam_enablescreenshot' && ['"authored text"', '$str0'].includes(argument))
          continue;
        const command = name + (argument ? ' ' + argument : '');
        p.store(0xb9bd9c, state === 'null' ? 0 : manager);
        p.store(manager, Number(state === 'ready'));
        engine.kernel.writeString(source, command);
        events.length = 0;
        const control = await engine.call(address, [scope, 0, 0, source, 0]);
        assert.equal(control, 0, `${command}/${state}: original FES return`);
        const expected = structuredClone(events);
        events.length = 0;
        const pending = [],
          host = {
            steam:
              state === 'null'
                ? null
                : {
                    enabled: state === 'ready',
                    achievement: (value) => events.push(['achievement', [...value]]),
                    resetAllStats: () => events.push(['reset']),
                    enableScreenshot: (value) => events.push(['screenshot', value >>> 0]),
                  },
            initializeSteam: () => events.push(['initialize']),
            nativeSteamBroadcast: () => {
              if (state !== 'null') {
                events.push(['broadcast']);
                return 19;
              }
              return 7;
            },
            soundConfigTokens: (line) => tokenizeNativeFESSoundConfiguration(line, profile),
            nativeFESScriptBytes: (value) => value,
          },
          instance = new FESInstance('AuthoredSteam', parseProgram('#START\n'), {
            host,
            globals: {},
            strings: {},
            enqueue: (promise) => pending.push(promise),
            unsupported: (message) => {
              throw new Error(message);
            },
          });
        instance.setGlobal = (index, value) => events.push(['store', index >>> 0, value >>> 0]);
        instance.execute(command, [], 0);
        await Promise.all(pending);
        assert.deepEqual(events, expected, `${command}/${state}: original manager/storage calls`);
        comparisons++;
      }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        comparisons,
        boundaries: [
          'Steam manager operations',
          'expression evaluation',
          'variable storage',
          'SCRIPT replacement',
          'string-bank expansion',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${comparisons} original FES Steam dispatches agree`);
} finally {
  for (const pointer of [scope, tokenizer, source, manager]) p.free(pointer);
  await engine.close();
}
