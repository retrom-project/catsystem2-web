// SPDX-License-Identifier: MPL-2.0
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeSoundConfiguration } from '../../src/native/sound-config.mjs';
import { NativeResources } from '../../src/native/resources.mjs';
import { parseXML } from '../../src/xml.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { KCSMachine } from '../../src/kcs/vm.mjs';
import { Binary } from '../../src/binary.mjs';

export function configurationQueryState(profile, seed = 0) {
  const document = parseXML(
      '<document><INT><int00><name>image</name><int>images.int</int><ext>hg3</ext><dir>images</dir></int00><int02><name>pcm</name><int>voice.int</int><ext>ogg</ext></int02><int07><name>other</name></int07><int11><name>日本語</name></int11><int127><name>last</name></int127></INT></document>',
    ),
    configuration = new NativeConfiguration({ profile }),
    soundConfiguration = new NativeSoundConfiguration({ profile }),
    nativeResources = new NativeResources(document),
    voice = configuration.blocks[0],
    words = new DataView(voice.buffer),
    put = (word, value) => words.setUint32(word * 4, value, true),
    text = (at, value) => voice.set([...encodeCP932(value), 0], at);
  configuration.soundGroups = ['bgm', 'Se', 'VOICE', 'sysvoice', 'other', '', '', ''].map(
    (type, i) => ({ id: i + 10, type, min: -1, max: -1 }),
  );
  for (let i = 0; i < 48; i++) {
    put(5 + 29 * i, (i + seed) % 4 === 0 ? 0 : i + seed + 2);
    put(14 + 29 * i, (seed * 17 + i * 13) | 0);
    put(25 + 29 * i, (i % 5) + 10);
  }
  for (const [i, head, category] of [
    [0, 'bg', 'bgm'],
    [1, 'se', 'se'],
    [2, 'voice', 'pcm'],
    [3, 'system', 'sys'],
    [4, 'call', 'other'],
    [5, '日本語', 'pcm'],
  ]) {
    text(60 + i * 116, head);
    text(104 + i * 116, category);
  }
  for (let i = 0; i < 4; i++) put(i, (seed * 23 + i * 19 + 3) | 0);
  for (let i = 0; i < 4; i++) put(1402 + i, (seed >>> i) & 1);
  const node = (key, head, category, children = []) => ({
    key,
    name: key + ' display',
    type: 'voice',
    head,
    int: category,
    id: seed - 7,
    group: seed % 5,
    sameid: seed,
    mastervol: 100,
    defaults: { volume: 91, play: 1, sysplay: 1, voicevol: 83, mute: 0, skipvol: -1 },
    current: { volume: 71, play: 1, sysplay: 1, voicevol: 73, mute: 0, skipvol: -1 },
    children,
  });
  soundConfiguration.master = node('MASTER', '', '');
  soundConfiguration.parts = [
    node('first', 'voice', 'pcm', [node('shadowed-child', 'voice_child', 'other')]),
    node('branch', '', 'other', [
      node('nested', 'call', 'other'),
      node('long-native-sso-key', 'long_sound_filename_', 'last'),
    ]),
    node('unicode', '日本語', '日本語'),
    node('duplicate', 'voice', 'last'),
  ];
  soundConfiguration.loaded = Boolean(seed & 1);
  return { configuration, soundConfiguration, game: { nativeResources } };
}
export function configurationQueryMachine() {
  return new KCSMachine(
    {
      body: new Binary(Uint8Array.of(59)),
      codeSize: 1,
      data: new Uint8Array(4096),
      stackSize: 4096,
    },
    {},
    new Uint8Array(1024),
  );
}

// Independent authored native input: only fields read by the original lookup
// are populated. No configuration-query implementation or memory codec is used.
export function authorOriginalQueryInputs(engine, state) {
  const p = engine.process,
    owner = engine.refs.owner,
    sdk = engine.profile.startsWith('sdk-'),
    encode = sdk ? encodeCP932 : (text) => new TextEncoder().encode(text),
    base = sdk ? 3192 : 5012,
    owned = [],
    allocate = (size) => {
      const at = p.allocate(size, true);
      owned.push(at);
      return at;
    },
    sso = (at, value) => {
      const bytes = encode(value),
        address = bytes.length < 16 ? at : allocate(bytes.length + 1);
      p.write(address, [...bytes, 0]);
      if (address !== at) p.store(at, address);
      p.store(at + 16, bytes.length);
      p.store(at + 20, Math.max(15, bytes.length));
    },
    vector = (at, nodes) => {
      const start = nodes.length ? allocate(nodes.length * 196) : 0;
      p.store(at, start);
      p.store(at + 4, start + nodes.length * 196);
      p.store(at + 8, start + nodes.length * 196);
      nodes.forEach((node, i) => {
        const row = start + i * 196;
        sso(row + 76, node.head);
        sso(row + 104, node.int);
        vector(row + 184, node.children);
      });
    };
  state.game.nativeResources.entries.forEach((row, i) => {
    for (const [field, offset] of [
      ['archive', 0],
      ['extension', 32],
      ['directory', 40],
      ['name', 300],
    ])
      p.write(owner + base + i * 332 + offset, [...encode(row[field]), 0]);
  });
  p.store(owner + (sdk ? 135236 : 163260), Number(state.soundConfiguration.loaded));
  vector(owner + (sdk ? 135272 : 163296), state.soundConfiguration.parts);
  return () => owned.reverse().forEach((at) => p.free(at));
}
