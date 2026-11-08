// SPDX-License-Identifier: MPL-2.0
// Original movie wrappers and graph state helpers, with explicit decoder/COM/window services.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeMovies, nativeMovie } from '../src/native/movie.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-movie.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Movie oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({ bytes, profile, trace: true }),
  p = engine.process,
  layout = sdk
    ? {
        open: 0x5bb610,
        diagnostic: 0x4a82f0,
        format: 0x8a6510,
        path: 0x4b0830,
        settings: 0xc965d4,
        active: 0x5c5f80,
        disabled: 0xcde8,
        factor: 0xe3f0,
        mute: 0xf9d8,
        cursor: 0x54d190,
        gate: 0x54dda0,
        window: 0x42f620,
        visible: 0x54e830,
        clear: 0x546a00,
      }
    : {
        open: 0x6fd110,
        diagnostic: 0x5cac90,
        format: 0x876ea0,
        path: 0x5d39e0,
        settings: 0xb91bfc,
        active: 0x715140,
        disabled: 63420,
        factor: 72080,
        mute: 77688,
        cursor: 0x6760f0,
        gate: 0x676c50,
        window: 0x676160,
        visible: 0x677730,
        clear: 0x66f6c0,
      },
  table = NATIVE_PROFILES[profile].tables.main.va,
  settingsPointer = p.allocate(100000, true),
  words = p.allocate(32, true),
  result = p.allocate(4, true),
  task = p.allocate(180, true),
  taskVtable = p.allocate(32, true),
  view = p.allocate(512, true),
  nativeInput = [],
  jsInput = [],
  settings = {
    disabled: false,
    active: true,
    factor: 37,
    mute: false,
    open: true,
    run: true,
    stop: true,
  },
  sessions = [];
let passed = 0,
  at = 0n,
  originalDB = 0,
  cursorAllowed = 1,
  renderGate = 0,
  cursorVisible = 1,
  completionMovie = 0,
  completionCount = 0,
  completionState;
const compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  ecx = () => p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
  com = (name, methods) => {
    const object = p.allocate(4, true),
      vtable = p.allocate(192, true);
    p.store(object, vtable);
    for (const [offset, [count, callback]] of Object.entries({ 8: [1, () => 1], ...methods }))
      p.store(vtable + Number(offset), p.trap('movie COM ' + name + ':' + offset, count, callback));
    return object;
  },
  graph = com('graph', {
    28: [1, () => (settings.run ? 0 : 0x80004005)],
    32: [1, () => (settings.stop ? 0 : 0x80004005)],
    36: [1, () => 0],
    40: [
      3,
      ([, , out]) => {
        p.store(out, 0);
        return 0;
      },
    ],
    60: [1, () => 0],
  }),
  video = com(
    'video',
    Object.fromEntries([52, 60, 76, 116, 148, 176].map((offset) => [offset, [2, () => 0]])),
  ),
  audio = com('audio', {
    28: [
      2,
      ([, value]) => {
        originalDB = value | 0;
        return 0;
      },
    ],
  }),
  events = com('events', {
    36: [
      3,
      ([, , out]) => {
        if (!completionCount++) {
          p.store(out, 1);
          return 0;
        }
        completionState = {
          repeat: p.load(completionMovie + 392),
          running: Boolean(p.load(completionMovie + 372)),
          at,
        };
        p.store(completionMovie + 372, 0);
        return 0x80004005;
      },
    ],
  }),
  seek = com('seek', {
    36: [2, () => 0],
    48: [
      2,
      ([, out]) => {
        const value = BigInt.asUintN(64, at);
        p.store(out, Number(value & 0xffffffffn));
        p.store(out + 4, Number(value >> 32n));
        return 0;
      },
    ],
    56: [
      5,
      ([, input]) => {
        at = BigInt.asIntN(64, BigInt(p.load(input)) | (BigInt(p.load(input + 4)) << 32n));
        return 0;
      },
    ],
  }),
  movies = new NativeMovies({
    handles: new NativeHandles(),
    dimensions: () => [640, 480],
    disabled: () => settings.disabled,
    active: () => settings.active,
    audio: () => ({ factor: settings.factor, mute: settings.mute }),
    cursorGate: (word) => {
      movies.allowed = word;
    },
    cursorVisible: (word) => {
      movies.visible = word;
    },
    inputGate: async (_, enabled) => jsInput.push(enabled),
    create: async () => {
      const adapter = {
        at: 0n,
        open: async () => settings.open,
        play: async () => settings.run,
        stop: async () => settings.stop,
        position: () => at,
        seek: async (value) => {
          at = value;
        },
        configure() {},
        redraw() {},
        activate() {},
        close: async () => {},
      };
      sessions.push(adapter);
      return adapter;
    },
  }),
  call = async (id, args = []) => {
    args.forEach((word, i) => p.store(words + i * 4, word));
    p.store(result, 0xcafebabe);
    let control;
    try {
      control = await engine.call(p.load(table + id * 4), [0, task, words, result]);
    } catch (error) {
      error.oracleCall = { id: id.toString(16), args, passed };
      throw error;
    }
    return control === 2 ? { control } : { control, value: p.load(result) };
  },
  model = (id, args = []) => nativeMovie(id, args, {}, { id: 73 }, movies, () => 'authored.wmv'),
  setSettings = () => {
    p.store(settingsPointer + layout.disabled, Number(settings.disabled));
    p.store(settingsPointer + layout.factor, settings.factor);
    p.store(settingsPointer + layout.mute, Number(settings.mute));
    p.store(settingsPointer + layout.mute + 4, 0);
  },
  state = (native, js, label, withRepeat = true) => {
    const value = movies.get(js);
    compare(
      {
        prepared: Boolean(p.load(native + 368)),
        running: Boolean(p.load(native + 372)),
        volume: p.load(native + 376),
        mode: p.load(native + 428),
        rectangle: Array.from({ length: 4 }, (_, i) => p.load(native + 400 + i * 4) | 0),
        ...(withRepeat ? { repeat: p.load(native + 392) } : {}),
      },
      {
        prepared: value.prepared,
        running: value.running,
        volume: value.volume,
        mode: value.mode,
        rectangle: value.rectangle,
        ...(withRepeat ? { repeat: value.repeat } : {}),
      },
      label,
    );
  },
  gates = (label) =>
    compare(
      { cursorAllowed, renderGate, cursorVisible, input: nativeInput },
      {
        cursorAllowed: movies.allowed,
        renderGate: movies.renderGate,
        cursorVisible: movies.visible,
        input: jsInput,
      },
      label,
    );
p.store(layout.settings, settingsPointer);
p.store(task, taskVtable);
p.store(task + 4, 73);
p.store(task + 116, view);
p.store(
  taskVtable + 16,
  p.trap('movie InputTask routing boundary', 7, ([, , message, , l, , out]) => {
    if (message === (sdk ? 32 : 34)) p.store(out, 17);
    else {
      assert.equal(message, sdk ? 141 : 143);
      nativeInput.push(l);
    }
    return 0;
  }),
);
engine.registerWindows('USER32.dll', 'SetRectEmpty', {
  count: 1,
  fn: ([out]) => {
    p.zero(out, 16);
    return 1;
  },
});
engine.registerWindows('KERNEL32.dll', 'Sleep', { count: 1, fn: () => 0 });
engine.patch(
  layout.format,
  'authored movie format',
  2,
  ([, out]) => {
    p.write(out, encodeCP932('authored.wmv\0'));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  layout.path,
  'authored movie category',
  3,
  ([out, name, category]) => {
    assert.equal(p.string(category), 'movie');
    p.write(out, p.stringBytes(name, false, true));
    return out;
  },
  { calleePops: true },
);
engine.patch(
  layout.open,
  'DirectShow decoder and window open boundary',
  3,
  ([name, , flag]) => {
    assert.equal(p.string(name), 'authored.wmv');
    assert.equal(flag, 1);
    if (!settings.open) return 0;
    const movie = ecx();
    p.store(movie + 8, graph);
    p.store(movie + 12, seek);
    p.store(movie + 16, events);
    p.store(movie + 20, video);
    p.store(movie + 24, audio);
    p.store(movie + 368, 1);
    [0, 0, 640, 480].forEach((v, i) => p.store(movie + 400 + i * 4, v));
    return 1;
  },
  { calleePops: true },
);
engine.patch(layout.active, 'browser foreground boundary', 0, () => Number(settings.active), {
  calleePops: true,
});
engine.patch(layout.diagnostic, 'movie diagnostic boundary', 0, () => 0);
engine.patch(
  layout.cursor,
  'movie cursor update boundary',
  1,
  ([word]) => {
    cursorAllowed = word;
  },
  { calleePops: true },
);
engine.patch(
  layout.gate,
  'movie renderer gate boundary',
  1,
  ([word]) => {
    renderGate = word;
  },
  { calleePops: true },
);
engine.patch(
  layout.visible,
  'movie ShowCursor boundary',
  1,
  ([word]) => {
    cursorVisible = word;
  },
  { calleePops: true },
);
engine.patch(layout.window, 'movie browser window boundary', 0, () => 1000, { calleePops: true });
engine.patch(layout.clear, 'movie clear-black boundary', 1, () => 1, { calleePops: true });
movies.allowed = movies.visible = 1;
try {
  for (let trial = 0; trial < 16; trial++) {
    settings.open = trial % 5 !== 0;
    settings.disabled = trial === 1;
    setSettings();
    const native = await call(0x109, [0]),
      js = await model(0x109, [0]);
    compare(native.control, js.control, 'open control');
    compare(Boolean(native.value), Boolean(js.value), 'open result');
    gates('open gates');
    if (!native.value) continue;
    const a = native.value,
      b = js.value;
    state(a, b, 'prepared state', false);
    for (const mode of [0, 1, 0xffffffff, 0]) {
      compare(await call(0x3e4, [a, mode]), await model(0x3e4, [b, mode]), 'mode wrapper');
      state(a, b, 'mode state', false);
    }
    const rect = [trial - 21, trial + 7, trial * 39, trial * 11];
    compare(await call(0x314, [a, ...rect]), await model(0x314, [b, ...rect]), 'rectangle wrapper');
    state(a, b, 'rectangle state', false);
    for (const active of [false, true])
      for (const mute of [false, true])
        for (const factor of [0, 37, 100, 0xffffffff]) {
          Object.assign(settings, { active, mute, factor });
          setSettings();
          for (const volume of [0, 1, 13, 50, 99, 100, 101, 0x7fffffff, 0x80000000, 0xffffffff]) {
            compare(
              await call(0x1a1, [a, volume]),
              await model(0x1a1, [b, volume]),
              'volume wrapper',
            );
            compare(p.load(a + 376), movies.get(b).volume, 'stored volume');
            compare(originalDB, movies.get(b).decibels, 'DirectShow attenuation');
          }
        }
    for (const point of [0n, 9999n, 10000n, 123456789n, (1n << 63n) - 1n, -123456789n]) {
      at = point;
      compare(await call(0x3e6, [a]), await model(0x3e6, [b]), 'signed 100ns position');
    }
    for (const run of [false, true]) {
      settings.run = run;
      settings.stop = true;
      compare(await call(0x10a, [a, trial]), await model(0x10a, [b, trial]), 'play result');
      state(a, b, 'play stores running before Run', run);
      compare(await call(0x10d, [a]), await model(0x10d, [b]), 'running query');
      for (const stop of [false, true]) {
        settings.stop = stop;
        compare(await call(0x10b, [a]), await model(0x10b, [b]), 'stop result');
        state(a, b, 'stop state', run);
      }
    }
    for (const visible of [0, 1, 0xffffffff]) {
      compare(
        await call(0x3e5, [a, visible]),
        await model(0x3e5, [b, visible]),
        'view gate wrapper',
      );
      gates('view gate state');
    }
    settings.run = settings.stop = true;
    for (const repeat of [0, 1, 2, 3, 0x80000000, 0xffffffff]) {
      await call(0x10a, [a, repeat]);
      await model(0x10a, [b, repeat]);
      at = 123456789n;
      completionMovie = a;
      completionCount = 0;
      completionState = null;
      await engine.call(sdk ? 0x5bafc0 : 0x6fca90, [0, a]);
      const native = completionState ?? {
        repeat: p.load(a + 392),
        running: Boolean(p.load(a + 372)),
        at,
      };
      at = 123456789n;
      await movies.ended(b);
      compare(
        native,
        { repeat: movies.get(b).repeat, running: movies.get(b).running, at },
        'one original completion event',
      );
      p.store(a + 372, Number(native.running));
      await call(0x10b, [a]);
      await model(0x10b, [b]);
    }
    compare(await call(0x10e, [a]), await model(0x10e, [b]), 'redraw wrapper');
    compare(await call(0x10c, [a]), await model(0x10c, [b]), 'close wrapper');
    gates('close gates');
  }
  for (const [id, args] of [
    [0x10a, [0, 1]],
    ...[0x10b, 0x10c, 0x10d, 0x10e, 0x3e6].map((id) => [id, [0]]),
    [0x1a1, [0, 13]],
    [0x314, [0, 0, 0, 0, 0]],
    [0x3e4, [0, 1]],
    [0x3e5, [0, 0]],
  ])
    compare(await call(id, args), await model(id, args), 'null wrapper');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'All eleven original movie wrappers plus original constructors, play/stop/query/rectangle/mode/position/volume/destructor and completion-thread helpers. Full state and attenuation compared with browser native service. Formatting, resource category, decoder open, DirectShow COM methods, foreground/window routing and renderer gates are supplied boundaries. The event wait supplies one completion, capturing repeating state before ending the diagnostic wait. Real video pixels/audio and GPU renderer gating are separate acceptance items.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original movie differential ${passed}/${passed}`);
} finally {
  await movies.close();
  await engine.close();
}
