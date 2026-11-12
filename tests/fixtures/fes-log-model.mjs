// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { translation, u32 } from '../helpers.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { FESObjectGraph } from '../../src/native/fes-object-graph.mjs';
import { FESLogModel, initializeFESLog } from '../../src/native/fes-log-model.mjs';
import { FESLogTextService } from '../../src/native/fes-log-text-service.mjs';
import { initializeFESString } from '../../src/native/fes-string-driver.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
export const bytes = (text) => encodeCP932(text);
export const text = (value) => new TextDecoder('shift_jis').decode(value);
export function scene(blocks) {
  const strings = [],
    offsets = [],
    table = [];
  for (const block of blocks) {
    table.push(block.length, offsets.length);
    for (const [kind, value] of block) {
      offsets.push(strings.length);
      strings.push(1, kind, ...bytes(value), 0);
    }
  }
  const index = table.length * 4,
    body = Uint8Array.from([
      ...[
        index + offsets.length * 4 + strings.length,
        blocks.length,
        index,
        index + offsets.length * 4,
        ...table,
        ...offsets,
      ].flatMap(u32),
      ...strings,
    ]);
  return Uint8Array.from([
    ...new TextEncoder().encode('CatScene'),
    ...u32(0),
    ...u32(body.length),
    ...body,
  ]);
}
export const files = {
  'story.cst': scene(
    Array.from({ length: 8 }, (_, i) => [
      [32, String.fromCharCode(65 + i)],
      [2, ''],
    ]),
  ),
  'story.cstl': translation(
    ['en', 'ja'],
    Array.from({ length: 8 }, (_, i) => ({
      en: ['', `E${i}`],
      ja: ['', `J${i}`],
    })),
  ),
};
function mountCategories(world) {
  world.game.readCategory = (name, category) =>
    world.game.read(category === 'scene' && !/\.[^/\\]+$/.test(name) ? name + '.cst' : name);
}
export function append(logs, model, value, block = model.blocks.length, options = {}) {
  logs.append(
    model,
    bytes(options.scene ?? 'story'),
    block,
    new Uint8Array(),
    bytes(value),
    options.voice ?? false,
    options.paragraph ?? false,
    options.path ?? block + 10,
  );
}
export function traceService() {
  const children = new Map(),
    events = [],
    byName = new Map();
  let nextHandle = 0x2001;
  const service = {
    async create(spec) {
      if (byName.has(spec.name)) {
        const handle = byName.get(spec.name);
        events.push(['reuse', handle, { ...spec }]);
        return handle;
      }
      const handle = nextHandle++;
      byName.set(spec.name, handle);
      children.set(handle, {
        handle,
        ...spec,
        source: new Uint8Array(),
        colors: [-1, -16777216, -1],
        shown: false,
        x: 0,
        y: 0,
        endY: 0,
        endChanged: false,
        reveal: 0,
        sourceEvents: 0,
      });
      events.push(['create', handle, { ...spec }]);
      return handle;
    },
    configure(handle, width, height, priority, vramX, vramY) {
      Object.assign(children.get(handle), { width, height, priority, vramX, vramY });
      events.push(['configure', handle, width, height, priority, vramX, vramY]);
    },
    priority(handle, priority) {
      children.get(handle).priority = priority;
      events.push(['priority', handle, priority]);
    },
    position(handle, x, y) {
      Object.assign(children.get(handle), { x, y });
      events.push(['position', handle, x, y]);
    },
    source(handle, value) {
      const child = children.get(handle);
      child.source = value ? value.slice() : new Uint8Array();
      child.sourceEvents++;
      child.reveal = 0;
      events.push(['source', handle, child.source.slice()]);
    },
    colors(handle, colors) {
      children.get(handle).colors = [...colors];
      events.push(['colors', handle, [...colors]]);
    },
    display(handle, shown) {
      children.get(handle).shown = shown;
      events.push(['display', handle, shown]);
    },
    draw(handle, page) {
      children.get(handle).page = page;
      events.push(['draw', handle, page]);
    },
    endY(handle) {
      return children.get(handle).endY;
    },
    consumeEndChanged(handle) {
      const c = children.get(handle),
        changed = c.endChanged;
      c.endChanged = false;
      return changed;
    },
    supportsLayout(mode) {
      return ['size', 'margin', 'font'].includes(mode);
    },
    layout(handle, mode, args) {
      events.push(['layout', handle, mode, args]);
      return { applied: true };
    },
    reset(handle) {
      events.push(['reset', handle]);
    },
  };
  return { service, children, events };
}
export async function fixture({
  type = 24,
  count = 3,
  rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  profile = profiles[1],
} = {}) {
  const world = await dataWorld(profile, files),
    logs = world.displayLogs;
  mountCategories(world);
  Object.assign(world.configuration.fields.log, {
    col: 16,
    prof: 0,
    space: 1,
    dispName: 0,
    nameline: 0,
    nameindent: 0,
  });
  const handle = logs.create(world.main.id),
    source = logs.get(handle),
    trace = traceService(),
    object = initializeFESLog({
      nativeType: type,
      baseName: 'history',
      key: 'history',
      handle: 0x1001,
    }),
    model = new FESLogModel(object, logs, trace.service);
  rows.forEach((row, index) => append(logs, source, row, index));
  model.setCount(count);
  model.setSize(24, 16);
  await model.setPriority(60000);
  await model.allocate();
  for (let i = 0; i < count; i++) await model.setDisplayPosition(i, 2, i * 18);
  model.bind(handle);
  return {
    world,
    logs,
    source,
    handle,
    object,
    model,
    ...trace,
    close: () => world.close({ flushFiles: false }),
  };
}

const glyphs = {
  measure: (_font, value) => ({
    width: value.length * 4,
    height: 8,
    ascent: 6,
    descent: 2,
    averageWidth: 4,
    maximumWidth: 8,
  }),
  glyph: () => ({
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 4,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};
export async function realFixture(
  profile,
  type = 24,
  saved = null,
  { omitPriority = false, initialBind = true, initialPosition = true } = {},
) {
  const world = await dataWorld(profile, files, { initialize: !saved, glyphs }),
    runtime = await world.text.runtime();
  mountCategories(world);
  if (saved) await world.restore(saved.world);
  const objects = saved ? structuredClone(saved.objects) : [],
    graph = new FESObjectGraph({ objects, ...(saved?.graph ?? {}) }),
    instance = {
      objects,
      byKey: new Map(objects.map((o) => [o.key, o])),
      runtimeID: world.main.id,
      plane: () => null,
      player: { nativeInput: { state: { sleeping: false } } },
    },
    object = saved
      ? objects.find((o) => o.nativeType === type)
      : initializeFESLog({
          nativeType: type,
          baseName: 'history',
          key: 'history',
          handle: graph.allocateHandle(),
        });
  if (!saved) {
    graph.register(object);
    objects.push(object);
    instance.byKey.set(object.key, object);
  }
  const service = new FESLogTextService({
      world,
      instance,
      resolveChild: (handle) => graph.get(handle),
      findChild: (name, index) => (index === 0 ? instance.byKey.get(name) : null),
      async createChild(spec) {
        if (instance.byKey.has(spec.name))
          throw new Error('Duplicate generated group ' + spec.name);
        const child = {
          key: spec.name,
          baseName: spec.name,
          handle: graph.allocateHandle(),
          parentHandle: null,
          nativeType: spec.nativeType,
          nativeControlledByLog: spec.logObjectHandle,
          type: spec.nativeType === 37 ? 'STRING8' : 'STRING',
          isPlane: true,
          x: 0,
          y: 0,
          z: 0,
          baseX: 0,
          baseY: 0,
          baseZ: 0,
          width: 0,
          height: 0,
          pri: 0,
          disp: false,
          alpha: 255,
          color: 0xffffffff,
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
          rotation: 0,
          rotationX: 0,
          rotationY: 0,
          vramX: 0,
          vramY: 0,
          vramZ: 0,
        };
        initializeFESString(child, world);
        graph.register(child);
        objects.push(child);
        instance.byKey.set(child.key, child);
        child.nativeTaskID = await world.objects.create({
          kind: spec.nativeType === 37 ? 63 : 48,
          parent: instance.runtimeID,
          creator: instance.runtimeID,
          name: spec.name,
        });
        world.text.fes.state(child);
        return child;
      },
    }),
    model = new FESLogModel(object, world.displayLogs, service);
  let sourceHandle = saved ? object.logHandle : 0;
  if (!saved) {
    Object.assign(world.configuration.fields.log, {
      col: 16,
      prof: 0,
      dispName: 0,
      nameline: 0,
      nameindent: 0,
    });
    const handle = world.displayLogs.create(world.main.id),
      source = world.displayLogs.get(handle);
    sourceHandle = handle;
    for (let i = 0; i < 6; i++)
      append(world.displayLogs, source, String.fromCharCode(65 + i), i, { voice: i % 2 !== 0 });
    model.setCount(3);
    model.setSize(24, 16);
    if (!omitPriority) await model.setPriority(60000);
    await model.allocate();
    for (let i = 0; i < 3; i++) await model.setDisplayPosition(i, 2, i * 18);
    if (initialBind) model.bind(handle);
    if (initialBind && initialPosition) await model.position(0);
    await model.layout('size', [4]);
    await model.layout('shadow', [0]);
  }
  const children = () => objects.filter((o) => o.nativeType === 21 || o.nativeType === 37);
  let closed = false;
  return {
    world,
    runtime,
    object,
    sourceHandle,
    model,
    service,
    graph,
    instance,
    children,
    async frame(frame) {
      await model.drive();
      for (const child of children()) {
        const record = world.objects.objects.get(child.nativeTaskID);
        record.effectiveFrame = frame;
        await world.text.fes.drive(instance, child);
        await world.graphics.get(child.nativeTaskID).tick();
      }
    },
    snapshot() {
      return {
        world: world.snapshot(),
        graph: graph.snapshot(),
        objects: structuredClone(objects),
      };
    },
    async frames() {
      return Promise.all(
        children().map(async (child) => ({
          handle: child.handle,
          x: child.x,
          y: child.y,
          state: structuredClone(child.nativeTextState),
          task: structuredClone(world.graphics.get(child.nativeTaskID).text),
          rgba: (await world.graphics.get(child.nativeTaskID).writer()).frame().rgba.slice(),
        })),
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      await world.close({ flushFiles: false });
    },
  };
}
