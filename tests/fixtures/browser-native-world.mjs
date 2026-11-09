// SPDX-License-Identifier: MPL-2.0
// Authored browser client with a real GPU and an actual mounted fixed engine.
import { NativeWorld } from '../../web/transitional-entry.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { StageRenderer } from '../../src/render/stage.mjs';
import { ImageStore } from '../../src/formats/hg3.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';

export function browserNativeWorld({ profile, files, width = 64, height = 48, storage }) {
  const names = [...files.keys()],
    canvas = new OffscreenCanvas(width, height),
    stageRenderer = new StageRenderer({
      canvas,
      ctx: canvas.getContext('2d'),
      begin() {
        this.ctx.reset();
      },
    }),
    game = {
      width,
      height,
      index: new Map(names.map((n) => [n, {}])),
      names: (ext) => names.filter((n) => n.endsWith('.' + ext)),
      has: (name) => files.has(name.toLowerCase()),
      read: async (name) => files.get(name.toLowerCase()) ?? null,
      async require(name) {
        const bytes = await this.read(name);
        if (bytes === null) throw new Error('Missing ' + name);
        return bytes;
      },
      resolveCategory(name, category) {
        name = name.replaceAll('\\', '/').toLowerCase();
        if (name.startsWith('@cat/')) name = name.split('/').slice(2).join('/');
        const ext = { mot: 'kcs', fes: 'fes', kcs: 'kcs', image: 'hg2' }[category];
        return files.has(name)
          ? name
          : ext && files.has(name + '.' + ext)
            ? name + '.' + ext
            : null;
      },
      async readCategory(name, category) {
        const path = this.resolveCategory(name, category);
        return path === null ? null : this.read(path);
      },
      async requireCategory(name, category) {
        const bytes = await this.readCategory(name, category);
        if (bytes === null) throw new Error('Missing ' + category + ' ' + name);
        return bytes;
      },
    },
    random = new ParticleRandom(),
    configuration = new NativeConfiguration({ profile });
  Object.assign(configuration.screen, {
    width,
    height,
    currentWidth: width,
    currentHeight: height,
    virtualWidth: width,
    virtualHeight: height,
  });
  const world = new NativeWorld({
    game,
    profile,
    images: new ImageStore(game),
    host: {},
    configuration,
    random,
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage,
  });
  world.stageRenderer = stageRenderer;
  return world;
}

export async function placeBrowserNativePlane(
  world,
  id,
  { width, height, color, position = [0, 0, 0], priority = 0, scale = [1, 1, 1] },
) {
  const send = (message, words) =>
    world.sendEngine(id, world.main.id, message, 0, 0, {
      payload: new NativeGraphicsPacket(words),
    });
  await send(color === undefined ? 41 : 42, [
    0,
    0,
    0,
    floatBits(width),
    floatBits(height),
    32,
    1,
    color ?? 0xffffffff,
  ]);
  await send(49, [0, 0, floatBits(priority)]);
  await send(51, position.map(floatBits));
  await send(66, scale.map(floatBits));
  await world.sendEngine(id, world.main.id, 48, 0, 1);
}

const check = (condition, message) => {
  if (!condition) throw new Error(message || 'Original task assertion failed');
};
const equal = (a, b) =>
  ArrayBuffer.isView(a) && ArrayBuffer.isView(b)
    ? a.length === b.length && a.every((n, i) => n === b[i])
    : JSON.stringify(a) === JSON.stringify(b);
export const browserAssert = {
  ok: check,
  equal: (a, b, message) => check(a === b, message ?? `${a} differs from ${b}`),
  deepEqual: (a, b, message) =>
    check(equal(a, b), message ?? `${JSON.stringify(a)} differs from ${JSON.stringify(b)}`),
  notDeepEqual: (a, b, message) => check(!equal(a, b), message ?? 'Task state stayed equal'),
};
