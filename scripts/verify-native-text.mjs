// SPDX-License-Identifier: MPL-2.0
// Original wrapper differential. Supply mounted, SHA-validated engine bytes;
// the harness intercepts task transport, VM pointer conversion and formatting.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeText } from '../src/native/text-task.mjs';

const profiles = [
  [
    '--game',
    'nekopara-vol3-engine-2.6.1.76',
    0x8772a0,
    0x876ea0,
    [
      0x64e270, 0x64e140, 0x64e230, 0x64e2e0, 0x64e110, 0x64e180, 0x64e0e0, 0x64e200, 0x64e390,
      0x64e350, 0x64e320, 0x64e2b0, 0x64e1c0,
    ],
  ],
  [
    '--sdk',
    'sdk-4.01-engine-2.6.1.74',
    0x8a6910,
    0x8a6510,
    [
      0x5197c0, 0x519690, 0x519780, 0x519830, 0x519660, 0x5196d0, 0x519630, 0x519750, 0x5198e0,
      0x5198a0, 0x519870, 0x519800, 0x519710,
    ],
  ],
];
const ids = [
  0x263, 0x264, 0x265, 0x266, 0x267, 0x268, 0x269, 0x26a, 0x26b, 0x26c, 0x26d, 0x2b7, 0x374,
];
let total = 0;
for (const [flag, profile, convert, format, wrappers] of profiles) {
  const index = process.argv.indexOf(flag);
  if (index < 0) continue;
  const bytes = new Uint8Array(await readFile(process.argv[index + 1])),
    engine = await NativeEngineProcess.open({ profile, bytes }),
    p = engine.process;
  try {
    const vm = p.allocate(1024, true),
      argv = p.allocate(32, true),
      caller = p.allocate(32, true),
      vtable = p.allocate(32, true),
      result = p.allocate(4, true);
    let traces = [],
      currentID,
      currentArgs,
      formatted;
    const normalize = (sender, target, message, w, l, payload) => {
      message = profile.startsWith('sdk-') ? message + 5 : message;
      let data = null;
      if ([449, 450, 451].includes(message)) l = 'vm:' + currentArgs[1];
      if (message === 452) {
        data = payload
          ? new TextDecoder('shift_jis').decode(payload.bytes(l, formatted.length))
          : p.string(l);
        l = 'formatted';
      }
      return { sender, target, message, w: w >>> 0, l: typeof l === 'string' ? l : l >>> 0, data };
    };
    const transport = p.trap(
      'authored text wrapper transport',
      7,
      ([sender, target, message, w, l, , out]) => {
        traces.push(normalize(sender, target, message, w, l));
        if (out) p.store(out, 0x12345678);
        return 0;
      },
    );
    p.store(vtable + 16, transport);
    p.store(caller, vtable);
    p.store(caller + 4, 7);
    engine.patch(convert, 'authored text VM pointer', 1, ([offset]) => vm + offset, {
      calleePops: true,
    });
    engine.patch(
      format,
      'authored text formatted input',
      2,
      ([, out]) => {
        engine.kernel.writeString(out, formatted);
        return out;
      },
      { calleePops: true },
    );
    const memory = {
      bytes: (at, size) => p.read(vm + at, size),
      load: (at) => p.load(vm + at),
      store: (at, value) => p.store(vm + at, value),
    };
    for (let i = 0; i < ids.length; i++)
      for (let variant = 0; variant < 16; variant++) {
        currentID = ids[i];
        currentArgs = [
          variant % 3,
          variant === 0 ? 0 : variant === 1 ? 16 : (variant * 127) >>> 0,
          (variant * 4099) >>> 0,
        ];
        formatted = 'Authored format ' + variant;
        if ([0x263, 0x264, 0x265].includes(currentID)) currentArgs[1] = variant % 2 ? 16 : 0;
        currentArgs.forEach((v, j) => p.store(argv + j * 4, v));
        p.store(result, 0xcccccccc);
        traces = [];
        const code = await engine.call(wrappers[i], [0, caller, argv, result]),
          expected = { code, value: code === 1 ? p.load(result) : null, traces };
        traces = [];
        const send = (target, sender, message, w, l, payload) => {
            traces.push(
              normalize(
                sender,
                target,
                profile.startsWith('sdk-') ? message - 5 : message,
                w,
                l,
                payload,
              ),
            );
            return 0x12345678;
          },
          world = {
            runtime: { services: { format: () => formatted } },
            getNativeFeature: async () => ({ pointer: () => currentArgs[1] }),
            graphics: {
              send,
              get: (target) => ({
                message: ([sender, message, w, l]) => send(target, sender, message, w, l),
              }),
            },
          };
        const reply = await nativeText(currentID, currentArgs, memory, { id: 7 }, world);
        assert.deepEqual(
          { code: reply.control, value: reply.control === 1 ? reply.value : null, traces },
          expected,
          `${profile} native ${currentID.toString(16)} case ${variant}`,
        );
        total++;
      }
    console.log(`${profile}: ${ids.length * 16} original text wrapper cases agree`);
  } finally {
    await engine.close();
  }
}
if (!total)
  throw new Error(
    'Usage: node scripts/verify-native-text.mjs --game /mounted/engine.exe --sdk /mounted/cs2_open.exe',
  );
console.log(`${total} original text wrapper cases agree`);
