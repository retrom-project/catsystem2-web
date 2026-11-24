// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { controlFiles } from './fixtures/control-files.mjs';
import { nativeM2Files, nativeM2Program } from './fixtures/native-m2-fixture.mjs';
import { hg3, kcsProgram } from './helpers.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { nativeABIBehavior } from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { append } from './fixtures/fes-log-model.mjs';

const bytes = (value) => new TextEncoder().encode(value),
  pixel = Uint8Array.from([22, 33, 44, 255, 55, 66, 77, 255, 88, 99, 111, 255, 122, 133, 144, 255]);

test('2.6.1.23 authored Slider owns its low task, decoded skin, click and drag', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23';
  const source = [
    '#DEFINE',
    'PLANE pl',
    'SLIDER slider',
    '#OBJECT SIZE VRAM PRI DISP',
    'pl 128,96 0,0 400 1',
    '#OBJECT FILE PL POS2 PRI DISP ENABLE',
    'slider controls pl area:7 1000 1 1',
    '#START',
    'slider page 0 10',
    'slider pos 3',
    'next WAIT',
    '#WAIT',
    '#slider.SCRL_P',
    '\\5=\\5+1',
    '#slider.FOCUS',
    '\\6=\\6+1',
    '#slider.UNFOCUS',
    '\\6=0',
    '#MISSING',
    'slider load absent',
    'break',
    '#RELOAD',
    'slider load controls',
    'break',
  ].join('\n');
  const assets = await controlFiles(new Uint8Array(), source);
  delete assets['engine.exe'];
  const world = await defaultFESWorld(profile, assets);
  try {
    const { task, instance, draw, surface } = await loadDefaultFES(world);
    await task.tick();
    assert.equal(instance.label, 'WAIT');
    const { nativeTaskID: id } = instance.byKey.get('slider');
    const slider = world.objects.objects.get(id).implementation;
    const { track, thumb } = slider.resource.areas;
    const input = world.inputFor(id);
    assert.equal(slider.kind, 42);
    assert.deepEqual(slider.config.rect, Int32Array.of(16, 12, 88, 24));
    assert.deepEqual(input.get(track).bounds, [16, 12, 88, 24]);
    assert.deepEqual(input.get(thumb).bounds, [35, 12, 43, 20]);
    assert.deepEqual([slider.model.state.value, slider.model.state.pixel], [3, 19]);

    for (const kind of [40, 41])
      await assert.rejects(
        world.objects.create({ kind, parent: world.main.id }),
        /Unreviewed .*controlResources/,
      );
    for (const [raw, canonical] of [
      [5, 6],
      [8, 9],
      [9, 10],
      [60, 64],
      [328, 359],
      [329, 360],
      [330, 361],
      [331, 362],
      [332, 363],
      [333, 364],
      [334, 365],
    ]) {
      assert.equal(mapABIMessage(profile, 'control', 'raw', raw, 42), canonical);
      assert.equal(mapABIMessage(profile, 'control', 'canonical', canonical, 42), raw);
    }
    assert.equal(await world.sendEngine(id, world.main.id, 364), 0);
    await assert.rejects(world.sendEngine(id, world.main.id, 366), /Unreviewed ABI message/);

    const retained = () =>
      draw.state.renderer.items.find((item) => (item.key & 65535) === world.nativeTaskID(id));
    const normal = retained().image;
    const sendFocus = () => world.sendEngine(id, thumb, 64, world.nativeTaskID(thumb), 0x81234567);
    await sendFocus();
    await sendFocus();
    assert.equal(instance.local(6), 2);
    const hover = retained().image;
    assert.notEqual(hover, normal);
    assert.equal(await world.sendEngine(id, world.main.id, 361, 0, 0), NATIVE_UNWRITTEN_WORD);
    assert.equal(input.get(track).enabled, 0);
    assert.equal(retained().image, hover);
    await world.sendEngine(id, world.main.id, 361, 0, 1);
    assert.ok(input.get(track).enabled);
    assert.equal(retained().image, hover);
    const hoverPixels = await drawPixels(world, surface);
    const at = (12 * 128 + 35) * 4;
    assert.deepEqual([...hoverPixels.subarray(at, at + 4)], [70, 180, 60, 255]);

    input.pointer(74, 16, 1);
    await world.tick();
    input.key(0, true, 2, 1);
    await world.tick();
    assert.equal(slider.model.state.dragging, false);
    assert.equal(instance.local(5), 1);
    assert.deepEqual([slider.model.state.value, slider.model.state.pixel], [8, 51]);
    input.key(0, false, 2, 1);
    await world.tick();
    input.pointer(70, 16, 1);
    await world.tick();
    input.key(0, true, 2, 1);
    await world.tick();
    assert.equal(slider.model.state.dragging, true);
    assert.deepEqual(input.get(thumb).bounds, [0, 0, 0, 0]);
    assert.equal(world.graphics.images.get(retained().image).state.width, 8);
    input.pointer(87, 16, 1);
    await world.tick();
    assert.equal(slider.model.state.value, 10);
    assert.equal(instance.local(5), 2);
    input.key(0, false, 2, 1);
    await world.tick();
    assert.equal(slider.model.state.dragging, false);
    assert.deepEqual(input.get(thumb).bounds, [80, 12, 88, 20]);
    assert.equal(instance.local(5), 2);

    await task.player.notify('MISSING');
    await task.syncObjects();
    await world.tick();
    assert.equal(slider.model.state.loaded, false);
    assert.equal(retained(), undefined);
    assert.ok([track, thumb].every((id) => !input.get(id)));
    await task.player.notify('RELOAD');
    await task.syncObjects();
    assert.equal(slider.model.state.loaded, true);
    assert.ok(retained());
    assert.ok(!world.nativeEngine);
  } finally {
    await world.close();
  }
});

test('2.6.1.23 FES screen configuration queues the full mode DWORD for Window', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23';
  const source = [
    '#START',
    'setconf 1 screen',
    'setconf 0 screen',
    'setconf -1 screen',
    'setconf 2 screen',
    'setconf 4 messpd',
    'next WAIT',
    '#WAIT',
  ].join('\n');
  const world = await defaultFESWorld(profile, { 'screen.fes': bytes(source) });
  const posts = [];
  world.host.nativeWindowMessage = (message) => posts.push(message);
  try {
    const initialMode = world.configuration.screen.fullscreen;
    const { task } = await loadDefaultFES(world);
    await task.tick();
    assert.equal(nativeABIBehavior(profile, 'messages.screenEvent'), 18);
    assert.equal(world.fesConfiguration.get('messpd'), 4);
    assert.equal(world.configuration.screen.fullscreen, initialMode);
    await world.tick();
    assert.deepEqual(
      posts.map(({ message, wParam, lParam }) => [message, wParam, lParam]),
      [1, 0, 0xffffffff, 2].map((mode) => [0x467, 0, mode]),
    );
  } finally {
    await world.close();
  }
});

test('2.6.1.23 live FES objects take precedence over matching common heads', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23';
  const shadowed = [
    '#DEFINE',
    'BUTTON sysvoice[2]',
    'CIMAGE setconf',
    '#START',
    'sysvoice enable 0',
    'sysvoice[1] enable 1',
    'setconf disp 1',
    'sysvoice 12',
    'setconf 10 messpd',
    'next WAIT',
    '#WAIT',
  ].join('\n');
  const unshadowed = ['#START', 'sysvoice 12', 'setconf 9 messpd', 'next WAIT', '#WAIT'].join('\n');
  const world = await defaultFESWorld(profile, {
    'screen.fes': bytes(shadowed),
    'unshadowed.fes': bytes(unshadowed),
  });
  world.configuration.fields.sysplay.fill(0);
  world.configuration.fields.systemVoice[7 * 32] = 1;
  world.configuration.fields.sysplay[7] = 1;
  try {
    const startingSpeed = world.fesConfiguration.get('messpd');
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    assert.equal(instance.label, 'WAIT');
    assert.deepEqual(
      [0, 1].map((index) => instance.collection.lookup('sysvoice', index).enable),
      [false, true],
    );
    assert.ok(instance.collection.lookup('setconf', 0).disp);
    assert.equal(instance.global(12), 0);
    assert.equal(world.fesConfiguration.get('messpd'), startingSpeed);
    assert.equal(task.player.unsupportedCommands.size, 2);
    const common = await loadDefaultFES(world, 'unshadowed');
    await common.task.tick();
    assert.equal(common.instance.label, 'WAIT');
    assert.equal(common.instance.global(12), 7);
    assert.equal(world.fesConfiguration.get('messpd'), 9);
  } finally {
    await world.close();
  }
});

test('Game FES definition misses retain diagnostics without an unsupported command', async () => {
  const source = `#DEFINE
CIMAGE owned
UNKNOWN invalidType
#OBJECT SIZE
absent[0] 12,16
absent[1] 24,32
owned 8,10
#OBJECT UNKNOWN
owned 7
#START
next WAIT
#WAIT
#CHECK
owned unknown_verb
break
`;
  const world = await defaultFESWorld(profiles[1], { 'screen.fes': bytes(source) }),
    diagnostics = [];
  world.host.nativeDiagnostic = (entry) => diagnostics.push(entry);
  try {
    const { id, task, instance } = await loadDefaultFES(world);
    await task.tick();
    assert.equal(instance.label, 'WAIT');
    assert.deepEqual(diagnostics, [
      {
        type: 'fes-definition-target-missing',
        task: id,
        message: 'FES definition target absent[0] is missing',
      },
      {
        type: 'fes-definition-target-missing',
        task: id,
        message: 'FES definition target absent[1] is missing',
      },
    ]);
    assert.equal(instance.collection.count('absent'), 0);
    const owned = instance.byKey.get('owned');
    assert.deepEqual([owned.width, owned.height], [8, 10]);
    assert.deepEqual(
      [...task.player.unsupportedCommands].map((message) => message.split(': ').at(-1)),
      ['Unknown FES declaration type UNKNOWN', 'Unknown FES definition column UNKNOWN'],
    );
    await task.player.notify('CHECK');
    assert.match(
      [...task.player.unsupportedCommands].at(-1),
      /Unimplemented FES object command unknown_verb/,
    );
    assert.deepEqual([owned.width, owned.height], [8, 10]);
  } finally {
    await world.close({ flushFiles: false });
  }
});

for (const profile of profiles) {
  test(`${profile} default Script reload and close release their JS image owners without constructing a PE list`, async () => {
    const world = await defaultFESWorld(profile);
    try {
      const owner = world.main.id,
        child = await world.objects.create({ kind: 12, parent: owner }),
        implementation = world.objects.objects.get(child).implementation;
      await implementation.loadScript('case.kcs');
      const create = async (task) => {
        const handle = (await world.runtime.native('main', 0x2dd, [2, 2], task.machine, task))
          .value;
        return { handle, bitmap: world.imageOwners.get(handle).bitmap };
      };
      const first = await create(implementation.task);
      await implementation.loadScript('missing.kcs', { nativeLoad: true });
      for (const handle of Object.values(first))
        assert.equal(world.runtime.handles.records.has(handle), false);
      await implementation.loadScript('case.kcs');
      const second = await create(implementation.task);
      await world.objects.release(child);
      for (const handle of Object.values(second))
        assert.equal(world.runtime.handles.records.has(handle), false);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });

  test(`${profile} ordinary DIFIMAGE refex owns external pixels through release, deletion and fresh World restore`, async () => {
    const source =
        '#DEFINE\nDIFIMAGE face\n#OBJECT POS PRI DISP\nface 3,4 60000 1\n#START\nnext IDLE\n#IDLE\n#BIND\nface refex $0\nbreak\n#DROP\nface delete\nbreak\n',
      world = await defaultFESWorld(profile, {
        'screen.fes': bytes(source),
        'pixel.hg3': hg3(2, 2, pixel),
      });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const task = world.main,
        machine = task.machine;
      machine.writeString('pixel.hg3', 256);
      const handle = (await world.runtime.native('main', 0x2c6, [256], machine, task)).value,
        bitmap = world.imageOwners.get(handle).bitmap;
      assert.ok(handle);
      h.instance.setGlobal(0, handle);
      await h.task.player.notify('BIND');
      await h.task.syncObjects();
      const face = h.instance.byKey.get('face'),
        retained = face.imageResource.source,
        expected = new Uint8ClampedArray(128 * 96 * 4);
      for (let row = 0; row < 2; row++)
        expected.set(pixel.subarray((1 - row) * 8, (2 - row) * 8), ((4 + row) * 128 + 3) * 4);
      assert.deepEqual(await drawPixels(world, h.surface), expected);
      assert.equal(world.renderSources.get(retained).refs, 2);
      await world.runtime.native('main', 0x2c7, [handle], machine, task);
      assert.equal(world.runtime.handles.records.has(handle), false);
      assert.equal(world.runtime.handles.records.has(bitmap), false);
      assert.deepEqual(await drawPixels(world, h.surface), expected);
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      await fresh.restore(structuredClone(world.snapshot()));
      assert.deepEqual(await drawPixels(fresh, h.surface), expected);
      assert.equal(
        fresh.objects.objects.get(h.id).implementation.player.root.byKey.get('face').imageResource
          .source,
        retained,
      );
      await h.task.player.notify('DROP');
      assert.equal(h.instance.byKey.has('face'), false);
      assert.deepEqual(await drawPixels(world, h.surface), expected);
      await h.task.syncObjects();
      assert.deepEqual(await drawPixels(world, h.surface), new Uint8ClampedArray(expected.length));
      assert.equal(world.runtime.handles.records.has(retained), false);
      await fresh.objects.release(h.id);
      assert.deepEqual(await drawPixels(fresh, h.surface), new Uint8ClampedArray(expected.length));
      assert.equal(fresh.runtime.handles.records.has(retained), false);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} default LOG queues generated STRING resources and SAVEPANEL/image fonts avoid the EXE`, async () => {
    const file = new NativeGlobalFile(),
      flags = new Uint32Array(1024);
    flags[5] = 617;
    file.write(0x400, new Uint8Array(flags.buffer));
    file.write(0x200, Uint8Array.of(55, 0));
    file.write(0x100, hg3(2, 2, pixel));
    const stored = await file.file(),
      source =
        '#DEFINE\nSTRING label\nIMAGE atlas\nLOGSTRING history\nSAVEPANEL saved\n#OBJECT SIZE PRI DISP\nlabel 24,16 60000 1\n#OBJECT FILE IDN\natlas pixel -1\n#OBJECT COUNT POS2 SIZE2 PRI\nhistory 1 area:0 area:0 60001\n#OBJECT FILE PRI DISP\nsaved pixel 60002 1\n#START\nlabel userfontobj atlas[0]\nlabel layout size 4\nlabel str ABC\nlabel draw\nsaved ptype SIMAGE 0 0x100\nsaved setsave 7 0x400 0\nsaved dispid 1 0\nsaved getflag 5 6\nsaved getsavestr 2 0x200\nsaved getsavedate 10 11 12 13 14 15\nnext IDLE\n#IDLE\n#BIND\nhistory setlog $0\nhistory pos 0\nhistory layout size 4\nhistory layout shadow 0\nhistory disp 1\nbreak\n',
      world = await defaultFESWorld(
        profile,
        {
          'screen.fes': bytes(source),
          'pixel.hg3': hg3(2, 2, pixel),
          'area.hg3': hg3(24, 16, new Uint8Array(24 * 16 * 4)),
        },
        {
          storage: {
            read: async (name) => (name === 'save0007.dat' ? stored : null),
            stat: async () => ({ modifiedMs: Date.UTC(2025, 3, 18, 11, 23, 45) }),
            write: async () => true,
          },
        },
      );
    let fresh;
    try {
      world.runtime.services.localOffsetMinutes = () => 0;
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const history = h.instance.byKey.get('history'),
        generated = h.instance.collection.graph.get(history.slots[0].main);
      assert.equal(
        generated.nativeTaskID,
        undefined,
        'LOG factory uses the real pending FIFO before the next allocation pass',
      );
      assert.ok(
        h.instance.collection.pending.some((request) => request.name.text === generated.baseName),
      );
      const pending = structuredClone(world.snapshot());
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      await fresh.restore(pending);
      const pendingRoot = fresh.objects.objects.get(h.id).implementation.player.root;
      assert.equal(pendingRoot.byKey.get(generated.key).nativeTaskID, undefined);
      assert.deepEqual(pendingRoot.runtime.snapshot(), h.instance.runtime.snapshot());
      await fresh.close();
      fresh = null;
      const handle = world.displayLogs.create(h.id),
        log = world.displayLogs.get(handle);
      append(world.displayLogs, log, 'ABC');
      h.instance.setGlobal(0, handle);
      await h.task.player.notify('BIND');
      await h.task.syncObjects();
      for (let frame = 0; frame < 12; frame++) await world.tick();
      assert.equal(world.objects.objects.get(generated.nativeTaskID).kind, 48);
      const task = world.graphics.get(generated.nativeTaskID),
        writer = await task.writer();
      assert.ok(writer.frame().rgba.some((value, index) => index % 4 === 3 && value));
      assert.strictEqual(world.text.core.get(task.text.writer), writer);
      assert.equal(h.task.player.globals[6], 617);
      assert.deepEqual(
        [10, 11, 12, 13, 14, 15].map((i) => h.task.player.globals[i]),
        [2025, 4, 18, 11, 23, 45],
      );
      assert.equal(h.task.player.strings[2], '7');
      assert.ok(h.instance.byKey.get('atlas').imageEncodedPointer);
      assert.equal(h.instance.byKey.get('label').nativeTextState.fontDirty, false);
      const saved = structuredClone(world.snapshot()),
        expected = writer.frame(),
        pixels = await drawPixels(world, h.surface);
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      await fresh.restore(saved);
      const restored = await fresh.graphics.get(generated.nativeTaskID).writer();
      assert.deepEqual(restored.frame(), expected);
      assert.deepEqual(await drawPixels(fresh, h.surface), pixels);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await world.close();
      await fresh?.close();
    }
  });

  test(`${profile} ordinary FES image/plane/control input and fresh restore use only owned JS services`, async () => {
    const resources = await controlFiles(null),
      source =
        '#DEFINE\nCIMAGE solid\nIMAGE image\nBUTTON button\nPLANE plane\nSLIDER slider\n#OBJECT SIZE COLOR POS PRI DISP\nsolid 2,2 0xff112233 0,0 60000 1\n#OBJECT FILE POS PRI DISP\nimage pixel 4,0 60001 1\nbutton pixel 8,0 60002 1\n#OBJECT SIZE DISP\nplane 8,6 1\n#OBJECT FILE POS SIZE PRI TYPE DISP ENABLE\nslider controls 8,24 100,8 9002 0 1 1\n#START\nslider page 0 100 20\nslider pos 25\nbutton keypos 1 1 1\nnext IDLE\n#IDLE\n#MOVE\nimage pos 6 0\nbreak\n#REMOVE\nimage delete\nbreak\n';
    delete resources['engine.exe'];
    const shared = (at) => [0x13, (0x80000000 + at) >>> 0],
      world = await defaultFESWorld(profile, {
        ...resources,
        'screen.fes': bytes(source),
        'pixel.hg3': hg3(2, 2, pixel),
        'ppos.kcs': kcsProgram([
          [21, shared(24), shared(156)],
          [21, shared(28), shared(160)],
          [21, shared(32), shared(164)],
          [43, 38, 0],
          [59],
        ]),
      });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const image = h.instance.byKey.get('image'),
        button = h.instance.byKey.get('button'),
        slider = h.instance.byKey.get('slider');
      assert.equal(h.instance.runtime.resources.entries.length, 5);
      assert.equal(world.objects.objects.get(slider.nativeTaskID).kind, 42);
      assert.ok(world.inputFor(h.id).get(button.nativeInputTaskID));
      await h.task.input.warp(button);
      assert.deepEqual(h.task.player.mouse, { x: 9, y: 1 });
      const before = await drawPixels(world, h.surface);
      assert.deepEqual([...before.slice(0, 8)], [17, 34, 51, 255, 17, 34, 51, 255]);
      assert.deepEqual([...before.slice(4 * 4, 6 * 4)], [...pixel.slice(8)]);
      assert.deepEqual([...before.slice((128 + 4) * 4, (128 + 6) * 4)], [...pixel.slice(0, 8)]);
      await h.task.player.notify('MOVE');
      await h.task.syncObjects();
      const expected = await drawPixels(world, h.surface),
        saved = structuredClone(world.snapshot());
      assert.equal(image.x, 6);
      fresh = await defaultFESWorld(
        profile,
        { 'ppos.kcs': await world.game.read('ppos.kcs') },
        { initialize: false },
      );
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (!name.endsWith('.kcs'))
          throw new Error('fresh FES restore reloaded a resource: ' + name);
        return read(name);
      };
      await fresh.restore(saved);
      const restored = fresh.objects.objects.get(h.id).implementation;
      assert.deepEqual(restored.player.root.runtime.snapshot(), h.instance.runtime.snapshot());
      assert.deepEqual(await drawPixels(fresh, h.surface), expected);
      assert.equal(fresh.nativeEngine, undefined);
      await h.task.player.notify('REMOVE');
      assert.equal(h.instance.byKey.has('image'), false);
      assert.deepEqual(
        await drawPixels(world, h.surface),
        expected,
        'ordinary deletion retains output until resource cleanup',
      );
      await h.task.syncObjects();
      assert.equal(h.instance.runtime.resources.entries.length, 4);
      await world.objects.release(h.id);
      assert.equal(
        [...world.objects.objects.values()].some((r) => r.parent === h.id),
        false,
      );
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
      await fresh?.close();
    }
  });

  test(`${profile} default FES STRING, sound, PTCL/PPI and M2 children share one restore authority`, async () => {
    const source =
      '#MACRO\nEMPTY_TEXTURE $str0\n#DEFINE\nSTRING label\nNVSTRING nv\nSOUND sound\nPARTICLE script\nPARTICLE plugin\nM2PLANE model\nSTRTABLE words\n#OBJECT SIZE PRI DISP\nlabel 24,16 60000 1\nnv 24,16 60001 1\n#OBJECT FILE\nmodel ' +
      nativeM2Program +
      '\nwords words.cnf\n#START\nlabel layout size 4\nlabel layout shadow 0\nlabel str ABC\nlabel draw\nnv insert\nnv apend DEF\nnv draw\nscript init 0 probe EMPTY_TEXTURE 1 12\nscript start\nplugin init 1 rain EMPTY_TEXTURE 1 13\nplugin param 4 8\nplugin start\nnext IDLE\n#IDLE\n';
    const world = await defaultFESWorld(profile, {
      ...nativeM2Files(),
      'screen.fes': bytes(source),
      'words.cnf': bytes('0\tA\tB\n'),
      'ptcl/probe.kcs': kcsProgram([[59]]),
      'ptclpi/rain.ppi': bytes('authored diagnostic identity'),
    });
    let fresh;
    try {
      const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id)),
        originalTexture = bank.getBytes(0);
      bank.setBytes(0, bytes('$str0'));
      const h = await loadDefaultFES(world);
      if (originalTexture === undefined) bank.entries.delete(0);
      else bank.setBytes(0, originalTexture);
      await h.task.tick();
      const initializedScript = h.instance.byKey.get('script'),
        initializedPlugin = h.instance.byKey.get('plugin');
      assert.deepEqual(
        [
          initializedScript.family,
          initializedScript.program,
          initializedScript.texture,
          initializedScript.count,
          initializedScript.priority,
        ],
        [0, 'probe', '', 1, 12],
      );
      assert.deepEqual(
        [
          initializedPlugin.family,
          initializedPlugin.program,
          initializedPlugin.texture,
          initializedPlugin.count,
          initializedPlugin.priority,
        ],
        [1, 'rain', '', 1, 13],
      );
      for (let frame = 0; frame < 12; frame++) await world.tick();
      const label = h.instance.byKey.get('label'),
        nv = h.instance.byKey.get('nv'),
        script = h.instance.byKey.get('script'),
        plugin = h.instance.byKey.get('plugin'),
        model = h.instance.byKey.get('model');
      const writer = await world.graphics.get(label.nativeTaskID).writer();
      assert.strictEqual(
        world.text.core.get(world.graphics.get(label.nativeTaskID).text.writer),
        writer,
      );
      assert.ok(writer.frame().rgba.some((value, index) => index % 4 === 3 && value));
      assert.equal(world.objects.objects.get(nv.nativeTaskID).kind, 49);
      assert.equal(world.particles.tasks.get(script.particleResource.taskID).bank.family, 'script');
      assert.equal(world.particles.tasks.get(plugin.particleResource.taskID).bank.family, 'plugin');
      assert.equal(world.objects.objects.get(model.nativeTaskID).kind, 54);
      assert.deepEqual(
        h.instance.byKey
          .get('words')
          .nativeDataState.rows.map(([id, row]) => [
            id,
            row.map((cell) => new TextDecoder().decode(cell)),
          ]),
        [[0, ['A', 'B']]],
      );
      const saved = structuredClone(world.snapshot()),
        expected = writer.frame();
      const m2Files = nativeM2Files();
      fresh = await defaultFESWorld(
        profile,
        { ...m2Files, 'ptcl/probe.kcs': kcsProgram([[59]]) },
        { initialize: false },
      );
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (!name.endsWith('.kcs') && !Object.hasOwn(m2Files, name))
          throw new Error('fresh FES restore replayed a source or resource: ' + name);
        return read(name);
      };
      await fresh.restore(saved);
      const root = fresh.objects.objects.get(h.id).implementation.player.root,
        restored = await fresh.graphics.get(root.byKey.get('label').nativeTaskID).writer();
      assert.deepEqual(restored.frame(), expected);
      assert.deepEqual(root.runtime.snapshot(), h.instance.runtime.snapshot());
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
      await world.objects.release(h.id);
      assert.equal(
        [...world.objects.objects.values()].some((r) => r.parent === h.id),
        false,
      );
    } finally {
      await world.close();
      await fresh?.close();
    }
  });
}
