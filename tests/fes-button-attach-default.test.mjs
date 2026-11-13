// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { controlFiles } from './fixtures/control-files.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { navigateFESButton, setFESButtonAttachment } from '../src/native/fes-button-navigation.mjs';

const utf8 = (text) => new TextEncoder().encode(text),
  decode = (bytes) => new TextDecoder().decode(bytes),
  ref = (value) => (value === null ? null : [decode(value.nameBytes), value.index]),
  declarations = `#DEFINE
BUTTON a
BUTTON b
BUTTON c
BUTTON holders[3]
STRING other
SCROLL scroll
SCROLL2 scroll2
SLIDER slider
#KEYBLOCK 3
0 3,3 -1,-1,-1,-1
1 3,3 -1,-1,-1,-1
2 3,3 -1,-1,-1,-1
#OBJECT SIZE POS PRI DISP ENABLE KEYBLOCK
a 8,8 20,20 60000 1 1 0,1,1
b 8,8 60,20 60001 1 1 0,2,1
c 8,8 80,60 60002 1 1 -1,0,0
holders 8,8 10,60 60003 1 1 -1,0,0
#OBJECT SIZE
other 8,8
#OBJECT FILE TYPE DISP ENABLE
scroll scroll 0 1 1
#OBJECT FILE POS2 DISP ENABLE
scroll2 controls area:8 1 1
slider controls area:7 1 1
#START
next IDLE
#IDLE
`,
  sharedLabels = {
    SELECT: 'a setact',
    INIT: 'scroll page 0 4 1\nscroll pos 1\nscroll2 page 0 4 1\nscroll2 pos 1\nslider page 0 4\nslider pos 1',
  };
const files = await controlFiles(new Uint8Array());
delete files['engine.exe'];
async function open(profile, labels = {}, links = '-1,-1,-1,-1') {
  const source =
    declarations.replace('0 3,3 -1,-1,-1,-1', `0 3,3 ${links}`) +
    Object.entries({ ...sharedLabels, ...labels })
      .map(([name, lines]) => `#${name}\n${lines}\nbreak\n`)
      .join('');
  const world = await defaultFESWorld(profile, { ...files, 'screen.fes': utf8(source) });
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    h.world = world;
    h.input = h.task.input;
    h.get = (name, index = 0) => h.instance.collection.lookup(name, index);
    await notify(h, 'INIT');
    await h.task.syncObjects();
    return h;
  } catch (error) {
    await world.close();
    throw error;
  }
}
const notify = (h, label) => h.task.player.notify(label),
  select = async (h) => {
    await notify(h, 'SELECT');
    await h.instance.runtime.flushRecords();
  },
  key = (h, direction) => h.world.sendEngine(h.id, h.world.main.id, 9, 0, direction + 4),
  command = (h, verb, args, name = 'a', index = 0) =>
    h.instance.runtime.command(verb, { name, nameBytes: utf8(name), index }, args.map(utf8));
function trace(h) {
  const messages = [],
    dispatch = h.world.engineMessages.dispatch.bind(h.world.engineMessages);
  h.world.engineMessages.dispatch = (target, sender, message, w, l, context = {}) => {
    if ([138, 357, 371, 363].includes(message))
      messages.push({ target, sender, message, w, l, flags: context.flags });
    return dispatch(target, sender, message, w, l, context);
  };
  return messages;
}
async function declare(h, name, type = 'BUTTON', count = 1) {
  const bytes = new Uint8Array(36),
    view = new DataView(bytes.buffer);
  bytes.set(utf8(name));
  view.setUint32(32, count, true);
  await h.world.sendEngine(
    h.id,
    h.world.main.id,
    338,
    0,
    FES_OBJECT_DEFINITION_ORDER.indexOf(type),
    {
      payload: {
        string: (at) => decode(bytes.subarray(at, bytes.indexOf(0, at))),
        load: (at) => view.getUint32(at, true),
      },
    },
  );
  await h.instance.runtime.initializeResources();
}
async function fresh(h) {
  const snapshot = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false });
  const read = world.game.read.bind(world.game),
    reads = [];
  world.game.read = (name) => {
    reads.push(name);
    if (name !== 'case.kcs') throw new Error('attach restore replayed ' + name);
    return read(name);
  };
  try {
    await world.restore(snapshot);
    const task = world.objects.objects.get(h.id).implementation;
    return {
      world,
      task,
      input: task.input,
      id: h.id,
      instance: task.player.root,
      reads,
      get: (name, index = 0) => task.player.root.collection.lookup(name, index),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}
for (const profile of profiles) {
  test(`${profile}: BUTTON attach has constructor NULL, owned references, first-null-stop and first-wins redeclaration`, async () => {
    const h = await open(profile, {
      ATTACH: 'a attach lost[7]',
      GROUP: 'holders attach b',
      CLEAR: 'a attach',
      BAD: 'a attach b[',
      EVAL: 'a attach $str0',
      EMPTY_CLEAR: 'a attach $str2',
      EMPTY_REF: 'a attach EMPTYREF',
      BITMAP: 'a load scroll\nb load scroll',
    });
    try {
      for (const name of ['a', 'b', 'c', 'holders'])
        assert.equal(h.get(name).buttonAttachment, null);
      const a = h.get('a'),
        before = [a.x, a.y, a.parentHandle, h.input.bounds(a)];
      await notify(h, 'ATTACH');
      assert.deepEqual(ref(a.buttonAttachment), ['lost', 7]);
      assert.deepEqual([a.x, a.y, a.parentHandle, h.input.bounds(a)], before);
      await notify(h, 'GROUP');
      await h.instance.collection.remove(h.get('holders', 1));
      await command(h, 'attach', ['scroll'], 'holders', -1);
      assert.deepEqual(ref(h.get('holders').buttonAttachment), ['scroll', 0]);
      assert.deepEqual(ref(h.get('holders', 2).buttonAttachment), ['b', 0]);
      const target = Buffer.from('b[3]');
      await h.instance.runtime.command('attach', { nameBytes: utf8('a'), index: 0 }, [target]);
      target.fill(120);
      assert.equal(a.buttonAttachment.nameBytes.constructor, Uint8Array);
      assert.deepEqual(ref(a.buttonAttachment), ['b', 3]);
      await declare(h, 'a');
      assert.equal(h.get('a'), a);
      assert.deepEqual(ref(a.buttonAttachment), ['b', 3]);
      await notify(h, 'BAD');
      assert.equal(a.buttonAttachment, null);
      await notify(h, 'ATTACH');
      await notify(h, 'CLEAR');
      assert.equal(a.buttonAttachment, null);
      const bank = h.world.runtime.stringBank(h.world.objects.objects.get(h.world.main.id)),
        script = h.world.configuration.scriptReplacements,
        calls = [],
        apply = script.apply.bind(script);
      bank.setBytes(0, utf8('SIDE'));
      bank.setBytes(2, new Uint8Array());
      script.add(utf8('SIDE'), utf8('b[++$10]'));
      script.add(utf8('EMPTYREF'), utf8('$str2[7]'));
      script.apply = (bytes) => {
        calls.push(decode(bytes));
        return apply(bytes);
      };
      await notify(h, 'EVAL');
      assert.equal(h.instance.global(10), 1);
      assert.deepEqual(ref(a.buttonAttachment), ['b', 1]);
      assert.equal(calls.filter((v) => v === 'SIDE').length, 1);
      await notify(h, 'EMPTY_CLEAR');
      assert.equal(a.buttonAttachment, null);
      await notify(h, 'EMPTY_REF');
      assert.deepEqual(ref(a.buttonAttachment), ['', 7]);
      await assert.rejects(
        command(h, 'attach', ['b[???]']),
        /expected|unknown|invalid|unexpected/i,
      );
      assert.deepEqual(ref(a.buttonAttachment), ['', 7]);
      await assert.rejects(command(h, 'attach', ['b[' + '1'.repeat(511)]), /512-byte destination/);
      assert.deepEqual(ref(a.buttonAttachment), ['', 7]);
      await notify(h, 'BITMAP');
      await h.task.syncObjects();
      await command(h, 'copy', ['b', '0', '0', '1', '1']);
      await h.task.syncObjects();
      assert.notEqual(a.imageResource.bitmap, h.get('b').imageResource.bitmap);
      assert.deepEqual(ref(a.buttonAttachment), ['', 7], 'image copy never copies the BUTTON tail');
      await command(h, 'attach', ['b'], 'other');
      assert.equal(h.get('other').buttonAttachment, undefined);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: real direction caller bypasses attach for a button result and preserves horizontal query slots`, async () => {
    const h = await open(profile, {
      ATTACH: 'a attach slider',
      'a.PUSH_RIGHT': '$30=++$30',
      'b.PUSH_RIGHT': '$31=++$31',
      'b.FOCUS': '$32=++$32',
      'a.UNFOCUS': '$33=++$33',
      KEYPOINT: 'b keypos 1 2 3',
    });
    try {
      await select(h);
      await notify(h, 'ATTACH');
      await notify(h, 'KEYPOINT');
      const calls = trace(h),
        a = h.get('a'),
        b = h.get('b'),
        slider = h.get('slider');
      const before = h.input.input.regions.map((r) => [r.owner, r.active]);
      await key(h, 3);
      assert.deepEqual(ref(h.input.state.focus), ['b', 0]);
      assert.equal(h.instance.pushRight, b.handle);
      assert.deepEqual(
        [30, 31, 32, 33].map((i) => h.instance.value('$' + i)),
        [0, 0, 0, 0],
      );
      assert.equal(slider.value, 1);
      assert.deepEqual(
        calls.filter((c) => c.message === 138),
        [
          {
            target: h.world.engineMessages.closestTop(h.id).implementation.input,
            sender: h.id,
            message: 138,
            w: 1,
            l: (23 << 16) | 62,
            flags: 0,
          },
        ],
      );
      assert.deepEqual(
        h.input.input.regions.map((r) => [r.owner, r.active]),
        before,
      );
      // An existing disabled first cell masks a later enabled duplicate cell.
      await command(h, 'enable', ['0'], 'b');
      await command(h, 'keyblock', ['0', '2', '1'], 'c');
      await select(h);
      await key(h, 3);
      assert.equal(slider.value, 2);
      assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
      // For a horizontal search with y=1, the real cross queries use x=0/2,
      // y=1. They do not query (majorX, crossY), even on later columns.
      await command(h, 'keyblock', ['0', '2', '0'], 'c');
      await command(h, 'attach', [], 'a');
      assert.deepEqual(navigateFESButton(h.instance, h.input.state.focus, 3), {
        button: null,
        controlChanged: false,
      });
      // Vertical scans still visit the nearest lower cross cell before upper.
      await command(h, 'keyblock', ['0', '0', '0'], 'b');
      await command(h, 'enable', ['1'], 'b');
      await command(h, 'keyblock', ['0', '2', '0'], 'c');
      assert.equal(navigateFESButton(h.instance, h.input.state.focus, 0).button, b);
      assert.equal(a.buttonAttachment, null);
      await command(h, 'enable', ['0'], 'b');
      await command(h, 'enable', ['0'], 'c');
      await command(h, 'attach', ['lost[7]']);
      const end = calls.length;
      await key(h, 3);
      assert.equal(calls.length, end);
      assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: attach raw13/14/15 uses exact ±1/orientation/inclusive bounds and notify1 without focus or warp`, async () => {
    const h = await open(profile, {
      HIDE: 'b enable 0\nc enable 0',
      'scroll.SCRL_P': '$40=++$40',
      'scroll2.SCRL_P': '$41=++$41',
      'slider.SCRL_P': '$42=++$42',
    });
    try {
      await notify(h, 'HIDE');
      await select(h);
      const calls = trace(h);
      for (const [name, direction, message, output] of [
        ['scroll', 1, 357, 40],
        ['scroll2', 1, 371, 41],
        ['slider', 3, 363, 42],
      ]) {
        const object = h.get(name);
        await command(h, 'attach', [name]);
        await key(h, direction);
        assert.equal(object.value, 2, name);
        assert.deepEqual(ref(h.input.state.focus), ['a', 0]);
        assert.equal(h.instance.value('$' + output), 1);
        assert.ok(calls.some((c) => c.message === message && c.w === 1 && c.l === 2));
        const before = calls.length;
        await key(h, direction === 1 ? 3 : 1);
        assert.equal(object.value, 2);
        assert.equal(calls.length, before);
        await command(h, 'pos', ['3'], name);
        await h.task.syncObjects();
        await key(h, direction);
        assert.equal(object.value, name === 'slider' ? 4 : 3);
        const end = calls.length;
        await key(h, direction);
        assert.equal(calls.length, end);
        await key(h, direction - 1);
        assert.equal(object.value, name === 'slider' ? 3 : 2);
      }
      assert.equal(
        calls.some((c) => c.message === 138),
        false,
      );
      // Native SCROLL's current getter consumes pending even on wrong axis;
      // target enable is not a gate in this reader.
      await command(h, 'attach', ['scroll']);
      await command(h, 'pos', ['1'], 'scroll');
      assert.equal(h.get('scroll').valuePending, true);
      await key(h, 3);
      assert.equal(h.get('scroll').valuePending, false);
      await command(h, 'enable', ['0'], 'scroll');
      await key(h, 1);
      assert.equal(h.get('scroll').value, 2);
      await h.instance.runtime.definitions.row(['TYPE'], 'scroll', ['1']);
      await key(h, 1);
      assert.equal(h.get('scroll').value, 2);
      await key(h, 3);
      assert.equal(h.get('scroll').value, 3);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: cross-block nearest retains sentinel/tie/order, and fresh references have no replay and preserve the raw23 wrong-class gate`, async () => {
    const h = await open(profile, { HIDE: 'b enable 0', ATTACH: 'a attach lost[3]' }, '-1,-1,-1,1');
    let restored;
    try {
      await notify(h, 'HIDE');
      await notify(h, 'ATTACH');
      await select(h);
      await command(h, 'keyblock', ['1', '0', '0'], 'b');
      await command(h, 'enable', ['1'], 'b');
      await command(h, 'keyblock', ['1', '2', '2'], 'c');
      await command(h, 'pos', ['30', '20'], 'b');
      await command(h, 'pos', ['10', '20'], 'c');
      assert.equal(navigateFESButton(h.instance, h.input.state.focus, 3).button, h.get('b'));
      await command(h, 'pos', ['10020', '20'], 'b');
      await command(h, 'pos', ['10021', '20'], 'c');
      assert.deepEqual(navigateFESButton(h.instance, h.input.state.focus, 3), {
        button: null,
        controlChanged: false,
      });
      await command(h, 'pos', ['9990', '20'], 'b');
      assert.equal(navigateFESButton(h.instance, h.input.state.focus, 3).button, h.get('b'));
      restored = await fresh(h);
      assert.deepEqual(ref(restored.get('a').buttonAttachment), ['lost', 3]);
      assert.deepEqual(ref(restored.input.state.focus), ['a', 0]);
      assert.deepEqual(restored.reads, ['case.kcs']);
      assert.equal(
        navigateFESButton(restored.instance, restored.input.state.focus, 3).button,
        restored.get('b'),
      );
      await restored.instance.collection.remove(restored.get('b'));
      await declare(restored, 'b');
      assert.equal(restored.get('b').buttonAttachment, null);
      setFESButtonAttachment(restored.get('b'), { nameBytes: new Uint8Array(), index: 7 });
      assert.deepEqual(ref(restored.get('b').buttonAttachment), ['', 7]);
      await declare(restored, 'mixed', 'BUTTON', 2);
      await restored.instance.collection.remove(restored.get('mixed', 1));
      await declare(restored, 'mixed', 'PARTICLE', 2);
      const mixedParticle = restored.get('mixed', 1),
        mixedAttachment = mixedParticle.attachment,
        mixedAttachmentDirty = mixedParticle.attachmentDirty;
      assert.equal(await command(restored, 'attach', ['a'], 'mixed', -1), 0);
      assert.equal(mixedParticle.attachment, mixedAttachment);
      assert.equal(mixedParticle.attachmentDirty, mixedAttachmentDirty);
      assert.deepEqual(ref(restored.get('mixed').buttonAttachment), ['a', 0]);
      assert.equal(restored.get('mixed', 1).nativeType, 23);
      await declare(restored, 'particle', 'PARTICLE');
      const particle = restored.get('particle'),
        attachment = particle.attachment,
        attachmentDirty = particle.attachmentDirty;
      assert.equal(await command(restored, 'attach', ['a'], 'particle'), 0);
      assert.equal(particle.attachment, attachment);
      assert.equal(particle.attachmentDirty, attachmentDirty);
      const ids = restored.input.state.buttons.map(([, id]) => id);
      await restored.world.objects.release(restored.id);
      assert.equal(
        ids.some((id) => restored.world.objects.objects.has(id)),
        false,
      );
      assert.equal(restored.world.nativeEngine, undefined);
    } finally {
      await restored?.world.close();
      await h.world.close();
    }
  });
}
