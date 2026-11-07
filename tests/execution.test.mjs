// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, encodeCP932 } from '../src/kcs.mjs';
import { evaluate, assign } from '../src/fes/expression.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { objectCommand, FESObject } from '../src/fes/object.mjs';
import { Stage, planeNumbers } from '../src/stage.mjs';
import { ScenePlayer } from '../src/scene.mjs';
import { AudioMixer } from '../src/audio.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { catScene, memoryGame, u32, translation } from './helpers.mjs';

test('changing language refreshes cached history and can return from translation to original text', () => {
  let language = 'cn';
  const currentMessage = {
    scene: 'scene',
    index: 0,
    text: 'Hello',
    speaker: 'Cat',
    original: '原文\\@',
    originalSpeaker: '猫',
  };
  const old = { ...currentMessage, index: 1, original: '前の文章', text: 'Previous' };
  const story = {
    currentMessage,
    log: [old, { ...currentMessage }],
    scripts: new Map([
      [
        'scene',
        {
          translation: {
            cn: [
              { text: '你好', speaker: '貓' },
              { text: '前文', speaker: '貓' },
            ],
          },
        },
      ],
    ]),
  };
  const player = { story, language: () => language, message() {} };
  CatSystem2.prototype.updateLanguage.call(player);
  assert.equal(currentMessage.text, '你好');
  assert.equal(old.text, '前文');
  language = 'jp';
  CatSystem2.prototype.updateLanguage.call(player);
  assert.equal(currentMessage.text, '原文');
  assert.equal(currentMessage.speaker, '猫');
  assert.equal(old.text, '前の文章');
});

test('missing voice remains silent with a diagnostic; corrupt audio still fails', async () => {
  let found = false;
  const mixer = new AudioMixer(
    { resolve: () => (found ? 'clip.ogg' : null), require: async () => new Uint8Array([1]) },
    {
      decodeAudioData: async () => {
        throw new Error('Corrupt audio');
      },
    },
  );
  await mixer.play({ channel: 'voice', file: 'missing', group: 'voice' });
  assert.equal(mixer.channels.size, 0);
  assert.deepEqual([...mixer.warnings], ['Missing audio missing']);
  found = true;
  await assert.rejects(mixer.play({ channel: 'voice', file: 'broken' }), /Corrupt audio/);
});

function machine(program, host) {
  const bytes = new Uint8Array(
    program.flatMap(([op, ...operands]) => [
      op,
      ...operands.flatMap((o) => [
        Array.isArray(o) ? o[0] : 3,
        ...u32(Array.isArray(o) ? o[1] : o),
      ]),
    ]),
  );
  return new KCSMachine(
    {
      body: new Binary(bytes),
      codeSize: bytes.length,
      data: new Uint8Array(1024),
      stackSize: 1024,
    },
    host,
  );
}
test('KCS signed arithmetic, stack operand order and assignment side effects', () => {
  const vm = machine([
    [21, [0x13, 0], 12],
    [60],
    [22, [0x13, 0]],
    [60],
    [37, 5],
    [37, 8],
    [2, [0x63, 0], [0x63, 0]],
    [59],
  ]);
  vm.run();
  assert.equal(vm.load(0), 13);
  assert.equal(vm.pop(), 3);
  const signed = machine([[4, -17, 3], [59]]);
  signed.run();
  assert.equal(signed.pop() | 0, -5);
});
test('KCS native arguments retain push order and bad stack/memory references fail', () => {
  const calls = [],
    vm = machine([[37, 10], [37, 20], [43, 7, 8], [59]], {
      native(id, args) {
        calls.push([id, args]);
        return args[0] * 10 + args[1];
      },
    });
  vm.run();
  assert.deepEqual(calls, [[7, [10, 20]]]);
  assert.equal(vm.pop(), 120);
  assert.throws(() => vm.load(0x7fffffff), /memory/);
  assert.throws(() => machine([[60], [59]]).run(), /underflow/);
});
test('KCS calls reserve arguments/return frame and restore the caller', () => {
  // call target=12; main body begins immediately after halt at byte 11.
  const vm = machine([[42, 12, 0], [59], [37, 42], [44, 4, 0]]);
  vm.run();
  assert.equal(vm.pop(), 42);
  assert.equal(vm.depth, 0);
  assert.equal(vm.fp, 0);
});
test('KCS CP932 memory strings preserve non-ASCII characters', () => {
  const vm = machine([[59]]);
  vm.writeString('名前', 100);
  assert.equal(vm.string(100), '名前');
  assert.deepEqual([...encodeCP932('ABC')], [65, 66, 67]);
});
function context() {
  const globals = {},
    locals = {};
  return {
    globals,
    locals,
    global: (n) => globals[n] || 0,
    setGlobal: (n, v) => {
      globals[n] = v;
    },
    local: (n) => locals[n] || 0,
    setLocal: (n, v) => {
      locals[n] = v;
    },
    macro: (n) => ({ WIDTH: '640', cycle: 'cycle' })[n],
    objectHandle: (name, index) => (name === 'button' ? 100 + index : null),
  };
}
test('FES expressions use C precedence, dynamic indices, macros and object handles', () => {
  const c = context();
  c.globals[5] = 7;
  c.locals[1] = 5;
  assert.equal(evaluate('2+3*4==14 && WIDTH>>6==10', c), 1);
  assert.equal(evaluate('$(\\1)+button[2]', c), 109);
  assert.equal(evaluate('0x80000000>>31', c), -1);
  assert.throws(() => evaluate('cycle', c), /recursion/);
  assert.throws(() => evaluate('window.alert(1)', c), /Unexpected/);
});
test('FES chained and compound assignments target global and local indices correctly', () => {
  const c = context();
  assign('$1 = \\2 = 4', c);
  assign('$1 += 3*2', c);
  assign('\\2++', c);
  assign('$(2+2) = $1==10', c);
  assert.equal(c.globals[1], 10);
  assert.equal(c.locals[2], 5);
  assert.equal(c.globals[4], 1);
});
test('FES blocks repeat by frame while a wait resumes within its call stack', async () => {
  const text =
    '#START\n$1=0\ncall INIT\n$1+=10\nnext WAIT\n#INIT\n$1+=1\nwait 2\n$1+=2\nbreak\n#WAIT\n$2++\n';
  const p = new FESPlayer(memoryGame({ 'flow.fes': new TextEncoder().encode(text) }), {});
  await p.start('flow');
  await p.step();
  assert.equal(p.globals[1], 1);
  await p.step();
  assert.equal(p.globals[1], 1);
  await p.step();
  assert.equal(p.globals[1], 13);
  await p.step();
  await p.step();
  assert.equal(p.globals[2], 3);
});
test('an absent FES subroutine returns to its caller and remains visible in diagnostics', async () => {
  const player = new FESPlayer(
    memoryGame({
      'flow.fes': new TextEncoder().encode('#START\ncall OPTIONAL\n$1=42\nnext WAIT\n#WAIT\n'),
    }),
    {},
  );
  await player.start('flow');
  await player.step();
  assert.equal(player.globals[1], 42);
  assert.deepEqual([...player.unresolvedTargets], ['flow: missing call OPTIONAL']);
});
test('FES log-name queries evaluate a variable holding the result variable index', async () => {
  const player = new FESPlayer(
    memoryGame({
      'flow.fes': new TextEncoder().encode(
        '#START\n\\0=1\n\\1=850\nsend 0xfffe0002 \\0 \\1\nnext WAIT\n#WAIT\n',
      ),
    }),
    {},
    { log: [{ nameID: 2 }, { nameID: 9 }] },
  );
  await player.start('flow');
  await player.step();
  assert.equal(player.globals[850], 9);
  assert.equal(Object.hasOwn(player.globals, 'NaN'), false);
});
test('FES next runs the destination in the same frame and preserves its wait after an event', async () => {
  const game = memoryGame({
    'screen.fes': new TextEncoder().encode(
      '#DEFINE\nBUTTON button\n#OBJECT SIZE DISP ENABLE\nbutton 40,20 1 1\n#START\nnext WAIT\n#WAIT\nif (_CLICK_L_==button) next SAVE\n#GO_WAIT\nnext WAIT\n#SAVE\n$1++\nwait 2\n$2++\nnext WAIT\n#button.FOCUS\nnext GO_WAIT\n',
    ),
  });
  const player = new FESPlayer(game, {});
  await player.start('screen');
  await player.step();
  player.click(10, 10);
  await player.step();
  assert.equal(player.globals[1], 1);
  assert.equal(player.globals[2], undefined);
  await player.step();
  assert.equal(player.globals[2], undefined);
  await player.step();
  assert.equal(player.globals[2], 1);
  player.root.event(player.root.byKey.get('button'), 'FOCUS');
  assert.equal(player.root.label, 'WAIT');
});
test('FES waits for mask transitions and named audio, including after a checkpoint', async () => {
  const transitions = [],
    sounds = [];
  let busy = true;
  const game = memoryGame({
    'flow.fes': new TextEncoder().encode(
      '#DEFINE\nSOUND clip\n#OBJECT FILE\nclip tone\n#START\nclip play 1\nrwipe 3 mask\nwait\n$1=1\nwait clip\n$2=1\nexit 0\n',
    ),
  });
  const host = {
    sound: (sound) => sounds.push(sound),
    soundBusy: () => busy,
    transition: (...args) => transitions.push(args),
  };
  const player = new FESPlayer(game, {}, host);
  await player.start('flow');
  for (let i = 0; i < 3; i++) await player.step();
  assert.equal(player.globals[1], undefined);
  await player.step();
  assert.equal(player.globals[1], 1);
  assert.equal(player.globals[2], undefined);
  assert.equal(sounds[0].file, 'tone');
  assert.deepEqual(transitions, [[3, 'rwipe', 'mask']]);
  const restored = new FESPlayer(game, {}, host, player.globals, player.strings);
  await restored.restore(player.snapshot());
  await restored.step();
  assert.equal(restored.globals[2], undefined);
  busy = false;
  await restored.step();
  assert.equal(restored.globals[2], 1);
  assert.equal(restored.root.finished, 0);
});
test('FES button events change control flow and suspended state survives checkpoint restore', async () => {
  const game = memoryGame({
    'screen.fes': new TextEncoder().encode(
      '#DEFINE\nBUTTON button\n#OBJECT SIZE DISP ENABLE\nbutton 40,20 1 1\n#START\nwait 3\nnext WAIT\n#WAIT\n#button.PUSH_L\n$8++\nnext DONE\n#DONE\n',
    ),
  });
  const p = new FESPlayer(game, {});
  await p.start('screen');
  await p.step();
  const saved = p.snapshot(),
    restored = new FESPlayer(game, {}, {}, p.globals, p.strings);
  await restored.restore(saved);
  restored.click(10, 10);
  assert.equal(restored.globals[8], 1);
  assert.equal(restored.root.label, 'DONE');
});
test('FES layout keeps font names as strings rather than interpreting them as expressions', () => {
  const o = new FESObject('STRING8', 'text', null, 1),
    s = {
      value: (value) => {
        if (value.includes('.')) throw new Error('filename evaluated');
        return Number(value);
      },
    };
  objectCommand(s, o, 'layout', ['fontind', '1', 'Example-Medium.ttf']);
  assert.equal(o.style.font, 'Example-Medium.ttf');
});
test('stage picture base coordinates, range clearing and relative motion are independent of screen size', () => {
  const stage = new Stage(640, 480, (text) => Number(text));
  stage.pictures('eg', ['2', 'image', '-320', '-240']);
  const picture = stage.planes[2].pictures[0];
  assert.equal(picture.x, 0);
  assert.equal(picture.y, 0);
  stage.planeCommand(['2', 'move', '10', '@+100', '@']);
  stage.frame = 5;
  assert.equal(stage.place(stage.planes[2]).x, 370);
  stage.planeCommand(['2', 'stop']);
  assert.equal(stage.place(stage.planes[2]).x, 420);
  assert.deepEqual(planeNumbers('[1,3-5]'), [1, 3, 4, 5]);
  stage.pictures('eg', ['[1-4]']);
  assert.equal(stage.planes[2].pictures.length, 0);
});
test('partial E-mote body updates retain explicit placeholders across copying and pose changes', () => {
  const stage = new Stage(640, 480, Number);
  stage.characterCommand(['1', 'm2body', '@,@,@,@,@,2']);
  assert.deepEqual([...stage.actors[1].body], ['@', '@', '@', '@', '@', '2']);
  stage.characterCommand(['1', 'm2body', '3,@,4']);
  assert.deepEqual([...stage.actors[1].body], ['3', '@', '4', '@', '@', '2']);
});
test('CatScene continuation messages keep their translation index through commands and click waits', async () => {
  const game = memoryGame({
    'a.cst': catScene([
      [0x21, '名前'],
      [0x20, '原文\\@'],
      [0x30, '#1=4'],
      [0x20, '\\n'],
      [2, ''],
      [0x20, '次の文'],
      [2, ''],
    ]),
    'a.cstl': translation(['en'], [{ en: ['Name', 'First'] }, { en: ['', 'Second'] }]),
  });
  const p = new ScenePlayer(game);
  await p.start('a');
  await p.tick();
  assert.equal(p.currentMessage.text, 'First');
  assert.equal(p.globals[1], 4);
  assert.equal(p.currentMessage.continues, true);
  assert.equal(p.waiting.kind, 'input');
  const state = p.snapshot();
  const restored = new ScenePlayer(game, {}, { ...p.globals });
  await restored.restore(state);
  restored.advance();
  await restored.tick();
  assert.equal(restored.currentMessage.text, 'Second');
  assert.equal(restored.currentMessage.index, 1);
});
test('CatScene call/return and conditional branches run actual child scripts', async () => {
  const game = memoryGame({
    'a.cst': catScene([
      [48, '#1=1'],
      [48, 'if (#1==1) call child'],
      [32, 'After'],
      [2, ''],
    ]),
    'child.cst': catScene([
      [32, 'Child'],
      [2, ''],
    ]),
  });
  const p = new ScenePlayer(game);
  await p.start('a');
  await p.tick();
  assert.equal(p.currentMessage.text, 'Child');
  assert.equal(p.stack.length, 2);
  p.advance();
  await p.tick();
  assert.equal(p.currentMessage.text, 'After');
  assert.equal(p.stack.length, 1);
});
test('reopening a scene view restores window visibility after a frame-off transition', async () => {
  const player = new ScenePlayer(memoryGame({}));
  await player.command('frameoff');
  assert.equal(player.windowVisible, false);
  await player.command('view 1');
  assert.equal(player.windowVisible, true);
  assert.equal(player.view, true);
});
