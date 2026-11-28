// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { CatSystem2 } from '../src/engine.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { parseProgram, fesPreloadLine } from '../src/fes/program.mjs';
import { hg3 } from './helpers.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  name = 'assets.int/tile.hg3',
  encoded = hg3(2, 1, Uint8Array.of(17, 34, 51, 255, 90, 120, 150, 255)),
  defaultSource = '#START\nbreak\n';
function prepared(source) {
  const bytes = source instanceof Uint8Array ? source : ascii(source),
    compressed = deflateSync(bytes),
    output = new Uint8Array(16 + compressed.length),
    view = new DataView(output.buffer);
  view.setUint32(0, 0x534546, true);
  view.setUint32(4, compressed.length, true);
  view.setUint32(8, bytes.length, true);
  output.set(compressed, 16);
  return output;
}
async function environment(profile, files = {}) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: Object.fromEntries(
          Object.entries({
            [name]: encoded,
            'assets.int/screen.fes': ascii(defaultSource),
            ...files,
          }).map(([file, bytes]) => [file.replace(/^assets\.int\//, 'assets/'), bytes]),
        ),
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mounts = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02><int03><name>image</name><int>assets.int</int><ext>hg3</ext><dir>assets</dir></int03>',
      ),
      source = new Uint8Array(startup.length + mounts.length);
    assert.ok(at >= 0);
    source.set(startup.subarray(0, at));
    source.set(mounts, at);
    source.set(startup.subarray(at), at + mounts.length);
    const input = new Map(template.input);
    input.set('startup.xml', new BlobFile(new Blob([source])));
    const game = new GameFiles(input);
    await game.open();
    player = new CatSystem2({
      game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      randomSeed: 77,
      audioContext: { currentTime: 0, close: async () => {} },
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          throw new Error('Cache owner must not open the original');
        },
      },
    });
    await player.initialize();
    assert.equal(player.world.frame, 1);
    assert.equal(player.world.runtime.variableBank(player.world.main, false).get(7), 0x12345678);
    assert.equal(player.world.nativeEngine, undefined);
    return {
      player,
      world: player.world,
      game,
      async close() {
        try {
          await player.dispose();
        } finally {
          scope.restore();
        }
      },
    };
  } catch (error) {
    try {
      await player?.dispose();
    } finally {
      scope.restore();
    }
    throw error;
  }
}
async function task(world) {
  const parent = world.main,
    owner = parent.id;
  world.runtime.stringBank(parent);
  const id = await world.objects.create({ kind: 34, parent: owner }),
    surface = await world.objects.create({ kind: 15, parent: owner });
  await world.sendEngine(surface, owner, 279, 64, 48);
  await world.sendEngine(surface, owner, 283);
  await world.sendEngine(id, owner, 331, 0, parent.context.variableBank);
  await world.sendEngine(id, owner, 334, 0, world.nativeTaskID(surface));
  const implementation = world.objects.objects.get(id).implementation,
    bank = world.runtime.handles.get(parent.context.stringBank, 'string-bank');
  assert.equal(world.objects.objects.get(id).context.stringBank, parent.context.stringBank);
  return { id, surface, implementation, bank, cache: implementation.imageCacheModel };
}
async function load(world, current) {
  await world.sendEngine(current.id, world.main.id, 332, 0, 0, {
    payload: { string: () => 'assets.int/screen.fes' },
  });
  assert.ok(current.implementation.player.root.runtime instanceof FESCoordinator);
}
function prefix(buffers, pointer, expected) {
  assert.deepEqual(buffers.data(pointer).subarray(0, expected.length), expected);
}
function defineCheckpointPixels(world) {
  const gpu = world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  // Public CPU-entry fixture defines the target fully; this is no GPU oracle.
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
}

for (const profile of startupProfiles) {
  test(`PRELOAD default332 rescans raw rows with its bound bank through EOF and reads duplicates before first-win: ${profile}`, async (t) => {
    const A = 'assets.int/a  name.hg3',
      C = 'assets.int/changed.hg3',
      S = 'assets.int/SCRIPT(9).hg3',
      original = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9),
      replacement = Uint8Array.of(91, 92, 93, 94, 95, 96, 97, 98, 99),
      source = `#PRELOAD\n${A}\n$str1\n$str2\n#PRELOAD\n${A}\n#START\nbreak\n`,
      h = await environment(profile, {
        'assets.int/screen.fes': prepared(source),
        [A]: original,
        [C]: Uint8Array.of(21),
        [S]: Uint8Array.of(31),
      });
    try {
      const current = await task(h.world),
        { bank, cache } = current,
        expanded = [],
        expand = bank.expandBytes,
        requested = [],
        preload = cache.preload,
        candidates = h.game.nativeCandidates.bind(h.game),
        modes = [],
        sourceModes = [],
        looseReads = [],
        storageRead = h.world.storage.read.bind(h.world.storage),
        physical = 'assets/a  name.hg3';
      let aReads = 0;
      bank.set(1, '#filtered before first read');
      bank.set(2, S);
      t.mock.method(bank, 'expandBytes', function (bytes) {
        assert.equal(this, bank);
        expanded.push(new Uint8Array(bytes));
        return expand.call(this, bytes);
      });
      t.mock.method(current.implementation.player.host, 'nativeFESArgumentBytes', () => {
        throw new Error('PRELOAD must not use bank/SCRIPT argument getter');
      });
      t.mock.method(current.implementation.player.host, 'nativeFESScriptBytes', () => {
        throw new Error('PRELOAD must not execute SCRIPT');
      });
      t.mock.method(cache, 'preload', function (file) {
        requested.push(file);
        return preload.call(this, file);
      });
      t.mock.method(h.game, 'nativeCandidates', (file, mode) => {
        if (file === 'assets.int/screen.fes') sourceModes.push(mode);
        else modes.push(mode);
        return candidates(file, mode);
      });
      t.mock.method(h.world.storage, 'read', async (file) => {
        looseReads.push(file);
        const bytes = await storageRead(file);
        if (file === physical && ++aReads === 2 && bytes !== null)
          bank.set(2, '#filtered on final EOF rescan');
        return bytes;
      });
      const input = h.game.lookup(A).file,
        read = input.read.bind(input);
      t.mock.method(input, 'read', async (offset, size) => {
        const bytes = await read(offset, size);
        bank.set(1, C);
        await h.world.storage.write(physical, replacement);
        return bytes;
      });
      const decode = t.mock.method(h.world.runtime.imageDataBuffers, 'decodeImage', () => {
        throw new Error('PRELOAD stores encoded bytes; it does not decode metadata or pixels');
      });
      await load(h.world, current);
      assert.deepEqual(requested, [A, C, S, A]);
      assert.deepEqual(sourceModes, [3]);
      assert.deepEqual(modes, [3, 3, 3, 3]);
      assert.deepEqual(looseReads, [
        physical,
        'assets/changed.hg3',
        'assets/script(9).hg3',
        physical,
      ]);
      assert.equal(aReads, 2);
      assert.equal(decode.mock.calls.length, 0);
      assert.equal(cache.entries.size, 3);
      const pointer = cache.entries.get(cache.key(A)),
        buffers = h.world.runtime.imageDataBuffers;
      prefix(buffers, pointer, original);
      assert.equal(buffers.words(pointer)[3], 1);
      assert.deepEqual(await storageRead(physical), replacement);
      const H = ascii('#PRELOAD'),
        rowA = ascii(A),
        one = ascii('$str1'),
        two = ascii('$str2');
      assert.deepEqual(expanded, [
        H,
        rowA,
        H,
        rowA,
        one,
        H,
        rowA,
        one,
        two,
        H,
        rowA,
        one,
        two,
        H,
        rowA,
        H,
        rowA,
        one,
        two,
        H,
        rowA,
      ]);
      assert.deepEqual(current.implementation.player.root.program.preload, [
        H,
        rowA,
        one,
        two,
        H,
        rowA,
      ]);
      assert.equal(bank.get(2), '#filtered on final EOF rescan');
    } finally {
      await h.close();
    }
  });

  test(`PRELOAD plain preparation cleans whitespace once but passes the whole filename to default332: ${profile}`, async (t) => {
    const filename = 'assets.int/plain name.hg3',
      raw = Uint8Array.of(41, 42, 43),
      h = await environment(profile, {
        'assets.int/screen.fes': ascii(
          '#PRELOAD\n\t assets.int/plain\t  name.hg3  //removed\n#START\nbreak\n',
        ),
        [filename]: raw,
      });
    try {
      const current = await task(h.world),
        requested = [],
        preload = current.cache.preload;
      t.mock.method(current.cache, 'preload', function (file) {
        requested.push(file);
        return preload.call(this, file);
      });
      await load(h.world, current);
      assert.deepEqual(requested, [filename]);
      prefix(
        h.world.runtime.imageDataBuffers,
        current.cache.entries.get(current.cache.key(filename)),
        raw,
      );
      assert.deepEqual(current.implementation.player.root.program.preload, [
        ascii('#PRELOAD'),
        ascii(filename),
      ]);
    } finally {
      await h.close();
    }
  });

  test(`PRELOAD prepared interior empty row, empty file and missing file are distinct before EOF: ${profile}`, async (t) => {
    const empty = 'assets.int/empty.hg3',
      missing = 'assets.int/missing.hg3',
      h = await environment(profile, {
        'assets.int/screen.fes': prepared(
          `#PRELOAD\n\n${empty}\n${missing}\n${name}\n#START\nbreak\n`,
        ),
        [empty]: new Uint8Array(),
      });
    try {
      const current = await task(h.world),
        requested = [],
        preload = current.cache.preload;
      t.mock.method(current.cache, 'preload', function (file) {
        requested.push(file);
        return preload.call(this, file);
      });
      await load(h.world, current);
      assert.deepEqual(requested, ['', empty, missing, name]);
      assert.equal(current.cache.entries.size, 2);
      assert.equal(current.cache.entries.has(current.cache.key(missing)), false);
      const pointer = current.cache.entries.get(current.cache.key(empty));
      assert.ok(pointer);
      assert.deepEqual(
        Array.from(h.world.runtime.imageDataBuffers.words(pointer).slice(1)),
        [0, 0, 1, 0],
      );
      assert.ok(current.cache.entries.has(current.cache.key(name)));
    } finally {
      await h.close();
    }
  });

  test(`PRELOAD default resident/IMAGE ownership survives interpreter replacement and fresh without replay: ${profile}`, async (t) => {
    const source =
        '#DEFINE\nIMAGE held\n#OBJECT FILE IDN DISP\nheld assets.int/tile.hg3 -1 1\n#PRELOAD\nassets.int/tile.hg3\n#START\nbreak\n',
      h = await environment(profile, { 'assets.int/screen.fes': ascii(source) });
    let fresh,
      phase = 'initial',
      imageReads = 0;
    try {
      const current = await task(h.world),
        file = h.game.lookup(name).file,
        read = file.read.bind(file),
        expand = NativeStringBank.prototype.expandBytes,
        restoreExpansions = [];
      t.mock.method(file, 'read', (...args) => {
        if (phase === 'restore') throw new Error('PRELOAD resident source replay on fresh');
        imageReads++;
        return read(...args);
      });
      const sourceFile = h.game.lookup('assets.int/screen.fes').file,
        readSource = sourceFile.read.bind(sourceFile);
      t.mock.method(sourceFile, 'read', (...args) => {
        if (phase === 'restore') throw new Error('FES source replay on fresh');
        return readSource(...args);
      });
      t.mock.method(NativeStringBank.prototype, 'expandBytes', function (bytes) {
        if (phase === 'restore') restoreExpansions.push(new Uint8Array(bytes));
        return expand.call(this, bytes);
      });
      await load(h.world, current);
      const pointer = current.cache.entries.get(current.cache.key(name)),
        buffers = h.world.runtime.imageDataBuffers;
      assert.equal(imageReads, 1);
      assert.equal(buffers.words(pointer)[3], 1);
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      assert.equal(
        current.implementation.player.root.byKey.get('held').imageEncodedPointer,
        pointer,
      );
      assert.equal(buffers.words(pointer)[3], 2);
      assert.equal(imageReads, 1);
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      phase = 'restore';
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original fresh initialization');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const restored = fresh.world.objects.objects.get(current.id).implementation,
        next = fresh.world.runtime.imageDataBuffers;
      assert.equal(
        restored.imageCacheModel.entries.get(restored.imageCacheModel.key(name)),
        pointer,
      );
      assert.equal(restored.player.root.byKey.get('held').imageEncodedPointer, pointer);
      assert.equal(next.words(pointer)[3], 2);
      assert.equal(buffers.words(pointer)[3], 2);
      assert.deepEqual(restoreExpansions, []);
      assert.equal(imageReads, 1);
      prefix(next, pointer, encoded);
      await fresh.world.objects.destroy(current.id);
      assert.equal(
        next.owns(pointer),
        true,
        'Task deletion retires at the next normal logic phase',
      );
      await fresh.world.tick();
      assert.equal(next.owns(pointer), false);
      assert.equal(buffers.words(pointer)[3], 2);
      phase = 'reload';
      await h.world.sendEngine(
        current.id,
        h.world.main.id,
        331,
        0,
        h.world.main.context.variableBank,
      );
      assert.equal(
        buffers.words(pointer)[3],
        2,
        'pending Core handoff retains held IMAGE ref until replacement source loads',
      );
      assert.equal(imageReads, 1);
      await load(h.world, current);
      assert.equal(imageReads, 2, 'explicit332 reload reads even an existing resident key');
      assert.equal(current.cache.entries.get(current.cache.key(name)), pointer);
      assert.equal(buffers.words(pointer)[3], 1);
      await h.world.objects.release(current.id);
      assert.equal(buffers.owns(pointer), false);
    } finally {
      phase = 'close';
      await fresh?.dispose();
      await h.close();
    }
  });

  for (const boundary of ['selected260', 'bank511'])
    test(`PRELOAD ${boundary} original overflow diagnosis preserves earlier default332 residency: ${profile}`, async () => {
      const h = await environment(profile, {
        'assets.int/screen.fes': prepared(`#PRELOAD\n${name}\n$str1\n#START\nbreak\n`),
      });
      try {
        const current = await task(h.world);
        current.bank.set(1, boundary === 'selected260' ? 'x'.repeat(260) : '#' + 'x'.repeat(510));
        await assert.rejects(
          load(h.world, current),
          boundary === 'selected260' ? /260-byte destination/ : /512-byte scratch/,
        );
        const pointer = current.cache.entries.get(current.cache.key(name));
        assert.ok(pointer);
        assert.equal(h.world.runtime.imageDataBuffers.words(pointer)[3], 1);
        prefix(h.world.runtime.imageDataBuffers, pointer, encoded);
      } finally {
        await h.close();
      }
    });
}

test('PRELOAD raw section keeps headers, duplicate sections, interior blanks and opaque whitespace without token/dequote reduction', () => {
  const raw = '#PRELOAD\r\n  a  b\t \r\n\r\n;literal\r\n#PRELOAD\r\n"quoted name"\r\n',
    program = parseProgram(ascii(raw), { prepared: true });
  assert.deepEqual(program.preload, [
    ascii('#PRELOAD'),
    ascii('  a  b\t '),
    new Uint8Array(),
    ascii(';literal'),
    ascii('#PRELOAD'),
    ascii('"quoted name"'),
  ]);
  assert.deepEqual(fesPreloadLine(program.preload, 0), ascii('  a  b\t '));
  assert.equal(fesPreloadLine(program.preload, 4), null);
});

test('PRELOAD original raw/bank scratch and selected CString limits use their actual NUL writes', () => {
  const bank = new NativeStringBank(),
    expand = (bytes) => bank.expandBytes(bytes),
    selected = ascii('x'.repeat(259));
  assert.deepEqual(fesPreloadLine([selected], 0), selected);
  assert.throws(() => fesPreloadLine([ascii('x'.repeat(260))], 0), /260-byte destination/);
  assert.deepEqual(fesPreloadLine([ascii('#'.repeat(511)), ascii('ok')], 0), ascii('ok'));
  assert.throws(() => fesPreloadLine([ascii('#'.repeat(512))], 0), /512-byte scratch/);
  bank.set(1, '#' + 'x'.repeat(509));
  assert.deepEqual(fesPreloadLine([ascii('$str1'), ascii('ok')], 0, expand), ascii('ok'));
  bank.set(1, '#' + 'x'.repeat(510));
  assert.throws(() => fesPreloadLine([ascii('$str1')], 0, expand), /512-byte scratch/);
  bank.set(1, '');
  const longRaw = ascii('$str1'.repeat(104));
  assert.equal(longRaw.length, 520);
  assert.deepEqual(fesPreloadLine([longRaw], 0, expand), new Uint8Array());
  assert.throws(() => fesPreloadLine([longRaw], 0), /512-byte scratch/);
});

test('PRELOAD selected bytes preserve bank CP932 aliases and own the CString result', () => {
  const bank = new NativeStringBank(),
    value = Uint8Array.of(0x87, 0x90);
  bank.setBytes(2, value);
  const selected = fesPreloadLine([ascii('#PRELOAD'), ascii('$str2')], 0, (bytes) =>
    bank.expandBytes(bytes),
  );
  assert.deepEqual(selected, Uint8Array.of(0x87, 0x90));
  selected[0] = 0;
  assert.deepEqual(bank.getBytes(2), value);
  assert.deepEqual(fesPreloadLine([Uint8Array.of(65, 0, 66)], 0), Uint8Array.of(65));
});

for (const profile of startupProfiles)
  test(`PRELOAD prepared leading-space pseudoheader stays ordinary START data without image I/O: ${profile}`, async (t) => {
    const h = await environment(profile, {
      'assets.int/screen.fes': prepared('#START\nbreak\n #PRELOAD\nassets.int/tile.hg3\n'),
    });
    try {
      const current = await task(h.world),
        requested = [],
        preload = current.cache.preload,
        file = h.game.lookup(name).file,
        read = file.read.bind(file);
      let imageReads = 0;
      t.mock.method(current.cache, 'preload', function (filename) {
        requested.push(filename);
        return preload.call(this, filename);
      });
      t.mock.method(file, 'read', (...args) => {
        imageReads++;
        return read(...args);
      });
      await load(h.world, current);
      assert.equal(imageReads, 0, 'raw byte0 is space, so no PRELOAD section or image I/O exists');
      assert.deepEqual(requested, []);
      assert.equal(current.cache.entries.size, 0);
      assert.deepEqual(current.implementation.player.root.program.preload, []);
      assert.deepEqual(current.implementation.player.root.program.blocks.START, [
        ascii('break'),
        ascii(' #PRELOAD'),
        ascii(name),
      ]);
    } finally {
      await h.close();
    }
  });
