// SPDX-License-Identifier: MPL-2.0
// Browser-safe authored World boundary. Importing this module runs no workload.
import { NativeWorld } from '../../../src/native/world.mjs';
import { NativeConfiguration } from '../../../src/native/config.mjs';
import { MotionLibrary } from '../../../src/motion/library.mjs';
import { ParticleRandom } from '../../../src/ppi/random.mjs';
import { NativeGraphicsPacket } from '../../../src/native/graphics-task.mjs';

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
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
export async function makeDefaultWorld(data, initialize) {
  const files = Object.fromEntries(
    Object.entries(data.files).map(([name, bytes]) => [name, Uint8Array.from(bytes)]),
  );
  const game = {
    width: 128,
    height: 96,
    index: new Map(Object.keys(files).map((name) => [name, {}])),
    has: (name) => Object.hasOwn(files, name.toLowerCase()),
    names: (ext) => Object.keys(files).filter((name) => name.endsWith('.' + ext)),
    read: async (name) => files[name.toLowerCase()] ?? null,
    require: async (name) => {
      const bytes = files[name.toLowerCase()];
      if (!bytes) throw new Error('Missing authored file ' + name);
      return bytes;
    },
  };
  game.resolveCategory = (name, category) => {
    const virtual = /^@cat\/([^/]+)\/(.*)$/.exec(name);
    if (virtual) [, category, name] = virtual;
    const ext = {
      image: ['hg3', 'hg2'],
      fes: ['fes'],
      scene: ['cst'],
      config: ['cnf'],
      mot: ['kcs'],
      ptcl: ['kcs'],
      ptclpi: ['ppi'],
      m2psb: ['psb'],
    };
    return (
      [
        name,
        ...(ext[category] ?? []).flatMap((x) => [name + '.' + x, category + '/' + name + '.' + x]),
      ].find((n) => game.has(n)) ?? null
    );
  };
  game.readCategory = (name, category) => {
    const file = game.resolveCategory(name, category);
    return file === null ? null : game.read(file);
  };
  game.requireCategory = async (name, category) => {
    const bytes = await game.readCategory(name, category);
    if (bytes === null) throw new Error('Missing authored category ' + name);
    return bytes;
  };
  const random = new ParticleRandom();
  const world = new NativeWorld({
    profile: data.profile,
    game,
    random,
    host: { nativeTextGlyphs: () => glyphs },
    images: {},
    configuration: new NativeConfiguration({ profile: data.profile }),
    motionLibrary: new MotionLibrary(game, { profile: data.profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
  world.ensureNativeEngine = () => {
    throw new Error('Authored World requested original engine');
  };
  world.stageRenderer.attach({ canvas: { width: data.canvas[0], height: data.canvas[1] } });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function loadDefaultEffect(world) {
  const owner = world.main.id,
    parent = world.objects.objects.get(owner);
  const id = await world.objects.create({ kind: 34, parent: owner });
  const surface = await world.objects.create({ kind: 15, parent: owner });
  const fes = world.objects.objects.get(id).implementation;
  await world.sendEngine(surface, owner, 279, 128, 96);
  await world.sendEngine(surface, owner, 283);
  world.runtime.variableBank(parent).initialize(64);
  world.runtime.stringBank(parent);
  await fes.initialize(parent.context.variableBank);
  await world.sendEngine(id, owner, 334, 0, world.nativeTaskID(surface));
  check(await fes.loadSource('screen'), 'Default FES source load failed');
  await world.withExecutor(world.effekseer.frameExecutor, (executorEntry) =>
    world.sendEngine(id, owner, 333, 0, 0, { executorEntry }),
  );
  const records = [...world.objects.objects.values()].filter((r) => r.kind === 61);
  check(records.length === 1 && records[0].parent === id, 'FES did not own exactly one kind61');
  return { sender: id, task: records[0].implementation };
}
export function floatPacket(values, words = false) {
  const packet = new NativeGraphicsPacket();
  const data = words ? values : new Uint32Array(Float32Array.from(values).buffer);
  data.forEach((value, index) => packet.store(index * 4, value));
  return packet;
}
