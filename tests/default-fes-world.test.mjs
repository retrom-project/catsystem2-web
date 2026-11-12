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
import { append } from './fixtures/fes-log-model.mjs';

const bytes = (value) => new TextEncoder().encode(value),
  pixel = Uint8Array.from([22, 33, 44, 255, 55, 66, 77, 255, 88, 99, 111, 255, 122, 133, 144, 255]);
for (const profile of profiles) {
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
      '#DEFINE\nSTRING label\nNVSTRING nv\nSOUND sound\nPARTICLE script\nPARTICLE plugin\nM2PLANE model\nSTRTABLE words\n#OBJECT SIZE PRI DISP\nlabel 24,16 60000 1\nnv 24,16 60001 1\n#OBJECT FILE\nmodel ' +
      nativeM2Program +
      '\nwords words.cnf\n#START\nlabel layout size 4\nlabel layout shadow 0\nlabel str ABC\nlabel draw\nnv insert\nnv apend DEF\nnv draw\nscript init 0 probe $str0 1 12\nscript start\nplugin init 1 rain $str0 1 13\nplugin param 4 8\nplugin start\nnext IDLE\n#IDLE\n';
    const world = await defaultFESWorld(profile, {
      ...nativeM2Files(),
      'screen.fes': bytes(source),
      'words.cnf': bytes('0\tA\tB\n'),
      'ptcl/probe.kcs': kcsProgram([[59]]),
      'ptclpi/rain.ppi': bytes('authored diagnostic identity'),
    });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
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
