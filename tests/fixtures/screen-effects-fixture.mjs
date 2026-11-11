// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../../web/transitional-entry.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { kcsProgram, memoryGame } from '../helpers.mjs';
import { NativeScreenEffects as OracleEffects } from '../../oracle/screen-effect-original.mjs';
import { NativeEffectCommands as OracleCommands } from '../../oracle/effect-commands-original.mjs';
import { NATIVE_SCREEN_EFFECT_KINDS } from '../../src/native/screen-effect.mjs';
import { floatBits } from '../../src/kcs.mjs';
export async function screenOracleWorld(fixture) {
  const profile = fixture.profile,
    files = {
      'engine.exe': fixture.bytes,
      'main.kcs': kcsProgram([[37, 2048], [43, 0xd1, 4], [59]]),
    };
  if (profile === 'nekopara-vol3-engine-2.6.1.76')
    files['emotedriver.dll'] = new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
  const game = memoryGame(files),
    configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom(17);
  game.width = 65;
  game.height = 49;
  Object.assign(configuration.screen, {
    width: 65,
    height: 49,
    currentWidth: 65,
    currentHeight: 49,
    virtualWidth: 65,
    virtualHeight: 49,
  });
  const world = new NativeWorld({
    game,
    images: {},
    host: {},
    profile,
    configuration,
    random,
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
  world.stageRenderer.gpu = new ScreenVectorGPU(65, 49);
  world.registerNativeFeature('screen-effects', (engine) => OracleEffects.open(engine, world));
  for (const kind of NATIVE_SCREEN_EFFECT_KINDS)
    world.objects.factories.set(kind, async (record, _objects, options) =>
      (await world.getNativeFeature('screen-effects')).create(record, options),
    );
  try {
    await world.initialize('main.kcs');
    const effects = await world.getNativeFeature('screen-effects'),
      commands = new OracleCommands(world.nativeEngine, world);
    await commands.apply(0x238, [floatBits(0), floatBits(60000)], world.main.machine, world.main);
    return { world, effects, commands, device: world.nativeEngine.features.get('renderer').d3d };
  } catch (error) {
    await world.close({ flushFiles: false });
    throw error;
  }
}
// Geometry-only adapter. It records submitted vectors and clear operations.
// Pixel equivalence is exercised with the actual WebGL renderer in Chromium.
export class ScreenVectorGPU {
  constructor(width = 65, height = 49) {
    this.gl = { MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => 4096 };
    this.primaryTarget = this.createRenderTarget(width, height);
    this.primaryDepthStencil = this.createDepthStencil(width, height);
    this.draws = [];
    this.drawing = false;
  }
  get target() {
    return this.activeTarget ?? this.primaryTarget;
  }
  beginNativeBatch() {
    return () => {};
  }
  close() {}
  createRenderTarget(width, height, rgba) {
    return {
      owner: this,
      width,
      height,
      bytes: rgba?.slice() ?? new Uint8Array(width * height * 4),
    };
  }
  createDepthStencil(width, height, format = 75) {
    return { owner: this, width, height, format, bytes: new Uint8Array(width * height * 4) };
  }
  withRenderTarget(target, callback) {
    const previous = this.activeTarget,
      drawing = this.drawing;
    this.activeTarget = target;
    this.drawing = true;
    try {
      return callback();
    } finally {
      this.activeTarget = previous;
      this.drawing = drawing;
    }
  }
  async withRenderTargetAsync(target, callback) {
    const previous = this.activeTarget,
      drawing = this.drawing;
    this.activeTarget = target;
    this.drawing = true;
    try {
      return await callback();
    } finally {
      this.activeTarget = previous;
      this.drawing = drawing;
    }
  }
  clear({ flags, color = 0 }) {
    if (flags & 1)
      for (let at = 0; at < this.target.bytes.length; at += 4)
        this.target.bytes.set(
          [(color >>> 16) & 255, (color >>> 8) & 255, color & 255, color >>> 24],
          at,
        );
  }
  drawGeometry(geometry) {
    if (!geometry.length) return;
    this.draws.push(
      structuredClone(
        geometry.flatMap(({ vertices }) =>
          vertices.length === 3 ? vertices : [0, 1, 2, 1, 3, 2].map((i) => vertices[i]),
        ),
      ),
    );
  }
  pixels(target = this.primaryTarget) {
    return target.bytes.slice();
  }
  uploadRenderTarget(target, frame) {
    target.bytes.set(frame.rgba);
  }
  releaseTextureFrame() {}
  destroyRenderTarget(target) {
    target.destroyed = true;
  }
  destroyDepthStencil(depth) {
    depth.destroyed = true;
  }
  snapshotDepthStencil(depth) {
    return {
      width: depth.width,
      height: depth.height,
      format: depth.format,
      bytes: depth.bytes.slice(),
    };
  }
  restoreDepthStencil(depth, state) {
    depth.bytes.set(state.bytes);
  }
}
export function rawScreenVertices(raw) {
  const view = new DataView(raw.bytes.buffer, raw.bytes.byteOffset, raw.bytes.byteLength),
    vertices = Array.from({ length: raw.bytes.length / raw.stride }, (_, i) => {
      const at = i * raw.stride;
      return {
        x: view.getFloat32(at, true),
        y: view.getFloat32(at + 4, true),
        z: view.getFloat32(at + 8, true),
        w: view.getFloat32(at + 12, true),
        color: view.getUint32(at + 16, true),
        u: raw.stride >= 28 ? view.getFloat32(at + 20, true) : 0,
        v: raw.stride >= 28 ? view.getFloat32(at + 24, true) : 0,
      };
    });
  return raw.type === 5 ? [0, 1, 2, 1, 3, 2].map((i) => vertices[i]) : vertices;
}

export function authoredScreenFrame(width = 65, height = 49, next = false) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const red = (x * 31 + y * 7) & 255,
        green = (x * 3 + y * 17) & 255,
        blue = (255 - x * 11 - y * 5) & 255;
      pixels.set(
        next
          ? [255 - red, 255 - green, 255 - blue, 225]
          : [red, green, blue, (x + y) % 3 ? 255 : 96],
        (y * width + x) * 4,
      );
    }
  return pixels;
}
// Authored capture input enters through the existing host D3D resource API.
export function authorOracleCaptures(oracle, frames) {
  const { world, device } = oracle,
    p = world.nativeEngine.process,
    core = world.nativeEngine.features.get('graphics-platform').refs.renderer,
    metadata = p.load(core + 1560),
    records = p.load(metadata + 12),
    output = p.allocate(4, true);
  try {
    assertCaptureCount(p.load(metadata + 20), frames.length);
    for (const [i, pixels] of frames.entries()) {
      const texture = device.textureData(p.load(records + i * 24 + 20));
      if (device.contracts('Texture9')[18][2](texture, [0, output]))
        throw Error('Oracle fixture could not acquire target surface');
      const surface = p.load(output);
      device.storePixels(texture, pixels);
      texture.dirty = false;
      device.gpu.uploadRenderTarget(device.gpuTarget(surface), device.frame(texture.pointer));
      device.release(device.objects.get(surface));
    }
  } finally {
    p.free(output);
  }
}
function assertCaptureCount(actual, expected) {
  if (actual !== expected)
    throw Error(`Oracle fixture capture count ${actual} differs from ${expected}`);
}
