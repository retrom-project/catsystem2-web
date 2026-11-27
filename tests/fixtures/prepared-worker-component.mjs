// SPDX-License-Identifier: MPL-2.0
// Isolate the job state machine from native-channel qualification. These
// components do not certify a Node fake as an owned browser worker.
import { mock } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const componentChild = process.env.CS2_PREPARED_COMPONENT === '1';
if (componentChild) {
  const url = new URL('../../src/native/scene-workers.mjs', import.meta.url),
    actual = await import(url);
  mock.module(url.href, {
    exports: {
      ...actual,
      canPrepareOwnedSceneWorker: actual.canPrepareSceneWorker,
      acquireOwnedSceneWorker: actual.acquireSceneWorker,
    },
  });
}

export async function runPreparedComponents(file, pattern, t) {
  const args = [
    '--experimental-test-module-mocks',
    '--import',
    import.meta.url,
    '--test',
    '--test-reporter=tap',
    ...(pattern ? ['--test-name-pattern', pattern] : []),
    fileURLToPath(file),
  ];
  const env = { ...process.env, CS2_PREPARED_COMPONENT: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, args, {
      env,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const expected = pattern ? 1 : 8;
    assert.match(stdout, new RegExp(`(?:^|\\n)# tests ${expected}(?:\\n|$)`));
    assert.match(stdout, new RegExp(`(?:^|\\n)# pass ${expected}(?:\\n|$)`));
    t.diagnostic(stdout.trim());
    if (stderr.trim()) t.diagnostic(stderr.trim());
  } catch (error) {
    t.diagnostic(error.stdout ?? '');
    t.diagnostic(error.stderr ?? '');
    throw error;
  }
}
