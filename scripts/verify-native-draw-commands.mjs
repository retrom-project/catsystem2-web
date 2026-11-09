// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeDrawCommands, NATIVE_DRAW_COMMAND_CONTRACTS } from '../src/native/draw-commands.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeRenderSources } from '../src/native/render-sources.mjs';
import { imageOwnerFixture } from '../tests/fixtures/image-owner-fixture.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-draw-commands.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Draw command oracle requires a frozen engine');
const f = await imageOwnerFixture(bytes, profile),
  { engine, world, machine: m, process: p, platform } = f,
  commands = new NativeDrawCommands(engine, world),
  renderSources = new NativeRenderSources(engine, world),
  buffers = engine.features.get('data-buffers'),
  data = buffers.allocateData(16),
  pointer = buffers.wrapPointer(data, 16),
  handle = buffers.handle(pointer, { owner: 41 }),
  host = p.allocate(160, true),
  vtable = p.allocate(32, true),
  argv = p.allocate(52, true),
  out = p.allocate(12, true),
  words = [0, 1, 2, 254, 255, 256, 0xffffffff, 0x80000000, 0x7f800000, 0x7fc01234, 0x12345678];
let events = [],
  comparisons = 0,
  operations = 0;
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  comparisons++;
};
const receive = (sender, target, message, w, l, flags, memory) => {
  let payload;
  if (message === 280 || message === 282) payload = Array.from(memory.bytes(l, 60));
  else if (message === 312) payload = Array.from(memory.bytes(l, 8));
  else if (message === 293) {
    payload = [];
    for (let a = l; ; a++) {
      const byte = memory.bytes(a, 1)[0];
      if (!byte) break;
      payload.push(byte);
      if (payload.length >= 1024) throw new Error('Original draw filename exceeded its scratch');
    }
  }
  events.push({
    sender,
    target,
    message,
    w,
    l: payload ? 'payload' : l,
    flags,
    ...(payload ? { payload } : {}),
  });
  return 77;
};
world.nativeTaskID = (id) => (id === 41 ? 17 : id);
world.resolveTaskID = (id, origin) => (id === 17 && origin === 41 ? 41 : null);
world.sendNativeEngine = async (target, sender, message, w, l, context) => {
  context.nativeRouted = target !== 0xffffffff;
  return receive(sender, target, message, w, l, context.flags, context.payload);
};
const readVM = () => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
try {
  m.writeString('@cat/image/anim.hg2', 768);
  assert.deepEqual(await renderSources.apply(0x2bf, [768, 1024, 1], m, { id: 41 }), {
    control: 1,
    value: 1,
  });
  assert.equal(m.load(1024), 2);
  const retainedPointer = m.load(1028),
    table = NATIVE_PROFILES[profile].tables.main.va;
  p.store(host, vtable);
  p.store(host + 4, 17);
  p.store(host + 116, platform.refs.view);
  p.store(
    vtable + 16,
    p.trap(
      'independent original draw task receiver',
      7,
      ([sender, target, raw, w, l, flags, result]) => {
        assert.equal(sender, 17);
        p.store(result, 77);
        return receive(41, target, profile.startsWith('sdk-') ? raw + 5 : raw, w, l, flags, {
          bytes: (at, size) => p.read(at, size),
        });
      },
    ),
  );
  m.allocate(2048);
  const sources = [
    '',
    '@cat/image/anim.hg3',
    '@cat/image/missing.anm',
    '@cat/image/%s[G2048].other',
    '猫.anm',
  ];
  m.writeString('anim', 2048);
  for (const spec of NATIVE_DRAW_COMMAND_CONTRACTS) {
    const handler = p.load(table + spec.id * 4),
      retained = spec.id === 0x2c3 || spec.id === 0x2c4;
    compare(handler, spec.handlers[Number(profile.startsWith('sdk-'))], 'fixed native table entry');
    for (const target of [0, 1, 0xffffffff, 0x80000000, 19])
      for (const value of words)
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
          const address = [128, 0x80000080, m.memory.length + 128][sourceIndex % 3],
            raw = encodeCP932(sources[sourceIndex]);
          m.bytes(address, raw.length + 1).set([...raw, 0]);
          const args =
              spec.id === 0x270
                ? [target, value, address]
                : spec.id === 0x271
                  ? [target, value, words[(sourceIndex + 3) % words.length]]
                  : spec.id === 0x370
                    ? [target, value, [0, 63, 64, 0xffffffff, 0x80000000][sourceIndex], value]
                    : [
                        target,
                        value,
                        retained
                          ? [0, retainedPointer, 0xffffffff, retainedPointer, 0x80000000][
                              sourceIndex
                            ]
                          : sourceIndex % 2
                            ? handle
                            : 0,
                        ...Array.from(
                          { length: 10 },
                          (_, i) => words[(i + sourceIndex) % words.length],
                        ),
                      ],
            nativeArgs = args.slice();
          if (spec.words === 13 && !retained && nativeArgs[2]) nativeArgs[2] = pointer;
          nativeArgs.forEach((word, i) => p.store(argv + i * 4, word));
          p.write(out, new Uint8Array(12).fill(0xa5));
          const before = readVM(),
            counts = buffers.words(pointer),
            bridge = new NativeKCSMemory(p, m);
          events = [];
          let control;
          try {
            control = await engine.call(handler, [bridge.pointer, host, argv, out + 4], undefined, {
              task: 41,
            });
          } finally {
            bridge.close();
          }
          const original = structuredClone(events);
          events = [];
          compare(
            await commands.apply(spec.id, args, m, { id: 41 }),
            { control },
            'complete wrapper reply',
          );
          compare(events, original, 'exact original task namespace, packet and filename bytes');
          if (spec.words === 13) {
            const payload = new Uint32Array(15);
            payload[retained ? 2 : 1] = nativeArgs[2];
            payload.set(args.slice(3, 10), 4);
            payload[11] = Math.min(255, args[10] >>> 0);
            payload[12] = args[11];
            payload[13] = args[12];
            compare(
              original[0].payload,
              Array.from(new Uint8Array(payload.buffer)),
              'all 60 initialized packet bytes',
            );
          }
          compare(readVM(), before, 'all four VM domains unchanged');
          compare(buffers.words(pointer), counts, 'packet transport does not retain a source');
          if (retained)
            compare(
              p.load(retainedPointer + 188),
              1,
              'retained pointer is carried without a new reference',
            );
          compare(
            Array.from(p.read(out, 12)),
            new Array(12).fill(0xa5),
            'unused result and both canaries',
          );
          operations++;
        }
  }
  await renderSources.apply(0x2c0, [1024, 1], m, { id: 41 });
  compare(p.allocations.has(retainedPointer), false, 'release of the transport oracle source');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        operations,
        comparisons,
        scope:
          'Seven original main2C3/2C4/26E/26F/270/271/370 wrappers, raw retained pointer transport and actual kcBuffer translation, canonical task namespace, all packet bytes, float/unsigned clamp boundaries, original ANM filename search, complete VM domains, original reference counts and result canaries. Draw receiver lifecycle and pixels are checked through World separately.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original retained draw commands ${comparisons}/${comparisons} (${operations} calls)`,
  );
} finally {
  await engine.close();
}
