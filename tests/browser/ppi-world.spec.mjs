// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { kcsProgram } from '../helpers.mjs';

test('a mounted game PPI preserves original particle ties across native planes and a fresh World', async ({
  page,
}) => {
  const { CATSYSTEM2_ENGINE_EXE, CATSYSTEM2_EMOTE_DLL, CATSYSTEM2_PPI_FIXTURES } = process.env;
  test.skip(!CATSYSTEM2_ENGINE_EXE || !CATSYSTEM2_EMOTE_DLL || !CATSYSTEM2_PPI_FIXTURES);
  test.setTimeout(180000);
  const golden = JSON.parse(
      await readFile(new URL('../fixtures/ppi-graph-world-golden.json', import.meta.url)),
    ),
    rgba = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < rgba.length; i += 4)
    rgba.set(i < rgba.length / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
  const [exe, emote, plugin, atlas] = await Promise.all([
    readFile(CATSYSTEM2_ENGINE_EXE),
    readFile(CATSYSTEM2_EMOTE_DLL),
    readFile(resolve(CATSYSTEM2_PPI_FIXTURES, golden.plugin)),
    encodeHG2({ width: 64, height: 64, rgba }, { crop: false }),
  ]);
  expect(createHash('sha256').update(exe).digest('hex')).toBe(golden.engineSHA256);
  expect(createHash('sha256').update(plugin).digest('hex')).toBe(golden.pluginSHA256);
  const files = new Map([
    ['engine.exe', exe],
    ['emotedriver.dll', emote],
    [golden.plugin, plugin],
    ['authored-grain.hg2', atlas],
    ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
  ]);
  await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
    route.fulfill({
      path: new URL('../fixtures/browser-native-world.mjs', import.meta.url).pathname,
      contentType: 'text/javascript',
    }),
  );
  await page.route('**/ppi-world-fixture/**', (route) => {
    const name = decodeURIComponent(
        new URL(route.request().url()).pathname.slice('/ppi-world-fixture/'.length),
      ),
      bytes = files.get(name);
    return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
  });
  await page.goto('/');
  const result = await page.evaluate(
    async ({ names, plugin, frames, origins, cropSize }) => {
      const [{ browserNativeWorld, placeBrowserNativePlane }, { floatBits }] = await Promise.all([
          import('/tests/fixtures/browser-native-world.mjs'),
          import('/src/kcs.mjs'),
        ]),
        files = new Map(
          await Promise.all(
            names.map(async (name) => [
              name,
              new Uint8Array(
                await (await fetch('/ppi-world-fixture/' + encodeURIComponent(name))).arrayBuffer(),
              ),
            ]),
          ),
        ),
        width = 1280,
        height = 720,
        make = () =>
          browserNativeWorld({
            profile: 'nekopara-vol3-engine-2.6.1.76',
            files,
            width,
            height,
            storage: { read: async () => null, write: async () => true },
          }),
        digest = async (bytes) =>
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
        first = make(),
        texture = first.configuration.fields.texture;
      texture.size.set([64, 64]);
      texture.grid.set([1, 1]);
      texture.bppY.set([1, 1]);
      texture.areas[0].set([0, 0, 1, 1]);
      let fresh;
      try {
        await first.initialize('main.kcs');
        first.random.integer.seed(4357);
        first.random.real.seed(4357);
        const task = first.main,
          machine = task.machine,
          call = (id, args) => first.runtime.native('main', id, args, machine, task),
          create = async (kind, name) => {
            machine.writeString(name, 128);
            const { value } = await call(0x42, [kind, first.nativeTaskID(first.root), 128]);
            return first.resolveTaskID(value, task.id);
          },
          background = await create(2, 'grain backdrop');
        await placeBrowserNativePlane(first, background, {
          width,
          height,
          color: 0xff184668,
          priority: 1000,
        });
        const particle = await create(16, 'game PPI'),
          nativeID = first.nativeTaskID(particle);
        machine.writeString(plugin, 160);
        machine.writeString('authored-grain.hg2', 192);
        for (let i = 0; i < 32; i++) machine.store(256 + 4 * i, floatBits(1));
        const loaded = await call(0x2b5, [nativeID, 160, 192, 4, floatBits(3000), 256]);
        await call(0x110, [nativeID]);
        const front = await create(2, 'grain foreground');
        await placeBrowserNativePlane(first, front, {
          width: 80,
          height: 64,
          position: [640, 328, 0],
          color: 0x807a2284,
          priority: 4000,
        });

        const origin = first.frame,
          bank = (world) => world.particles.get(particle).bank,
          initialRecords = await digest(bank(first).instance.records()),
          sample = async (world, frame, step = true) => {
            if (step) {
              // Match the original Wine probe's callback frame deltas.
              world.frame = origin + frame;
              await world.tick();
            }
            const current = bank(world),
              gpu = world.stageRenderer.gpu,
              drawGeometry = gpu.drawGeometry,
              layers = [];
            let vertices;
            gpu.drawGeometry = function (geometry, image, options) {
              if (image === current.image) {
                layers.push('particle');
                const rows = geometry.flatMap((quad) => quad.vertices);
                vertices = new DataView(new ArrayBuffer(rows.length * 28));
                for (const [i, v] of rows.entries()) {
                  [v.x, v.y, v.z, v.w, 0, v.u, v.v].forEach((value, j) =>
                    vertices.setFloat32(i * 28 + j * 4, value, true),
                  );
                  vertices.setUint32(i * 28 + 16, v.color, true);
                }
              } else layers.push(geometry[0].vertices[0].color);
              return drawGeometry.call(this, geometry, image, options);
            };
            try {
              await world.stageRenderer.render(
                world.graphics.stage,
                null,
                world.particles.drawItems(),
              );
            } finally {
              gpu.drawGeometry = drawGeometry;
            }
            const pixels = gpu.pixels(),
              crops = origins.map(([x, y]) =>
                Array.from({ length: cropSize }, (_, row) => {
                  const start = ((y + row) * width + x) * 4;
                  return [...pixels.subarray(start, start + cropSize * 4)];
                }).flat(),
              );
            return {
              frame: current.instance.frame,
              before: current.instance.before,
              records: await digest(current.instance.records()),
              vertices: await digest(vertices.buffer),
              fullFrame: await digest(pixels),
              layers,
              crops,
            };
          };
        const samples = [];
        for (const frame of frames.slice(0, 3)) samples.push(await sample(first, frame));
        fresh = make();
        await fresh.restore(structuredClone(first.snapshot()));
        const restored = [await sample(fresh, frames[2], false)];
        for (const frame of frames.slice(3)) {
          samples.push(await sample(first, frame));
          restored.push(await sample(fresh, frame));
        }
        return { loaded, initialRecords, samples, restored };
      } finally {
        await fresh?.close();
        await first.close();
      }
    },
    {
      names: [...files.keys()],
      plugin: golden.plugin,
      frames: golden.frames.map(({ frame }) => frame),
      origins: golden.origins,
      cropSize: golden.cropSize,
    },
  );
  expect(result.loaded).toEqual({ control: 1, value: 1 });
  expect(result.initialRecords).toBe(golden.initialRecordsSHA256);
  expect(result.restored).toEqual(result.samples.slice(2));
  const pixels = inflateSync(Buffer.from(golden.rgbaDeflate, 'base64')),
    cropBytes = golden.cropSize ** 2 * 4;
  expect(pixels.length).toBe(golden.frames.length * golden.origins.length * cropBytes);
  for (const [i, expected] of golden.frames.entries()) {
    const sample = result.samples[i];
    expect(sample.frame).toBe(expected.frame);
    expect(sample.before).toBe(golden.frames[i - 1]?.frame ?? 0xffffffff);
    expect(sample.records).toBe(expected.recordsSHA256);
    expect(sample.vertices).toBe(expected.verticesSHA256);
    expect(sample.layers).toEqual([0xff184668, 'particle', 0x807a2284]);
    for (const [j, crop] of sample.crops.entries()) {
      const start = (i * golden.origins.length + j) * cropBytes,
        maxError = Math.max(...crop.map((value, k) => Math.abs(value - pixels[start + k])));
      expect(maxError, `frame ${sample.frame}, crop ${j}`).toBeLessThanOrEqual(
        j === golden.tieCrop ? 0 : 1,
      );
    }
  }
});
