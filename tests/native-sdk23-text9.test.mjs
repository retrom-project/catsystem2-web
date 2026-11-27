// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI, abiForEngineVersion } from '../src/native/abi/index.mjs';
import { rasterTextGlyph } from '../src/native/text-raster.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-text9-golden.json', import.meta.url)),
  ),
  profile = golden.profile,
  marker = 0x74657839,
  glyphs = {
    measure: () => ({
      width: 4,
      height: 6,
      ascent: 6,
      descent: 0,
      averageWidth: 4,
      maximumWidth: 4,
    }),
    glyph: () => ({
      width: 4,
      height: 6,
      originX: 0,
      originY: 6,
      advanceX: 4,
      advanceY: 0,
      alpha: new Uint8Array(24).fill(255),
    }),
  };

function filesFor(kind) {
  const fixture = golden[kind],
    initial = [],
    words = (at, values) =>
      values.forEach((value, i) => initial.push([37, value >>> 0], [38, at + i * 4])),
    bytes = (at, values) => {
      const padded = Buffer.alloc(Math.ceil(values.length / 4) * 4);
      padded.set(values);
      words(
        at,
        Array.from({ length: padded.length / 4 }, (_, i) => padded.readUInt32LE(i * 4)),
      );
    };
  if (kind.startsWith('string')) bytes(kind === 'string' ? 640 : 1024, fixture.configuration);
  else words(640, fixture.configuration);
  if (kind === 'legacy') {
    bytes(256, Buffer.from('Actual legacy text\0'));
    bytes(384, [65, 0xa1, 0x82, 0xa0, 0]);
    bytes(448, Buffer.from('\\fn;A\\fl;B\0'));
    bytes(512, [0]);
  } else if (kind === 'visible') {
    bytes(256, Buffer.from('Visible legacy\0'));
    bytes(384, [65, 0]);
    bytes(448, [66, 0]);
    bytes(512, [0]);
  } else {
    bytes(kind === 'string' ? 256 : 320, Buffer.from('Paged actual STRING\0'));
    bytes(384, [65, 0]);
    bytes(448, [66, 0]);
    bytes(576, [65, 0x82, 0xa0, 66, 0]);
  }
  return {
    // The parent waits on its normal mapped message packet while children update.
    'case.kcs': kcsProgram([[37, 240], [43, 71, 4], [59]]),
    'text9.kcs': kcsProgram([
      [37, marker],
      ...initial,
      ...fixture.rows.flatMap((row) =>
        row.update
          ? [[43, 65, 0]]
          : [
              ...(row.code ?? [
                ...row.args.map((arg, i) => [37, row.id === 66 && i === 1 ? [0x13, 88] : arg]),
                [43, row.id, row.args.length * 4],
                ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
              ]),
              [43, 65, 0],
            ],
      ),
      [59],
    ]),
  };
}

async function bitmapEqual(world, handle, expected, label) {
  if (!expected) return;
  const bitmap = world.graphics.images.get(handle);
  assert.deepEqual([bitmap.width, bitmap.height], [expected.width, expected.height], label);
  assert.equal(Buffer.from(await bitmap.pixels()).toString('base64'), expected.rgbaBase64, label);
}

async function legacyEqual(world, taskID, row, kind, machine) {
  const record = world.objects.objects.get(taskID),
    legacy = record.implementation,
    expected = kind === 'legacy' ? row : row.legacy;
  for (const [word, value] of Object.entries(expected.words)) {
    // Cell count and bitmap identity are represented by their actual owners.
    if (word === '172') assert.equal(legacy.text.rows.length, value, row.label);
    else if (word !== '46' || legacy.text.configured)
      assert.equal(legacy.text.w(Number(word)) >>> 0, value, row.label + ' word' + word);
  }
  assert.deepEqual(
    legacy.text.rows.map((cell) => [...cell].map((value) => value >>> 0)),
    expected.cells,
    row.label + ' cells',
  );
  await bitmapEqual(world, legacy.bitmap, expected.bitmap, row.label + ' pixels');
  if (kind === 'visible' && row.id === 130) {
    const source = Buffer.from(expected.bitmap.rgbaBase64, 'base64'),
      { width, height } = expected.bitmap,
      vram = world.graphics.images.get(world.graphics.vramHandle),
      pixels = await vram.pixels();
    for (let y = 0; y < height; y++)
      assert.deepEqual(
        pixels.slice(y * vram.width * 4, (y * vram.width + width) * 4),
        new Uint8ClampedArray(
          source.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
        ),
        row.label + ' texture upload row' + y,
      );
  }
  if (row.id === 391)
    assert.equal(machine.load(row.resultAddress), row.borrowed ? legacy.bitmap : 0, row.label);
  if (row.id === 119)
    assert.deepEqual([machine.load(100), machine.load(104)], row.outputs, row.label);
  if (legacy.bitmap)
    assert.equal(
      [...world.runtime.handles.records.values()].filter(
        ({ type, value }) =>
          type === 'bitmap' &&
          value.dataHandle === world.graphics.images.get(legacy.bitmap).dataHandle,
      ).length,
      1,
      row.label + ' borrowed query creates no alias or reference',
    );
}

for (const kind of ['legacy', 'visible', 'string', 'stringPlain']) {
  test(
    'SDK23 Text9 ' + kind + ' runs original vectors through real factory GCALLs and cold',
    async (t) => {
      const inputs = filesFor(kind),
        world = await dataWorld(profile, inputs, { glyphs });
      t.after(() => world.close({ flushFiles: false }));
      const task = await world.spawnScript('text9.kcs', {
          parent: world.main.id,
          initialExecute: false,
        }),
        floor = task.machine.sp;
      task.machine.store(88, world.nativeTaskID(world.main.id));
      const packets = [],
        send = world.sendNativeEngine.bind(world);
      if (kind === 'legacy')
        world.sendNativeEngine = (target, sender, message, w, l, context = {}) => {
          if (message === 114 || message === 123) {
            const bytes = context.payload.bytes(0, message === 114 ? 8 : 20),
              view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            packets.push(
              Array.from({ length: message === 114 ? 4 : 5 }, (_, i) =>
                message === 114 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true),
              ),
            );
          }
          return send(target, sender, message, w, l, context);
        };
      let textID, bitmap;
      const advance = async (current, caller, row) => {
        const receiver = textID && current.objects.objects.get(textID).implementation,
          writer = kind.startsWith('string') && receiver && (await receiver.writer()),
          beforeQuery = row.id === 616 && structuredClone(writer.snapshot()),
          handleCount = current.runtime.handles.records.size;
        if (row.update) await current.objects.tick(row.frame ?? row.update);
        else await current.runtime.scheduler.execute(caller);
        const m = caller.machine;
        assert.equal(m.sp, floor + 4, row.label + ' stack');
        assert.equal(m.load(floor), marker, row.label + ' guard');
        if (row.id === 66) textID = current.resolveTaskID(m.load(32), caller.id);
        if (current === world && row.packets?.length)
          assert.deepEqual(packets.splice(0), row.packets, row.label + ' wrapper packet');
        if (!kind.startsWith('string')) {
          await legacyEqual(current, textID, row, kind, m);
          bitmap = current.objects.objects.get(textID).implementation.bitmap;
        } else {
          const text = current.objects.objects.get(textID).implementation,
            actual = await text.writer();
          if (row.active !== null)
            assert.equal(text.text.active, Boolean(row.active), row.label + ' active');
          if (row.resultAddress !== null) {
            if (row.id !== 66) assert.equal(m.load(row.resultAddress), row.result, row.label);
          }
          if (row.code) assert.equal(m.load(100), row.comparison, row.label);
          if (actual) {
            assert.equal(actual.parser.dirty, Boolean(row.pending), row.label + ' pending');
            assert.deepEqual(
              actual.parser.rows
                .filter((record) => record[1])
                .map((record) => [...record.slice(1, 8), record[15]].map((word) => word >>> 0)),
              row.records
                .filter((record) => record[1] & 65535)
                .map((record) => [...record.slice(1, 8), record[13]]),
              row.label + ' parsed rows',
            );
            if (row.bitmap)
              assert.equal(
                Buffer.from(actual.frame().rgba).toString('base64'),
                row.bitmap.rgbaBase64,
                row.label + ' actual STRING output bitmap',
              );
            assert.equal(current.text.core.writers.size, 1, row.label + ' writer ownership');
          }
          if (row.id === 616) {
            assert.strictEqual(actual, writer, row.label + ' writer identity');
            assert.deepEqual(actual.snapshot(), beforeQuery, row.label + ' query is read-only');
            assert.equal(
              current.runtime.handles.records.size,
              handleCount,
              row.label + ' no retain',
            );
          }
        }
      };
      for (const [i, row] of golden[kind].rows.entries()) {
        await advance(world, task, row);
        if (
          ['font-sizes', 'force-to-first-mark', 'pending', 'partially-drawn-count'].includes(
            row.label,
          )
        ) {
          const fresh = await dataWorld(profile, inputs, { initialize: false, glyphs });
          try {
            await fresh.restore(structuredClone(world.snapshot()));
            const caller = fresh.runtime.scheduler.tasks.get(task.id);
            if (!kind.startsWith('string'))
              await legacyEqual(fresh, textID, row, kind, caller.machine);
            for (const next of golden[kind].rows.slice(i + 1)) await advance(fresh, caller, next);
            await fresh.objects.tick(1200);
            if (kind !== 'visible') {
              assert.equal(fresh.objects.objects.has(textID), false);
              if (kind === 'legacy') assert.equal(fresh.runtime.handles.records.has(bitmap), false);
              else assert.equal(fresh.text.core.writers.size, 0);
            }
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
      }
      if (kind !== 'visible') {
        await world.objects.tick(1200);
        assert.equal(world.objects.objects.has(textID), false);
        if (kind === 'legacy') assert.equal(world.runtime.handles.records.has(bitmap), false);
        else assert.equal(world.text.core.writers.size, 0);
      }
    },
  );
}

test('SDK23 Text9 admits only its reviewed typed legacy wrappers', () => {
  const abi = nativeABI(profile);
  for (const id of [130, 133, 134, 135, 391, 456, 585, 599]) {
    const entry = abi.tables.main.entries[id];
    assert.equal(entry.status, 'recovered');
    assert.equal(entry.signature.review, 'reviewed');
    assert.equal(entry.signature.parameters[0].type.objectKind, 'legacy-text');
    assert.equal(entry.signature.resultWritten, id === 391);
  }
  assert.deepEqual(abi.tables.main.entries[391].signature.result, {
    kind: 'handle',
    handleKind: 'bitmap',
    ownership: 'borrowed',
  });
  assert.equal(abi.tables.main.entries[616].status, 'recovered');
  assert.equal(abi.tables.main.entries[616].signature.parameters[0].type.objectKind, 'STRING');
  assert.equal(abi.tables.main.entries[616].signature.result.signed, true);
  for (const version of ['2.6.1.63', '2.6.1.67']) {
    const text = abiForEngineVersion(version).text;
    assert.equal(text.legacyTextServices, undefined);
    assert.equal(text.remainingTaskKinds, undefined);
    assert.equal(text.gdiSBCSUsesMeasuredWidth, undefined);
    assert.equal(text.gdiFixedGlyphHalfCell, undefined);
  }
});

test('SDK23 GDI fixed cells keep measured layout separate from live glyph centering', () => {
  const font = { height: -24, fixed: 1, fixedCellWidth: 12 },
    row = new Int32Array(22),
    parser = {
      font: () => font,
      character: () => 'A',
      glyphs: {
        measure: glyphs.measure,
        glyph: () => ({ ...glyphs.glyph(), originX: 2, advanceX: 6 }),
      },
    },
    columns = (shape) =>
      Array.from({ length: shape.width }, (_, x) => x).filter(
        (x) => shape.rgba[(shape.width + x) * 4 + 3],
      );
  row[1] = 65;
  row[2] = -1;
  row[6] = 4;
  row[7] = 24;
  assert.deepEqual(columns(rasterTextGlyph(parser, row)), [6, 7, 8, 9]);
  font.fixedCellWidth = 8;
  assert.deepEqual(columns(rasterTextGlyph(parser, row)), [4, 5, 6, 7]);
  assert.equal(row[6], 4, 'layout advance is unchanged');
  font.backend = 1;
  Object.defineProperty(font, 'fixedCellWidth', {
    get: () => assert.fail('FreeType must not read the GDI cell'),
  });
  parser.glyphs.glyphNative = () => glyphs.glyph();
  assert.deepEqual(columns(rasterTextGlyph(parser, row)), []);
});

test('SDK23 Text9 protects unreviewed receiver and argument shapes through actual GCALL', async (t) => {
  for (const [label, id, args, error] of [
    ['legacy-count', 133, [0], /expects 2 argument words/],
    ['string-count', 616, [], /expects 1 arguments/],
    ['string-owner', 616, [0], /requires a reviewed STRING task/],
  ]) {
    const world = await dataWorld(profile, {
      'guard.kcs': kcsProgram([...args.map((arg) => [37, arg]), [43, id, args.length * 4], [59]]),
    });
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('guard.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    await assert.rejects(world.runtime.scheduler.execute(task), error, label);
  }
  for (const [kind, id, tail, error] of [
    [48, 616, [], /requires an initialized writer/],
    [8, 616, [], /requires a reviewed STRING task/],
    [48, 133, [1], /requires a kind 8 task/],
  ]) {
    const world = await dataWorld(profile, {
      'guard.kcs': kcsProgram(
        [
          [37, kind],
          [37, [0x13, 88]],
          [37, 256],
          [43, 66, 12],
          [38, 32],
          [37, [0x13, 32]],
          ...tail.map((word) => [37, word]),
          [43, id, (1 + tail.length) * 4],
          [59],
        ],
        [[256, 'Guard receiver']],
      ),
    });
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('guard.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    task.machine.store(88, world.nativeTaskID(world.main.id));
    await assert.rejects(world.runtime.scheduler.execute(task), error);
  }
});
