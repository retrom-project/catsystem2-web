// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineHost } from '../src/host.mjs';

test('host diagnostic output retains the latest 1024 entries in order across producers', () => {
  const engine = {},
    host = new EngineHost(engine);
  for (let i = 0; i < 1050; i++) host.nativeLog(`entry ${i}`);
  const records = engine.nativeLog;
  assert.equal(records.length, 1024);
  assert.equal(records[0], 'entry 26');
  host.nativeDebugOutput(new TextEncoder().encode('last'));
  assert.equal(engine.nativeLog, records);
  assert.equal(records.length, 1024);
  assert.equal(records[0], 'entry 27');
  assert.equal(records.at(-1), 'last');
});

test('the next log event bounds an existing oversized history', () => {
  const engine = { nativeLog: Array.from({ length: 1500 }, (_, i) => `old ${i}`) };
  new EngineHost(engine).nativeLog('new');
  assert.equal(engine.nativeLog.length, 1024);
  assert.equal(engine.nativeLog[0], 'old 477');
  assert.equal(engine.nativeLog.at(-1), 'new');
});
