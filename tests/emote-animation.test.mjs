// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EmoteDocument } from '../src/emote/document.mjs';
import { EmoteAnimation } from '../src/emote/animation.mjs';
import { floatBits } from '../src/kcs.mjs';
import { emoteControllerCases, emoteControllerModel } from './fixtures/emote-controller-cases.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/emote-controller-golden.json', import.meta.url)),
);
const cases = emoteControllerCases();
import { apply } from './fixtures/emote-js-steps.mjs';

test('all authored controller sequences match the original DLL float bits and integer states', async () => {
  for (const [index, input] of cases.entries()) {
    const model = emoteControllerModel(input.category, input.settings),
      expected = golden.cases[index];
    assert.equal(input.name, expected.name);
    assert.equal(createHash('sha256').update(model).digest('hex'), expected.modelSHA256);
    const animation = new EmoteAnimation(await EmoteDocument.open(model));
    assert.deepEqual(animation.variables(), expected.variables);
    for (const [i, step] of input.steps.entries()) {
      apply(animation, step);
      for (const [name, value] of expected.frames[i].variables)
        assert.equal(
          floatBits(animation.variable(name)),
          value,
          `${input.name} frame ${i} variable ${name}`,
        );
      if (step.observeRoot)
        assert.deepEqual(
          {
            position: Array.from(animation.root.position.value, floatBits),
            scale: floatBits(animation.root.scale.value[0]),
            angle: floatBits(animation.angle()),
            color: animation.color(),
          },
          expected.frames[i].root,
          `${input.name} frame ${i} root`,
        );
    }
  }
});

test('fresh JS controller restore retains queues, graphs, RNG, springs, wind and timeline cursors', async () => {
  for (const input of cases) {
    const document = await EmoteDocument.open(emoteControllerModel(input.category, input.settings)),
      animation = new EmoteAnimation(document),
      split = Math.ceil(input.steps.length / 2);
    for (const step of input.steps.slice(0, split)) apply(animation, step);
    const saved = animation.snapshot(),
      frozen = structuredClone(saved),
      copy = new EmoteAnimation(document);
    copy.restore(saved);
    const outputBuffer = copy.root.position.value;
    for (const step of input.steps.slice(split)) {
      apply(animation, step);
      apply(copy, step);
      assert.deepEqual(copy.snapshot(), animation.snapshot(), input.name);
      assert.equal(copy.root.position.value, outputBuffer);
    }
    assert.deepEqual(saved, frozen);
  }
});

test('out-of-range float32 inputs fail before wrapping or frame slicing can stop making progress', async () => {
  const animation = new EmoteAnimation(await EmoteDocument.open(emoteControllerModel('root')));
  assert.throws(() => animation.setRoot('angle', 1e30), /cannot wrap/);
  assert.throws(() => animation.update(1e30), /cannot progress/);
  assert.throws(() => animation.update(Infinity), /must be finite/);
  const looping = new EmoteAnimation(
    await EmoteDocument.open(emoteControllerModel('timeline', { loop: true })),
  );
  looping.timelines.play('timeline', 2);
  assert.throws(() => looping.update(1e30), /cannot progress/);
});
