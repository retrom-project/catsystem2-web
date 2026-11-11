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
function apply(animation, step) {
  if (step.root) {
    const r = step.root;
    if (r.position) animation.setRoot('position', r.position, r.frames, r.easing);
    if (r.scale != null) animation.setRoot('scale', [r.scale], r.frames, r.easing);
    if (r.angle != null) animation.setRoot('angle', r.angle, r.frames, r.easing);
    if (r.color != null) animation.setColor(r.color, r.frames, r.easing);
  }
  if (step.wind) animation.setWind(step.wind);
  if (step.timeline) {
    const t = step.timeline;
    if (t.action === 'play') animation.timelines.play(t.label, t.flags);
    else animation.timelines.stop(t.label);
  }
  for (const v of step.variables ?? []) animation.setVariable(v.name, v.value, v.frames, v.easing);
  animation.update(step.elapsed);
}

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
