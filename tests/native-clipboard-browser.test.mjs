// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserNativeClipboard } from '../src/native/clipboard-browser.mjs';
test('clipboard ownership performs the real empty/write sequence and refuses overlapping owners', async () => {
  const writes = [],
    service = new BrowserNativeClipboard({
      clipboard: { writeText: async (text) => writes.push(text) },
    });
  assert.equal(await service.empty(), false);
  assert.equal(service.open(1), true);
  assert.equal(service.open(2), false);
  assert.equal(await service.empty(), true);
  assert.equal(await service.write('猫\r\ntext'), true);
  assert.deepEqual(writes, ['', '猫\r\ntext']);
  assert.equal(service.close(), true);
  assert.equal(await service.write('closed'), false);
  assert.equal(service.open(2), true);
  assert.equal(service.owner, 2);
  service.close();
});
test('unavailable or denied platform access reports failure without fabricating empty or successful data', async () => {
  const unavailable = new BrowserNativeClipboard({ clipboard: null });
  assert.equal(unavailable.open(1), false);
  const diagnostics = [],
    service = new BrowserNativeClipboard({
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      diagnostic: (d) => diagnostics.push(d),
    });
  assert.equal(service.open(1), true);
  assert.equal(await service.empty(), false);
  assert.equal(await service.write('text'), false);
  assert.deepEqual(
    diagnostics.map((d) => d.message),
    ['denied', 'denied'],
  );
  assert.equal(service.close(), true);
});
