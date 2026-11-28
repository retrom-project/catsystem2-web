// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHandles } from '../src/native/handles.mjs';
import { abiForEngineVersion } from '../src/native/abi/index.mjs';
import { NativeMovies, nativeMovie } from '../src/native/movie.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
function fixture(movieOptions = {}) {
  const handles = new NativeHandles(),
    events = [],
    sessions = [],
    settings = { disabled: false, active: true, factor: 27, mute: false },
    movies = new NativeMovies({
      handles,
      dimensions: () => [640, 480],
      disabled: () => settings.disabled,
      active: () => settings.active,
      audio: () => settings,
      inputGate: async (owner, value) => events.push(['input', owner, value]),
      cursorGate: (value) => events.push(['gate', value]),
      cursorVisible: (value) => events.push(['cursor', value]),
      create: async () => {
        const session = {
          at: 0n,
          closed: false,
          plays: 0,
          stops: 0,
          activated: false,
          open: async (name) => name !== 'missing',
          play: async () => {
            session.plays++;
            return !session.failRun;
          },
          stop: async () => {
            session.stops++;
            return !session.failStop;
          },
          position: () => session.at,
          seek: async (at) => {
            session.at = at;
          },
          configure: (record) => {
            session.state = structuredClone(record);
          },
          redraw() {},
          activate: () => {
            session.activated = true;
          },
          close: async () => {
            session.closed = true;
          },
        };
        sessions.push(session);
        return session;
      },
      ...movieOptions,
    }),
    call = (id, words = []) => nativeMovie(id, words, {}, { id: 73 }, movies, (value) => value);
  return { handles, events, sessions, settings, movies, call };
}
test('native movies retain prepared/running state, repeat counts, volume, rectangle and explicit close ownership', async () => {
  const f = fixture(),
    a = (await f.call(0x109, ['opening'])).value;
  assert.deepEqual(f.events, [
    ['input', 73, 0],
    ['gate', 0],
  ]);
  assert.equal((await f.call(0x10d, [a])).value, 0);
  assert.equal(f.movies.get(a).windowVisible, false);
  assert.equal((await f.call(0x10a, [a, 2])).value, 1);
  assert.equal((await f.call(0x10a, [a, 1])).value, 0);
  f.sessions[0].at = 9000000n;
  assert.equal((await f.call(0x3e6, [a])).value, 900);
  await f.call(0x314, [a, -2, 5, 9, 7]);
  assert.deepEqual(f.movies.get(a).rectangle, [-2, 5, 7, 12]);
  await f.call(0x1a1, [a, 50]);
  assert.equal(f.movies.get(a).volume, 50);
  f.settings.active = false;
  await f.call(0x1a1, [a, 50]);
  assert.equal(f.movies.get(a).volume, 13);
  f.settings.mute = true;
  await f.call(0x1a1, [a, 50]);
  assert.equal(f.movies.get(a).volume, 0);
  await f.sessions[0].ended();
  assert.equal(f.movies.get(a).repeat, 1);
  assert.equal(f.movies.get(a).running, true);
  assert.equal(f.sessions[0].at, 0n);
  await f.sessions[0].ended();
  assert.equal(f.movies.get(a).repeat, 0);
  assert.equal(f.movies.get(a).running, false);
  const b = (await f.call(0x109, ['other'])).value;
  await f.call(0x10a, [b, 0xffffffff]);
  await f.sessions[1].ended();
  assert.equal(f.movies.get(b).repeat, 0xffffffff);
  assert.deepEqual(await f.call(0x10c, [a]), { control: 1, value: 1 });
  assert.equal(f.sessions[0].closed, true);
  assert.equal(f.sessions[1].closed, false);
  assert.equal(f.movies.renderGate, 0);
  await f.call(0x3e5, [b, 0]);
  assert.equal(f.movies.renderGate, 1);
  await f.call(0x3e5, [b, 1]);
  assert.equal(f.movies.renderGate, 0);
  await f.call(0x3e4, [b, 0]);
  assert.equal(f.movies.get(b).windowVisible, false);
  await f.call(0x10c, [b]);
  assert.equal(f.sessions[1].closed, true);
  assert.equal(f.handles.records.size, 0);
});
test('movie open/run/stop failures and null calls retain original wrapper side effects', async () => {
  const f = fixture();
  f.settings.disabled = true;
  assert.equal((await f.call(0x109, ['opening'])).value, 0);
  assert.equal(f.sessions.length, 0);
  f.settings.disabled = false;
  assert.equal((await f.call(0x109, ['missing'])).value, 0);
  assert.equal(f.movies.renderGate, 0);
  assert.equal(f.handles.records.size, 0);
  assert.equal(f.sessions[0].closed, true);
  const a = (await f.call(0x109, ['opening'])).value;
  f.sessions[1].failRun = true;
  assert.equal((await f.call(0x10a, [a, 1])).value, 0);
  assert.equal((await f.call(0x10d, [a])).value, 1);
  f.sessions[1].failStop = true;
  assert.equal((await f.call(0x10b, [a])).value, 0);
  assert.equal((await f.call(0x10d, [a])).value, 1);
  f.sessions[1].failStop = false;
  await f.call(0x10b, [a]);
  f.sessions[1].failRun = false;
  await f.call(0x10a, [a, 0]);
  await f.sessions[1].ended();
  assert.equal(f.movies.get(a).repeat, 0xffffffff);
  await f.call(0x10c, [a]);
  for (const id of [0x10b, 0x10c, 0x10d, 0x3e6])
    assert.deepEqual(await f.call(id, [0]), { control: 1, value: 0 });
  assert.deepEqual(await f.call(0x3e5, [0, 1]), { control: 2 });
});
for (const [version, query] of [
  ['2.6.1.23', 31],
  ['2.6.1.63', 32],
])
  test(`${version} uses the BGM gain and mute for an active movie window`, async () => {
    const abi = abiForEngineVersion(version);
    for (const id of [265, 266, 267, 268, 269, 270, 417, 787, 788])
      assert.equal(abi.tables.main.entries[id].status, 'recovered', `Main ${id}`);
    assert.deepEqual(abi.messages.movieInput, { query, gate: 143 });
    const f = fixture(abi.movie);
    try {
      const handle = (await f.call(0x109, ['opening'])).value;
      await f.call(0x1a1, [handle, 50]);
      assert.equal(f.movies.get(handle).volume, 13);
      f.settings.mute = true;
      await f.call(0x1a1, [handle, 50]);
      assert.equal(f.sessions[0].state.decibels, -10000);
      assert.deepEqual(await f.call(0x10c, [handle]), { control: 1, value: 1 });
    } finally {
      await f.movies.close();
    }
  });
test('portable movie checkpoints seek in a fresh decoder and defer visible playback until activation', async () => {
  const f = fixture();
  f.movies.activate();
  const handle = (await f.call(0x109, ['opening'])).value;
  await f.call(0x10a, [handle, 3]);
  f.sessions[0].at = 123456789n;
  const movies = f.movies.snapshot(),
    handles = f.handles.snapshot(),
    saved = await deserializeCheckpoint(await serializeCheckpoint({ movies, handles })),
    fresh = fixture();
  fresh.handles.restore(saved.handles);
  await fresh.movies.restore(saved.movies);
  assert.equal(fresh.sessions[0].at, 123456789n);
  assert.equal(fresh.sessions[0].activated, false);
  assert.equal(fresh.sessions[0].plays, 0);
  assert.equal(fresh.movies.get(handle).repeat, 3);
  fresh.movies.activate();
  assert.equal(fresh.sessions[0].activated, true);
  await Promise.resolve();
  assert.equal(fresh.sessions[0].plays, 1);
  await f.movies.close();
  assert.equal(fresh.sessions[0].closed, false);
  await fresh.movies.close();
  assert.equal(fresh.sessions[0].closed, true);
});

test('2.6.1.67 KCS movie window owns decoder playback, Root input packets and the live drawing rectangle', async (t) => {
  const profile = 'bokutomo-engine-2.6.1.67',
    output = 164,
    canary = 0xe74e3629,
    handleAddress = 160,
    handleWord = [0x13, handleAddress],
    filename = 240;
  const program = (id, args, writes, strings = []) =>
    kcsProgram(
      [
        [37, canary],
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        ...(writes ? [[38, output]] : []),
        [59],
      ],
      strings,
    );
  const world = await dataWorld(profile, {
    'open.kcs': program(265, [filename], true, [[filename, '動画%%']]),
    'play.kcs': program(266, [handleWord, 9], true),
    'stop.kcs': program(267, [handleWord], true),
    'close.kcs': program(268, [handleWord], true),
    'playing.kcs': program(269, [handleWord], true),
    'redraw.kcs': program(270, [handleWord], false),
    'volume.kcs': program(417, [handleWord, 50], false),
    'view.kcs': program(787, [304, 308, 312, 316], false),
    'rectangle.kcs': program(788, [handleWord, -2, 5, 9, 7], false),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { movies } = world,
    decoders = fixture(),
    requests = [],
    inputPackets = [],
    root = world.objects.objects.get(world.root),
    input = world.objects.objects.get(root.implementation.input),
    receive = input.implementation.message;
  input.implementation.message = (words, context) => {
    if (words[1] === 143) inputPackets.push(words);
    return receive(words, context);
  };
  world.runtime.services.resourceFilename = (name, category) => {
    requests.push([name, category]);
    return name === '動画%' && category === 'movie' ? 'video.avi' : null;
  };
  let successfulOpen = false,
    redraws = 0;
  movies.create = async () => {
    const decoder = await decoders.movies.create();
    decoder.open = async (name) => {
      assert.equal(name, 'video.avi');
      return successfulOpen;
    };
    decoder.redraw = () => redraws++;
    return decoder;
  };
  async function call(name, handle = 0) {
    const task = await world.spawnScript(`${name}.kcs`, {
      parent: world.main.id,
      initialExecute: false,
    });
    const machine = task.machine,
      floor = machine.sp;
    machine.store(handleAddress, handle);
    machine.store(output, canary);
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.pop(), canary);
    return { machine, word: machine.load(output) };
  }
  world.configuration.fields.general.disableMovie = 1;
  assert.equal((await call('open')).word, 0);
  assert.deepEqual(requests, []);
  assert.deepEqual(inputPackets, []);
  world.configuration.fields.general.disableMovie = 0;
  assert.equal((await call('open')).word, 0);
  assert.ok(decoders.sessions[0].closed);
  assert.equal(movies.renderGate, 0);
  successfulOpen = true;
  const handle = (await call('open')).word,
    decoder = decoders.sessions[1];
  assert.ok(handle);
  assert.equal(movies.renderGate, 1);
  assert.equal(world.graphics.cursorAllowed, 0);
  assert.deepEqual(requests, [
    ['動画%', 'movie'],
    ['動画%', 'movie'],
  ]);
  assert.deepEqual(
    inputPackets.map(([_sender, message, w, l]) => [message, w, l]),
    [
      [143, 0, 0],
      [143, 0, 1],
      [143, 0, 0],
    ],
  );
  for (const name of ['play', 'stop', 'close', 'playing']) assert.equal((await call(name)).word, 0);
  assert.equal((await call('playing', handle)).word, 0);
  assert.equal((await call('redraw', handle)).word, canary);
  assert.equal(redraws, 0);
  decoder.failRun = true;
  assert.equal((await call('play', handle)).word, 0);
  assert.equal((await call('playing', handle)).word, 1);
  assert.equal(movies.get(handle).repeat, 0);
  decoder.failStop = true;
  assert.equal((await call('stop', handle)).word, 0);
  assert.equal((await call('playing', handle)).word, 1);
  decoder.failStop = false;
  assert.equal((await call('stop', handle)).word, 1);
  decoder.failRun = false;
  assert.equal((await call('play', handle)).word, 1);
  assert.equal((await call('play', handle)).word, 0);
  assert.equal(movies.get(handle).repeat, 9);
  assert.equal((await call('redraw', handle)).word, canary);
  assert.equal(redraws, 1);
  const voice = new DataView(world.configuration.blocks[0].buffer),
    mute = world.configuration.voiceLayout.muteWord;
  voice.setUint32(0, 27, true);
  assert.equal((await call('volume', handle)).word, canary);
  assert.equal(decoder.state.volume, 13);
  for (const word of [mute, mute + 1]) {
    voice.setUint32(word * 4, 1, true);
    assert.equal((await call('volume', handle)).word, canary);
    assert.equal(decoder.state.volume, 0);
    assert.equal(decoder.state.decibels, -10000);
    voice.setUint32(word * 4, 0, true);
  }
  assert.equal((await call('rectangle', handle)).word, canary);
  assert.deepEqual(decoder.state.rectangle, [-2, 5, 7, 12]);
  world.graphics.view.configure({ active: true, drawingRectangle: [7, 11, 39, 67] });
  const view = await call('view');
  assert.equal(view.word, canary);
  assert.deepEqual(
    [304, 308, 312, 316].map((at) => view.machine.load(at)),
    [7, 11, 32, 56],
  );
  Object.assign(world.configuration.screen, { currentWidth: 640, currentHeight: 480 });
  world.graphics.view.configure({ active: false });
  const adapted = await call('view');
  assert.deepEqual(
    [304, 308, 312, 316].map((at) => adapted.machine.load(at)),
    [0, 0, 640, 480],
  );
  assert.equal((await call('close', handle)).word, 1);
  assert.ok(decoder.closed);
  assert.equal(movies.renderGate, 0);
  assert.equal(world.graphics.cursorAllowed, 1);
  assert.equal(movies.sessions.size, 0);
  assert.deepEqual(inputPackets.at(-1).slice(1), [143, 0, 1]);
});
