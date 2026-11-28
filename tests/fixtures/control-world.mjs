// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { controlFiles } from './control-files.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../../src/native/engine-message.mjs';
import { installJSControlTasks } from '../../src/native/control-task-js.mjs';
import { extraControlFiles } from './control-extra-files.mjs';

export async function controlWorld(
  profile,
  { initialize = true, resources = true, extra = false } = {},
) {
  const files = resources ? await controlFiles(new Uint8Array()) : {};
  if (resources && extra) Object.assign(files, await extraControlFiles());
  delete files['engine.exe'];
  const world = await dataWorld(profile, files, { initialize: false });
  world.game.width = 128;
  world.game.height = 96;
  world.game.resolveCategory = (name, category) => {
    const file = name.includes('.') ? name : `${name}.${category === 'image' ? 'hg2' : category}`;
    return world.game.has(file) ? file : null;
  };
  world.game.readCategory = async (name, category) => {
    const file = world.game.resolveCategory(name, category);
    return file === null ? null : world.game.read(file);
  };
  Object.assign(world.configuration.screen, {
    width: 128,
    height: 96,
    currentWidth: 128,
    currentHeight: 96,
    virtualWidth: 128,
    virtualHeight: 96,
  });
  installJSControlTasks(world);
  world.objects.register(1000, (record) => {
    const base = world.base(record);
    let events = [];
    return {
      events: () => events,
      async message(words, context) {
        if (words[1] === 27 || words[1] === 28) {
          events.push({
            sender: context.nativeSenderWorldID,
            message: words[1],
            value: words[3] | 0,
          });
          return NATIVE_UNWRITTEN_WORD;
        }
        return base.message(words, context);
      },
      snapshot: () => ({ events: structuredClone(events) }),
      restore: (state) => {
        events = structuredClone(state.events);
      },
    };
  });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function setupControl(world, kind, { file, nativeID = 111, extra = false } = {}) {
  const parent = await world.objects.create({
    kind: 1000,
    parent: world.main.id,
    name: 'control receiver',
  });
  const surface = await world.objects.create({
    kind: 15,
    parent: world.main.id,
    name: 'control surface',
  });
  await world.sendEngine(surface, world.main.id, 279, 128, 96);
  await world.sendEngine(surface, world.main.id, 283, 0, 0);
  const id = await world.objects.create({ kind, parent, name: 'authored control', nativeID });
  const task = world.objects.objects.get(id).implementation;
  const packet = controlLoad(world, surface, kind, file, extra);
  await world.sendEngine(id, world.main.id, kind === 40 ? 353 : kind === 41 ? 368 : 359, 0, 0, {
    payload: packet,
  });
  const range = new NativeGraphicsPacket([0, 100, kind === 42 ? 0 : 20]);
  await world.sendEngine(id, world.main.id, kind === 40 ? 356 : kind === 41 ? 370 : 362, 0, 0, {
    payload: range,
  });
  await world.sendEngine(
    id,
    world.main.id,
    kind === 40 ? 357 : kind === 41 ? 371 : 363,
    0,
    kind === 40 ? 10 : kind === 41 ? 30 : 25,
  );
  return { id, task, parent, surface, draw: world.graphics.drawTasks.get(surface) };
}
export function controlLoad(
  world,
  surface,
  kind,
  file = kind === 40 ? 'scroll.hg2' : 'controls.hg2',
  extra = false,
) {
  const packet = new NativeGraphicsPacket(new Array(73).fill(0));
  if (kind === 40) {
    packet.store(0, extra ? 1 : 0);
    packet.store(4, world.nativeTaskID(surface));
    packet.data.set(encodeCP932(file), 8);
    [0, 0, 4, 4, 102, 1003].forEach((value, i) => packet.store(268 + i * 4, value));
  } else {
    packet.store(0, world.nativeTaskID(surface));
    packet.data.set(encodeCP932(file), 4);
    const fields =
      kind === 42
        ? [100, 16, 12, 88, 24, 2, 3]
        : extra
          ? [101, 40, 16, 72, 24, 0, 0]
          : [101, 104, 12, 116, 76, 0, 0];
    fields.forEach((value, i) => packet.store(264 + i * 4, value));
  }
  return packet;
}
