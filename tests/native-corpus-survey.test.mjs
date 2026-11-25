// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectKCS,
  inspectFES,
  inspectCST,
  surveyContainer,
} from '../scripts/survey-native-corpus.mjs';
import {
  summarizeSDKCoverage,
  verifyWorkExecutable,
} from '../scripts/collect-native-abi-acceptance.mjs';
import { kcsProgram, catScene, kif } from './helpers.mjs';

test('a tested work and guards still leave ordinary SDK coverage incomplete', () => {
  const main = [
      { id: 0, declaration: { status: 'reserved' } },
      { id: 1, declaration: { status: 'unknown' }, evidence: { sdkScope: 'ordinary-runtime' } },
      {
        id: 2,
        declaration: { status: 'unknown' },
        evidence: { sdkScope: 'original-undefined-input' },
      },
      {
        id: 3,
        declaration: { status: 'unknown' },
        evidence: { sdkScope: 'desktop-author-or-export' },
      },
      { id: 4, declaration: { status: 'unknown' } },
      { id: 5, declaration: { status: 'recovered' }, evidence: { disposition: 'original-stub' } },
    ],
    works = [
      { id: 'visited', contentIdentity: 'first digest' },
      { id: 'extra', contentIdentity: 'second digest' },
    ],
    receipts = new Map([
      ['ending', { contentIdentity: 'first digest', kind: 'product' }],
      ['protected', { contentIdentity: 'second digest', kind: 'guard' }],
    ]);
  const summarize = (slots) =>
    summarizeSDKCoverage({ tables: { main: { slots } } }, works, receipts);
  const coverage = summarize(main);
  assert.deepEqual(coverage.guarded, {
    'ordinary-runtime': [{ table: 'main', id: 1 }],
    'original-undefined-input': [{ table: 'main', id: 2 }],
    'desktop-author-or-export': [{ table: 'main', id: 3 }],
    'unclassified-evidence': [{ table: 'main', id: 4 }],
  });
  assert.deepEqual(
    coverage.originalStubs.map(({ id }) => id),
    [0, 5],
  );
  assert.deepEqual(coverage.productReceiptsByWork, [
    { work: 'visited', receipts: ['ending'] },
    { work: 'extra', receipts: [] },
  ]);
  assert.equal(coverage.ordinaryRuntime, 'incomplete');
  assert.equal(coverage.ordinaryOpen, 1);
  assert.equal(coverage.unclassified, 1);
  assert.equal(summarize([main[4]]).ordinaryRuntime, 'incomplete');
  assert.equal(summarize([main[1]]).ordinaryRuntime, 'incomplete');
  assert.equal(summarize([main[2], main[3]]).ordinaryRuntime, 'no-identified-open-slot');
  const implemented = {
    id: 6,
    declaration: { status: 'recovered' },
    evidence: {
      guardedShapes: [
        { sdkScope: 'ordinary-runtime', shape: 'two owned resources and a valid selector' },
        { sdkScope: 'original-undefined-input', shape: 'released resource' },
      ],
    },
  };
  const shapeCoverage = summarize([implemented]);
  assert.equal(shapeCoverage.ordinaryRuntime, 'incomplete');
  assert.equal(shapeCoverage.ordinaryOpen, 0);
  assert.equal(shapeCoverage.ordinaryOpenShapes, 1);
  assert.deepEqual(shapeCoverage.guardedShapes['ordinary-runtime'], [
    { table: 'main', id: 6, shape: 'two owned resources and a valid selector' },
  ]);
  const secondaryCoverage = summarizeSDKCoverage({ tables: {} }, works, receipts, [
    { name: 'FES control resource', sdkScope: 'ordinary-runtime' },
    { name: 'Task message receiver', sdkScope: 'unclassified-evidence' },
    { name: 'Native save layout sampled by this work' },
  ]);
  assert.equal(secondaryCoverage.ordinaryRuntime, 'incomplete');
  assert.equal(secondaryCoverage.ordinaryOpen, 0);
  assert.equal(secondaryCoverage.ordinaryOpenShapes, 0);
  assert.equal(secondaryCoverage.ordinaryOpenSecondary, 1);
  assert.equal(secondaryCoverage.unclassifiedSecondary, 1);
  assert.deepEqual(secondaryCoverage.secondaryOpen['ordinary-runtime'], ['FES control resource']);
  assert.deepEqual(secondaryCoverage.secondaryOpen['unclassified-evidence'], [
    'Task message receiver',
  ]);
});

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

test('static FES counting keeps literal declarations and unresolved raw rows without evaluation', () => {
  const report = inspectFES(
    {
      text: '#INCLUDE\ncommon.fes\n#DEFINE\nTEXT label[$60++]\n$str0\nCIMAGE dynamic[$str1]\n#START\nACTION 1\nlabel show 1\n',
      bytes: new TextEncoder().encode(
        '#INCLUDE\ncommon.fes\n#DEFINE\nTEXT label[$60++]\n$str0\nCIMAGE dynamic[$str1]\n#START\nACTION 1\nlabel show 1\n',
      ),
      prepared: false,
    },
    () => ({ bytes: new TextEncoder().encode('#MACRO\nACTION wait\n'), prepared: false }),
  );
  assert.deepEqual(report.commands, ['wait']);
  assert.deepEqual(report.objectCommands, [{ type: 'TEXT', command: 'show' }]);
  assert.deepEqual(report.objects, [{ type: 'TEXT', name: 'label' }]);
  assert.deepEqual(report.unresolvedDefinitions, [
    {
      raw: '$str0',
      reason: 'Declaration requires runtime expansion or is outside the static bare grammar',
    },
    {
      raw: 'CIMAGE dynamic[$str1]',
      reason: 'Declaration requires runtime expansion or is outside the static bare grammar',
    },
  ]);
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
  assert.deepEqual(report.commandSites, [
    { line: 1, command: 'wait' },
    { line: 3, command: 'rdraw' },
  ]);
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

test('archive inventory binds byte-identical FES callers to each include context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cs2-corpus-includes-'));
  try {
    const bytes = (text) => new TextEncoder().encode(text),
      menu = bytes('#INCLUDE\nshared.h\n#START\nACTION 1\n'),
      reports = [];
    for (const [index, command] of ['wait', 'next'].entries()) {
      const path = join(directory, `combined-${index}.int`);
      const archive = kif([
        ['menu.fes', menu],
        ['shared.h', bytes(`#MACRO\nACTION ${command}\n`)],
      ]);
      await writeFile(path, archive);
      await assert.rejects(
        surveyContainer({ path, sha256: '0'.repeat(64) }),
        /Archive SHA-256 mismatch/,
      );
      const report = await surveyContainer({ path, logicalPath: 'fes.int' });
      assert.equal(report.entries[0].callShapes[0].command, command);
      assert.equal(report.entries[0].callShapes[0].argumentTokens, 1);
      reports.push(report.entries[0]);
    }
    assert.equal(reports[0].sha256, reports[1].sha256);
    assert.notEqual(reports[0].includes['shared.h'], reports[1].includes['shared.h']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('work fingerprints are checked against the bytes of every staged executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cs2-work-executable-'));
  try {
    const expectedBytes = Buffer.from('MZ fixture SDK 2.6.1.74 original'),
      distinctBytes = Buffer.from('MZ fixture SDK 2.6.1.74 alternate'),
      sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex'),
      executableSha256 = sha256(expectedBytes),
      same = join(directory, 'first.exe'),
      copy = join(directory, 'second.exe'),
      different = join(directory, 'alternate.exe');
    await Promise.all([
      writeFile(same, expectedBytes),
      writeFile(copy, expectedBytes),
      writeFile(different, distinctBytes),
    ]);
    await verifyWorkExecutable(
      { id: 'first', executableSha256, executablePath: same },
      executableSha256,
    );
    await verifyWorkExecutable(
      { id: 'second', executableSha256, executablePath: copy },
      executableSha256,
    );
    await assert.rejects(
      verifyWorkExecutable({ id: 'second', executableSha256 }, executableSha256),
      /requires its executablePath/,
    );
    await assert.rejects(
      verifyWorkExecutable(
        { id: 'alternate', executableSha256: sha256(distinctBytes), executablePath: different },
        executableSha256,
      ),
      /requires the exact executable SHA-256/,
    );
    await assert.rejects(
      verifyWorkExecutable(
        { id: 'alternate', executableSha256, executablePath: different },
        executableSha256,
      ),
      /SHA-256 mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
