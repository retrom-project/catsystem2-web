// SPDX-License-Identifier: MPL-2.0
// Browser side of the existing task/message oracle. No instruction probes.
import { M2OracleWorld } from './m2-world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { StageRenderer } from '../src/render/stage.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { ImageStore } from '../src/formats/hg3.mjs';
import { NativeSoundPacket } from '../src/native/sound.mjs';
import { floatBits } from '../src/kcs.mjs';

export async function recordM2Sequence({
  entries,
  programs,
  initialFrames,
  transitionFrames,
  operations,
  capturePixels = false,
  audio = null,
}) {
  const files = new Map(entries.map(([name, bytes]) => [name, new Uint8Array(bytes)])),
    game = {
      width: 64,
      height: 64,
      index: new Map(entries.map(([name]) => [name, {}])),
      has: (name) => files.has(name.toLowerCase()),
      names: (ext) => [...files.keys()].filter((name) => name.endsWith('.' + ext)),
      read: async (name) => files.get(name.toLowerCase()) ?? null,
      async require(name) {
        const bytes = await this.read(name);
        if (!bytes) throw new Error(`Missing authored oracle resource ${name}`);
        return bytes;
      },
      resolveCategory(name, category) {
        name = name.toLowerCase().replaceAll('\\', '/');
        const ext = { m2psb: 'psb', kcs: 'kcs' }[category];
        if (ext && !name.endsWith('.' + ext)) name += '.' + ext;
        return files.has(name) ? name : null;
      },
      async readCategory(name, category) {
        return this.read(this.resolveCategory(name, category) ?? '');
      },
      async requireCategory(name, category) {
        return this.require(this.resolveCategory(name, category) ?? '');
      },
    },
    profile = 'nekopara-vol3-engine-2.6.1.76',
    configuration = new NativeConfiguration({ profile });
  for (const key of [
    'width',
    'height',
    'currentWidth',
    'currentHeight',
    'virtualWidth',
    'virtualHeight',
  ])
    configuration.setField('screen.' + key, 64);
  const stage = new StageRenderer({ canvas: new OffscreenCanvas(64, 64) }),
    random = new ParticleRandom(),
    world = new M2OracleWorld({
      game,
      profile,
      configuration,
      random,
      images: new ImageStore(game),
      motionLibrary: new MotionLibrary(game, { profile, random }),
      host: { nativeGPU: () => stage.gpu },
      storage: {
        read: async () => null,
        write: async () => true,
        stat: async () => null,
        remove: async () => true,
      },
    });
  world.stageRenderer = stage;
  try {
    await world.initialize('main.kcs');
    const id = await world.objects.create({
        kind: 54,
        parent: world.root,
        name: 'authored M2 sequence',
      }),
      nativeID = world.nativeTaskID(id),
      owner = await world.getNativeFeature('m2'),
      machine = world.main.machine,
      rows = [],
      d3d = owner.device.d3d;
    // A deterministic public sound-task double supplies media clock/levels
    // and authored sidecar handles. It observes no EXE memory or instructions.
    if (audio) {
      const sound = world.sound.primary(world.root),
        original = sound.message.bind(sound),
        bytes = audio.bytes ? new Uint8Array(audio.bytes) : null,
        handle = bytes ? world.runtime.handles.add('sound-sidecar', bytes) : 0;
      sound.message = async (words, context = {}) => {
        const [, message, , l] = words,
          memory = context.payload;
        if (message === 185) return Number(rows.length < (audio.end ?? 1000));
        if (message === 200) return 0;
        if (message === 219) return rows.length;
        if (message === 222) return Number(Boolean(handle));
        if (message === 220 || message === 221) {
          const selected = audio.kind === (message === 220 ? 'lpb' : 'lv');
          memory.store(l, selected ? handle : 0);
          memory.store(l + 4, selected ? bytes.length : 0);
          return 0;
        }
        if (message === 213) {
          const destination = memory.load(l),
            count = memory.load(l + 4),
            levels = audio.levels?.[rows.length] ?? Array(80).fill(100);
          if (destination)
            for (let i = 0; i < Math.min(levels.length, count); i++)
              memory.store(destination + i * 4, levels[i]);
          return levels.length;
        }
        return original(words, context);
      };
    }
    const native = (id, args) => world.runtime.native('main', id, args, machine, world.main),
      load = async (program) => {
        machine.writeString(program, 128);
        await native(906, [nativeID, 128, 1]);
      },
      capture = async (label) => {
        const draws = [];
        d3d.onDrawRaw = ({ bytes, type, count, stride, fvf }) => {
          if (fvf === 322)
            draws.push({
              type,
              count,
              stride,
              fvf,
              bytes: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
            });
        };
        for (const operation of operations.filter((entry) => entry.index === rows.length)) {
          const packet = new NativeSoundPacket([
            0,
            ...(operation.floats?.map(floatBits) ?? operation.words ?? []),
          ]);
          if (operation.text !== undefined) packet.writeString(operation.text, 4);
          await world.sendNativeEngine(
            nativeID,
            world.main.id,
            operation.message,
            operation.w ?? 0,
            operation.l ?? 4,
            { payload: packet, machine },
          );
        }
        const busy = await native(909, [nativeID]),
          actionBusy = await native(1028, [nativeID, 128]);
        await native(926, [nativeID, 640]);
        await native(910, [nativeID, 0, 700, 704, 708]);
        const body = machine.string(640),
          attribute = [700, 704, 708].map((at) => machine.load(at));
        try {
          await world.tick();
          stage.gpu.beginFrame(0xff000000);
          await world.graphics.get(id).drawGPU(stage.gpu);
          stage.gpu.endFrame();
        } finally {
          d3d.onDrawRaw = undefined;
        }
        const pixels = capturePixels ? [...stage.gpu.pixels()] : undefined;
        rows.push({
          label,
          frame: world.frame,
          busy,
          actionBusy,
          body,
          attribute,
          draws,
          ...(pixels ? { pixels } : {}),
        });
      };
    await load(programs[0]);
    await native(907, [nativeID, 1]);
    if (audio) await native(924, [nativeID, 1, 0]);
    await world.sendNativeEngine(nativeID, world.main.id, 47, 0, 1);
    for (let i = 0; i < initialFrames; i++) await capture('initial');
    await load(programs[1]);
    for (let i = 0; i < transitionFrames; i++) await capture('transition');
    return rows;
  } finally {
    await world.close({ flushFiles: false });
  }
}
