// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  encode = (text) => new TextEncoder().encode(text),
  loaded = (at) => [0x13, at],
  call = (id, ...args) => [...args.map((word) => [37, word]), [43, id, args.length * 4]],
  resources = encode(
    '<?xml version="1.0" encoding="Shift_JIS"?><document><INT><int00><name>ptcl</name><int>ptcl.int</int><ext>kcs</ext></int00><int01><name>mot</name><int>mot.int</int><ext>kcs</ext></int01></INT></document>',
  );

async function frame(world) {
  const updated = await world.resumeHostFrameWait(world.beginHostFrameWait());
  if (updated) world.completeHostFrame();
  return updated;
}

test('one paced dispatch advances the actual FES and MOT consumers once at their absolute Frame', async () => {
  let timer = 0;
  const files = {
      'screen.fes': encode(
        `#DEFINE\nCPLANE panel\n#OBJECT SIZE COLOR DISP PRI\npanel 4,4 0xff123456 1 60000\n#SUBCOMMAND\ncontinue custom held : 0\n#START\npanel custom\nnext IDLE\n#IDLE\n$5++\n`,
      ),
      'held.kcs': kcsProgram([[37, 128], [43, 0, 4], [59]], [[128, 'one MOT dispatch']]),
    },
    world = await defaultFESWorld(profile, files, { frameSource: { now: () => timer } });
  let fresh;
  try {
    const fes = await loadDefaultFES(world);
    timer = 17;
    await frame(world);
    assert.equal(fes.task.player.frameCount, 1);
    const panel = fes.instance.byKey.get('panel'),
      target = fes.instance.runtime.targetFor(panel, false),
      motion = [...target.manager.records.values()][0];
    assert.equal(motion.instance.messages.length, 0);
    timer = 100;
    await frame(world);
    assert.equal(world.frame, 6);
    assert.equal(fes.task.player.frameCount, 2);
    assert.equal(motion.startTick, 6);
    assert.deepEqual(
      motion.instance.messages.map(({ frame }) => frame),
      [0],
    );
    timer = 108;
    assert.equal(await frame(world), false);
    assert.equal(fes.task.player.frameCount, 2);
    assert.equal(motion.instance.messages.length, 1);
    timer = 117;
    await frame(world);
    assert.equal(fes.task.player.frameCount, 3);
    assert.deepEqual(
      motion.instance.messages.map(({ frame }) => frame),
      [0, 1],
    );
    let coldTimer = 1000;
    const saved = structuredClone(world.snapshot());
    fresh = await defaultFESWorld(profile, files, {
      initialize: false,
      frameSource: { now: () => coldTimer },
    });
    await fresh.restore(saved);
    timer = 134;
    coldTimer = 1017;
    await frame(world);
    await frame(fresh);
    const restored = fresh.objects.objects.get(fes.id).implementation,
      restoredMotion = [
        ...restored.player.root.runtime
          .targetFor(restored.player.root.byKey.get('panel'), false)
          .manager.records.values(),
      ][0];
    assert.equal(restored.player.frameCount, fes.task.player.frameCount);
    assert.equal(restoredMotion.startTick, motion.startTick);
    assert.deepEqual(
      restoredMotion.instance.messages.map(({ frame }) => frame),
      motion.instance.messages.map(({ frame }) => frame),
    );
    assert.equal(motion.instance.messages.at(-1).frame, 2);
    assert.deepEqual(fresh.framePacer.snapshot(), world.framePacer.snapshot());
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});

test('an actual Script factory/start makes one Particle main per particle for each dispatch', async () => {
  let timer = 0;
  const main = kcsProgram(
      [
        ...call(66, 16, 3, 256),
        [38, 40],
        ...call(669, loaded(40), 320, 384, 2, 1024, 448),
        ...call(272, loaded(40)),
        ...Array.from({ length: 8 }, () => [[43, 65, 0]]).flat(),
        [59],
      ],
      [
        [256, 'Observed Particle'],
        [320, 'probe'],
        [384, ''],
        [448, 'opaque-source'],
      ],
    ),
    world = await defaultFESWorld(
      profile,
      {
        'case.kcs': main,
        'ptcl.int/probe.kcs': kcsProgram(
          [[37, 128], [43, 0, 4], [59]],
          [[128, 'one Particle main']],
        ),
      },
      { frameSource: { now: () => timer } },
    );
  try {
    world.game.nativeResources = new NativeResources(parseNativeXML(resources, 'Shift_JIS'));
    world.graphics.createLogicalDevice();
    timer = 17;
    await frame(world);
    const id = world.resolveTaskID(world.main.machine.load(40), world.main.id),
      bank = world.particles.get(id).bank;
    assert.equal(bank.instance.messages.length, 0);
    timer = 100;
    await frame(world);
    assert.equal(bank.clockStart, 6);
    assert.equal(bank.clockValue, 0);
    assert.equal(bank.instance.messages.length, 2);
    timer = 108;
    assert.equal(await frame(world), false);
    assert.equal(bank.instance.messages.length, 2);
    timer = 117;
    await frame(world);
    assert.equal(bank.clockLast, 7);
    assert.equal(bank.clockValue, bank.speed);
    assert.equal(bank.instance.messages.length, 4);
    assert.equal(bank.extraName, 'opaque-source');
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('a real STRING factory keeps draw-before-time accounting across a Frame jump', async () => {
  const fixture = JSON.parse(
      await readFile(new URL('./fixtures/native-sdk23-text9-golden.json', import.meta.url)),
    ),
    bytes = Uint8Array.from(fixture.string.configuration),
    view = new DataView(bytes.buffer),
    configure = Array.from({ length: bytes.length / 4 }, (_, i) => [
      [37, view.getUint32(i * 4, true)],
      [38, 640 + i * 4],
    ]).flat();
  let timer = 0;
  const world = await defaultFESWorld(
    profile,
    {
      'case.kcs': kcsProgram(
        [
          ...configure,
          ...call(66, 48, 3, 256),
          [38, 40],
          ...call(612, loaded(40), 640),
          ...call(614, loaded(40), 384),
          ...call(619, loaded(40), 0),
          ...Array.from({ length: 8 }, () => [[43, 65, 0]]).flat(),
          [59],
        ],
        [
          [256, 'Observed STRING'],
          [384, 'A\\wf10;BBBBBBBB'],
        ],
      ),
    },
    {
      frameSource: { now: () => timer },
      startup: parseNativeXML(
        encode(
          '<?xml version="1.0" encoding="Shift_JIS"?><document><GAME><strframe_frame>60</strframe_frame></GAME></document>',
        ),
        'Shift_JIS',
      ),
    },
  );
  try {
    world.graphics.createLogicalDevice();
    timer = 17;
    await frame(world);
    assert.equal(world.text.core.rate, 60);
    const id = world.resolveTaskID(world.main.machine.load(40), world.main.id),
      task = world.objects.objects.get(id).implementation,
      writer = await task.writer(),
      remaining = await writer.remaining(-1);
    assert(remaining > 0);
    assert.equal(task.text.elapsed, 0);
    timer = 100;
    await frame(world);
    assert.equal(task.text.elapsed, 5);
    assert.equal(task.text.lastFrame, 6);
    assert.equal(
      await writer.remaining(-1),
      remaining,
      'the elapsed jump is accumulated after the current draw',
    );
    timer = 108;
    assert.equal(await frame(world), false);
    assert.equal(task.text.elapsed, 5);
    timer = 117;
    await frame(world);
    assert.equal(task.text.elapsed, 6);
    assert.equal(task.text.lastFrame, 7);
  } finally {
    await world.close({ flushFiles: false });
  }
});
