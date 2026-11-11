// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EmoteDocument } from '../src/emote/document.mjs';
import { EmoteProfiles } from '../src/emote/profiles.mjs';
import { M2Model } from '../src/emote/m2-model.mjs';
import { emoteM2Cases } from './fixtures/emote-m2-sequences.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/emote-m2-golden.json', import.meta.url)),
);
const inputs = emoteM2Cases().filter((input) => !input.replacement);
async function modelFor(input) {
  const profiles = new EmoteProfiles(
      new Map(
        Object.entries(input.files)
          .filter(([name]) => !name.endsWith('.psb'))
          .map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]),
      ),
    ),
    document = await EmoteDocument.open(input.files['authored.psb']);
  const model = new M2Model(document, { profiles, program: input.programs[0] });
  if (input.audio?.bytes)
    model.external.lip.install(new Uint8Array(input.audio.bytes), input.audio.kind);
  return model;
}
function request(input, model, index) {
  if (index === input.initialFrames) {
    model.setProgram(input.programs[1]);
    if (input.audio?.bytes)
      model.external.lip.install(new Uint8Array(input.audio.bytes), input.audio.kind);
  }
  if (input.audio) {
    model.external.soundFrame = index;
    if (!input.audio.bytes)
      model.external.lip.feedLevels(input.audio.levels?.[index] ?? Array(80).fill(100));
    if (index >= (input.audio.end ?? 1000)) model.external.lip.stop();
  }
  for (const operation of input.operations.filter((entry) => entry.index === index)) {
    if (operation.message === 535) {
      // The reviewed PSB path does not use the image-fallback color mode.
      continue;
    }
    if (operation.message === 545) {
      model.requestFade(operation.l);
      continue;
    }
    if (operation.message === 546) continue; // Next-load effect policy has no PSB controller of its own.
    if (operation.message === 51) model.position = operation.floats.slice();
    else if (operation.message === 543) model.external.spline.start(operation.text);
    else if (operation.message === 527) model.finish();
    else if (operation.message === 526) {
      model.variables.setPlaying(operation.l);
      model.bodyVariables.setPlaying(operation.l);
    } else if (operation.message === 552) model.external.actions.finish();
    else if (operation.message === 551) model.external.actions.start(operation.text);
    else assert.fail('Unhandled authored operation ' + operation.message);
  }
}

for (const input of inputs)
  test(`M2 ${input.name}: complete model frames match every oracle vertex word`, async () => {
    const expected = golden.cases.find((entry) => entry.name === input.name),
      model = await modelFor(input);
    assert.deepEqual(
      Object.entries(input.files).map(([name, bytes]) => [
        name,
        createHash('sha256').update(bytes).digest('hex'),
      ]),
      expected.inputs,
    );
    let draws;
    for (const [i, row] of expected.rows.entries()) {
      request(input, model, i);
      const commands = model.update(row.frame).commands;
      if (row.draws.length) draws = row.draws;
      assert.equal(commands.length, draws.length);
      commands.forEach((command, index) => {
        for (const key of ['type', 'count', 'stride', 'fvf'])
          assert.equal(command[key], draws[index][key]);
        assert.equal(
          Buffer.from(command.bytes).toString('hex'),
          draws[index].bytes,
          `${input.name} frame${row.frame} command${index}`,
        );
      });
    }
  });

test('fresh M2 models resume DIF, pending automatic writes, springs and shared RNG state', async () => {
  for (const input of inputs)
    for (const offset of input.name === 'action-finish-transitions' ? [3, 5] : [3]) {
      const first = await modelFor(input),
        second = await modelFor(input),
        rows = golden.cases.find((entry) => entry.name === input.name).rows,
        halfway = input.initialFrames + offset;
      for (let i = 0; i < halfway; i++) {
        request(input, first, i);
        first.update(rows[i].frame);
      }
      const saved = first.snapshot(),
        frozen = structuredClone(saved);
      second.restore(saved);
      for (let i = halfway; i < rows.length; i++) {
        request(input, first, i);
        request(input, second, i);
        first.update(rows[i].frame);
        second.update(rows[i].frame);
        assert.deepEqual(second.snapshot(), first.snapshot(), input.name + '/' + i);
        assert.deepEqual(
          second.geometry.commands.map((command) => command.bytes),
          first.geometry.commands.map((command) => command.bytes),
        );
      }
      assert.deepEqual(saved, frozen);
    }
});
