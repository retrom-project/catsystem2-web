// SPDX-License-Identifier: MPL-2.0
// Compare complete original wrappers with JS packets using the existing task
// and view boundaries. GPU/render-target behavior is tested separately.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EFFECT_COMMAND_CONTRACTS } from '../oracle/effect-commands-original.mjs';
import { NativeEffectCommands } from '../src/native/effect-commands.mjs';
import { NativeBufferMemory } from '../src/native/buffer-memory.mjs';
import { floatBits } from '../src/kcs.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { imageOwnerFixture } from '../tests/fixtures/image-owner-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-effect-commands.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Effect command oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  f = await imageOwnerFixture(bytes, profile),
  { engine, world, machine: m, process: p, platform } = f,
  commands = new NativeEffectCommands(world),
  host = p.allocate(160, true),
  vtable = p.allocate(32, true),
  argv = p.allocate(40, true),
  out = p.allocate(12, true),
  bitmap = p.allocate(92, true),
  wrapper = p.allocate(4, true),
  values = [0, 1, 0xffffffff, 0x80000000, 0x7fffffff, 0x80000001, 0x7fc01234, 0x3f800000],
  payloadSizes = {
    378: 88,
    380: 36,
    382: 12,
    384: 12,
    387: 20,
    390: 24,
    394: 36,
    516: 20,
    519: 24,
    521: 28,
  };
let events = [],
  id,
  queryWord,
  queryWrites,
  queryInitial = null,
  operations = 0,
  comparisons = 0;
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  comparisons++;
};
const receive = (sender, target, message, w, l, flags, memory, result) => {
  const size = payloadSizes[message],
    payload = size ? memory.bytes(l, size).slice() : null;
  if (message === 387) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    if (view.getUint32(12, true) === bitmap) view.setUint32(12, 99, true);
  }
  if (message === 377) queryInitial = memory.load(result);
  events.push({
    sender,
    target,
    message,
    w,
    l: size ? 'payload' : l,
    flags: flags ?? 0,
    ...(size ? { payload: Array.from(payload) } : {}),
    ...(message === 377 ? { initial: 'caller-result-address' } : {}),
  });
};
world.nativeTaskID = (id) => (id === 41 ? 17 : id);
world.resolveTaskID = (id, origin) => (id === 17 && origin === 41 ? 41 : null);
const getFeature = world.getNativeFeature;
world.getNativeFeature = async (name) =>
  name === 'bitmap-memory'
    ? {
        wrapper: async (handle) => {
          assert.equal(handle, 99);
          return wrapper;
        },
      }
    : getFeature(name);
world.sendNativeEngine = async (target, sender, message, w, l, context) => {
  receive(
    sender,
    target,
    message,
    w,
    l,
    context.flags,
    context.resultMemory ?? context.payload,
    context.nativeResult,
  );
  context.nativeRouted = target !== 0xffffffff;
  return queryWrites ? queryWord : undefined;
};
world.runtime.imageDataBuffers = { process: new NativeBufferMemory() };
world.screenEffects = {
  rendering: {
    prepare(count) {
      if (id !== 0x238) events.push({ view: platform.refs.view, name: 'prepare', args: [count] });
    },
    capture(index, minimum, maximum) {
      events.push({
        view: platform.refs.view,
        name: id === 0x238 ? 'prepare-and-capture' : 'capture',
        args: [...(id === 0x238 ? [] : [index]), floatBits(minimum), floatBits(maximum)],
      });
    },
  },
};
const vm = () => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
try {
  p.store(wrapper, bitmap);
  p.store(host, vtable);
  p.store(host + 4, 17);
  p.store(host + 116, platform.refs.view);
  p.store(
    vtable + 16,
    p.trap(
      'independent original effect receiver',
      7,
      ([sender, target, raw, w, l, flags, result]) => {
        assert.equal(sender, 17);
        const message = !sdk ? raw : raw >= 490 && raw <= 497 ? raw + 26 : raw + 5;
        receive(
          41,
          target,
          message,
          w,
          l,
          flags,
          { load: (at) => p.load(at), bytes: (at, size) => p.read(at, size) },
          result,
        );
        if (queryWrites) p.store(result, queryWord);
        return Number(target !== 0xffffffff);
      },
    ),
  );
  for (const [address, count, name] of [
    [sdk ? 0x54cdf0 : 0x675ce0, 1, 'prepare'],
    [sdk ? 0x54d140 : 0x6760a0, 3, 'capture'],
    [sdk ? 0x54d0f0 : 0x676050, 2, 'prepare-and-capture'],
  ])
    engine.patch(
      address,
      'authored view ' + name + ' boundary',
      count,
      (args) => {
        assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, platform.refs.view);
        events.push({ view: platform.refs.view, name, args });
        return 0;
      },
      { calleePops: true },
    );
  m.allocate(2048);
  for (const spec of NATIVE_EFFECT_COMMAND_CONTRACTS) {
    id = spec.id;
    for (const target of [0, 1, 0xffffffff, 0x80000000, 19])
      for (queryWord of values)
        for (let variant = 0; variant < 6; variant++) {
          const address = [128, 0x80000080, m.memory.length + 128][variant % 3],
            args = Array.from({ length: spec.words }, (_, i) =>
              i ? values[(i + variant) % values.length] : target,
            );
          for (let i = 0; i < 16; i++)
            m.store(address + i * 4, values[(i + variant) % values.length]);
          if (id === 0x209) args[1] = target ? address : 0xffffffff;
          if (id === 0x212 || id === 0x389) args[4] = variant % 2 ? 99 : 0;
          const nativeArgs = args.slice();
          if ((id === 0x212 || id === 0x389) && nativeArgs[0] && nativeArgs[4])
            nativeArgs[4] = wrapper;
          nativeArgs.forEach((word, i) => p.store(argv + i * 4, word));
          p.write(out, new Uint8Array(12).fill(0xa5));
          const before = vm(),
            bridge = new NativeKCSMemory(p, m);
          queryWrites = variant % 2 === 0;
          events = [];
          queryInitial = null;
          let original;
          try {
            const control = await engine.call(
              spec.handlers[Number(sdk)],
              [bridge.pointer, host, argv, out + 4],
              undefined,
              { task: 41 },
            );
            original = { control, ...(control === 1 ? { value: p.load(out + 4) } : {}) };
          } finally {
            bridge.close();
          }
          const expected = structuredClone(events),
            originalInitial = queryInitial;
          if (id === 0x208 && target && !queryWrites) {
            compare(
              original.value,
              out + 4,
              'original unwritten query returns its caller result address',
            );
            compare(originalInitial, out + 4, 'original stack local retains the same address');
            original.value = 'caller-result-address';
          }
          events = [];
          queryInitial = null;
          const reply = await commands.apply(id, args, m, { id: 41 });
          if (id === 0x208 && target && !queryWrites) {
            compare(
              reply.value,
              queryInitial,
              'host transport preserves the original unwritten address',
            );
            reply.value = 'caller-result-address';
          }
          compare(reply, original, 'complete original wrapper reply');
          compare(events, expected, 'complete task packets and original view calls');
          compare(vm(), before, 'all VM domains and matrix input unchanged');
          compare(
            [...p.read(out, 4), ...p.read(out + 8, 4)],
            new Array(8).fill(0xa5),
            'output canaries',
          );
          if (spec.control === 2)
            compare(p.load(out + 4), 0xa5a5a5a5, 'void wrapper preserves caller result');
          operations++;
        }
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        operations,
        comparisons,
        scope:
          'All 30 JS KCS screen-effect wrappers against their complete original bodies; exact packet layouts, transform bit patterns, VM data/shared/extended matrices, guarded invalid pointers, bitmap identity normalization, zero/missing/extreme targets, null bitmap guards, query writes and original unwritten pointer result, view prepare/capture calling conventions, all VM memory and output canaries. Receivers, view prepare/capture and bitmap ownership are explicit supplied probe boundaries; separate real World/GPU tests cover those implementations.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original effect commands ${comparisons}/${comparisons} (${operations} calls)`);
} finally {
  await engine.close();
}
