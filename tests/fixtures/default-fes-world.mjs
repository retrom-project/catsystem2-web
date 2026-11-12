// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { flipBitmapRows } from '../../src/native/raster-kernel.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const glyphs = {
  measure: (_font, text) => ({
    width: text.length * 4,
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
export async function defaultFESWorld(profile, files = {}, options = {}) {
  const world = await dataWorld(profile, files, { glyphs, ...options });
  world.game.width = world.graphics.stage.width = 128;
  world.game.height = world.graphics.stage.height = 96;
  world.game.resolveCategory = (name, category) => {
    const virtual = /^@cat\/([^/]+)\/(.*)$/.exec(name);
    if (virtual) [, category, name] = virtual;
    const extensions = {
      image: ['hg3', 'hg2'],
      fes: ['fes'],
      scene: ['cst'],
      config: ['cnf'],
      mot: ['kcs'],
      ptcl: ['kcs'],
      ptclpi: ['ppi'],
      m2psb: ['psb'],
    };
    const candidates = [
      name,
      ...(extensions[category] ?? []).flatMap((ext) => [
        `${name}.${ext}`,
        `${category}/${name}.${ext}`,
      ]),
    ];
    return candidates.find((file) => world.game.has(file)) ?? null;
  };
  world.game.readCategory = (name, category) => {
    const file = world.game.resolveCategory(name, category);
    return file === null ? null : world.game.read(file);
  };
  world.game.requireCategory = async (name, category) => {
    const result = await world.game.readCategory(name, category);
    if (result === null) throw new Error(`Missing ${category} fixture ${name}`);
    return result;
  };
  return world;
}
export async function loadDefaultFES(world, name = 'screen') {
  const owner = world.main.id,
    parent = world.objects.objects.get(owner),
    id = await world.objects.create({ kind: 34, parent: owner }),
    surface = await world.objects.create({ kind: 15, parent: owner }),
    task = world.objects.objects.get(id).implementation;
  await world.sendEngine(surface, owner, 279, 128, 96);
  await world.sendEngine(surface, owner, 283);
  world.runtime.variableBank(parent).initialize(64);
  world.runtime.stringBank(parent);
  await task.initialize(parent.context.variableBank);
  await world.sendEngine(id, owner, 334, 0, surface);
  if (!(await task.loadSource(name)))
    throw new Error('FES fixture failed its ordinary source message');
  return {
    id,
    task,
    instance: task.player.root,
    surface,
    draw: world.graphics.drawTasks.get(surface),
  };
}
export async function drawPixels(world, surface) {
  const draw = world.graphics.drawTasks.get(surface);
  await draw.render();
  return flipBitmapRows(
    await world.graphics.images.get(draw.state.renderer.bitmap).pixels(),
    draw.state.renderer.width,
    draw.state.renderer.height,
  );
}
