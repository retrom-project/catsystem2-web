// Test integration only: real JS World, D6 task receivers/bitmaps/caches.
import assert from 'node:assert/strict';
import { dataWorld } from './data-world.mjs';
import { ScreenVectorGPU } from './screen-effects-fixture.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { copyFESBitmapRectangle } from '../../src/native/fes-bitmap.mjs';
import { FESEffectModel } from '../../src/native/fes-effect-model.mjs';

const lengths = new Map([
  [274, 14],
  [275, 11],
  [276, 12],
  [384, 3],
  [387, 5],
  [516, 5],
  [519, 6],
]);
export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
export async function makeWorld(profile, initialize = true) {
  const world = await dataWorld(profile, {}, { initialize: false });
  Object.assign(world.configuration.screen, {
    width: 8,
    height: 6,
    currentWidth: 8,
    currentHeight: 6,
    virtualWidth: 8,
    virtualHeight: 6,
  });
  world.graphics.view.clientWidth = 8;
  world.graphics.view.clientHeight = 6;
  world.graphics.view.virtualWidth = 8;
  world.graphics.view.virtualHeight = 6;
  world.graphics.view.drawingRectangle = [0, 0, 8, 6];
  world.stageRenderer.gpu = new ScreenVectorGPU(8, 6);
  if (initialize) await world.initialize('case.kcs');
  assert.ok(!world.nativeEngine, 'independent JS fixture has no loaded EXE');
  return world;
}
export async function fillBitmap(world, handle, color) {
  const image = world.graphics.images.get(handle),
    data = await image.pixels();
  for (let at = 0; at < data.length; at += 4) data.set(color, at);
  await image.changed();
}
export async function makeDraw(world) {
  const id = await world.objects.create({ kind: 15, parent: world.main.id, name: 'FES surface' });
  await world.sendEngine(id, world.main.id, 279, 16, 12);
  await world.sendEngine(id, world.main.id, 283, 1, 1);
  await world.graphics.ensureVRAM(8, 6);
  return id;
}
export function harness(world, { drawId = 0, planes = new Map(), mask = 0 } = {}) {
  const events = [],
    packets = [],
    identities = new Map();
  const state = { busy: true, nextIdentity: 1, color: [160, 20, 40, 255], drawId, mask };
  const api = {
    packet(words) {
      const packet = new NativeGraphicsPacket(words);
      packets.push(packet);
      return packet;
    },
    async createObject(spec) {
      const id = `fx${state.nextIdentity++}`;
      identities.set(id, structuredClone(spec));
      events.push(['object', id, spec]);
      return id;
    },
    objectExists(name) {
      return [...identities.values()].some((object) => object.name === name);
    },
    async addDummyMotion(effect, motion) {
      events.push(['dummy', effect.identity, motion]);
    },
    async queueWipeRecord(effect, record) {
      events.push(['wipeRecord', effect.identity, record]);
    },
    busy() {
      return state.busy;
    },
    clearMotion(effect) {
      events.push(['clearMotion', effect.identity]);
    },
    plane(id) {
      return planes.get(id);
    },
    drawing() {
      const draw = world.graphics.drawTasks.get(state.drawId);
      return (
        draw && {
          taskId: state.drawId,
          bitmap: draw.state.renderer?.bitmap,
          offset: draw.state.offset,
        }
      );
    },
    async loadMask(name) {
      events.push(['mask', name]);
      if (!state.mask) return 0;
      assert.equal(world.graphics.images.get(state.mask).state.bpp, 4);
      return world.graphics.images.alias(state.mask, world.main.id);
    },
    async snapshotBitmap(handle, rectangle) {
      events.push(['snapshot', ...rectangle]);
      return copyFESBitmapRectangle(world.graphics.images, handle, rectangle, world.main.id);
    },
    releaseBitmap: (handle) => world.graphics.images.release(handle),
    requireBitmap: (handle) => world.graphics.images.get(handle),
    async createTask(kind, name) {
      events.push(['task', kind, name]);
      return world.objects.create({ kind, name, parent: world.main.id });
    },
    rebindTask(id, kind) {
      assert.equal(world.objects.objects.get(id)?.kind, kind);
    },
    async send(taskId, message, l = 0, payload = null) {
      const count = lengths.get(message);
      events.push([
        'message',
        message,
        l,
        taskId,
        count ? Array.from({ length: count }, (_, i) => payload.load(i * 4)) : null,
        payload,
      ]);
      return world.sendEngine(taskId, world.main.id, message, 0, l, payload ? { payload } : {});
    },
    deleteObject(identity) {
      events.push(['delete', identity]);
      identities.delete(identity);
    },
    hasView: () => world.graphics.view.active,
    prepareCaptures(count) {
      events.push(['prepare', count]);
      return world.screenEffects.rendering.prepare(count);
    },
    async capture(index, minimum, maximum) {
      events.push(['capture', index, minimum, maximum]);
      const rendering = world.screenEffects.rendering;
      rendering.frame = {
        items: [
          { priority: 1, color: [255, 0, 0, 255] },
          { priority: 10, color: state.color },
          { priority: 20, color: [0, 0, 255, 255] },
        ],
        draw: async (item, gpu) => {
          const [r, g, b, a] = item.color;
          gpu.clear({ flags: 1, color: ((a << 24) | (r << 16) | (g << 8) | b) >>> 0 });
        },
      };
      try {
        return await rendering.capture(index, minimum, maximum);
      } finally {
        rendering.frame = null;
      }
    },
    notify(name) {
      events.push(['notify', name]);
    },
    maskOutputs(sleep) {
      events.push(['maskOutputs', sleep]);
    },
    async flushDraw() {
      events.push(['flush']);
      if (state.drawId) await world.sendEngine(state.drawId, world.main.id, 292);
    },
  };
  return { model: new FESEffectModel(api), api, events, state, packets, identities, planes };
}
export const messages = (events) => events.filter((event) => event[0] === 'message');
