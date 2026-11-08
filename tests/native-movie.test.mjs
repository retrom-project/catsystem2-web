// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeMovies, nativeMovie } from '../src/native/movie.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
function fixture() {
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
