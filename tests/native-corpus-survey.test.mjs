// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectKCS,
  inspectFES,
  inspectCST,
  surveyContainer,
} from '../scripts/survey-native-corpus.mjs';
import { kcsProgram, catScene, kif } from './helpers.mjs';

test('static GCALL decoding distinguishes immediate, memory and stack operands', async () => {
  const bytes = kcsProgram([
    [43, [3, 17], [3, 8]],
    [43, [0x23, 18], [0x23, 12]],
    [43, [0x13, 19], [3, 0]],
    [43, [0x43, 20], [0x43, 4]],
    [59],
  ]);
  const report = await inspectKCS(bytes, 'kcs.int');
  assert.equal(report.table, 'main');
  assert.deepEqual(
    report.calls.map((call) => [call.id, call.argumentWords]),
    [
      [17, 2],
      [18, 3],
      [null, 0],
      [null, null],
    ],
  );
  assert.equal(report.calls[1].pc, 11);
});

test('table binding keeps generic and versioned particle namespaces separate', async () => {
  const bytes = kcsProgram([[59]]);
  assert.equal((await inspectKCS(bytes, 'mot.int')).table, 'generic');
  assert.equal((await inspectKCS(bytes, 'update01.int')).table, 'needs-review');
  for (const [version, table] of [
    [0x10000, 'particle-v1'],
    [0x20000, 'particle-v2'],
    [0x30000, 'particle-unknown'],
  ]) {
    const copy = bytes.slice(),
      view = new DataView(copy.buffer);
    view.setUint16(8, version >>> 16, true);
    assert.equal((await inspectKCS(copy, 'ptcl.int')).table, table);
  }
});

test('FES counting expands macros and includes while keeping object definitions', () => {
  const report = inspectFES(
    '#INCLUDE\ncommon.fes\n#DEFINE\nTEXT label\n#START\nACTION 1\nlabel show 1\n',
    () => '#MACRO\nACTION wait\n',
  );
  assert.deepEqual(report.commands, ['wait']);
  assert.deepEqual(report.objectCommands, [{ type: 'TEXT', command: 'show' }]);
  assert.deepEqual(report.objects, [{ type: 'TEXT', name: 'label' }]);
});

test('CST end-of-line grouping retains other decoded command sites', async () => {
  const report = await inspectCST(
    catScene([
      [0x30, 'wait 1'],
      [0x30, 'if ('],
      [0x30, 'rdraw'],
    ]),
  );
  assert.equal(report.lines, 3);
  assert.deepEqual(report.commands, ['wait', 'rdraw']);
  assert.deepEqual(report.commandErrors, []);
});

test('container failures retain a reason even when decompression has no message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cs2-corpus-'));
  try {
    const bytes = catScene([[0x30, 'wait 1']]);
    bytes[bytes.length - 1] ^= 255;
    const path = join(directory, 'scene.int');
    await writeFile(path, kif([['bad.cst', bytes]]));
    const report = await surveyContainer({ path, work: 'authored', role: 'test' });
    assert.equal(report.entries[0].status, 'needs-review');
    assert.ok(report.entries[0].reason.length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
