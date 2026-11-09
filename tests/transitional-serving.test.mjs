// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('the normal development server serves the explicit transitional modules', async (t) => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'close');
    }
  });
  let output = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (bytes) => {
      output += bytes;
      if (output.includes('CatSystem2 Web:')) resolve();
    });
    child.stderr.on('data', (bytes) => (output += bytes));
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Development server exited ${code}\n${output}`)));
  });
  for (const file of [
    'web/transitional-entry.mjs',
    'oracle/transitional-exe.mjs',
    'oracle/scalar-handlers.mjs',
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(
      await response.text(),
      await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
    );
  }
  for (const file of ['oracle/scalar-handlers.mjs/extra', 'scripts/check-no-exe-addresses.mjs'])
    assert.equal((await fetch(`http://127.0.0.1:${port}/${file}`)).status, 404, file);
});
