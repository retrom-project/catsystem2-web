// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressBudget, FrameBudgetReached } from './browser/progress-budget.mjs';
import { progressAcceptance, step, state } from './browser/native-game-input.mjs';

test('progress gates retain reviewed floors and stop at the fixed extra frame budget', () => {
  const budget = new ProgressBudget('route');
  budget.observe({ frame: 583, messages: 54, position: ['01', 54] });
  assert.throws(
    () => budget.observe({ frame: 883, messages: 80, position: ['01', 80] }),
    FrameBudgetReached,
  );
  const regressed = new ProgressBudget('route');
  assert.throws(
    () => regressed.observe({ frame: 883, messages: 53, position: ['01', 53] }),
    /Progress regressed at messages/,
  );
  assert.equal(new ProgressBudget('game').limit, 1936);
  assert.equal(new ProgressBudget('particle').limit, undefined);
});

test('a blocked browser frame closes its context after the wall stall deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = false;
  const page = {
    on() {},
    evaluate: () => new Promise(() => {}),
    context: () => ({
      close: async () => {
        closed = true;
      },
    }),
  };
  const info = { setTimeout() {}, async attach() {} };
  const operation = progressAcceptance(page, info, 'game', () => step(page));
  t.mock.timers.tick(180000);
  await assert.rejects(operation, /wall stall/);
  assert.equal(closed, true);
});

test('progress observes explicit scene handles and a revealing JS writer while the KCS PC waits', async () => {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  const reader = { filename: '01', block: 2, line: 7 },
    text = { source: 'dialogue', elapsed: 1, active: true },
    task = { name: 'sscript', machine: { pc: 123 } };
  globalThis.window = {
    catSystem2: {
      status: () => ({ stack: ['meswnd#WAIT'], unsupported: [] }),
      world: {
        frame: 500,
        runtime: {
          sceneData: () => null,
          scheduler: { tasks: new Map([[1, task]]) },
          handles: { records: new Map([[7, { type: 'scene-data', value: { reader } }]]) },
        },
        objects: { objects: new Map([[8, { id: 8, implementation: { text } }]]) },
      },
    },
  };
  globalThis.document = { getElementById: () => ({ textContent: '' }) };
  try {
    const page = { evaluate: (observe) => observe() };
    const first = await state(page);
    assert.equal(first.position.scenes[0].line, 7);
    text.elapsed++;
    const revealed = await state(page);
    assert.notDeepEqual(revealed.position, first.position);
    reader.line++;
    const advanced = await state(page);
    assert.equal(advanced.position.scenes[0].line, 8);
    assert.deepEqual(advanced.position.tasks, first.position.tasks);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('frame and wall no-progress conditions stop independently at the earlier bound', () => {
  let time = 0;
  const budget = new ProgressBudget('game', () => time);
  budget.observe({ frame: 10, position: ['wait'] });
  time = 179999;
  budget.observe({ frame: 10, position: ['wait'] }, 1);
  time++;
  assert.throws(() => budget.observe({ frame: 10, position: ['wait'] }, 1), /no progress/);
  const frames = new ProgressBudget('game', () => 0);
  frames.observe({ frame: 10, position: ['wait'] });
  assert.throws(() => frames.observe({ frame: 10, position: ['wait'] }, 300), /no progress/);
  const moving = new ProgressBudget('game', () => time);
  moving.observe({ frame: 0, position: ['a'] });
  time += 100000;
  moving.observe({ frame: 1, position: ['a'] });
  assert.equal(moving.remainingWallMS(), 180000);
});
