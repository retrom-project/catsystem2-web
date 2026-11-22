// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { SceneVoicePreparation } from '../src/native/scene-voice-preparation.mjs';

const encoder = new TextEncoder();
function page(flags, sequence, packet) {
  const out = new Uint8Array(28 + packet.length);
  out.set(encoder.encode('OggS'));
  out[5] = flags;
  const view = new DataView(out.buffer);
  view.setUint32(14, 4123, true);
  view.setUint32(18, sequence, true);
  out[26] = 1;
  out[27] = packet.length;
  out.set(packet, 28);
  return out;
}
function ogg(encodedID, extraPackets = 0) {
  const id = new Uint8Array(30);
  id[0] = 1;
  id.set(encoder.encode('vorbis'), 1);
  id[11] = 2;
  new DataView(id.buffer).setUint32(12, 44100, true);
  id[28] = extraPackets ? 0xd8 : 0xb8;
  id[29] = 1;
  const packets = Array.from({ length: extraPackets }, (_, i) =>
    page(0, i + 1, Uint8Array.of(encodedID)),
  );
  return new BlobFile(
    new Blob([page(2, 0, id), ...packets, page(4, extraPackets + 1, Uint8Array.of(encodedID))]),
  );
}
function setup(t) {
  const pendingIdle = new Map();
  let sequence = 0;
  globalThis.requestIdleCallback = (work) => {
    const id = ++sequence;
    pendingIdle.set(id, work);
    return id;
  };
  globalThis.cancelIdleCallback = (id) => pendingIdle.delete(id);
  t.after(() => {
    delete globalThis.requestIdleCallback;
    delete globalThis.cancelIdleCallback;
  });
  const runIdle = async () => {
    for (const [id, task] of [...pendingIdle]) {
      pendingIdle.delete(id);
      task();
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  const game = new GameFiles(new Map()),
    owner = { id: 5 },
    history = { value: 0 },
    blocks = [
      [[0x30, 'wait'], [0x30, 'pcm first'], [0x21], [0x20], [2]],
      [[0x30, 'se effect'], [0x30, 'pcm second'], [0x21], [0x20], [2]],
      [[0x30, 'pl 1'], [0x30, 'pcm third'], [0x21], [0x20], [2]],
    ],
    scene = {
      history: { path: [history] },
      reader: {
        body: { bytes: Uint8Array.of(1) },
        blockCount: blocks.length,
        blockInfo: (block) => ({ count: blocks[block].length }),
        type: (block, row) => blocks[block][row][0],
        text: (block, row) => encoder.encode(blocks[block][row][1]),
      },
    };
  const mount = (name, file) => game.index.set(name, { file, offset: 0, size: file.size });
  game.nativeResources = {
    resolve: (name) => (name.endsWith('.ogg') ? name : name + '.ogg'),
  };
  mount('first.ogg', ogg(3));
  mount('second.ogg', ogg(5));
  mount('third.ogg', ogg(7));
  const audio = {
      game,
      context: { state: 'running' },
      buffers: new Map(),
      pending: new Map(),
      decoded: [],
      async decodeBuffer(bytes) {
        const buffer = { id: bytes.at(-1) };
        this.decoded.push(buffer);
        return buffer;
      },
      rememberBuffer(name, buffer) {
        this.buffers.set(name, buffer);
      },
    },
    world = { runtime: { scheduler: { tasks: new Map([[owner.id, owner]]) } } },
    prep = new SceneVoicePreparation(world, audio);
  prep.loaded(scene, 'mounted.cst', true);
  return { prep, owner, scene, history, audio, pendingIdle, runIdle, mount };
}

test('each consumed voiced dialogue can prepare one adjacent literal page', async (t) => {
  const { prep, owner, scene, history, audio, runIdle } = setup(t);
  assert.equal(prep.hint(scene, owner.id, 0), true);
  await runIdle();
  assert.deepEqual(audio.decoded, [{ id: 3 }]);
  assert.equal(audio.buffers.size, 0);
  assert.equal(prep.take('first.ogg', 99), null);
  const first = prep.take('first.ogg', owner.id);
  assert(first);
  assert.strictEqual(audio.buffers.get('first.ogg'), audio.decoded[0]);
  prep.continued(first);
  await runIdle();
  assert.deepEqual(audio.decoded, [{ id: 3 }, { id: 5 }]);
  history.value = 1;
  scene.reader.body = { bytes: scene.reader.body.bytes.slice() };
  prep.loaded(scene, 'mounted.cst', true);
  const second = prep.take('second.ogg', owner.id);
  assert(second);
  assert.strictEqual(audio.buffers.get('second.ogg'), audio.decoded[1]);
  prep.continued(second);
  await runIdle();
  assert.deepEqual(audio.decoded, [{ id: 3 }, { id: 5 }, { id: 7 }]);
  assert.equal(audio.buffers.has('third.ogg'), false);
  history.value = 2;
  assert(prep.take('third.ogg', owner.id));
  assert.strictEqual(audio.buffers.get('third.ogg'), audio.decoded[2]);
});

test('early demand, replaced backing and released scene ownership leave audio to the regular load', async (t) => {
  const { prep, owner, scene, audio, pendingIdle, runIdle, mount } = setup(t);
  assert.equal(prep.hint(scene, owner.id, 0), true);
  assert(prep.take('first.ogg', owner.id));
  assert.equal(pendingIdle.size, 0);
  assert.equal(audio.decoded.length, 0);

  prep.loaded(scene, 'mounted.cst', true);
  assert.equal(prep.hint(scene, owner.id, 0), true);
  await runIdle();
  mount('first.ogg', ogg(7));
  assert.equal(prep.take('first.ogg', owner.id), null);
  assert.equal(audio.buffers.size, 0);

  prep.loaded(scene, 'mounted.cst', true);
  assert.equal(prep.hint(scene, owner.id, 0), true);
  prep.releaseOwner(owner.id);
  assert.equal(pendingIdle.size, 0);
  await runIdle();
  assert.deepEqual(audio.decoded, [{ id: 3 }]);
});

test('packed voice data above the decoded sample budget never starts a background decode', async (t) => {
  const { prep, scene, owner, audio, mount, runIdle } = setup(t);
  mount('first.ogg', ogg(7, 256));
  assert.equal(prep.hint(scene, owner.id, 0), true);
  await runIdle();
  assert.equal(audio.decoded.length, 0);
  assert.equal(prep.take('first.ogg', owner.id), null);
  assert.equal((await audio.game.require('first.ogg')).at(-1), 7);
});

test('prepared bytes witness only the active owner, archive range and mount generation', async (t) => {
  const { prep, owner, scene, audio, runIdle } = setup(t),
    { game } = audio,
    hit = game.lookup('first.ogg');
  game.nativeSearch = {};
  assert.equal(prep.hint(scene, owner.id, 0), true);
  assert.equal(prep.openedBytes('first.ogg', owner, hit), null);
  await runIdle();
  assert.equal(prep.openedBytes('first.ogg', owner, hit).at(-1), 3);
  assert.equal(prep.openedBytes('first.ogg', { id: owner.id }, hit), null);
  assert.equal(prep.openedBytes('first.ogg', owner, { ...hit, offset: 1 }), null);
  game.nativeSearch = {};
  assert.equal(prep.openedBytes('first.ogg', owner, hit), null);
  assert(prep.take('first.ogg', owner.id), 'the read witness did not consume playback state');
  assert.equal(prep.openedBytes('first.ogg', owner, hit), null);
});
