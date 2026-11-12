// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures/fes-command-fixture.mjs';
import {
  FESImageControlCommands,
  FES_IMAGE_CONTROL_COMMANDS,
  FES_IMAGE_CONTROL_TYPE_GATES,
} from '../src/native/fes-image-control-commands.mjs';
import { FESImages } from '../src/native/fes-image-driver.mjs';
import {
  profiles,
  verifyPlainFilter,
  verifyKeyPosition,
  verifyPanelQueries,
  verifyDifFilter,
} from './fixtures/fes-command-world.mjs';

for (const profile of profiles) {
  test(`${profile} ordinary IMAGE filter preserves exact original pixels after reload`, () =>
    verifyPlainFilter(profile, FESImages));
  test(`${profile} typed keypos reaches actual Input pointer without a second keyPosition authority`, () =>
    verifyKeyPosition(profile, FESImages));
  test(`${profile} PANEL whole commands load actual CSS bytes/private flags/date and render original thumbnail`, () =>
    verifyPanelQueries(profile));
  test(`${profile} DIF whole refex/filter reaches held owner pixels and survives external owner release`, () =>
    verifyDifFilter(profile));
}

test('selectors evaluate once, retain holes and dispatch mixed IMAGE/SNDTABLE classes in canonical collection', async () => {
  const f = fixture(),
    objects = f.create(2);
  await f.collection.remove(objects[1]);
  f.create(10);
  await f.command('setid', ['(#0)++']);
  assert.equal(f.bank.get(0), 1);
  assert.deepEqual(f.evaluations, ['(#0)++']);
  assert.deepEqual(
    f.instance.objects.map((o) => o.nativeType),
    [2, 2, 10],
  );
  assert.deepEqual(f.sound, [['set', 'items[1]', 0]]);
  await f.command('setid', ['9']);
  await f.command('getid', ['3'], 1);
  assert.equal(f.bank.get(3), 9);
  assert.equal(f.collection.lookup('items', 2).idIndex, 9);
  await f.collection.remove(f.collection.lookup('items', 1));
  await f.command('setid', ['4']);
  assert.equal(f.collection.lookup('items', 0).idIndex, 4);
  assert.equal(f.collection.lookup('items', 2).idIndex, 9);
});

test('settbl mixes IMAGE and both control skins while preserving first-count holes and ranges', async () => {
  const f = fixture(),
    objects = f.create(2);
  await f.collection.remove(objects[1]);
  f.create(14);
  await f.command('settbl', ['(#0)++', '(#1)++']);
  assert.deepEqual(f.evaluations, ['(#0)++', '(#1)++']);
  assert.equal(f.bank.get(0), 1);
  assert.equal(f.bank.get(1), 1);
  assert.equal(objects[0].usesIDTable, true);
  assert.equal(objects[2].usesIDTable, true);
  const control = f.collection.lookup('items', 1);
  assert.equal(control.tablePending, true);
  assert.deepEqual(control.skinTable, [0, 0, 2, 3]);
  await f.command('settbl', [-1, 77]);
  assert.equal(control.skinTable[-1], undefined);
  assert.equal(objects[0].ids[-1], undefined);
});

test('table selectors reject getid/setid widening and preserve original unsupported getid ABI data boundary', async () => {
  const f = fixture(),
    objects = f.create(16);
  await f.command('setid', [7]);
  assert.ok(objects.every((o) => o.idIndex === 0));
  await f.command('getid', ['(#0)++']);
  assert.equal(f.bank.get(0), 0);
  await assert.rejects(f.command('getid', [1], 0), /group\/name ABI address/);
  await f.command('getid', [1], 0, { referenceAddress: 0xabcdef01 });
  assert.equal(f.bank.get(1), 0xabcdef01);
});

test('page evaluates all three arguments once, skips missing indices, and reaches LOG alongside controls', async () => {
  const f = fixture(),
    objects = f.create(13);
  await f.collection.remove(objects[1]);
  await f.collection.remove(objects[2]);
  f.create(24);
  const log = f.collection.lookup('items', 1);
  log.logModel = {
    async page(delta) {
      this.delta = delta;
    },
  };
  const last = f.collection.lookup('items', 2);
  last.logModel = {
    async page(delta) {
      this.delta = delta;
    },
  };
  await f.command('page', ['(#0)++', '100', '20']);
  assert.equal(f.bank.get(0), 1);
  assert.equal(objects[0].pagePending, true);
  assert.equal(log.logModel.delta, 0);
  await f.collection.remove(log);
  await f.command('page', [2, 40, 10]);
  assert.equal(last.logModel.delta, 2);
});

test('reference parses once and POS2 first-colon setter ignores its evaluated later selector', async () => {
  const f = fixture(),
    objects = f.create(2),
    seen = [];
  f.commands.reference = (token) => {
    seen.push(token);
    return { name: 'other', index: -1, nameBytes: Uint8Array.of(111) };
  };
  await f.command('ref', ['other']);
  assert.deepEqual(seen, ['other']);
  assert.equal(objects[0].referenceRequest.index, -1);
  assert.notEqual(objects[0].referenceRequest, objects[1].referenceRequest);
  await f.collection.remove(objects[1]);
  await f.command('ref', ['other']);
  assert.equal(seen.length, 2);
  assert.equal(objects[2].referenceRequest.name, 'other');
  await f.command('pos2', ['region:7', '(#0)++']);
  assert.equal(f.bank.get(0), 1);
  assert.equal(objects[2].positionReference.name, 'region');
  assert.equal(objects[2].positionReference.index, 7);
  assert.equal(objects[2].dirty, true);
});

test('color is one packed ARGB argument, ignores holes and schedules actual pColor shape per admitted class', async () => {
  const f = fixture(),
    objects = f.create(2);
  await f.collection.remove(objects[1]);
  f.create(24);
  await f.command('color', ['287454020']);
  assert.deepEqual(f.evaluations, ['287454020']);
  assert.equal(f.specs.length, 3);
  assert.deepEqual(
    f.specs.map((s) => s.registers),
    [
      [17, 34, 51, 68],
      [17, 34, 51, 68],
      [17, 34, 51, 68],
    ],
  );
  assert.ok(objects.filter((o) => !o.deleted).every((o) => o.color === 0x11223344 && o.sizeDirty));
});

test('tone/blur/coordinate mode retain their own stop policy and do not widen dirty propagation', async () => {
  const f = fixture(),
    objects = f.create(2);
  await f.collection.remove(objects[1]);
  await f.command('tone', ['80', '70', '60']);
  assert.deepEqual(objects[0].toneRGB, [80, 70, 60]);
  assert.deepEqual(objects[2].toneRGB, [100, 100, 100]);
  assert.equal(objects[0].imageChanged, true);
  objects[0].dirty = false;
  await f.command('coordmode', [2]);
  assert.equal(objects[0].coordinateMode, 2);
  assert.equal(objects[0].dirty, false);
  await f.command('blur', [3]);
  assert.deepEqual([objects[0].blurX, objects[0].blurY], [3, 1]);
  assert.deepEqual([objects[2].blurX, objects[2].blurY], [1, 1]);
});

test('ANM preserves exact2/6 gate, case-insensitive STOP, missing extension and one string expansion', async () => {
  const f = fixture(),
    objects = f.create(2),
    seen = [];
  f.commands.expandString = (value) => {
    seen.push(value);
    return value;
  };
  await f.command('setanm', ['folder/image']);
  assert.deepEqual(seen, ['folder/image']);
  assert.ok(objects.every((o) => o.anmFile === 'folder/image.anm'));
  await f.command('anm', ['sToP']);
  assert.ok(objects.every((o) => o.anmEnabled === false && o.anmPending));
  await f.collection.remove(objects[1]);
  f.create(22);
  const excluded = f.collection.lookup('items', 1);
  await f.command('anm');
  assert.equal(excluded.anmEnabled, false);
  assert.equal(objects[2].anmEnabled, true);
  await f.command('setanm');
  assert.equal(objects[0].anmFile, '.anm');
});

test('button drag and keyblock gates differ around a hole; keypos keeps original accumulating automatic formula', async () => {
  const f = fixture(),
    objects = f.create(6);
  await f.collection.remove(objects[1]);
  await f.command('drag', [7]);
  assert.equal(objects[0].fullInput, 7);
  assert.equal(objects[2].fullInput, false);
  await f.command('keyblock', [2, 3, 4]);
  assert.deepEqual(objects[2].keyblock, { block: 2, x: 3, y: 4 });
  Object.assign(objects[0], { width: 40, height: 12, auxiliaryWidth: 10, auxiliaryHeight: 20 });
  await f.command('keypos');
  assert.deepEqual([objects[0].auxiliaryWidth, objects[0].auxiliaryHeight], [34, 26]);
  await f.command('keypos');
  assert.deepEqual([objects[0].auxiliaryWidth, objects[0].auxiliaryHeight], [58, 32]);
  await f.command('keypos', [1, -3, 8]);
  assert.deepEqual(
    [objects[0].auxiliarySizeMode, objects[0].auxiliaryWidth, objects[0].auxiliaryHeight],
    [1, -3, 8],
  );
});

test('mode, bmode, locator and mag preserve exact class gates and pending/dirty differences', async () => {
  const f = fixture(),
    images = f.create(2);
  await f.command('mode', [3]);
  assert.ok(images.every((o) => o.pathMode === 3 && !o.dirty));
  const g = fixture(),
    planes = g.create(4);
  await g.command('locator', ['plane.loc']);
  assert.ok(planes.every((o) => o.resourcePending && !o.dirty));
  await g.command('bmode', [2]);
  assert.ok(planes.every((o) => o.blendMode === 2 && o.dirty));
  const t = fixture(),
    texts = t.create(21);
  texts.forEach((o) => {
    o.dirty = false;
  });
  await t.command('mag', [10]);
  assert.ok(texts.every((o) => !o.dirty));
  await t.command('mag', [4]);
  assert.ok(texts.every((o) => o.nativeTextState.speed === 4 && o.dirty));
});

test('refex distinguishes real bitmap wrapper and DIF owner services, refcap keeps uint32 range', async () => {
  const f = fixture(),
    objects = f.create(2);
  await f.collection.remove(objects[1]);
  f.create(25);
  await f.command('refex', ['(#0)++']);
  assert.equal(f.bank.get(0), 1);
  assert.deepEqual(f.instances, [
    ['bitmap', 'items[0]', 0],
    ['owner', 'items[1]', 0],
    ['bitmap', 'items[2]', 0],
  ]);
  await f.command('refcap', [-1]);
  assert.deepEqual(f.collection.lookup('items', 1).difImage.captureRequest, {
    minimum: 0xffffffff,
    maximum: 45000,
  });
  await f.command('filter', ['SePiA']);
  assert.equal(f.collection.lookup('items', 1).difImage.filterPending, true);
  assert.equal(objects[0].filterPending, true);
});

test('max follows per-table evaluation and exact selector counts; getfile shares outputs across mixed group', async () => {
  const f = fixture(),
    objects = f.create(18);
  objects[0].table = {
    max(selectors) {
      assert.deepEqual(selectors, [2, 5, 7]);
      return 13;
    },
  };
  await f.command('max', [3, 2, 5, 7], 0);
  assert.equal(f.bank.get(3), 13);
  const before = f.writes.length;
  await f.command('max', [4, 9, 5, 7], 0);
  assert.equal(f.writes.length, before);
  const g = fixture(),
    images = g.create(2);
  images[0].file = 'one.hg3';
  images[2].file = 'last.hg3';
  await g.collection.remove(images[1]);
  g.create(19);
  g.collection.lookup('items', 1).table = { select: () => null };
  await g.command('getfile', [1, 5]);
  assert.equal(new TextDecoder().decode(g.strings.get(1)), 'last.hg3');
  await g.collection.remove(images[2]);
  await g.command('getfile', [1, 5]);
  assert.equal(
    g.strings.get(1).length,
    0,
    'null table pointer becomes native empty-string assignment',
  );
});

test('selection loop bounds retain evaluation position and unknown/services errors stay explicit', async () => {
  const f = fixture();
  f.create(2);
  const order = [],
    count = f.collection.count.bind(f.collection),
    value = f.instance.value;
  f.collection.count = (name) => {
    order.push('count');
    return count(name);
  };
  f.instance.value = (token) => {
    order.push('value');
    return value(token);
  };
  await f.command('setid', ['1']);
  assert.deepEqual(order, ['value', 'count']);
  order.length = 0;
  await f.command('settbl', ['0', '3']);
  assert.deepEqual(order, ['count', 'value', 'value']);
  await assert.rejects(f.command('not-a-builtin'), /Unknown image\/control/);
  assert.equal(FES_IMAGE_CONTROL_COMMANDS.size, 34);
  const g = fixture();
  g.create(10);
  g.commands.soundSetID = null;
  await assert.rejects(g.command('setid', [1]), /soundSetID JavaScript service/);
  assert.throws(() => new FESImageControlCommands({ value: Number }), /canonical collection/);
});

test('lazy SCRIPT/bank boundaries do not expand frozen ignored ptype fields and parse selector fragments after expansion', async () => {
  const f = fixture(),
    objects = f.create(12),
    seen = [],
    context = {
      text(at) {
        seen.push(at);
        if (at >= 2) throw new Error('ignored IMAGE token expanded');
        return ['IMAGE', '2'][at];
      },
      argument() {
        throw new Error('ptype fragments must evaluate expanded text');
      },
    };
  await f.command('ptype', ['MODE', 'ID', 'IGNORED'], -1, context);
  assert.deepEqual(seen, [0, 1]);
  assert.equal(objects[0].panel.save.definitions.get(2).kind, 1);
  const g = fixture();
  g.create(12);
  const order = [],
    tokens = ['SSTR', '3', 'FLAG.5:10', '4', '8', '0xabcdef'];
  await g.command('ptype', tokens, -1, {
    text(at) {
      order.push(at);
      return tokens[at];
    },
  });
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(g.evaluations, ['3', '5', '10', '4', '8', '0xabcdef']);
  const spec = g.collection.lookup('items', 0).panel.save.definitions.get(3);
  assert.equal(spec.flag, 5);
  assert.equal(spec.digits, 10);
  assert.equal(spec.fontSize, 4);
});

test('dispid evaluates display once but each live target re-expands and evaluates original ID/range tokens', async () => {
  const f = fixture(),
    objects = f.create(11),
    seen = [];
  await f.command('dispid', ['DISPLAY', 'RANGE'], -1, {
    argument(at) {
      seen.push(['value', at]);
      return 1;
    },
    text(at) {
      seen.push(['text', at]);
      return '[(#0)++-3]';
    },
  });
  assert.deepEqual(seen, [
    ['value', 0],
    ['text', 1],
    ['text', 1],
    ['text', 1],
  ]);
  assert.equal(f.bank.get(0), 3);
  assert.deepEqual(
    objects.map((o) => o.panel.displayIDs),
    [
      [0, 1, 2, 3],
      [1, 2, 3],
      [2, 3],
    ],
  );
  await f.collection.remove(objects[1]);
  await f.command('dispid', [0, 3]);
  assert.deepEqual(objects[0].panel.displayIDs, [0, 1, 2]);
  assert.deepEqual(objects[2].panel.displayIDs, [2, 3]);
});

test('PANEL definitions and private CSS queries preserve explicit-index and sequential output gates', async () => {
  const f = fixture(),
    objects = f.create(12),
    save = objects[0].panel.save;
  save.flags[5] = 617;
  save.date = [2025, 4, 18, 11, 23, 45];
  await f.command('setsave', ['(#0)++', 3, 4]);
  assert.equal(f.bank.get(0), 0);
  await f.command('setsave', ['(#0)++', 3], 0);
  assert.equal(f.bank.get(0), 1);
  assert.deepEqual(f.instances, []);
  await f.command('setsave', [7, 0x400, 0], 0);
  assert.deepEqual(f.instances, [['setsave', 'items[0]', 7, 0x400, 0]]);
  await f.command('getflag', [5, 6], 0);
  assert.equal(f.bank.get(6), 617);
  await f.command('getflag', [-1, 6], 0);
  assert.equal(f.bank.get(6), 0);
  objects[0].fixtureSaveFile = { read: (entry) => (entry === 9 ? Uint8Array.of(65, 0, 66) : null) };
  await f.command('getsavestr', [2, 9], 0);
  assert.deepEqual(f.strings.get(2), Uint8Array.of(65));
  await f.command('getsavestr', [2, 3], 0);
  assert.equal(f.strings.get(2).length, 0);
  await f.command('getsavedate', [10, 11, 12, 13, 14, 15], 0);
  assert.deepEqual(
    [10, 11, 12, 13, 14, 15].map((at) => f.bank.get(at)),
    save.date,
  );
  await f.command('ptype', ['NORM', 0]);
  await f.command('setnum', [0, 23]);
  assert.equal(save.definitions.get(0).constant, 23);
});

test('whole userfont retains original first-target branch, holes and LOG main-child subset', async () => {
  const f = fixture(),
    objects = f.create(21);
  await f.collection.remove(objects[1]);
  const log = f.create(24)[1],
    children = f.create(21, 'children', 4);
  log.slots = [
    { main: children[0].handle, secondary: children[1].handle },
    { main: children[2].handle, secondary: children[3].handle },
  ];
  log.logModel = { max: () => 1 };
  await f.command('userfont', ['(#0)++', '7']);
  assert.equal(f.bank.get(0), 1);
  assert.deepEqual(objects[0].nativeTextState.fontMap, [[0, 7]]);
  assert.deepEqual(objects[2].nativeTextState.fontMap, [[0, 7]]);
  assert.deepEqual(children[0].nativeTextState.fontMap, [[0, 7]]);
  assert.deepEqual(children[1].nativeTextState.fontMap, []);
  assert.deepEqual(children[2].nativeTextState.fontMap, []);
  const g = fixture(),
    plain = g.create(2);
  await g.collection.remove(plain[1]);
  g.create(21);
  await g.command('userfont', ['(#0)++', 1]);
  assert.equal(g.bank.get(0), 0, 'original first target type gate precedes argument parsing');
  const p = fixture(),
    panels = p.create(11);
  await p.command('userfont', [0, 'atlas', 65, 2]);
  assert.equal(panels[0].panel.parts.get(0).userFonts[0].frame, 2);
});

test('whole userfontobj parses its canonical source once and propagates through text/LOG targets only', async () => {
  const f = fixture(),
    objects = f.create(21),
    atlas = f.create(2, 'atlas', 2),
    seen = [];
  f.commands.reference = (token) => {
    seen.push(token);
    return { name: 'atlas', index: -1 };
  };
  await f.command('userfontobj', ['atlas']);
  assert.deepEqual(seen, ['atlas']);
  assert.ok(objects.every((o) => o.nativeTextState.fontSource === null));
  await f.command('userfontobj', ['unused'], -1, { reference: { name: 'atlas', index: 1 } });
  assert.equal(seen.length, 1);
  assert.ok(objects.every((o) => o.nativeTextState.fontSource === atlas[1].handle));
});

test('ordinary numeric/text arguments use lazy central hooks once while setanm keeps its second bank-only expansion', async () => {
  const f = fixture(),
    objects = f.create(2),
    seen = [];
  f.instance.value = () => {
    throw new Error('raw token bypassed central argument expansion');
  };
  await f.command('setid', ['RAW'], -1, {
    argument(at) {
      seen.push(['arg', at]);
      return 7;
    },
  });
  assert.ok(objects.every((o) => o.idIndex === 7));
  f.commands.expandString = (token) => {
    seen.push(['bank-only', token]);
    return 'file';
  };
  await f.command('setanm', ['RAW'], -1, {
    text(at) {
      seen.push(['text', at]);
      return 'expanded';
    },
  });
  assert.deepEqual(seen, [
    ['arg', 0],
    ['text', 0],
    ['bank-only', 'expanded'],
  ]);
  assert.ok(objects.every((o) => o.anmFile === 'file.anm'));
});

test('mcpend evaluates once before traversal, applies to mixed classes and stops on a canonical hole', async () => {
  const f = fixture(),
    objects = f.create(2);
  await f.collection.remove(objects[1]);
  f.create(33);
  await f.command('mcpend', ['-1', '(#0)++', '90', '-180']);
  assert.deepEqual(f.evaluations, ['-1', '(#0)++', '90', '-180']);
  assert.equal(f.bank.get(0), 1);
  assert.equal(f.specs.length, 3);
  for (const spec of f.specs) {
    assert.equal(spec.file, 'mcPend');
    assert.equal(spec.group, 1);
    assert.deepEqual(spec.registers, [0, 0, Math.fround(Math.PI / 2), Math.fround(-Math.PI)]);
  }
  await f.collection.remove(f.collection.lookup('items', 1));
  await f.command('mcpend');
  assert.equal(f.specs.length, 4);
  assert.equal(f.specs[3].key, objects[0].key);
  assert.deepEqual(f.specs[3].registers, [30, 0, 0, 0]);
});

test('exported raw-type gate table records explicit no-ops, getid ABI output and universal mcpend', () => {
  assert.deepEqual(Object.keys(FES_IMAGE_CONTROL_TYPE_GATES), [...FES_IMAGE_CONTROL_COMMANDS]);
  assert.deepEqual(FES_IMAGE_CONTROL_TYPE_GATES.setanm.types, [2, 6]);
  assert.equal(FES_IMAGE_CONTROL_TYPE_GATES.setanm.otherwise, 'no-op');
  assert.equal(FES_IMAGE_CONTROL_TYPE_GATES.getid.otherwise, 'write-reference-address');
  assert.deepEqual(FES_IMAGE_CONTROL_TYPE_GATES.userfont.types, [11, 12, 21, 24, 29, 37, 38]);
  assert.equal(FES_IMAGE_CONTROL_TYPE_GATES.mcpend.types, null);
  assert.equal(FES_IMAGE_CONTROL_TYPE_GATES.mcpend.otherwise, 'apply');
});

test('POS2 expands its filename before evaluating its selector, after reading canonical bounds', async () => {
  const f = fixture(),
    objects = f.create(2),
    order = [],
    count = f.collection.count.bind(f.collection);
  f.collection.count = (name) => {
    order.push('count');
    return count(name);
  };
  await f.command('pos2', ['RAW-FILE', 'RAW-SELECTOR'], -1, {
    text(at) {
      order.push(['text', at]);
      f.bank.set(0, 7);
      return 'atlas';
    },
    argument(at) {
      order.push(['argument', at]);
      return f.bank.get(0);
    },
  });
  assert.deepEqual(order, ['count', ['text', 0], ['argument', 1]]);
  assert.ok(
    objects.every((o) => o.positionReference.name === 'atlas' && o.positionReference.index === 7),
  );
});
