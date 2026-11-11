// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESObject } from '../src/fes/object.mjs';
import { FESObjectCollection } from '../src/native/fes-object-collection.mjs';
import { createFESTypedObject, initializeFESPlane } from '../src/native/fes-object-factory.mjs';
import { createFESImageSelector } from '../src/native/fes-image-model.mjs';
import {
  FESDefinitionModel,
  compileFESDefinitionColumns,
  fesDefinitionTuple,
  parseFESObjectReference,
  fesDefinitionResourceReference,
  readFESDefinitionRecord,
} from '../src/native/fes-definitions.mjs';
import { snapshotFESControl, restoreFESControl } from '../src/native/fes-control-model.mjs';
import { FESImageTable } from '../src/native/fes-image-table-model.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { evaluateNativeExpression } from '../src/native/expression.mjs';

// Image resource-driver initializer is an explicit integration seam. These
// established fields suffice for definition tests, without loading a bitmap.
function imageDefaults(object) {
  Object.assign(object, {
    x: 0,
    y: 0,
    z: 0,
    imageOriginX: 0,
    imageOriginY: 0,
    baseX: 0,
    baseY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    width: -1,
    height: -1,
    depth: -1,
    alpha: 255,
    pri: -1,
    renderID: -1,
    displayValue: 0,
    displayDelta: 0,
    disp: false,
    color: 0,
    mask: 0,
    baseHandlingMode: 0,
    priorityChanged: false,
    oldPriority: -1,
    auxiliarySizeMode: 0,
    auxiliaryWidth: 0,
    auxiliaryHeight: 0,
    positionReference: null,
    positionPending: false,
    sizeReference: null,
    sizePending: false,
    sizeDirty: false,
    file: '',
    planeReference: null,
    parentPlaneID: 0,
  });
  if (object.nativeType !== 1 && object.nativeType !== 25)
    Object.assign(object, createFESImageSelector());
}
function fixture() {
  const bank = new NativeVariableBank();
  bank.initialize(32);
  bank.registerContext('fes');
  const evaluations = [],
    special = [],
    files = [],
    diagnostics = [],
    collection = new FESObjectCollection({
      create: (identity) =>
        createFESTypedObject(identity, {
          initializeImage: imageDefaults,
          initializeSpecial: () => true,
        }),
    }),
    instance = {
      objects: collection.objects,
      byKey: collection.byKey,
      value(source) {
        evaluations.push(source);
        return evaluateNativeExpression(source, bank);
      },
    },
    model = new FESDefinitionModel(instance, {
      collection,
      report: (message) => diagnostics.push(message),
      setImageFile(object, file) {
        files.push([object.key, file]);
        if (object.file !== file) {
          object.file = file;
          object.imageChanged = true;
        }
      },
      applySpecial(object, record, index) {
        special.push({ object, record, index });
        return true;
      },
    });
  return { bank, evaluations, collection, instance, model, special, files, diagnostics };
}

test('pure typed construction preserves FESObject prototype, VIEW raw0, exact plane/control defaults and approved LOG state', () => {
  const f = fixture(),
    view = f.collection.create('VIEW', 'view', 1)[0],
    plane = f.collection.create('PLANE', 'plane', 1)[0],
    control = f.collection.create('SCROLL', 'scroll', 1)[0],
    log = f.collection.create('LOGSTRING', 'log', 1)[0];
  assert.ok(view instanceof FESObject);
  assert.equal(view.type, 'VIEW');
  assert.equal(view.nativeType, 0);
  assert.deepEqual(
    [plane.x, plane.y, plane.z, plane.positionW, plane.baseW, plane.scaleW, plane.rotationW],
    [0, 0, 0, 1, 1, 1, 1],
  );
  assert.deepEqual([...plane.motionMatrix], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual(
    [
      plane.width,
      plane.height,
      plane.pri,
      plane.color,
      plane.planeType,
      plane.sizeDirty,
      plane.vramW,
    ],
    [800, 600, 5000, 0xffffffff, 1, false, 1],
  );
  assert.deepEqual(
    [
      plane.blendMode,
      plane.resourceFile,
      plane.resourcePending,
      plane.positionPending,
      plane.sizePending,
    ],
    [0, '', false, false, false],
  );
  assert.deepEqual(
    [control.pri, control.planePriority, control.controlType, control.alpha],
    [10, 1000, 0, 255],
  );
  assert.deepEqual([log.pri, log.top, log.count], [0, 0, 0]);
  assert.equal(Object.hasOwn(control, 'positionReference'), true);
  assert.equal(control.positionReference, null);
  assert.equal(Object.hasOwn(control, 'positionPending'), true);
  assert.equal(control.positionPending, false);
  const initialControl = snapshotFESControl(control);
  assert.equal(initialControl.positionReference, null);
  assert.equal(initialControl.positionPending, false);
  assert.throws(
    () => createFESTypedObject({ type: 'SOUND', nativeType: 9, baseName: 'sound', index: 0 }),
    /pure family initializer/,
  );
  assert.throws(
    () => createFESTypedObject({ type: 'EFKPLANE', nativeType: 36, baseName: 'efk', index: 0 }),
    /no registered JavaScript/,
  );
});

test('tuple presence follows comma scanning, evaluates empty components as zero, stops before absent components and preserves int32', () => {
  const f = fixture(),
    evaluate = (s) => f.instance.value(s);
  assert.equal(fesDefinitionTuple('12,,7', 0, evaluate), 12);
  assert.equal(fesDefinitionTuple('12,,7', 1, evaluate), 0);
  assert.equal(fesDefinitionTuple('12,,7', 2, evaluate), 7);
  assert.equal(fesDefinitionTuple('12,,7', 3, evaluate), undefined);
  assert.deepEqual(f.evaluations, ['12', '', '7']);
  assert.equal(fesDefinitionTuple('4294967295,ignored', 0, evaluate), -1);
  assert.throws(() => fesDefinitionTuple('0'.repeat(512), 0, evaluate), /512-byte/);
});

test('reference parsing evaluates bare -1 then applies first count, expands name separately and accepts original trailing text', () => {
  const f = fixture();
  f.collection.create('IMAGE', 'g', 3);
  const options = {
      evaluate: (s) => f.instance.value(s),
      count: (name) => f.collection.count(name),
    },
    group = parseFESObjectReference('g', options),
    element = parseFESObjectReference('g[1]ignored', options);
  assert.equal(group.index, -1);
  assert.equal(element.index, 1);
  assert.equal(parseFESObjectReference('missing', options).index, 0);
  assert.equal(parseFESObjectReference('name tail', options).name, 'name');
  assert.throws(() => parseFESObjectReference('g[1', options), /closing bracket/);
  assert.throws(() => parseFESObjectReference('g[]', options), /no defined original value/);
  const expanded = parseFESObjectReference('$str0[2]', {
    ...options,
    expandName: () => new TextEncoder().encode('g'),
  });
  assert.equal(expanded.name, 'g');
  assert.equal(expanded.index, 2);
});

test('header IDs and suffix aliases are exact; unknown headers diagnose and do not consume a row column', () => {
  const messages = [],
    compiled = compileFESDefinitionColumns(
      ['unknown', 'ID.N', 'ID.D', 'ID.F', 'ID.P', 'ID.31', 'POS', 'PRI', 'PRI_P'],
      { report: (m) => messages.push(m) },
    );
  assert.deepEqual(compiled, [2, 3, 4, 5, 33, 34, 41, 42]);
  assert.equal(messages.length, 1);
  assert.throws(() => compileFESDefinitionColumns(['file']), /Unknown FES definition column/);
  assert.deepEqual(compileFESDefinitionColumns(['ID.unknown', 'PRI.D']), [2, 42]);
});

test('whole row expressions execute once before original null-preserving group application', async () => {
  const f = fixture(),
    objects = f.collection.create('IMAGE', 'g', 3);
  await f.collection.remove(objects[1]);
  await f.model.row(['POS', 'PRI', 'ID.N'], 'g', ['(#0)++,9', '(#1)++', '4']);
  assert.equal(f.bank.get(0), 1);
  assert.equal(f.bank.get(1), 1);
  assert.deepEqual([objects[0].x, objects[2].x], [0, 0]);
  assert.deepEqual([objects[0].pri, objects[2].pri], [20, 22]);
  assert.deepEqual([objects[0].renderID, objects[2].renderID], [0, 2]);
  assert.deepEqual([objects[0].ids[0], objects[2].ids[0]], [4, 4]);
  assert.equal(f.diagnostics.length, 1);
  assert.match(f.diagnostics[0], /g\[1\]/);
});

test('PRI_P is SCROLL plane priority while PRI carries the original shared array-relative flag and inverted 14/15 rule', async () => {
  const f = fixture(),
    images = f.collection.create('IMAGE', 'images', 3),
    scroll = f.collection.create('SCROLL', 'scroll', 3),
    second = f.collection.create('SCROLL2', 'second', 3),
    slider = f.collection.create('SLIDER', 'slider', 3);
  await f.model.row(['PRI_P'], 'images', ['90']);
  assert.deepEqual(
    images.map((o) => o.pri),
    [-1, -1, -1],
  );
  await f.model.row(['PRI', 'PRI_P'], 'scroll', ['30', '90']);
  assert.deepEqual(
    scroll.map((o) => [o.pri, o.planePriority]),
    [
      [50, 90],
      [51, 91],
      [52, 92],
    ],
  );
  await f.model.row(['PRI_P'], 'scroll[2]', ['100']);
  assert.equal(scroll[2].planePriority, 100);
  await f.model.row(['PRI'], 'second', ['30']);
  await f.model.row(['PRI'], 'slider[2]', ['30']);
  assert.deepEqual(
    second.map((o) => o.pri),
    [50, 50, 50],
  );
  assert.equal(slider[2].pri, 52);
});

test('IMAGE definitions ignore recognized SIZE/BASE/COLOR/ENABLE while CIMAGE and BUTTON retain their narrower branches', async () => {
  const f = fixture(),
    image = f.collection.create('IMAGE', 'image', 1)[0],
    cimage = f.collection.create('CIMAGE', 'cimage', 1)[0],
    button = f.collection.create('BUTTON', 'button', 1)[0],
    window = f.collection.create('IMGWND', 'window', 1)[0];
  await f.model.row(['FILE', 'SIZE', 'BASE', 'COLOR', 'ENABLE'], 'image', [
    'sprite',
    '21,22',
    '3,4',
    '0x80402010',
    '0',
  ]);
  assert.deepEqual(
    [image.file, image.width, image.height, image.baseX, image.baseY, image.color, image.enable],
    ['sprite', -1, -1, 0, 0, 0, true],
  );
  await f.model.row(['FILE', 'SIZE', 'BASE', 'COLOR', 'ID.0'], 'cimage', [
    'unused',
    '21,22',
    '3,4',
    '0x80402010',
    '4',
  ]);
  assert.deepEqual(
    [cimage.file, cimage.width, cimage.height, cimage.baseX, cimage.color, cimage.sizeDirty],
    ['', 21, 22, 0, 0x80402010, true],
  );
  assert.deepEqual(cimage.ids, [], 'CIMAGE has no ID-table definition branch');
  await f.model.row(['SIZE', 'ENABLE', 'TYPE', 'DEFAULT'], 'button', ['7,8', '0', '2', 'PUSH']);
  assert.deepEqual(
    [button.width, button.height, button.enable, button.buttonType, button.defaultHandler],
    [7, 8, false, 2, 'PUSH'],
  );
  await f.model.row(['SIZE'], 'window', ['31,32']);
  assert.deepEqual([window.width, window.height], [-1, -1]);
});

test('FILE then IDN then ID table is the recovered apply order and missing fields preserve already authored state', async () => {
  const f = fixture(),
    object = f.collection.create('IMAGE', 'image', 1)[0];
  await f.model.row(['ID.0', 'IDN', 'FILE', 'POS'], 'image', ['7', '0', 'sprite', '1,2']);
  assert.deepEqual(
    [object.file, object.idIndex, object.ids[0], object.usesIDTable, object.idTableChanged],
    ['sprite', 0, 7, true, true],
  );
  object.imageChanged = false;
  await f.model.row(['FILE', 'POS', 'DISP'], 'image', ['sprite']);
  assert.equal(object.imageChanged, false, 'same FILE does not itself reload');
  assert.deepEqual([object.x, object.y, object.disp], [1, 2, false]);
  assert.deepEqual(
    f.files.map((entry) => entry[1]),
    ['sprite', 'sprite'],
  );
});

test('PARENT resolves once before type application; PL and external plane references remain independent', async () => {
  const f = fixture(),
    parents = f.collection.create('PLANE', 'parent', 2),
    images = f.collection.create('IMAGE', 'g', 2);
  await f.model.row(['PARENT', 'PL'], 'g', ['parent[1]', 'parent']);
  for (const image of images) {
    assert.equal(image.parentHandle, parents[1].handle);
    assert.equal(image.planeReference.name, 'parent');
    assert.equal(image.planeReference.index, -1);
    assert.equal(image.parentPlaneID, 0);
  }
  await f.model.row(['PARENT'], 'g', ['missing']);
  assert.deepEqual(
    images.map((o) => o.parentHandle),
    [null, null],
  );
  await f.model.row(['PARENT'], 'g', ['parent']);
  assert.deepEqual(
    images.map((o) => o.parentHandle),
    [null, null],
    'bare multi-element PARENT lookup is not per-child pairing',
  );
});

test('plane definitions preserve absent fractional coordinates and vector W, while BASE and VRAM write zero W and COLOR precedes BLEND', async () => {
  const f = fixture(),
    plane = f.collection.create('PLANE', 'plane', 1)[0];
  Object.assign(plane, { x: 1.5, y: -2.75, z: 3.25, positionW: 0 });
  await f.model.row(['POS', 'BASE', 'VRAM', 'COLOR', 'BLEND', 'TYPE', 'EXPOS'], 'plane', [
    '7',
    '4',
    '9,10',
    '0x11223344',
    '128',
    '9',
    '-3',
  ]);
  assert.deepEqual([plane.x, plane.y, plane.z, plane.positionW], [7, -2.75, 3.25, 0]);
  assert.deepEqual([plane.baseX, plane.baseY, plane.baseZ, plane.baseW], [4, 0, 0, 0]);
  assert.deepEqual([plane.vramX, plane.vramY, plane.vramZ, plane.vramW], [9, 10, 0, 0]);
  assert.deepEqual(
    [plane.color, plane.alpha, plane.planeType, plane.planeProperty],
    [0x80223344, 128, 1, -3],
  );
  const cp = f.collection.create('CPLANE', 'cp', 1)[0];
  await f.model.row(['VRAM'], 'cp', ['5,6']);
  assert.equal(cp.vramX, 0, 'CPLANE has no PLANE VRAM setter branch');
  Object.assign(cp, { baseX: -0, baseY: 0, baseZ: 0, baseW: 0, dirty: false });
  await f.model.row(['BASE'], 'cp', ['0']);
  assert.ok(Object.is(cp.baseX, -0));
  assert.equal(cp.dirty, false, 'equal vector avoids a signed-zero-destroying store');
});

test('POS2 and SIZE2 distinguish object-index evaluation from the resource colon selector and retain exact pending flags', async () => {
  const f = fixture(),
    image = f.collection.create('IMAGE', 'image', 1)[0],
    plane = f.collection.create('PLANE', 'plane', 1)[0],
    control = f.collection.create('SCROLL2', 'control', 1)[0];
  await f.model.row(['POS2', 'SIZE2'], 'image', ['frames:12[\u00230++]', 'frames[7]']);
  assert.equal(f.bank.get(0), 1);
  assert.deepEqual(
    [image.positionReference.name, image.positionReference.index, image.positionPending],
    ['frames', 12, true],
  );
  assert.deepEqual(
    [image.sizeReference.name, image.sizeReference.index, image.sizePending, image.sizeDirty],
    ['frames', 0, true, false],
  );
  await f.model.row(['POS2', 'SIZE2'], 'plane', ['frames:2', 'frames:3']);
  assert.deepEqual([plane.positionPending, plane.sizePending, plane.sizeDirty], [true, true, true]);
  await f.model.row(['POS2'], 'control', ['frames:4']);
  assert.equal(control.positionPending, true);
  assert.equal(
    control.dirty,
    false,
    'original control POS2 setter only marks its own resource pending',
  );
  assert.equal(
    fesDefinitionResourceReference({ name: 'frames:12+9' }).index,
    12,
    'resource suffix uses integer-prefix parsing, not an expression',
  );
});

test('SCROLL applies screen POS and VRAM; SCROLL2/SLIDER exclude ordinary POS/TYPE/VRAM definitions', async () => {
  const f = fixture(),
    a = f.collection.create('SCROLL', 'a', 1)[0],
    b = f.collection.create('SCROLL2', 'b', 1)[0],
    c = f.collection.create('SLIDER', 'c', 1)[0];
  for (const name of ['a', 'b', 'c'])
    await f.model.row(['POS', 'VRAM', 'TYPE'], name, ['7,8', '9,10', '1']);
  assert.deepEqual([a.x, a.y, a.vramX, a.vramY, a.controlType], [7, 8, 9, 10, 1]);
  assert.deepEqual([b.x, b.y, b.vramX, b.vramY, b.controlType, c.x, c.y], [0, 0, 0, 0, 0, 0, 0]);
});

test('pure family specialization is explicit and current definition records restore without input or resource work', async () => {
  const f = fixture(),
    text = f.collection.create('STRING', 'text', 1)[0];
  await f.model.row(['FILE', 'POS'], 'text', ['script', '3,4']);
  assert.equal(f.special.length, 1);
  assert.equal(f.special[0].object, text);
  const compiled = compileFESDefinitionColumns(['POS']),
    record = readFESDefinitionRecord(compiled, ['1,2'], {
      evaluate: Number,
      reference: () => null,
    });
  assert.deepEqual(structuredClone(record), record);
  assert.throws(
    () => createFESTypedObject({ type: 'IMAGE', nativeType: 2, baseName: 'g', index: 0 }),
    /pure initializer/,
  );
  assert.equal(initializeFESPlane({ nativeType: 3 }).sizeDirty, false);
});

test('one compiled header serves subsequent real rows without repeating token expansion', async () => {
  const f = fixture();
  f.collection.create('IMAGE', 'a', 1);
  f.collection.create('IMAGE', 'b', 1);
  let headers = 0;
  f.model.expandToken = (token) => {
    if (token === 'HEADER') {
      headers++;
      return 'POS';
    }
    return token;
  };
  const compiled = f.model.compile(['HEADER']);
  await f.model.rowCompiled(compiled, 'a', ['1,2']);
  await f.model.rowCompiled(compiled, 'b', ['3,4']);
  assert.equal(headers, 1);
  assert.deepEqual([f.collection.lookup('a', 0).x, f.collection.lookup('b', 0).x], [1, 3]);
});

test('fresh collection and standalone control restore retain pure typed pending definitions without replaying a row', async () => {
  const f = fixture(),
    plane = f.collection.create('PLANE', 'plane', 1)[0],
    control = f.collection.create('SCROLL2', 'control', 1)[0];
  await f.model.row(['POS', 'BASE', 'SIZE2'], 'plane', ['7', '4,5', 'frames:3']);
  await f.model.row(['POS2'], 'control', ['frames:4']);
  const saved = f.collection.snapshot(),
    fresh = fixture();
  fresh.collection.restore(saved);
  assert.equal(fresh.evaluations.length, 0);
  assert.deepEqual(fresh.collection.snapshot(), saved);
  assert.ok(fresh.collection.lookup('plane', 0) instanceof FESObject);
  assert.equal(fresh.collection.lookup('plane', 0).sizePending, true);
  const only = snapshotFESControl(control),
    target = createFESTypedObject({ type: 'SCROLL2', nativeType: 14, baseName: 'new', index: 0 });
  restoreFESControl(target, structuredClone(only));
  assert.equal(target.positionPending, true);
  assert.deepEqual(target.positionReference, control.positionReference);
  assert.deepEqual([plane.baseX, plane.baseY, plane.baseW], [4, 5, 0]);
});

test('TABLE awaits the real table owner before FILE and the following command can inspect that same loaded table', async () => {
  const f = fixture(),
    object = f.collection.create('BGTABLE2', 'table', 1)[0],
    order = [];
  f.model.loadImageTable = async (instance, target, name) => {
    assert.strictEqual(instance, f.instance);
    assert.strictEqual(target, object);
    assert.equal(name, 'tabledata');
    order.push('table');
    target.imageTable = new FESImageTable(
      17,
      Uint8Array.of(0x81, 0x9b, 44, 120, 44, 102, 111, 111),
    );
    target.tablePending = false;
  };
  const setFile = f.model.setImageFile;
  f.model.setImageFile = (target, name) => {
    assert.ok(target.imageTable instanceof FESImageTable);
    order.push('file');
    setFile(target, name);
  };
  await f.model.row(['FILE', 'TABLE'], 'table', ['fallback', 'tabledata']);
  assert.deepEqual(order, ['table', 'file']);
  assert.equal(object.imageTable.max([]), 1);
  assert.equal(new TextDecoder().decode(object.imageTable.select([0, 0])), 'foo');
  const noLoader = fixture();
  noLoader.collection.create('BGTABLE2', 'table', 1);
  await assert.rejects(
    noLoader.model.row(['TABLE'], 'table', ['tabledata']),
    /immediate JavaScript table loader/,
  );
});
