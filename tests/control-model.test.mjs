// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeFESControl,
  setFESControlFile,
  setFESControlPriority,
  setFESControlPlanePriority,
  setFESControlType,
  setFESControlOrigin,
  setFESControlVRAM,
  setFESControlRect,
  setFESControlDisplay,
  setFESControlPage,
  setFESControlValue,
  setFESControlSkin,
  fesControlPosition,
  fesControlLoadPacket,
  fesControlRangePacket,
  snapshotFESControl,
  restoreFESControl,
} from '../src/native/fes-control-model.mjs';
import {
  ControlTaskModel,
  createControlTaskState,
  quantizeControlPixel,
  snapControlValue,
} from '../src/native/control-task-model.mjs';
import { setFESEnabled } from '../src/native/fes-common-model.mjs';
import { fesMotionState, applyFESMotionState } from '../src/native/fes-motion-model.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { FESObjectGraph } from '../src/native/fes-object-graph.mjs';

function control(nativeType, key = 'control') {
  return initializeFESControl({
    nativeType,
    key,
    handle: 0x1001,
    parentHandle: null,
    dirty: false,
  });
}
function instance(objects) {
  return { objects, byKey: new Map(objects.map((object) => [object.key, object])) };
}
function harness(kind, saved) {
  const events = [],
    packets = new Map(),
    model = new ControlTaskModel(
      kind,
      (operation, packet) => {
        events.push([operation, structuredClone(packet)]);
        const previous = packets.get(operation);
        if (previous) assert.strictEqual(packet, previous, `${operation} packet reuse`);
        else packets.set(operation, packet);
      },
      saved,
    );
  return { model, events, packets };
}
const sliderGeometry = Object.freeze({ rect: [16, 12, 88, 24], thumbLength: 8 }),
  scroll2Geometry = Object.freeze({ rect: [104, 12, 116, 76], minimumThumb: 16 }),
  scrollGeometry = Object.freeze({ direction: 0, x: 4, y: 4, trackStart: 16, trackLength: 48 });
async function slider() {
  const h = harness(42);
  await h.model.loadGeometry(sliderGeometry);
  await h.model.setRange(0, 100);
  return h;
}
function notifications(events) {
  return events.filter(([operation]) => operation === 'notify').map(([, packet]) => packet.value);
}

test('FES constructor defaults and typed TYPE/PRI/PRI_P/geometry gates stay distinct', () => {
  const scroll = control(13),
    scroll2 = control(14),
    slider = control(15),
    s = instance([scroll, scroll2, slider]);
  assert.deepEqual(
    [scroll.pri, scroll.planePriority, scroll.alpha, scroll.enable, scroll.disp],
    [10, 1000, 255, true, false],
  );
  assert.deepEqual(
    [scroll.filePending, scroll.pagePending, scroll.valuePending],
    [false, false, false],
  );
  const alreadyDirty = initializeFESControl({ nativeType: 13, dirty: true });
  assert.equal(alreadyDirty.dirty, true, 'base initialization owns the initial dirty flag');
  for (const object of [scroll, scroll2, slider]) {
    setFESControlPriority(object, 1000);
    assert.equal(object.pri, 1020);
    assert.equal(object.dirty, false, 'PRI only stores the biased value');
  }
  assert.equal(setFESControlType(scroll, 1), true);
  assert.equal(scroll.controlType, 1);
  assert.equal(scroll.dirty, false, 'TYPE does not itself trigger a reload');
  assert.equal(setFESControlType(scroll2, 1), false);
  assert.equal(setFESControlPlanePriority(slider, 7), false);
  assert.equal(setFESControlPlanePriority(scroll, 700), true);
  assert.equal(setFESControlOrigin(s, scroll2, 3, 5), false);
  assert.equal(setFESControlRect(s, scroll, 1, 2, 3, 4), false);
  setFESControlOrigin(s, scroll, 3, 5);
  setFESControlVRAM(s, scroll, 8, 9);
  setFESControlRect(s, slider, 16, 12, 88, 24);
  assert.deepEqual([slider.x, slider.y, slider.width, slider.height], [16, 12, 72, 12]);
});

test('FES pos is a value and load/range/query packets are reused without identity conversion', () => {
  const object = control(15),
    s = instance([object]);
  setFESControlRect(s, object, 16, 12, 88, 24);
  setFESControlFile(object, 'controls');
  setFESControlPage(object, 0, 100, 999);
  setFESControlValue(object, 25, 1);
  assert.equal(object.pageSize, 0, 'SLIDER page has only min/max');
  const position = fesControlPosition(object),
    range = fesControlRangePacket(object),
    packet = fesControlLoadPacket(object, 77, { nativeType: 4, x: 3.75, y: -5.75 });
  assert.deepEqual([...position], [25, 0, 0]);
  assert.deepEqual([...range], [0, 100]);
  assert.deepEqual([...packet.rect], [16, 12, 88, 24]);
  assert.deepEqual([packet.kind, packet.drawID, packet.planeX, packet.planeY], [42, 77, 3, -5]);
  assert.strictEqual(fesControlPosition(object), position);
  assert.strictEqual(fesControlRangePacket(object), range);
  assert.strictEqual(fesControlLoadPacket(object, 78, { nativeType: 3, x: 80, y: 90 }), packet);
  assert.deepEqual([packet.drawID, packet.planeX, packet.planeY], [78, 0, 0]);
  assert.equal('nativeTaskID' in packet, false);
  assert.equal('handle' in packet, false);
  assert.equal('inputID' in packet, false);
});

test('FES page/value/skin flags and fresh semantic restore preserve independent state', () => {
  const object = control(14),
    s = instance([object]);
  setFESControlPage(object, 0, 100, 20);
  setFESControlValue(object, 30, 7);
  setFESControlDisplay(s, object, 1);
  setFESEnabled(object, 0);
  assert.equal(setFESControlSkin(object, 1, 77), true);
  assert.equal(setFESControlSkin(object, -1, 66), false);
  assert.equal(setFESControlSkin(control(13), 1, 66), false);
  object.planeReference = { name: 'pl', index: 2 };
  const snapshot = structuredClone(snapshotFESControl(object)),
    fresh = restoreFESControl(control(14), snapshot);
  assert.deepEqual(snapshotFESControl(fresh), snapshotFESControl(object));
  assert.deepEqual([...fesControlPosition(fresh)], [30, 0, 0]);
  fresh.skinTable[1] = 99;
  fresh.planeReference.index = 3;
  assert.equal(object.skinTable[1], 77);
  assert.equal(object.planeReference.index, 2);
  assert.equal(snapshot.skinTable[1], 77);
  setFESControlPage(fresh, 0, 100);
  assert.equal(fresh.pageSize, 0, 'omitted FES page size is command default zero');
});

test('existing alpha-only MOT application dirties SCROLL descendants but SCROLL2/SLIDER only pending alpha', () => {
  for (const type of [13, 14, 15]) {
    const object = control(type),
      child = { key: 'child', handle: 0x1002, nativeType: 0, parentHandle: object.handle },
      s = instance([object, child]),
      bytes = fesMotionState(object);
    assert.strictEqual(fesMotionState(object), bytes);
    assert.equal(bytes.length, 144);
    assert.equal(bytes[MOTION_ABI.color + 3], 255);
    assert.equal(
      bytes.filter((value, index) => index !== MOTION_ABI.color + 3 && value !== 0).length,
      0,
    );
    bytes[MOTION_ABI.color + 3] = 64;
    applyFESMotionState(s, object, bytes);
    assert.equal(object.alpha, 64);
    assert.equal(object.dirty, type === 13);
    assert.equal(child.dirty ?? false, type === 13);
    assert.equal(object.alphaPending, type !== 13);
  }
});

test('low-level constructor defaults are separate from FES defaults and unsupported kinds fail', () => {
  assert.deepEqual(
    [createControlTaskState(41).maximum, createControlTaskState(41).pageSize],
    [10, 4],
  );
  for (const kind of [40, 41, 42]) {
    const state = createControlTaskState(kind);
    assert.equal(state.loaded, false);
    assert.equal(state.dragging, false);
    assert.equal(state.alpha, 255);
    assert.deepEqual(state.skinTable, [0, 0, 2, 3]);
  }
  assert.throws(() => new ControlTaskModel(39, () => {}), /Unsupported/);
  assert.throws(() => new ControlTaskModel(42, null), /service is required/);
});

test('SLIDER static fixture values 25 and 64 snap to exact original pixel arithmetic', async () => {
  const { model, events } = await slider();
  await model.setValue(25, true);
  assert.deepEqual([model.state.value, model.state.pixel, model.state.pixelMaximum], [25, 16, 64]);
  await model.setValue(64, true);
  assert.deepEqual([model.state.value, model.state.pixel], [64, 40]);
  assert.deepEqual(notifications(events), [25, 64]);
  const packet = events.filter(([name]) => name === 'render').at(-1)[1];
  assert.deepEqual([packet.x, packet.y], [56, 12]);
});

test('SLIDER mid-drag restore keeps anchors/pixel and emits no load, reset or replayed FES event', async () => {
  const original = await slider(),
    { model } = original;
  await model.setValue(64);
  await model.press('thumb', [60, 16], 10);
  const saved = structuredClone(model.snapshot()),
    fresh = harness(42, saved);
  assert.deepEqual(fresh.events, [], 'restore has no service side effect');
  assert.notStrictEqual(fresh.model.state, model.state);
  for (const current of [original, fresh]) {
    current.events.length = 0;
    await current.model.move([80, 16]);
    assert.deepEqual([current.model.state.pixel, current.model.state.value], [60, 94]);
    assert.equal(current.events[0][1].updateBounds, false);
    assert.deepEqual(notifications(current.events), [94]);
    await current.model.release('thumb');
    assert.deepEqual([current.model.state.pixel, current.model.state.value], [60, 94]);
    assert.deepEqual(notifications(current.events), [94]);
  }
  assert.deepEqual(fresh.model.snapshot(), model.snapshot());
  assert.deepEqual(fresh.events, original.events);
});

test('SCROLL2 preserves unsnapped drag pixel 38 then release snaps value63 to pixel37 without notify', async () => {
  const { model, events } = harness(41);
  await model.loadGeometry(scroll2Geometry);
  await model.setRange(0, 100, 20);
  await model.setValue(30);
  assert.deepEqual(
    [model.state.thumbLength, model.state.pixelMaximum, model.state.pixel],
    [16, 48, 18],
  );
  await model.press('thumb', [108, 34], 10);
  events.length = 0;
  await model.move([108, 54]);
  assert.deepEqual([model.state.value, model.state.pixel], [63, 38]);
  assert.deepEqual(notifications(events), [63]);
  await model.release('thumb');
  assert.deepEqual([model.state.value, model.state.pixel, model.state.dragging], [63, 37, false]);
  assert.deepEqual(notifications(events), [63]);
});

test('release can change the task value while FES owner retains its last notified value', async () => {
  const { model, events } = await slider();
  let ownerValue = 0;
  model.service = async (operation, packet) => {
    events.push([operation, structuredClone(packet)]);
    if (operation === 'notify') ownerValue = packet.value;
  };
  await model.setValue(40, true);
  assert.deepEqual([ownerValue, model.state.value, model.state.pixel], [40, 40, 25]);
  await model.press('thumb', [44, 16], 10);
  await model.release('thumb');
  assert.deepEqual([ownerValue, model.state.value, model.state.pixel], [40, 39, 24]);
  assert.deepEqual(notifications(events), [40]);
});

test('SLIDER track press centers, quantizes, notifies, then anchors dragging; track release ends it', async () => {
  const { model, events } = await slider();
  events.length = 0;
  await model.press('track', [50, 16], 9);
  assert.deepEqual(
    [model.state.value, model.state.pixel, model.state.dragging, model.state.state],
    [47, 30, true, 3],
  );
  assert.deepEqual(
    events.map(([name]) => name),
    ['render', 'notify', 'skin', 'bounds'],
  );
  assert.equal(events.at(-1)[1].clear, true);
  await model.release('track');
  assert.equal(model.state.dragging, false);
  assert.deepEqual(notifications(events), [47]);
});

test('the three range operations preserve their distinct rebuild/reset rules', async () => {
  const scroll = harness(40),
    scroll2 = harness(41),
    slide = await slider();
  await scroll.model.loadGeometry(scrollGeometry);
  await scroll.model.setRange(0, 100, 20);
  await scroll.model.setValue(10);
  await scroll.model.setRange(0, 100, 50);
  assert.deepEqual(
    [scroll.model.state.value, scroll.model.state.pixel, scroll.model.state.thumbLength],
    [0, 0, 24],
  );
  await scroll.model.setRange(0, 100, 100);
  assert.deepEqual([scroll.model.state.thumbLength, scroll.model.state.pixelMaximum], [48, 16]);
  await scroll2.model.loadGeometry(scroll2Geometry);
  await scroll2.model.setRange(0, 100, 20);
  await scroll2.model.setValue(30);
  scroll2.events.length = 0;
  await scroll2.model.setRange(0, 200, 20);
  assert.deepEqual([scroll2.model.state.value, scroll2.model.state.pixel], [30, 18]);
  assert.deepEqual(
    scroll2.events.map(([name]) => name),
    ['rebuild', 'render'],
  );
  assert.equal(scroll2.events.at(-1)[1].originOnly, true);
  await slide.model.setValue(64);
  slide.events.length = 0;
  await slide.model.setRange(0, 200);
  assert.deepEqual([slide.model.state.value, slide.model.state.pixel], [64, 40]);
  assert.deepEqual(slide.events, []);
});

test('SCROLL repeat uses +30 then +5, at most one step/tick, and survives a fresh restore', async () => {
  const original = harness(40),
    { model } = original;
  await model.loadGeometry(scrollGeometry);
  await model.setRange(0, 100, 20);
  await model.setValue(10);
  await model.press('increment', [8, 80], 10);
  assert.deepEqual([model.state.value, model.state.nextRepeat], [11, 40]);
  const fresh = harness(40, model.snapshot());
  for (const current of [original, fresh]) {
    current.events.length = 0;
    await current.model.tick(39);
    assert.equal(current.model.state.value, 11);
    await current.model.tick(40);
    assert.deepEqual([current.model.state.value, current.model.state.nextRepeat], [12, 45]);
    await current.model.tick(100);
    assert.deepEqual([current.model.state.value, current.model.state.nextRepeat], [13, 50]);
    await current.model.tick(101, false);
    assert.equal(current.model.state.value, 13);
    await current.model.setEnabled(0);
    await current.model.tick(101);
    assert.equal(current.model.state.value, 14, 'enable does not clear task repeat');
    await current.model.setShown(0);
    await current.model.tick(102);
    assert.equal(current.model.state.value, 14);
    assert.deepEqual(notifications(current.events), [12, 13, 14]);
  }
  assert.deepEqual(fresh.model.snapshot(), model.snapshot());
});

test('repeat at the limit advances its deadline without notifying; release/focus-leave clear it', async () => {
  const { model, events } = harness(40);
  await model.loadGeometry(scrollGeometry);
  await model.setRange(0, 100, 20);
  await model.setValue(80);
  events.length = 0;
  await model.press('increment', [8, 80], 0);
  await model.tick(30);
  assert.equal(model.state.nextRepeat, 35);
  assert.deepEqual(notifications(events), []);
  await model.release('increment');
  assert.deepEqual([model.state.repeatPart, model.state.nextRepeat], [null, 0]);
  assert.deepEqual(
    events.slice(-2).map(([name]) => name),
    ['skin', 'release'],
  );
  await model.press('decrement', [8, 8], 40);
  await model.focus('decrement', 0, [0, 0]);
  assert.equal(model.state.repeatPart, null);
});

test('SCROLL wheel/arrow step is one while track step is page and thumb TYPE changes the axis', async () => {
  const { model } = harness(40);
  await model.loadGeometry({ ...scrollGeometry, direction: 1 });
  await model.setRange(0, 100, 20);
  await model.setValue(10);
  await model.press('track', [100, 8], 0);
  assert.equal(model.state.value, 30);
  await model.press('track', [100, 8], 0, 2, 8);
  assert.equal(model.state.value, 29);
  await model.press('thumb', [30, 8], 0);
  const before = model.state.pixel;
  await model.move([40, 8]);
  assert.equal(model.state.pixel, before + 10);
});

test('input source/unknown/button gates yield unconsumed callbacks and touch remains explicit', async () => {
  const { model, events } = await slider();
  events.length = 0;
  assert.equal(await model.press('thumb', [20, 16], 0, 1), false);
  assert.equal(await model.press('unknown', [20, 16], 0), false);
  assert.equal(await model.press('thumb', [20, 16], 0, 2, 1), false);
  assert.equal(model.state.dragging, false);
  assert.equal(await model.focus('unknown', 1, [20, 16]), false);
  await model.touch('thumb');
  assert.deepEqual(
    events.map(([name]) => name),
    ['unconsumed', 'unconsumed', 'unconsumed', 'unconsumed', 'touch'],
  );
});

test('SLIDER focus tests authored rect with right/bottom exclusion and no duplicate transitions', async () => {
  const { model, events } = await slider();
  events.length = 0;
  await model.focus('thumb', 1, [20, 16]);
  await model.focus('track', 0, [20, 16]);
  await model.focus('track', 1, [88, 16]);
  const focus = events
    .filter(([name]) => name === 'focus')
    .map(([, packet]) => [packet.message, packet.flag]);
  assert.deepEqual(focus, [
    [28, true],
    [28, false],
  ]);
});

test('enable and skin selection are independent for SCROLL2 and mapped state for SLIDER', async () => {
  const second = harness(41),
    slide = await slider();
  await second.model.setEnabled(0);
  assert.equal(second.model.state.state, 0);
  assert.deepEqual(
    second.events.map(([name]) => name),
    ['enabled'],
  );
  await slide.model.setEnabled(0);
  assert.equal(slide.model.state.state, 1);
  assert.equal(slide.model.setTable(1, 77), true);
  await slide.model.reselectSkin();
  assert.equal(slide.model.state.skinTable[1], 77);
  await slide.model.setAlpha(64);
  assert.equal(slide.events.at(-1)[1].alpha, 64);
  assert.equal(slide.model.setTable(4, 77), false);
  const unloaded = harness(42);
  await unloaded.model.setEnabled(0);
  assert.equal(
    unloaded.model.state.state,
    0,
    'no bitmap wrapper means native selector does not change state',
  );
});

test('nonzero minima preserve native no-offset arithmetic; zero-step and undefined boundaries are explicit', async () => {
  const { model } = await slider();
  await model.setRange(10, 110);
  await model.setValue(-100);
  assert.deepEqual([model.state.value, model.state.pixel], [10, 6]);
  await model.setValue(999);
  assert.deepEqual([model.state.value, model.state.pixel], [100, 64]);
  const state = createControlTaskState(41);
  Object.assign(state, { maximum: 1000, pageSize: 0, trackLength: 1, thumbLength: 0, pixel: 0 });
  assert.equal(quantizeControlPixel(state), 1000, 'native step=0 advances to the extent');
  assert.throws(
    () => quantizeControlPixel(createControlTaskState(42)),
    /undefined native integer division/,
  );
  Object.assign(state, { maximum: -2147483648 });
  assert.throws(() => quantizeControlPixel(state), /abs\(INT_MIN\)/);
  const missing = harness(40);
  await assert.rejects(missing.model.loadGeometry({ direction: 0 }), /metadata/);
});

test('integer multiplication order and half-step ties match independent static boundary examples', () => {
  const slider = createControlTaskState(42);
  Object.assign(slider, { maximum: 1000000, pixelMaximum: 1000, value: 50000 });
  snapControlValue(slider);
  // 100*50000*1000 wraps to 705032704, then IDIV 1000000 and IDIV 100.
  assert.equal(slider.pixel, 7);
  const scroll = createControlTaskState(40);
  Object.assign(scroll, { maximum: 1000000, trackLength: 1000, thumbLength: 0, value: 50000 });
  snapControlValue(scroll);
  assert.equal(scroll.pixel, 0, 'SCROLL truncates the step before value multiplication');
  Object.assign(slider, { maximum: 5, pixelMaximum: 10, pixel: 1 });
  assert.equal(quantizeControlPixel(slider), 1, 'exact half-step ties round upward');
});

// Independent transcription of 62EE70/631290/632AA0's original short loop.
// BigInt int32 multiplication/division avoids reusing the model's arithmetic
// implementation. Restrict this reference to small limits; the production
// operation is required to handle the same rule in constant time.
function originalThresholdLoop(kind, limit, travel, pixel) {
  if (kind !== 42 && limit === 0) return 0;
  const int32 = (value) => BigInt.asIntN(32, value),
    n = BigInt(limit),
    length = kind === 42 ? BigInt(Math.abs(travel)) : BigInt(travel),
    step = int32(100n * length) / n,
    position = int32(100n * BigInt(pixel));
  let value = 0n,
    threshold = step / 2n;
  while (value < n && position >= threshold) {
    value++;
    threshold = int32(threshold + step);
  }
  return Number(value);
}

test('constant-time threshold arithmetic matches the original short loop at signed/odd/even/wrap boundaries', () => {
  for (const kind of [40, 41, 42]) {
    const s = createControlTaskState(kind);
    const cases =
      process.env.CATSYSTEM2_EXTENDED_CONTROL_MODEL === '1'
        ? [1, 2, 3, 4, 5, 7, 8, 9, 10, 31, 32, 33, 63, 64, 65, 127].flatMap((limit) =>
            [-21474837, -21474836, -3, -1, 0, 1, 2, 3, 7, 10, 64, 1000, 21474836, 21474837].flatMap(
              (travel) =>
                [-21474836, -3, -2, -1, 0, 1, 2, 3, 4, 5, 10000, 21474837].map((pixel) => [
                  limit,
                  travel,
                  pixel,
                ]),
            ),
          )
        : [
            [1, 0, 0],
            [1, 0, -1],
            [1, -1, 0],
            [1, -1, -1],
            [1, 21474837, 0],
            [1, 21474837, -1],
            [2, 1, 0],
            [2, 1, 1],
            [2, 3, 0],
            [2, 3, 1],
            [2, 3, 2],
            [3, 1, 0],
            [3, 1, 1],
            [3, 2, 0],
            [3, 2, 1],
            [3, 2, 2],
            [7, 10, 0],
            [7, 10, 1],
            [7, 10, 5],
            [7, 10, 10],
            [31, 1, 0],
            [31, 1, 1],
            [127, 21474836, 21474837],
            [127, -21474836, -21474836],
            [127, -21474837, 0],
            [8, 7, 3],
            [9, -3, -2],
            [10, 64, 5],
          ];
    for (const [limit, travel, pixel] of cases) {
      Object.assign(s, {
        minimum: 0,
        maximum: limit,
        pageSize: 0,
        trackLength: travel,
        thumbLength: 0,
        pixelMinimum: 0,
        pixelMaximum: travel,
        pixel,
      });
      assert.equal(
        quantizeControlPixel(s),
        originalThresholdLoop(kind, limit, travel, pixel),
        `kind=${kind} N=${limit} travel=${travel} pixel=${pixel}`,
      );
    }
    if (kind !== 42) {
      Object.assign(s, { maximum: 0, pageSize: 0, trackLength: 10, pixel: -1 });
      assert.equal(quantizeControlPixel(s), 0);
      Object.assign(s, { maximum: 0, pageSize: 5, pixel: 0 });
      assert.equal(quantizeControlPixel(s), originalThresholdLoop(kind, -5, 10, 0));
    }
  }
});

test('legitimate very large ranges use exact constant-time zero/positive/negative-step branches', () => {
  const s = createControlTaskState(41);
  Object.assign(s, { maximum: 2147483647, pageSize: 0, trackLength: 1, thumbLength: 0, pixel: 0 });
  assert.equal(quantizeControlPixel(s), 2147483647);
  s.pixel = -1;
  assert.equal(quantizeControlPixel(s), 0);
  Object.assign(s, { maximum: 1000000000, trackLength: 21474836, pixel: 1000000 });
  assert.equal(quantizeControlPixel(s), 50000000);
  Object.assign(s, { trackLength: 21474837, pixel: 0 });
  assert.equal(quantizeControlPixel(s), 1000000000);
  s.pixel = -1;
  assert.equal(quantizeControlPixel(s), 0);
});

test('FES graph identities and pending control fields restore together without substituting child IDs', () => {
  const graph = new FESObjectGraph(),
    object = control(15);
  object.handle = graph.allocateHandle();
  graph.register(object);
  const parent = { key: 'parent', nativeType: 0, handle: graph.allocateHandle() };
  graph.register(parent);
  graph.bind(object, parent);
  object.nativeTaskID = 77;
  setFESControlValue(object, 64, 1);
  const snapshot = { graph: graph.snapshot(), objects: structuredClone([object, parent]) },
    fresh = new FESObjectGraph({ objects: snapshot.objects, ...snapshot.graph });
  const restored = fresh.get(object.handle);
  assert.deepEqual(
    [
      restored.handle,
      restored.parentHandle,
      restored.nativeTaskID,
      restored.value,
      restored.valueNotify,
    ],
    [0x1001, 0x1002, 77, 64, 1],
  );
  assert.equal(fresh.allocateHandle(), 0x1003);
});
