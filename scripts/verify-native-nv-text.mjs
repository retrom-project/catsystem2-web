// SPDX-License-Identifier: MPL-2.0
// Differential of the original NV task message/frame handlers. Only the graph
// backend and base clock boundary are substituted; glyph/layout code is original.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeTextRuntime, NativeNVTextWriter } from '../oracle/text.mjs';
import { NativeTextRuntime as JSTextRuntime } from '../src/native/text.mjs';
import { NativeNVTextTask } from '../src/native/text-task.mjs';
import { installNativeGraphics } from '../src/native/graphics.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const fontBytes = await encodeHG2(
  {
    width: 2,
    height: 2,
    rgba: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255),
  },
  { id: 1 },
);
const glyphs = {
  measure: (font, text) => ({
    width: text.length * 12,
    height: 24,
    ascent: 20,
    descent: 4,
    averageWidth: 12,
    maximumWidth: 24,
  }),
  glyph: () => ({
    width: 12,
    height: 20,
    originX: 0,
    originY: 20,
    advanceX: 12,
    advanceY: 0,
    alpha: new Uint8Array(240).fill(255),
  }),
};
const configs = [
  [
    'nekopara-vol3-engine-2.6.1.76',
    'engine.exe',
    {
      handler: 0x6369b0,
      tick: 0x6368a0,
      baseFrame: 0x5dcc80,
      clock: 0x5dd440,
      graph: 0x5e0920,
      destroy: 0x675ea0,
      shown: 0x676910,
      display: 0x6776f0,
      blit: 0x677690,
      fill: 0x6745b0,
      first: 489,
      state: 302,
    },
  ],
  [
    'sdk-4.01-engine-2.6.1.74',
    'sdk-engine.exe',
    {
      handler: 0x50cce0,
      tick: 0x50cbd0,
      baseFrame: 0x4b8ea0,
      clock: 0x4b9670,
      graph: 0x4bcc70,
      destroy: 0x54cfb0,
      shown: 0x54da30,
      display: 0x54e7f0,
      blit: 0x54e790,
      fill: 0x54b6a0,
      first: 463,
      state: 286,
    },
  ],
];
let total = 0;
for (const [profile, , abi] of configs) {
  const flag = profile.startsWith('sdk-') ? '--sdk' : '--game',
    index = process.argv.indexOf(flag);
  if (index < 0) continue;
  const e = await NativeEngineProcess.open({
      profile,
      bytes: new Uint8Array(await fs.readFile(process.argv[index + 1])),
    }),
    p = e.process,
    r = new NativeTextRuntime(e, { glyphs }),
    candidate = new JSTextRuntime(
      { ...e, profile: e.profile, process: e.process, registerFeature() {} },
      { glyphs },
    );
  let clock = 0,
    graph = null,
    shown = true,
    originalVRAM = new Uint8Array(256 * 256 * 4),
    checked = 0;
  const patch = (address, name, count, fn) =>
      e.patch(address, name, count, fn, { calleePops: true }),
    bitmapFrame = (bitmap) => {
      const w = p.load(bitmap + 4),
        h = p.load(bitmap + 8),
        data = p.load(bitmap + 12),
        stride = p.load(bitmap + 20),
        rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const source = p.read(data + y * stride + x * 4, 4),
            at = (y * w + x) * 4;
          rgba.set([source[2], source[1], source[0], source[3]], at);
        }
      return { width: w, height: h, rgba };
    };
  patch(abi.baseFrame, 'authored NV base clock', 2, () => 1);
  patch(abi.clock, 'authored NV task clock', 0, () => clock);
  patch(abi.graph, 'authored NV graph messages', 6, ([, message, _w, l]) => {
    if (profile.startsWith('sdk-')) message += 2;
    if (message === 41) {
      graph = {
        width: new DataView(p.read(l + 12, 4).buffer).getFloat32(0, true),
        height: new DataView(p.read(l + 16, 4).buffer).getFloat32(0, true),
      };
    } else if (message === 47) shown = Boolean(l);
    else if (message !== 51) throw new Error('unknown graph msg ' + message);
    return 0;
  });
  patch(abi.destroy, 'authored NV destroy graph', 1, () => {
    graph = null;
    return 1;
  });
  patch(abi.shown, 'authored NV graph visibility', 2, ([, out]) => {
    if (!graph) return 0;
    p.store(out, Number(shown));
    return 1;
  });
  patch(abi.display, 'authored NV graph rendering gate', 2, () => 1);
  patch(abi.blit, 'authored NV VRAM bitmap copy', 7, ([bitmap, sx, sy, w, h, dx, dy]) => {
    const frame = bitmapFrame(bitmap);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const tx = (dx | 0) + x,
          ty = (dy | 0) + y,
          fx = (sx | 0) + x,
          fy = (sy | 0) + y;
        if (
          tx >= 0 &&
          ty >= 0 &&
          tx < 256 &&
          ty < 256 &&
          fx >= 0 &&
          fy >= 0 &&
          fx < frame.width &&
          fy < frame.height
        )
          originalVRAM.set(
            frame.rgba.subarray((fy * frame.width + fx) * 4, (fy * frame.width + fx) * 4 + 4),
            (ty * 256 + tx) * 4,
          );
      }
    return 1;
  });
  patch(abi.fill, 'authored NV clear VRAM', 4, ([dx, dy, w, h]) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const tx = (dx | 0) + x,
          ty = (dy | 0) + y;
        if (tx >= 0 && ty >= 0 && tx < 256 && ty < 256)
          originalVRAM.fill(0, (ty * 256 + tx) * 4, (ty * 256 + tx) * 4 + 4);
      }
    return 1;
  });
  try {
    for (let variant = 0; variant < 12; variant++) {
      const world = {
        profile,
        game: { width: 256, height: 256 },
        objects: new NativeObjects(),
        runtime: { handles: new NativeHandles(), register() {} },
        base: () => ({
          message: () => {
            throw new Error('base');
          },
        }),
        configuration: {
          fields: {
            texture: {
              size: Uint32Array.of(256, 256),
              grid: Uint32Array.of(1, 1),
              bppY: Uint32Array.of(0, 1),
              bpp: 32,
              areas: Array.from({ length: 8 }, (_, i) =>
                Uint32Array.from(
                  i ? [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff] : [0, 0, 1, 1],
                ),
              ),
            },
          },
        },
      };
      installNativeGraphics(world);
      const record = { id: 12, kind: 49, state: 'active', effectiveFrame: 0, pausedFrames: 0 },
        task = new NativeNVTextTask({ world, runtime: async () => candidate }, record),
        raw = p.allocate(0x600, true),
        out = p.allocate(4, true),
        packet = p.allocate(r.bindings('nv').packetSize, true),
        string = p.allocate(128, true),
        position = p.allocate(8, true),
        memory = {
          bytes: (a, n) => p.read(a, n),
          load: (a) => p.load(a),
          store: (a, v) => p.store(a, v),
          write: (a, b) => p.write(a, b),
        };
      p.store(raw + 4, 11);
      p.store(raw + 104, 1);
      p.store(raw + (abi.state + 4) * 4, 1);
      graph = null;
      shown = true;
      clock = 0;
      originalVRAM.fill(0);
      const compare = async (label) => {
        checked++;
        const js = [
            Number(task.text.active),
            task.text.elapsed,
            task.text.lastFrame,
            task.text.pageLimit >>> 0,
            Number(task.text.done),
            Number(task.text.sectionPending),
          ],
          native = Array.from({ length: 6 }, (_, i) => p.load(raw + (abi.state + i) * 4));
        assert.deepEqual(js, native, profile + ' ' + variant + ' ' + label + ' fields');
        if (task.text.writer) {
          const a = new NativeNVTextWriter(r, {
            pointer: p.load(raw + 684),
            mode: 'nv',
            config: null,
          });
          assert.deepEqual(
            (await task.writer()).frame(),
            a.frame(),
            profile + ' ' + variant + ' ' + label + ' frame',
          );
        }
        const frame = await (await world.graphics.ensureVRAM(256, 256)).frame();
        assert.deepEqual(
          Buffer.from(frame.rgba),
          Buffer.from(originalVRAM),
          profile + ' ' + variant + ' ' + label + ' VRAM',
        );
      };
      const send = async (op, w = 0, l = 0, context = {}) => {
        p.store(out, 0xcccccccc);
        await e.call(abi.handler, [0, abi.first + op, w >>> 0, l >>> 0, 0, out], raw);
        const expected = p.load(out),
          coordinates = op === 12 ? p.read(w, 8) : null,
          actual = await task.message([0, 489 + op, w >>> 0, l >>> 0], {
            payload: memory,
            ...context,
          });
        if (coordinates) assert.deepEqual(p.read(w, 8), coordinates);
        if (op === 6) assert.equal(actual >>> 0, expected);
        await compare('message ' + op);
      };
      const tick = async (frame) => {
        clock = frame;
        record.effectiveFrame = frame;
        await e.call(abi.tick, [frame, 0], raw);
        await task.tick(frame);
        await compare('frame ' + frame);
      };
      try {
        const cfg = await r.defaultPacket('nv'),
          view = new DataView(cfg.buffer),
          size = r.bindings('nv').configSize;
        view.setUint32(4, 96, true);
        view.setUint32(8, 64, true);
        view.setUint32(20, 96, true);
        view.setUint32(24, 64, true);
        view.setUint32(140, variant % 2, true);
        view.setUint32(4 + size, 3, true);
        view.setUint32(8 + size, 5, true);
        view.setUint32(12 + size, 1, true);
        p.write(packet, cfg);
        await send(1, 0, packet);
        const fontBlock = r.buffers.createPointer(fontBytes);
        await send(10, 0, fontBlock, { resourceBytes: fontBytes });
        await send(11, 0x8740, 1);
        await send(14);
        p.write(string, encodeCP932('A\\nB\0'));
        await send(3, 0, string);
        p.write(string, encodeCP932('Side\0'));
        await send(4, 0, string);
        await send(8);
        await send(9, 0, variant % 3 === 0 ? 0 : -1);
        for (const frame of [0, 1, 3, 12, 50]) await tick(frame);
        await send(6);
        await send(12, position, position + 4);
        await send(13, 0, 1);
        await send(14);
        p.write(string, encodeCP932('Next\0'));
        await send(3, 0, string);
        await send(9, 0, -1);
        for (const frame of [51, 52, 70]) await tick(frame);
        await send(14);
        record.userValue = 1;
        record.pausedFrames = 4;
        clock = 66;
        record.effectiveFrame = 70;
        await e.call(abi.tick, [70, 0], raw);
        await task.tick(70);
        await compare('paused-frame');
        record.userValue = 0;
        record.pausedFrames = 0;
        clock = 70;
        await send(17);
        await send(16);
        await send(15);
        await send(2, 0, packet);
        await send(5);
        await send(14);
        p.write(string, encodeCP932('Final\0'));
        await send(3, 0, string);
        await send(9, 0, -1);
        await send(7);
        await send(6);
      } finally {
        await task.close();
        const writer = p.load(raw + 684);
        if (writer) {
          await r.call(r.bindings('nv').destroy, [], writer);
          p.free(writer);
        }
        for (const a of [raw, out, packet, string, position]) p.free(a);
      }
    }
  } finally {
    await candidate.close();
    await e.close();
  }
  total += checked;
  console.log(profile, checked, 'original NV task comparisons agree');
}

if (!total)
  throw new Error(
    'Usage: node scripts/verify-native-nv-text.mjs --game /mounted/game.exe --sdk /mounted/sdk.exe',
  );
console.log(total, 'original NV task comparisons agree');
