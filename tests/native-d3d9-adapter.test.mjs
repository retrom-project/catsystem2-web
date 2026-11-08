// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { EmoteD3D9 } from '../src/emote/native-d3d.mjs';
import { NativeEmoteDevice } from '../src/emote/native-device.mjs';

const invalid = 0x8876086c,
  unavailable = 0x8876086a;
const invoke = (p, object, slot, args = []) =>
  p.call(p.load(p.load(object) + slot * 4), [object, ...args]);
const parameters = (p, address, changes = {}) => {
  const words = [8, 8, 22, 1, 0, 0, 3, 1, 1, 1, 80, 1, 0, 0];
  for (const [index, value] of Object.entries(changes)) words[index] = value;
  words.forEach((word, index) => p.store(address + index * 4, word));
  return words;
};

test('native Texture9 AddDirtyRect retains live level-zero storage and accumulated dirty bounds', async () => {
  const p = new PE32Process(await loadUnicorn()),
    d = new EmoteD3D9(p, { width: 8, height: 8 }),
    out = p.allocate(32, true);
  try {
    assert.equal(invoke(p, d.device, 23, [8, 8, 1, 0, 21, 1, out, 0]), 0);
    const pointer = p.load(out),
      texture = d.textureData(pointer);
    assert.equal(texture, d.objects.get(pointer));
    assert.equal(d.textureData(d.backbuffer), null);
    assert.deepEqual(texture.dirtyRectangle, [0, 0, 8, 8]);
    texture.dirtyRectangle = null;
    [1, 2, 5, 6].forEach((word, i) => p.store(out + i * 4, word));
    assert.equal(invoke(p, pointer, 21, [out]), 0);
    assert.deepEqual(texture.dirtyRectangle, [1, 2, 5, 6]);
    [0, 3, 2, 7].forEach((word, i) => p.store(out + i * 4, word));
    assert.equal(invoke(p, pointer, 21, [out]), 0);
    assert.deepEqual(texture.dirtyRectangle, [0, 2, 5, 7]);
    const original = texture.pixels,
      revision = texture.revision;
    p.store(out, 0xffffffff);
    assert.equal(invoke(p, pointer, 21, [out]), invalid);
    assert.equal(texture.revision, revision);
    assert.equal(invoke(p, pointer, 21, [0]), 0);
    assert.equal(texture.pixels, original);
    assert.deepEqual(texture.dirtyRectangle, [0, 0, 8, 8]);
    assert.equal(invoke(p, pointer, 19, [0, out + 16, 0, 0x8000]), 0);
    texture.dirtyRectangle = null;
    assert.equal(invoke(p, pointer, 20, [0]), 0);
    assert.equal(texture.dirtyRectangle, null);
    assert.equal(invoke(p, pointer, 19, [0, out + 16, 0, 0]), 0);
    assert.deepEqual(texture.dirtyRectangle, [0, 0, 8, 8]);
    assert.equal(invoke(p, pointer, 20, [0]), 0);
  } finally {
    d.close();
    p.close();
  }
});

test('the real stdcall adapter ABI enumerates its device and reports only its implemented pipeline', async () => {
  const p = new PE32Process(await loadUnicorn()),
    d = new EmoteD3D9(p, { width: 8, height: 8 }),
    out = p.allocate(1200, true);
  try {
    assert.equal(invoke(p, d.d3d, 4), 1);
    assert.equal(invoke(p, d.d3d, 6, [0, 22]), 1);
    assert.equal(invoke(p, d.d3d, 6, [1, 22]), 0);
    assert.equal(invoke(p, d.d3d, 7, [0, 22, 0, out]), 0);
    assert.deepEqual(
      Array.from({ length: 4 }, (_, i) => p.load(out + i * 4)),
      [8, 8, 60, 22],
    );
    assert.equal(invoke(p, d.d3d, 9, [0, 1, 22, 22, 1]), 0);
    assert.equal(invoke(p, d.d3d, 9, [0, 1, 22, 23, 1]), unavailable);
    assert.equal(invoke(p, d.d3d, 10, [0, 1, 22, 0x400, 3, 21]), 0x0876086f);
    assert.equal(invoke(p, d.d3d, 14, [1, 1, out]), invalid);
    p.store(out + 304, 0x12345678);
    assert.equal(invoke(p, d.d3d, 14, [0, 1, out]), 0);
    assert.equal(p.load(out + 304), 0x12345678);
    assert.equal(p.load(out + 28) & 0x10000, 0);
    assert.equal(p.load(out + 36) & 0x40000, 0);
    assert.equal(p.load(out + 148), 1);
    assert.equal(p.load(out + 152), 1);
    assert.equal(p.load(out + 196), 0);
    assert.equal(p.load(out + 204), 0);
    assert.equal(invoke(p, d.d3d, 11, [0, 1, 22, 1, 4, out]), unavailable);
    assert.equal(p.load(out), 0);
    assert.equal(invoke(p, d.d3d, 11, [0, 1, 22, 1, 0, out]), 0);
    assert.equal(p.load(out), 1);
    assert.equal(invoke(p, d.d3d, 5, [0, 0, out]), 0);
    assert.equal(p.string(out), 'catsystem2-web');
    p.store(out + 1100, 0x11223344);
    assert.equal(invoke(p, d.d3d, 5, [1, 0, out]), invalid);
    assert(p.read(out, 1100).every((byte) => byte === 0));
    assert.equal(p.load(out + 1100), 0x11223344);
  } finally {
    d.close();
    p.close();
  }
});

test('device creation preserves unsupported-format failure and lockable XRGB back-buffer bytes', async () => {
  const p = new PE32Process(await loadUnicorn()),
    uploads = [],
    d = new EmoteD3D9(p, { width: 8, height: 8, onDraw: (command) => uploads.push(command) }),
    pp = p.allocate(56, true),
    out = p.allocate(320, true);
  try {
    parameters(p, pp, { 10: 71 });
    assert.equal(invoke(p, d.d3d, 16, [0, 1, 1, 0x24, pp, out]), unavailable);
    assert.equal(p.load(out), 0);
    parameters(p, pp);
    assert.equal(invoke(p, d.d3d, 16, [0, 1, 1, 0x24, pp, out]), 0);
    assert.equal(p.load(out), d.device);
    assert.equal(invoke(p, d.device, 9, [out]), 0);
    assert.deepEqual(
      Array.from({ length: 4 }, (_, i) => p.load(out + i * 4)),
      [0, 1, 1, 0x24],
    );
    assert.equal(invoke(p, d.device, 18, [0, 0, 0, out]), 0);
    const surface = p.load(out);
    assert.equal(surface, d.backbuffer);
    assert.equal(invoke(p, surface, 13, [out, 0, 0]), 0);
    assert.equal(p.load(out), 32);
    p.write(p.load(out + 4), [0, 0, 255, 17]);
    assert.equal(invoke(p, surface, 13, [out, 0, 0]), invalid);
    assert.equal(invoke(p, surface, 14), 0);
    assert.equal(invoke(p, surface, 14), invalid);
    assert.deepEqual([...uploads.at(-1).frame.rgba.slice(0, 4)], [255, 0, 0, 255]);
    assert.equal(invoke(p, d.device, 4), 64 * 1024 * 1024 - 8 * 8 * 6);
    const iid = p.allocate(16, true);
    [0xd0223b96, 0x43fdbf7a, 0x3ba4bd92, 0xebb9820d].forEach((word, i) =>
      p.store(iid + i * 4, word),
    );
    assert.equal(invoke(p, d.device, 0, [iid, out]), 0);
    assert.equal(p.load(out), d.device);
    p.zero(iid, 16);
    assert.equal(invoke(p, d.device, 0, [iid, out]), 0x80004002);
    assert.equal(p.load(out), 0);
  } finally {
    d.close();
    p.close();
  }
});

test('an injected Direct3D device remains owned by the renderer when E-mote closes', async () => {
  const p = new PE32Process(await loadUnicorn()),
    d3d = new EmoteD3D9(p, { width: 8, height: 8 }),
    device = new NativeEmoteDevice(null, { process: p, d3d });
  try {
    assert.equal(device.d3d, d3d);
    assert.equal(device.ownsD3D, false);
    assert.equal(device.ownsProcess, false);
    let batchesClosed = 0;
    d3d.sceneBatch = () => batchesClosed++;
    device.close();
    assert.equal(batchesClosed, 0);
    assert.equal(d3d.closed, undefined);
    assert.equal(invoke(p, d3d.d3d, 4), 1);
  } finally {
    d3d.close();
    p.close();
  }
});

test('CreateDevice, GetCaps, Reset and Release match native x87/MXCSR control-word records', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-d3d9-control-golden.json', import.meta.url)),
    ),
    p = new PE32Process(await loadUnicorn()),
    d = new EmoteD3D9(p, { width: 8, height: 8 }),
    pp = p.allocate(56, true),
    out = p.allocate(304, true),
    controls = (cw, mxcsr) => {
      p.cpu.reg_write_i32(p.uc.X86_REG_FPCW, cw);
      p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, mxcsr);
    },
    state = () => [
      p.cpu.reg_read_i32(p.uc.X86_REG_FPCW) >>> 0,
      p.cpu.reg_read_i32(p.uc.X86_REG_MXCSR) >>> 0,
    ];
  try {
    assert.equal(
      createHash('sha256')
        .update(
          await readFile(new URL('../scripts/native-d3d9-adapter-oracle.cpp', import.meta.url)),
        )
        .digest('hex'),
      golden.sourceSHA256,
    );
    for (const row of golden.cases) {
      parameters(p, pp);
      controls(row[1], row[2]);
      assert.equal(invoke(p, d.d3d, 16, [0, 1, 1, row[0], pp, out]), row[3]);
      assert.deepEqual(state(), row.slice(4, 6));
      controls(row[1], row[2]);
      assert.equal(invoke(p, d.device, 7, [out]), 0);
      assert.deepEqual(state(), row.slice(6, 8));
      controls(row[1], row[2]);
      assert.equal(invoke(p, d.device, 16, [pp]), row[8]);
      assert.deepEqual(state(), row.slice(9, 11));
      controls(row[1], row[2]);
      assert.equal(invoke(p, d.device, 2), 0);
      assert.deepEqual(state(), row.slice(11, 13));
    }
  } finally {
    d.close();
    p.close();
  }
});
