// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { NativeSoundPacket } from '../src/native/sound.mjs';
import { floatBits } from '../src/kcs/vm.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import { emoteM2Cases } from './fixtures/emote-m2-sequences.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/emote-m2-golden.json', import.meta.url)),
);
async function make(input, saved = new Map()) {
  const game = memoryGame({ ...input.files, 'main.kcs': kcsProgram([[59]]) }),
    random = new ParticleRandom(),
    profile = 'nekopara-vol3-engine-2.6.1.76',
    configuration = new NativeConfiguration({ profile });
  game.width = game.height = 64;
  game.resolveCategory = (name, category) =>
    category === 'image'
      ? null
      : category === 'm2psb'
        ? name + '.psb'
        : category === 'fes'
          ? name + '.fes'
          : name;
  game.readCategory = (name, category) => game.read(game.resolveCategory(name, category));
  game.requireCategory = (name, category) => game.require(game.resolveCategory(name, category));
  for (const key of [
    'width',
    'height',
    'currentWidth',
    'currentHeight',
    'virtualWidth',
    'virtualHeight',
  ])
    configuration.setField('screen.' + key, 64);
  const world = new NativeWorld({
    game,
    configuration,
    profile,
    random,
    images: {},
    host: {},
    motionLibrary: new MotionLibrary(game, { random, profile }),
    storage: {
      read: async (name) => saved.get(name) ?? null,
      write: async (name, bytes) => {
        saved.set(name, bytes.slice());
        return true;
      },
      stat: async () => null,
      remove: async () => true,
    },
  });
  return world;
}

for (const input of emoteM2Cases())
  test(`JS M2 task ${input.name}: native results, message writes and draw packets match oracle`, async () => {
    const world = await make(input);
    try {
      await world.initialize('main.kcs');
      const id = await world.objects.create({ kind: 54, parent: world.root }),
        task = world.graphics.get(id),
        machine = world.main.machine,
        native = (id, args) => world.runtime.native('main', id, args, machine, world.main),
        load = async (program) => {
          machine.writeString(program, 128);
          await native(906, [id, 128, 1]);
        };
      let index = 0;
      if (input.audio) {
        const sound = world.sound.primary(world.root),
          original = sound.message.bind(sound),
          bytes = input.audio.bytes ? new Uint8Array(input.audio.bytes) : null,
          handle = bytes ? world.runtime.handles.add('sound-sidecar', bytes) : 0;
        sound.message = (words, context = {}) => {
          const [, message, , l] = words,
            memory = context.payload;
          if (message === 185) return Number(index < (input.audio.end ?? 1000));
          if (message === 219) return index;
          if (message === 220 || message === 221) {
            const selected = input.audio.kind === (message === 220 ? 'lpb' : 'lv');
            memory.store(l, selected ? handle : 0);
            memory.store(l + 4, selected ? bytes.length : 0);
            return 0;
          }
          if (message === 213) {
            const destination = memory.load(l),
              count = memory.load(l + 4),
              levels = input.audio.levels?.[index] ?? Array(80).fill(100);
            if (destination)
              for (let i = 0; i < Math.min(levels.length, count); i++)
                memory.store(destination + i * 4, levels[i]);
            return levels.length;
          }
          return original(words, context);
        };
      }
      await load(input.programs[0]);
      await native(907, [id, 1]);
      if (input.audio) await native(924, [id, 1, 0]);
      await task.message([world.main.id, 47, 0, 1]);
      for (const [i, row] of golden.cases
        .find((entry) => entry.name === input.name)
        .rows.entries()) {
        index = i;
        if (i === input.initialFrames) await load(input.programs[1]);
        let inlineDraws = [];
        for (const op of input.operations.filter((entry) => entry.index === i)) {
          const packet = new NativeSoundPacket([
            0,
            ...(op.floats?.map(floatBits) ?? op.words ?? []),
          ]);
          if (op.text !== undefined) packet.writeString(op.text, 4);
          await task.message([world.main.id, op.message, op.w ?? 0, op.l ?? 4], {
            payload: packet,
          });
          if (op.message === 524 && task.oldModel) inlineDraws = task.oldModel.geometry.commands;
        }
        const busy = await native(909, [id]);
        assert.deepEqual(busy, row.busy, input.name + '/busy/' + i);
        assert.deepEqual(
          await native(1028, [id, 128]),
          row.actionBusy,
          input.name + '/actionBusy/' + i,
        );
        await native(926, [id, 640]);
        await native(910, [id, 0, 700, 704, 708]);
        assert.equal(machine.string(640), row.body);
        assert.deepEqual(
          [700, 704, 708].map((at) => machine.load(at)),
          row.attribute,
        );
        await world.tick();
        if (row.draws.length)
          assert.deepEqual(
            [...inlineDraws, ...task.model.geometry.commands].map((c) =>
              Buffer.from(c.bytes).toString('hex'),
            ),
            row.draws.map((c) => c.bytes),
            input.name + '/draw/' + i,
          );
      }
      assert.equal(world.nativeEngine, undefined);
      if (input.audio) return; // Sound doubles are not checkpoint state; the pure model test restores their sampled controller state.
      const fresh = await make(input);
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await world.tick();
        await fresh.tick();
        assert.deepEqual(fresh.graphics.get(id).snapshot(), task.snapshot());
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

test('M2 settings use the captured XML shape and round-trip JS preferences', async () => {
  const input = emoteM2Cases().find((i) => i.name === 'curves'),
    saved = new Map(),
    first = await make(input, saved);
  try {
    await first.initialize('main.kcs');
    await first.m2.saveSettings();
    const expected = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<document>',
      '  <aa>',
      '    <eff_to_fade>0</eff_to_fade>',
      '    <eff>',
      '      <lip>1</lip>',
      '      <blink>1</blink>',
      '      <inertia>1</inertia>',
      '      <dif>1</dif>',
      '    </eff>',
      '    <motion>1</motion>',
      '  </aa>',
      '  <interleaving>0</interleaving>',
      '</document>',
      '',
    ].join('\r\n');
    // Frozen independently by original native923 through the existing task oracle.
    assert.equal(new TextDecoder().decode(saved.get('m2setting.xml')), expected);
    first.m2.configuration.set('eff_blink', 0);
    first.m2.configuration.set('interleave', 3);
    await first.m2.saveSettings();
    const second = await make(input, saved);
    try {
      await second.initialize('main.kcs');
      assert.equal(second.fesConfiguration.getM2('eff_blink'), 0);
      assert.equal(second.fesConfiguration.getM2('interleave'), 3);
      assert.deepEqual(second.m2.snapshot(), first.m2.snapshot());
    } finally {
      await second.close({ flushFiles: false });
    }
  } finally {
    await first.close({ flushFiles: false });
  }
});

test('JS M2PLANE binds common motion and owns model commands without a guest record', async () => {
  const source =
      '#DEFINE\nM2PLANE actor\n#OBJECT FILE POS PRI DISP COLOR\nactor aa01,1,1,1,1,1,1:0 3,4 50000 1 123\n#START\nnext WAIT\n#WAIT\n',
    input = emoteM2Cases().find((i) => i.name === 'curves'),
    world = await make({
      ...input,
      files: { ...input.files, 'panel.fes': new TextEncoder().encode(source) },
    });
  try {
    await world.initialize('main.kcs');
    const player = new FESPlayer(world.game, world.images);
    player.nativeM2 = world.m2FES;
    await player.start('panel');
    player.root.runtimeID = world.root;
    const object = player.root.byKey.get('actor');
    await world.m2FES.update(player.root, object);
    const task = world.graphics.get(object.nativeTaskID);
    assert.deepEqual(task.m2.position, [3, 4]);
    assert.equal(task.m2.color, 0xffffffff);
    assert.equal(task.m2.effectsOverride, 123);
    assert.equal(object.nativeObjectPointer, undefined);
    for (const verb of [
      'play',
      'time',
      'm2eff',
      'm2fspeed',
      'm2prmscale',
      'm2draw',
      'm2enable_blink',
      'm2enable_lip',
    ])
      assert.equal(await world.m2FES.command(player.root, object, verb, ['0']), 0);
    await world.m2FES.command(player.root, object, 'm2body', ['base']);
    await world.m2FES.command(player.root, object, 'color', ['-1']);
    await world.m2FES.update(player.root, object);
    assert.equal(task.model.body, 'base');
    await world.m2FES.command(player.root, object, 'load', [input.programs[1]]);
    await world.m2FES.update(player.root, object);
    assert.equal(task.program, input.programs[1]);
    await world.m2FES.close(object);
    await world.tick();
    assert.equal(world.m2.tasks.size, 0);
    assert.equal(world.m2.documents.size, 0);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('shared M2 documents survive sibling release and an active cache refresh', async () => {
  const world = await make(emoteM2Cases().find((entry) => entry.name === 'curves'));
  try {
    await world.initialize('main.kcs');
    const tasks = [];
    for (let i = 0; i < 3; i++) {
      const id = await world.objects.create({ kind: 54, parent: world.root });
      tasks.push(world.graphics.get(id));
    }
    const program = 'aa01,1,1,1,1,1,1:0';
    await tasks[0].load(program);
    await tasks[1].load(program);
    assert.equal(tasks[0].model.document, tasks[1].model.document);
    tasks[0].unloadModel();
    assert.equal(world.m2.documents.size, 1);
    await world.m2.command(932);
    await tasks[2].load(program);
    assert.notEqual(tasks[1].model.document, tasks[2].model.document);
    tasks[1].unloadModel();
    assert.equal(world.m2.documents.size, 1);
    assert.equal(await world.m2.document('authored'), tasks[2].model.document);
    tasks[2].unloadModel();
    assert.equal(world.m2.documents.size, 0);
  } finally {
    await world.close({ flushFiles: false });
  }
});
