// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenePlayer, cleanText, parseMessage } from '../src/scene.mjs';
import { catScene, memoryGame } from './helpers.mjs';

async function scene(scripts, host = {}, globals = {}, strings = {}) {
  const game = memoryGame(
    Object.fromEntries(
      Object.entries(scripts).map(([name, lines]) => [`${name}.cst`, catScene(lines)]),
    ),
  );
  const player = new ScenePlayer(game, host, globals, strings);
  await player.start('main');
  return player;
}
const command = (text) => [0x30, text];
const text = (value) => [0x20, value];
const input = [2, ''];

test('CST call/return and conditional assignments preserve the caller and shared variable domain', async () => {
  const p = await scene({
    main: [
      command('#1=$100'),
      command('call child'),
      command('if (#1==258) (#2+=4)'),
      text('After'),
      input,
    ],
    child: [command('#1++'), command('call nested'), command('return'), command('#2=99')],
    nested: [command('++#1')],
  });
  await p.tick();
  assert.equal(p.globals[1], 258);
  assert.equal(p.globals[2], 4);
  assert.equal(p.currentMessage.text, 'After');
  assert.equal(p.stack.length, 1);
  assert.throws(() => p.local(1), /no FES local variable domain/);
});

test('CST numbered strings expand in commands, speakers and message text', async () => {
  const strings = {};
  const p = await scene(
    {
      main: [
        command('str 1 child'),
        command('str 2 Cat'),
        command('strn 3 7'),
        command('next $str1'),
      ],
      child: [[0x21, '$str2'], text('Count:$str3'), input],
    },
    {},
    {},
    strings,
  );
  await p.tick();
  assert.equal(p.currentMessage.speaker, 'Cat');
  assert.equal(p.currentMessage.text, 'Count:7');
  assert.equal(p.currentMessage.scene, 'child');
  assert.equal(p.currentMessage.line, 1);
  assert.equal(strings[1], 'child');
});

test('CST max/min return the first matching position, and bit/calendar helpers use result indices', async () => {
  const p = await scene({
    main: [
      command('#1=8'),
      command('#2=30'),
      command('#3=30'),
      command('max 10 #1 #2 #3'),
      command('min 11 #1 #2'),
      command('setfbit 20 0 7 31'),
      command('clearfbit 20 7'),
      command('getfbit 21 #20 31'),
      command('week 22 2024 2 29'),
      command('str 1 Cat'),
      command('str 2 cat'),
      command('strcmp 23 $str1 $str2'),
      command('strcmp 24 $str1 $str2 1'),
    ],
  });
  await p.tick();
  assert.equal(p.globals[10], 1);
  assert.equal(p.globals[11], 0);
  assert.equal(p.globals[20], -2147483647);
  assert.equal(p.globals[21], 1);
  assert.equal(p.globals[22], 4);
  assert.equal(p.globals[23], 0);
  assert.equal(p.globals[24], 1);
});

test('fselect consumes compiled rows, permits duplicate IDs and selects by row order', async () => {
  const shown = [];
  const p = await scene(
    {
      main: [command('fselect custom'), command('0 left First'), command('0 right Second')],
      left: [text('Left'), input],
      right: [text('Right'), input],
    },
    {
      selection: (value) => {
        shown.push(value);
      },
      undoPoint() {},
      selectionClosed() {},
    },
  );
  await p.tick();
  assert.equal(p.waiting.kind, 'selection');
  assert.equal(shown[0].script, 'custom');
  assert.deepEqual(
    shown[0].choices.map((c) => c.id),
    [0, 0],
  );
  await p.choose(1);
  await p.tick();
  assert.equal(p.currentMessage.text, 'Right');
  await assert.rejects(p.choose(0), /No matching scene selection/);
});

test('select disabled entries and select2 chosen-ID flags have separate contracts', async () => {
  const p = await scene(
    {
      main: [command('select'), command('9 1 Disabled'), command('10 image Next')],
      image: [command('select2 map 4 80'), command('12 left'), command('25 right')],
      left: [text('Left'), input],
      right: [text('Right'), input],
    },
    { selection() {}, undoPoint() {}, selectionClosed() {} },
  );
  await p.tick();
  assert.equal(p.waiting.choices[0].enabled, false);
  assert.equal(p.waiting.choices[0].disabledStyle, 1);
  await assert.rejects(p.choose(0), /disabled/);
  await p.choose(1);
  await p.tick();
  assert.equal(p.waiting.file, 'map');
  assert.equal(p.waiting.plane, 4);
  await p.choose(1);
  await p.tick();
  assert.equal(p.globals[80], 25);
  assert.equal(p.currentMessage.text, 'Right');
});

test('selection state survives a checkpoint without confusing repeated IDs or return frames', async () => {
  const scripts = {
    main: [command('call question'), text('Returned'), input],
    question: [command('fselect'), command('4 result A'), command('4 result B')],
    result: [command('return')],
  };
  const host = { selection() {}, undoPoint() {}, selectionClosed() {} };
  const p = await scene(scripts, host);
  await p.tick();
  const restored = await scene(scripts, host);
  await restored.restore(p.snapshot());
  await restored.choose(1);
  await restored.tick();
  assert.equal(restored.currentMessage.text, 'Returned');
  assert.equal(restored.stack.length, 1);
});

test('wait key pauses a continuation and keyskip off prevents skipping a timed wait', async () => {
  const p = await scene({
    main: [
      text('First\\@'),
      command('wait key'),
      command('keyskip off'),
      command('wait 0'),
      command('#1=1'),
      text('Second'),
      input,
    ],
  });
  await p.tick();
  assert.equal(p.currentMessage.text, 'First');
  assert.equal(p.waiting.kind, 'input');
  p.advance();
  await p.tick();
  assert.equal(p.waiting.kind, 'frames');
  assert.equal(p.globals[1], undefined);
  p.advance();
  assert.equal(p.waiting.kind, 'frames');
  p.stage.frame++;
  await p.tick();
  assert.equal(p.globals[1], 1);
  assert.equal(p.currentMessage.text, 'Second');
});

test('voice and particle waits query their explicit host lifetime instead of all stage motions', async () => {
  let soundBusy = true,
    particleBusy = true;
  const p = await scene(
    { main: [command('wait pcm 2'), command('#1=1'), command('wait pt 3'), command('#2=1')] },
    { soundBusy: () => soundBusy, particleBusy: () => particleBusy },
  );
  await p.tick();
  await p.tick();
  assert.equal(p.globals[1], undefined);
  soundBusy = false;
  await p.tick();
  assert.equal(p.globals[1], 1);
  assert.equal(p.waiting.bank, 3);
  particleBusy = false;
  await p.tick();
  assert.equal(p.globals[2], 1);
});

test('fesds requests a persistent asynchronous bank instead of closing a modal screen', async () => {
  const calls = [];
  const p = await scene(
    { main: [command('#1=7'), command('fesds 2 1 0 hud #1 9')] },
    {
      fesAsync: (request) => calls.push(request),
    },
  );
  await p.tick();
  assert.deepEqual(calls, [{ bank: 2, save: true, il: 0, file: 'hud', parameters: [7, 9] }]);
  assert.equal(p.waiting, null);
});

test('replay boundaries register their offset flag and terminate only in replay mode', async () => {
  const scripts = { main: [command('end_of_kaisou 4'), command('#1=99')] };
  const normal = await scene(scripts);
  normal.replayFlagBase = 900;
  await normal.tick();
  assert.equal(normal.globals[904], 1);
  assert.equal(normal.globals[1], 99);
  let ended = 0;
  const replay = await scene(scripts, {
    replayEnd: () => {
      ended++;
    },
  });
  replay.replayFlagBase = 900;
  replay.replayMode = true;
  await replay.tick();
  assert.equal(replay.globals[904], 1);
  assert.equal(replay.globals[1], undefined);
  assert.equal(replay.finished, true);
  assert.equal(ended, 1);
});

test('frameoff restores at text, while forcemesdel retains suppression until explicitly cleared', async () => {
  const windows = [];
  const p = await scene(
    {
      main: [
        command('frameoff'),
        text('Visible'),
        input,
        command('forcemesdel 1'),
        text('Hidden'),
        input,
        command('forcemesdel 0'),
        command('mesdraw 0'),
        text('Logged'),
        input,
      ],
    },
    { showWindow: (show) => windows.push(show), messageVisibility() {} },
  );
  await p.tick();
  assert.equal(p.windowVisible, true);
  p.advance();
  await p.tick();
  assert.equal(p.windowVisible, false);
  assert.equal(p.currentMessage.text, 'Hidden');
  p.advance();
  await p.tick();
  assert.equal(p.windowVisible, true);
  assert.equal(p.currentMessage.visible, false);
  assert.equal(p.log.length, 3);
  assert.deepEqual(windows, [false, true, false, true]);
});

test('forced auto mode uses its declared timing and optional manual advance flag', async () => {
  const p = await scene(
    { main: [command('auto on 1 0 -1 0'), text('Auto'), input, command('#1=1')] },
    {
      automaticMode() {},
    },
  );
  await p.tick();
  assert.equal(p.waiting.autoDue, 6);
  p.advance();
  assert.equal(p.waiting.kind, 'input');
  p.stage.frame = 5;
  await p.tick();
  assert.equal(p.globals[1], undefined);
  p.stage.frame = 6;
  await p.tick();
  assert.equal(p.globals[1], 1);
});

test('unknown CST commands retain a source location instead of becoming silent host hints', async () => {
  const p = await scene({
    main: [command('unknown 1'), command('tonetbl 2'), command('autoface on')],
  });
  await p.tick();
  assert.ok([...p.unsupported].some((s) => /^main:1: unknown 1/.test(s)));
  assert.ok([...p.unsupported].some((s) => /^main:2: tonetbl/.test(s)));
  assert.ok([...p.unsupported].some((s) => /^main:3: autoFace: host service/.test(s)));
});

test('message escapes preserve formatting and timing instructions without inventing default font metrics', () => {
  const parsed = parseMessage(
    'A\\C0xff0000ff;B\\c\\FLL C\\f+3;D\\fr10;E\\PCF\\wf12;G\\w2;H\\wrI\\N\\@',
  );
  assert.equal(parsed.text, 'AB CDEFGHI\n');
  assert.deepEqual(parsed.unknown, []);
  assert.deepEqual(
    parsed.runs.filter((r) => r.kind === 'style'),
    [
      { kind: 'style', property: 'color', operation: 'set', value: 0xff0000ff },
      { kind: 'style', property: 'color', operation: 'reset', value: null },
      { kind: 'style', property: 'size', operation: 'keyword', value: 'll' },
      { kind: 'style', property: 'size', operation: 'relative', value: 3 },
      { kind: 'style', property: 'rubySize', operation: 'set', value: 10 },
    ],
  );
  assert.deepEqual(
    parsed.runs.filter((r) => r.kind === 'wait'),
    [
      { kind: 'wait', unit: 'frames', value: 12 },
      { kind: 'wait', unit: 'characters', value: 2 },
    ],
  );
  assert.equal(parsed.runs.at(-1).kind, 'continue');
  assert.equal(cleanText('\\fssSmall\\fn\\nNormal'), 'Small\nNormal');
});

test('message source metadata and expanded original text survive later string changes', async () => {
  const p = await scene({
    main: [command('str 5 old'), text('Value:$str5\\fl!'), input, command('str 5 new')],
  });
  await p.tick();
  assert.equal(p.currentMessage.original, 'Value:old\\fl!');
  assert.equal(p.currentMessage.line, 1);
  assert.equal(p.currentMessage.endLine, 2);
  assert.ok(p.currentMessage.runs.some((r) => r.kind === 'style' && r.value === 'l'));
  p.advance();
  await p.tick();
  assert.equal(p.strings[5], 'new');
  assert.equal(cleanText(p.log[0].original), 'Value:old!');
});

test('sound commands preserve banks and control verbs instead of treating them as filenames', async () => {
  const requests = [];
  const p = await scene(
    {
      main: [
        command('bgm 0 pause'),
        command('bgm 0 replay'),
        command('bgm 0 end 120'),
        command('se 2 loop rain 10 20 30'),
        command('se [1-3] vol 20'),
        command('pcm voice_a'),
        command('pcm voice_b -30 5'),
        text('Together'),
        input,
      ],
    },
    {
      soundCommand: (request) => {
        requests.push(request);
        return {
          handled: true,
          banks: request.group === 'se' ? [{ bank: 2, file: 'rain', loop: true }] : [],
        };
      },
    },
  );
  await p.tick();
  assert.deepEqual(requests.slice(0, 5), [
    { group: 'bgm', banks: [0], verb: 'pause', args: [] },
    { group: 'bgm', banks: [0], verb: 'replay', args: [] },
    { group: 'bgm', banks: [0], verb: 'end', args: ['120'] },
    { group: 'se', banks: [2], verb: 'loop', args: ['rain', '10', '20', '30'] },
    { group: 'se', banks: [1, 2, 3], verb: 'vol', args: ['20'] },
  ]);
  assert.equal(requests[5].banks, null);
  assert.equal(requests[6].verb, 'play');
  assert.deepEqual(p.currentMessage.voices, ['voice_a', 'voice_b']);
  assert.equal(p.sounds[2].file, 'rain');
});

test('a sound host without an explicit successful acknowledgement cannot fabricate playback state', async () => {
  const p = await scene(
    { main: [command('pcm sample'), text('Silent'), input] },
    { soundCommand() {} },
  );
  await p.tick();
  assert.equal(p.voice, null);
  assert.equal(p.currentMessage.voice, null);
  assert.deepEqual(p.currentMessage.voices, []);
  assert.ok([...p.unsupported].some((s) => /pcm play.*no successful host acknowledgement/.test(s)));
});

test('parenthesized parameters stay together and literal string arguments retain hash characters', async () => {
  const p = await scene({
    main: [
      command('#1=6'),
      command('str 1 #literal'),
      command('strn 2 (#1 + 4)'),
      command('wait (#1 - 5)'),
      text('$str1:$str2'),
      input,
    ],
  });
  await p.tick();
  assert.equal(p.waiting.kind, 'frames');
  p.stage.frame++;
  await p.tick();
  assert.equal(p.currentMessage.text, '#literal:10');
});
