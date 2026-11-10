// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressBudget, FrameBudgetReached } from './browser/progress-budget.mjs';

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
});

test('frame and wall no-progress conditions stop independently at the earlier bound', () => {
  let time = 0;
  const budget = new ProgressBudget('game', () => time);
  budget.observe({ frame: 10, position: ['wait'] });
  time = 179999;
  budget.observe({ frame: 11, position: ['wait'] });
  time++;
  assert.throws(() => budget.observe({ frame: 12, position: ['wait'] }), /no progress/);
  const frames = new ProgressBudget('game', () => 0);
  frames.observe({ frame: 10, position: ['wait'] });
  assert.throws(() => frames.observe({ frame: 310, position: ['wait'] }), /no progress/);
  const moving = new ProgressBudget('game', () => time);
  moving.observe({ frame: 0, position: ['a'] });
  time += 100000;
  moving.observe({ frame: 1, position: ['b'] });
  assert.equal(moving.remainingWallMS(), 180000);
});
