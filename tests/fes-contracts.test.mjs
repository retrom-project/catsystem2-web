// SPDX-License-Identifier: MPL-2.0
// Independently authored public fixtures for the official FES language contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../src/fes/program.mjs';
import { evaluate, assign } from '../src/fes/expression.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { memoryGame, u32 } from './helpers.mjs';
import { Binary } from '../src/binary.mjs';
import { MotionManager } from '../src/motion/manager.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { tokenizeNativeFESSoundConfiguration } from '../src/native/fes-sound-config.mjs';
import { NativeSteam } from '../src/native/steam.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

test('FES wndmenu posts the actual window message after native token and expression evaluation', async () => {
  for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74']) {
    const events = [],
      p = await screen('#START\nwndmenu\nwndmenu (10 + 2)\nwndmenu -1\nnext WAIT\n#WAIT\n', {
        host: {
          soundConfigTokens: (line) => tokenizeNativeFESSoundConfiguration(line, profile),
          async postWindowMessage(message, instance) {
            events.push({ message, name: instance.name });
          },
        },
      });
    await p.step();
    assert.deepEqual(events, [
      { message: { message: 0x46c, wParam: 0, lParam: 12 }, name: 'screen' },
      { message: { message: 0x46c, wParam: 0, lParam: 0xffffffff }, name: 'screen' },
    ]);
    assert.deepEqual([...p.unsupportedCommands], []);
  }
});
test('FES rettitle posts the native application event and continues until the host delivers it', async () => {
  const messages = [],
    player = await screen('#START\nrettitle\n\\0=17\nnext WAIT\n#WAIT\n', {
      host: { postWindowMessage: (message) => messages.push(message) },
    });
  await player.step();
  assert.deepEqual(messages, [{ message: 0x468, wParam: 0, lParam: 0 }]);
  assert.equal(player.root.local(0), 17);
  assert.equal(player.root.label, 'WAIT');
});

test('FES Steam commands preserve the null-manager branch and optional provider calls', async () => {
  const source =
      '#START\nsteam_achievement\nsteam_achievement AUTHORED\nsteam_enablescreenshot\nsteam_enablescreenshot 0\nnext WAIT\n#WAIT\n',
    absent = await screen(source, { host: { steam: null } });
  await absent.step();
  assert.deepEqual([...absent.unsupportedCommands], []);
  const calls = [],
    present = await screen(source, {
      host: {
        steam: {
          async achievement(name) {
            calls.push(['achievement', new TextDecoder('shift_jis').decode(name)]);
          },
          async enableScreenshot(value) {
            calls.push(['screenshot', value]);
          },
        },
      },
    });
  await present.step();
  assert.deepEqual(calls, [
    ['achievement', 'AUTHORED'],
    ['screenshot', 1],
    ['screenshot', 0],
  ]);
});
test('FES achievement byte names keep CP932 tokens distinct from UTF8 replacement bytes', async () => {
  const calls = [],
    steam = new NativeSteam({
      achievements: new Map([
        ['猫', false],
        ['ASCII', false],
      ]),
      achievement: (name) => calls.push(name),
    }),
    player = await screen(
      '#START\nsteam_achievement 猫\nsteam_achievement ASCII\nsteam_achievement INJECTED\nnext WAIT\n#WAIT\n',
      {
        host: {
          steam,
          nativeFESArgumentBytes: (token) =>
            token === 'INJECTED' ? new TextEncoder().encode('猫') : encodeCP932(token),
        },
      },
    );
  await player.step();
  assert.deepEqual(calls, ['ASCII', '猫']);
  assert.equal(steam.achievementState(encodeCP932('猫')), 0);
  assert.equal(steam.achievementState(new TextEncoder().encode('猫')), 1);
  await steam.close();
});

test('FES Steam uses one initialized session, original argument tokens and the application broadcast flag', async () => {
  for (const available of [false, true])
    for (const authorMode of [0, 1]) {
      const calls = [],
        service = new NativeSteam({
          achievements: new Map([
            ['$str(0)', false],
            ['REMAPPED_TOKEN', false],
          ]),
          initialize: async () => {
            calls.push(['initialize']);
            return available;
          },
          achievement: async (name) => calls.push(['achievement', name]),
          resetAllStats: async (word) => calls.push(['reset', word]),
          enableScreenshot: async (word) => calls.push(['screenshot', word]),
          isBroadcasting: async () => {
            calls.push(['observe']);
            return true;
          },
        }),
        host = {
          steam: null,
          nativeScriptReplace: (text) => text.replaceAll('STRING_TOKEN', 'REMAPPED_TOKEN'),
          soundConfigTokens: (line) =>
            tokenizeNativeFESSoundConfiguration(line, 'nekopara-vol3-engine-2.6.1.76'),
          async initializeSteam() {
            await service.initialize();
            this.steam = service;
          },
          async nativeSteamBroadcast() {
            if (service.managerExists) {
              await service.observeBroadcastQuery();
              if (!authorMode) return 0;
            }
            return 7;
          },
        },
        player = await screen(
          `#START
steam_isenable 0
steam_isbroadcast 1
steam_achievement NOT_SENT
steam_init
steam_isenable (1 + 2)
steam_isbroadcast 4
steam_achievement "$str(0)"
steam_achievement $str0
steam_achievement_reset
steam_enablescreenshot (1 + 1)
steam_enablescreenshot
next WAIT
#WAIT
`,
          { host, strings: { 0: 'STRING_TOKEN' } },
        );
      await player.step();
      assert.equal(player.globals[0], 0);
      assert.equal(player.globals[1], 7);
      assert.equal(player.globals[3], Number(available));
      assert.equal(player.globals[4], authorMode ? 7 : 0);
      assert.deepEqual(
        calls,
        available
          ? [
              ['initialize'],
              ['observe'],
              ['achievement', '$str(0)'],
              ['achievement', 'REMAPPED_TOKEN'],
              ['reset', 1],
              ['screenshot', 2],
              ['screenshot', 1],
            ]
          : [['initialize']],
      );
      assert.deepEqual([...player.unsupportedCommands], []);
      await service.close();
    }
});

function game(files) {
  return memoryGame(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [
        name,
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      ]),
    ),
  );
}
async function screen(
  source,
  { host = {}, images = {}, globals = {}, strings = {}, files = {}, motionLibrary } = {},
) {
  const p = new FESPlayer(game({ 'screen.fes': source, ...files }), images, host, globals, strings);
  p.motionLibrary = motionLibrary;
  await p.start('screen');
  return p;
}

test('native FES locals share the registered bank context and checkpoint only its identity', async () => {
  let bank = new NativeVariableBank();
  bank.initialize(1024);
  const bind = (player, key) => {
    player.nativeVariableContext = (instance) => {
      instance.nativeVariableContextKey ??= key;
      bank.registerContext(instance.nativeVariableContextKey);
      bank.selectContext(instance.nativeVariableContextKey);
      return bank.context(instance.nativeVariableContextKey);
    };
  };
  const first = await screen('#START\n\\1=17\nnext WAIT\n#WAIT\n'),
    other = await screen('#START\nnext WAIT\n#WAIT\n');
  bind(first, 'FES A');
  bind(other, 'FES B');
  await first.step();
  other.root.setLocal(1, 29);
  assert.equal(first.root.local(1), 17);
  assert.equal(other.root.local(1), 29);
  bank.context('FES A').words[1] = 41;
  assert.equal(first.root.local(1), 41);
  first.root.setLocal(-1, 9);
  first.root.setLocal(512, 9);
  assert.equal(first.root.local(-1), 0);
  assert.equal(first.root.local(512), 0);
  const state = first.snapshot(),
    savedBank = bank.snapshot();
  assert.equal(state.root.nativeVariableContextKey, 'FES A');
  assert.equal(Object.hasOwn(state.root, 'locals'), false);
  bank = new NativeVariableBank();
  bank.restore(savedBank);
  const restored = await screen('#START\n\\1=17\nnext WAIT\n#WAIT\n');
  bind(restored, 'would create a different context');
  await restored.restore(state);
  assert.equal(restored.root.nativeVariableContextKey, 'FES A');
  assert.equal(restored.root.local(1), 41);
  assert.equal(bank.contexts.size, 2);
});

test('native FES sound commands retain object identity and wait on the asynchronous bank query', async () => {
  const p = await screen(`#DEFINE
SOUND tone
#OBJECT FILE CHANNEL STYPE BLEND ENABLE
tone sample 3 1 1 0
#START
tone crossfade 1 24
tone play 2 1 1
wait tone
$7=9
exit 0
`),
    calls = [],
    queries = [];
  let busy = true;
  p.nativeSound = {
    command(instance, object, verb, args) {
      calls.push({ instance, object, verb, args });
    },
    async busy(instance, object) {
      queries.push({ instance, object });
      return busy;
    },
  };
  const object = p.root.byKey.get('tone');
  assert.equal(object.soundBypassVolume, 1);
  assert.equal(object.alpha, 255);
  assert.equal(object.soundType, 1);
  assert.equal(object.channel, 3);
  assert.equal(object.enable, false);
  await p.step();
  assert.deepEqual(
    calls.map(({ verb, args }) => [verb, args]),
    [
      ['crossfade', ['1', '24']],
      ['play', ['2', '1', '1']],
    ],
  );
  assert.equal(calls[0].object, object);
  assert.equal(calls[0].instance, p.root);
  assert.equal(p.root.waitSound, 'tone');
  await p.step();
  assert.equal(p.globals[7], undefined);
  assert.equal(queries[0].object, object);
  busy = false;
  await p.step();
  assert.equal(p.globals[7], 9);
  assert.equal(p.root.finished, 0);
});

test('native notifications flush resources immediately and preserve the interrupted script and object index', async () => {
  const messages = [];
  const p = await screen(
    `#DEFINE
BUTTON button[2]
#START
call INNER
$9=1
exit 0
#INNER
wait 3
$8=1
#button.UPDATE
$1=@
send 7 @
@ setid 9
$2=@
#PULSE
$3=@
`,
    {
      host: {
        async send(values) {
          await Promise.resolve();
          messages.push(values);
        },
      },
    },
  );
  await p.step();
  const suspended = structuredClone(p.root.suspended),
    frame = p.frameCount;
  assert.equal(await p.notify('UPDATE', 'button', 1), true);
  assert.equal(p.frameCount, frame);
  assert.deepEqual(p.root.suspended, suspended);
  assert.deepEqual([p.globals[1], p.globals[2]], [1, 1]);
  assert.equal(p.root.byKey.get('button[1]').idIndex, 9);
  assert.deepEqual(messages, [[7, 1]]);
  assert.equal(p.root.eventObject, null);
  assert.equal(await p.notify('PULSE', null, 4), true);
  assert.equal(p.globals[3], 4);
  await p.step();
  await p.step();
  await p.step();
  assert.equal(p.globals[8], 1);
  assert.equal(p.globals[9], 1);
});

test('a notification next changes real control flow while input-only events do not invent handlers', async () => {
  const p = await screen(
    `#DEFINE
BUTTON button
#START
wait 20
exit 9
#CHANGE
send 1
next TARGET
#TARGET
$1=3
wait 2
exit 0
#button.PUSH_UP
exit 99
`,
    { host: { async send() {} } },
  );
  await p.step();
  assert.equal(await p.nativeEvent('button', 'PUSH_UP'), false);
  assert.equal(p.root.pushUp, p.root.byKey.get('button').handle);
  assert.equal(await p.notify('CHANGE'), true);
  assert.equal(p.root.label, 'TARGET');
  assert.equal(p.globals[1], 3);
  await p.step();
  await p.step();
  assert.equal(p.root.finished, 0);
});

test('native sound handler frame returns suspend the real interpreter and retain explicit object selection', async () => {
  const source = '#DEFINE\nSOUND tone\n#START\ntone[0] sndtag wait marker\n$2=7\nexit 0\n';
  const p = await screen(source),
    selections = [];
  p.nativeSound = {
    async command(instance, object, verb, args, context) {
      selections.push([object.key, verb, args, context.index]);
      return 3;
    },
  };
  await p.step();
  assert.deepEqual(selections, [['tone', 'sndtag', ['wait', 'marker'], 0]]);
  assert.equal(p.root.commandDelayUntil, 4);
  assert.equal(p.globals[2], undefined);
  const checkpoint = p.snapshot(),
    restored = await screen(source, { globals: p.globals });
  restored.nativeSound = p.nativeSound;
  await restored.restore(checkpoint);
  await restored.step();
  await restored.step();
  assert.equal(restored.globals[2], undefined);
  await restored.step();
  assert.equal(restored.globals[2], 7);
  assert.equal(restored.root.finished, 0);
  const all = await screen('#DEFINE\nSOUND tone[2]\n#START\ntone sndtag wait marker\nexit 0');
  all.nativeSound = {
    command(instance, object, verb, args, context) {
      assert.equal(context.index, -1);
      return 0;
    },
  };
  await all.step();
  assert.equal(all.root.finished, 0);
});

test('native dynamic declarations distinguish factory indexes and apply complete OBJECT rows across a checkpoint', async () => {
  const p = await screen('#START\n');
  p.root.createObjects(6, 'button', 2);
  p.root.createObjects(33, 'strings', 1);
  p.root.createObjects(35, 'model', 1);
  assert.equal(p.root.byKey.get('strings[0]').type, 'STRTABLE');
  assert.equal(p.root.byKey.get('strings[0]').nativeType, 34);
  assert.equal(p.root.byKey.get('model[0]').type, 'M2PLANE');
  assert.equal(p.root.applyObjects('#OBJECT POS SIZE ENABLE', 'button 10,20 30,40 1'), true);
  assert.equal(p.root.applyObjects('#OBJECT POS', 'button[1] 50,60'), true);
  assert.deepEqual(
    p.root.objects.filter((o) => o.type === 'BUTTON').map((o) => [o.x, o.y, o.width, o.height]),
    [
      [10, 20, 30, 40],
      [50, 60, 30, 40],
    ],
  );
  const saved = p.snapshot(),
    restored = await screen('#START\n');
  await restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.root.elements('button[1]')[0].x, 50);
  assert.equal(restored.root.applyObjects('#OBJECT POS', 'absent 1,2'), false);
  assert.throws(() => p.root.createObjects(999, 'bad', 1), /factory index/);
  await assert.rejects(
    screen('#DEFINE\nINVENTED object\n#START\n'),
    /Unknown FES object type INVENTED/,
  );
});

test('FES source expands includes and token macros, and strips both C comment forms', async () => {
  const p = await screen(
    `/* a comment
    #START
    exit 99
  */
#INCLUDE
  declarations.h // included before initialization
#MACRO
  NUMBER 3
  SLOT 12
  SHOW disp
#DEFINE
  BUTTON button[NUMBER]
#OBJECT SIZE DISP
  button 20,10 0
#START
  \\SLOT=NUMBER /* same-line comment */ + 4
  button SHOW 1 // a macro may replace a command token
  $1=\\12
  exit 0
`,
    { files: { 'declarations.h': '#DEFINE\nPLANE surface\n#OBJECT POS\nsurface 5,6\n' } },
  );
  await p.step();
  assert.equal(p.root.objects.length, 4);
  assert.equal(p.root.byKey.get('surface').x, 5);
  assert.equal(p.root.byKey.get('button[2]').disp, true);
  assert.equal(p.globals[1], 7);
  assert.equal(p.root.finished, 0);
});

test('FES include and macro cycles are reported instead of becoming runnable blocks', () => {
  assert.throws(
    () => parseProgram('#INCLUDE\na.h', { include: () => '#INCLUDE\na.h' }),
    /include cycle/,
  );
  assert.throws(() => parseProgram('#INCLUDE\nmissing.h'), /Unresolved FES include/);
  assert.throws(() => parseProgram('#MACRO\nA B\nB A\n#START\n$1=A'), /macro cycle/);
});

test('FES expression mutations, indirect references and short circuiting retain C behavior', () => {
  const globals = { 1: 4, 2: 10 },
    locals = {};
  const context = {
    global: (n) => globals[n] || 0,
    setGlobal: (n, v) => {
      globals[n] = v;
    },
    local: (n) => locals[n] || 0,
    setLocal: (n, v) => {
      locals[n] = v;
    },
    macro: (name) => (name === 'LOCAL' ? '2' : undefined),
  };
  assert.equal(evaluate('$1++ + ++$2', context), 15);
  assert.deepEqual(globals, { 1: 5, 2: 11 });
  assert.equal(evaluate('0 && ($1=99)', context), 0);
  assert.equal(evaluate('1 || ($2=99)', context), 1);
  assert.deepEqual(globals, { 1: 5, 2: 11 });
  assign('\\LOCAL = $(1+1) = 3', context);
  assign('$2 <<= 3', context);
  assign('$2 >>= 1', context);
  assert.equal(globals[2], 12);
  assert.equal(locals[2], 3);
  assert.throws(() => evaluate('$missing', context), /Invalid variable index/);
  assert.throws(() => evaluate('undeclared + 1', context), /identifier 'undeclared'/);
  assert.throws(() => assign('2=5', context), /Invalid assignment/);
});

test('FES current-value @ is parameter-specific and getpos2 includes parent coordinates', async () => {
  const p = await screen(`#DEFINE
PLANE parent
IMAGE child
#OBJECT POS SIZE DISP
parent 100,200,30 320,240 1
#OBJECT POS PARENT
child 10,20,3 parent
#START
child pos @+5 @-2 @+7
\\0=40
child getpos \\0 41 42
child getpos2 43 44 45
child size 70 80
child getsize 46 47
exit 0
`);
  await p.step();
  assert.deepEqual(
    [40, 41, 42, 43, 44, 45, 46, 47].map((i) => p.globals[i]),
    [15, 18, 10, 115, 218, 40, 70, 80],
  );
  assert.equal(Object.hasOwn(p.globals, 'NaN'), false);
});

test('FES wait zero yields a frame and per-instance frame clocks can be reset', async () => {
  const spawned = [];
  const p = await screen(
    `#START
reset_frame
$1=_FRAME_
wait 0
$2=_FRAME_
execfes child
next RUN
#RUN
`,
    {
      host: {
        startFES: (name, owner, parameters) => {
          spawned.push({ name, owner, parameters });
          return 31;
        },
      },
    },
  );
  await p.step();
  assert.equal(p.globals[1], 0);
  assert.equal(p.globals[2], undefined);
  await p.step();
  assert.equal(p.globals[2], 1);
  await p.flush();
  assert.equal(p.root.childTaskID, 31);
  assert.equal(p.instances.length, 1);
  assert.equal(spawned[0].name, 'child');
  assert.deepEqual(spawned[0].parameters, new Array(16).fill(0));
  await p.step();
  assert.equal(p.globals[3], undefined);
});

test('FES child tasks keep their identity until endfes and query the host exit code', async () => {
  const calls = [],
    exitCodes = new Map([
      [17, -1],
      [0, -1],
    ]),
    host = {
      startFES: (name, owner, parameters) => {
        calls.push(['fes', name, parameters]);
        return 17;
      },
      startKCS: (name) => {
        calls.push(['kcs', name]);
        return 0;
      },
      endFES: (id) => calls.push(['endfes', id]),
      endKCS: (id) => calls.push(['endkcs', id]),
      childExitCode: (id) => exitCodes.get(id),
    };
  const p = await screen('#START\nexecfes authored 10 -20\nnext WAIT\n#WAIT\n$1=_EXITCODE_\n', {
    host,
  });
  await p.step();
  assert.equal(p.root.childTaskID, 17);
  assert.equal(p.globals[1], -1);
  exitCodes.set(17, 42);
  await p.step();
  assert.equal(p.globals[1], 42);
  p.requestKCS('blocked', p.root);
  assert.equal(calls.length, 1);
  p.endFES(p.root);
  await p.flush();
  assert.equal(p.root.childTaskID, null);
  p.requestKCS('authored.kcs', p.root);
  await p.flush();
  assert.equal(p.root.kcsTaskID, 0);
  assert.equal(p.snapshot().root.kcsTaskID, 0);
  p.endKCS(p.root);
  await p.flush();
  assert.equal(p.root.kcsTaskID, null);
  assert.deepEqual(calls, [
    ['fes', 'authored', [10, -20, ...new Array(14).fill(0)]],
    ['endfes', 17],
    ['kcs', 'authored.kcs'],
    ['endkcs', 0],
  ]);
});

test('decode resolves queued image loads without advancing the FES frame', async () => {
  const picture = { frame: () => ({ width: 18, height: 27, offsetX: 9, offsetY: 13 }), frames: [] };
  const loaded = [];
  const p = await screen(
    `#DEFINE
IMAGE image
#START
reset_frame
image load $str1 8
decode
image pos2 $str1 8
image getpos 1 2
$3=_FRAME_
exit 0
`,
    {
      images: {
        load: async (name) => {
          loaded.push(name);
          return picture;
        },
      },
      strings: { 1: 'dynamic' },
    },
  );
  await p.step();
  assert.deepEqual(loaded, ['dynamic']);
  assert.deepEqual([p.globals[1], p.globals[2], p.globals[3]], [9, 13, 0]);
  assert.equal(p.frameCount, 1);
});

test('a named object wait ignores other motions and survives checkpoint restore', async () => {
  const source = `#DEFINE
IMAGE image[2]
#START
image[0] move 10 100 0
image[1] move 3 30 0
wait image[1]
$1=1
exit 0
`;
  const p = await screen(source);
  await p.step();
  const restored = await screen(source, { globals: p.globals });
  await restored.restore(p.snapshot());
  await restored.step();
  await restored.step();
  assert.equal(restored.globals[1], undefined);
  await restored.step();
  assert.equal(restored.globals[1], 1);
  assert.equal(restored.root.byKey.get('image[0]').motions.length, 1);
});

test('fade2 reaches the second alpha halfway and returns to its starting alpha', async () => {
  const p = await screen('#DEFINE\nIMAGE image\n#START\nimage fade2 4 20 220\nwait\nexit 0');
  const object = p.root.byKey.get('image');
  await p.step();
  assert.equal(object.alpha, 120);
  await p.step();
  assert.equal(object.alpha, 220);
  await p.step();
  await p.step();
  assert.equal(object.alpha, 20);
  assert.equal(object.motions.length, 0);
});

test('default event handlers run before the object handler and event @ selects its bank', async () => {
  const p = await screen(`#DEFINE
BUTTON button[2]
#OBJECT SIZE DISP DEFAULT
button 20,10 1 common
#START
next IDLE
#IDLE
#common.PUSH_L
$1=10
$2=@
@ setid 1
#button.PUSH_L
$1+=5
@ setid 2
`);
  p.root.event(p.root.byKey.get('button[1]'), 'PUSH_L');
  assert.equal(p.globals[1], 15);
  assert.equal(p.globals[2], 1);
  assert.equal(p.root.byKey.get('button[1]').idIndex, 2);
  assert.equal(p.root.byKey.get('button[0]').idIndex, 0);
});

test('event waits and unknown initialization columns/verbs have located diagnostics', async () => {
  const p = await screen(`#DEFINE
BUTTON button
#OBJECT MYSTERY
button 1
#START
next IDLE
#IDLE
#button.PUSH_L
wait 8
button setanm sample
button pathinfo 0 10 11
`);
  p.root.event(p.root.byKey.get('button'), 'PUSH_L');
  assert.equal(p.root.waitFrames, 0);
  assert.equal(p.globals[10], undefined);
  assert.ok([...p.unsupportedCommands].some((s) => /screen#button.PUSH_L:1:.*wait/.test(s)));
  assert.ok([...p.unsupportedCommands].some((s) => /#OBJECT column MYSTERY/.test(s)));
  assert.ok([...p.unsupportedCommands].some((s) => /button.setanm/.test(s)));
  assert.equal(p.hints.size, 0);
});

test('KEYBLOCK links, default buttons and keypos determine logical keyboard navigation', async () => {
  const p = await screen(`#DEFINE
BUTTON button[3]
#KEYBLOCK 2
0 1,2 -1,-1,-1,1
1 1,1 -1,-1,0,-1
#OBJECT SIZE POS DISP KEYBLOCK
button[0] 20,10 10,10 1 0,0,0
button[1] 20,10 10,40 1 0,0,1
button[2] 20,10 200,10 1 1,0,0
#START
button[1] noact
button[2] keypos 1 4 5
next IDLE
#IDLE
`);
  await p.step();
  p.moveFocus('right');
  assert.equal(p.focused.o.key, 'button[1]');
  p.moveFocus('up');
  assert.equal(p.focused.o.key, 'button[0]');
  p.moveFocus('right');
  assert.equal(p.focused.o.key, 'button[2]');
  assert.deepEqual(p.mouse, { x: 204, y: 15 });
  assert.equal(p.root.system('_PUSH_RIGHT_'), p.root.byKey.get('button[0]').handle);
  assert.equal(p.moveFocus('right'), false);
});

test('dispid accepts multiple IDs/ranges and deleting an object prevents future targeting', async () => {
  const p = await screen(`#DEFINE
SAVEPANEL panel
IMAGE image
#START
panel dispid 1 2 5 [10-12]
panel dispid 0 11
image delete
image disp 1
exit 0
`);
  await p.step();
  assert.deepEqual(p.root.byKey.get('panel').shownIDs, [2, 5, 10, 12]);
  assert.deepEqual(p.root.elements('image'), []);
  assert.ok([...p.unresolvedTargets].some((s) => /image disp 1/.test(s)));
});

test('randtbl produces a deterministic permutation rather than independently sampled values', async () => {
  const source = '#START\nrandtbl 100 104 -2 2\nexit 0\n';
  const first = await screen(source),
    second = await screen(source);
  await first.step();
  await second.step();
  const values = (p) => [100, 101, 102, 103, 104].map((i) => p.globals[i]);
  assert.deepEqual(
    values(first).toSorted((a, b) => a - b),
    [-2, -1, 0, 1, 2],
  );
  assert.deepEqual(values(first), values(second));
});

test('string tables, formatted values and save queries use only their declared output indices', async () => {
  const source = `#START
\\0=7
strvar \\0 value_%04d -7
setstbl 10 $str7
getstbl 10 11
\\1=11
strvar get 12 \\1
getweek 20 2024 2 29
saveexist 403 30 4
exit 0
`;
  const p = await screen(source, { host: { saveInfo: () => ({ version: 4 }) } });
  await p.step();
  assert.equal(p.strings[7], 'value_-007');
  assert.equal(p.strings[11], 'value_-007');
  assert.equal(p.strings[12], 'value_-007');
  assert.equal(p.globals[20], 4);
  assert.equal(p.globals[30], 1);
  assert.equal(p.globals[883], undefined);
  const state = p.snapshot();
  const restored = await screen(source);
  await restored.restore(state);
  assert.equal(restored.stringTable[10], 'value_-007');
});

function authoredMotionLibrary({ exit = true } = {}) {
  const profile = 'nekopara-vol3-engine-2.6.1.76';
  const shared = (offset) => [0x13, 0x80000000 + offset];
  const instructions = [
    [21, shared(MOTION_ABI.pos), shared(MOTION_ABI.registers)],
    ...(exit ? [[43, [3, 38], [3, 0]]] : []),
    [59],
  ];
  const body = new Uint8Array(
    instructions.flatMap(([opcode, ...args]) => [
      opcode,
      ...args.flatMap(([mode, value]) => [mode, ...u32(value)]),
    ]),
  );
  const script = {
    name: 'authored-position',
    body: new Binary(body),
    codeSize: body.length,
    data: new Uint8Array(16),
    stackSize: 1024,
  };
  return {
    load: async () => script,
    manager: (base, speed) =>
      new MotionManager({
        profile,
        base,
        speed,
        loadScript: async () => script,
      }),
  };
}

test('FES custom SUBCOMMAND runs its KCS with typed registers, without an extra logical frame', async () => {
  const p = await screen(
    `#DEFINE
IMAGE image
#OBJECT POS DISP
image 10,20 1
#SUBCOMMAND
oneshot custom authored-position PX[0] : [0]
#START
image custom 75
$1=_FRAME_
wait image
$2=1
exit 0`,
    { motionLibrary: authoredMotionLibrary() },
  );
  await p.step();
  assert.equal(p.root.byKey.get('image').x, 75);
  assert.equal(p.globals[1], 1);
  assert.equal(p.globals[2], undefined);
  assert.equal(p.root.byKey.get('image').motionTarget.manager.records.size, 0);
  await p.step();
  assert.equal(p.globals[2], 1);
  assert.equal(p.unsupportedCommands.size, 0);
});

test('object delay applies to the native MOT start delay and its named wait', async () => {
  const p = await screen(
    '#DEFINE\nIMAGE image\n#SUBCOMMAND\noneshot custom authored-position PX[0] : [0]\n#START\nimage delay 2\nimage custom 75\nwait image\n$1=1\nexit 0',
    { motionLibrary: authoredMotionLibrary() },
  );
  const image = p.root.byKey.get('image');
  await p.step();
  assert.equal(image.x, 0);
  assert.equal(image.motionBusy, true);
  await p.step();
  assert.equal(image.x, 0);
  await p.step();
  assert.equal(image.x, 75);
  assert.equal(p.globals[1], undefined);
  await p.step();
  assert.equal(p.globals[1], 1);
  assert.equal(p.root.finished, 0);
});

test('active FES KCS motion and a named object wait survive a checkpoint', async () => {
  const source = `#DEFINE
IMAGE image
#SUBCOMMAND
continue custom authored-position PX[0] : [0]
#START
image custom 88
wait image
$1=1
exit 0`;
  const library = authoredMotionLibrary({ exit: false }),
    p = await screen(source, { motionLibrary: library });
  await p.step();
  const restored = await screen(source, { motionLibrary: library });
  await restored.restore(p.snapshot());
  await restored.step();
  assert.equal(restored.root.byKey.get('image').x, 88);
  assert.equal(restored.globals[1], undefined);
  assert.equal(restored.root.byKey.get('image').motionBusy, true);
  restored.root.byKey.get('image').motionTarget.stop(restored.frameCount);
  await restored.step();
  assert.equal(restored.globals[1], 1);
});

test('keyskip distinguishes a single wait, continuous waits and forced-key-only input', async () => {
  for (const mode of ['on', 'cont', 'ctrl', 'off']) {
    const p = await screen(
      `#START\nkeyskip ${mode}\nwait 20\n$1++\nwait 20\n$2++\nkeyskip off\nwait 20\n$3++\nexit 0\n`,
    );
    await p.step();
    p.nativeEvent(null, 'PUSH_L');
    await p.step();
    assert.equal(p.globals[1], mode === 'on' || mode === 'cont' ? 1 : undefined);
    assert.equal(p.globals[2], mode === 'cont' ? 1 : undefined);
    assert.equal(p.globals[3], undefined);
    if (mode === 'ctrl') {
      p.root.skipControl = true;
      await p.step();
      assert.equal(p.globals[1], 1);
      assert.equal(p.globals[2], 1);
      assert.equal(p.globals[3], undefined);
    }
  }
});

test('FES debugging emits structured Unicode text and evaluated values without suppressing execution', async () => {
  const output = [],
    p = await screen(
      '#START\n\\0=17\ndbgstr first\\_line\ndbgstru8 日本語\ndebug \\0*2\nexit 0\n',
      { host: { fesDebug: (entry) => output.push(entry) } },
    );
  await p.step();
  assert.deepEqual(
    output.map(({ kind, value }) => [kind, value]),
    [
      ['dbgstr', 'first line'],
      ['dbgstru8', '日本語'],
      ['debug', 34],
    ],
  );
  assert.equal(
    output.every((v) => v.file === 'screen' && v.label === 'START' && v.line > 0),
    true,
  );
  assert.deepEqual([...p.unsupportedCommands], []);
  assert.equal(p.root.finished, 0);
});
