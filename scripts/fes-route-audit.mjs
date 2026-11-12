// SPDX-License-Identifier: MPL-2.0
// Offline dispatch review, separate from the frozen ABI signature declarations.
const rows = [
  [0x1bf, 'start', 2, [331, 332], 2],
  [0x1c0, 'update', 1, [333], 2],
  [0x1c1, 'bindSurface', 2, [334], 2],
  [0x1c2, 'jump', 2, [335], 1],
  [0x1c3, 'setSaveObject', 2, [336], 2],
  [0x1c4, 'exitCode', 1, [23], 1],
  [0x1c5, 'setCurrentExitCode', 1, [], 2],
  [0x1c6, 'contextName', 1, [], 2],
  [0x276, 'notifyObject', 4, [337], 2],
  [0x277, 'createObject', 4, [338], 2],
  [0x278, 'initializeObjects', 3, [339], 2],
  [0x285, 'setLocal', 3, [340], 2],
  [0x286, 'getLocal', 2, [341], 1],
  [0x287, 'sleep', 2, [342], 2],
  [0x289, 'saveLocalBank', 3, [343, 343], 1],
  [0x28a, 'loadLocalBank', 3, [344], 1],
  [0x298, 'setNamedLocal', 3, [345], 2],
  [0x299, 'copyPrivateFromCaller', 1, [346], 2],
  [0x29a, 'copyPrivateToCaller', 1, [347], 2],
  [0x29b, 'result', 1, [348], 1],
  [0x29c, 'clearResult', 1, [349], 2],
  [0x2e2, 'setObjectImageData', 3, [350], 2],
  [0x372, 'setNamed', 3, [352], 2],
  [0x373, 'getNamed', 2, [351], 1],
];
export const FES_ROUTE_AUDIT = Object.freeze(
  rows.map(([id, label, words, messages, control]) => ({
    id,
    label: `fes.${label}`,
    module: 'src/native/fes.mjs',
    words,
    messages,
    control,
    receiver: messages.length
      ? 'default kind34 → createNativeFESTask → FESPlayer/FESCoordinator and World JS services'
      : 'current JS task record or caller VM bytes',
    evidence: [
      'src/native/fes.mjs:nativeFES/persistFESBank',
      'src/native/fes-task.mjs:createNativeFESTask',
      'src/native/abi/messages.mjs:mapABIMessage',
      'tests/fes-route-audit.test.mjs',
      'tests/native-fes-task.test.mjs',
      'tests/default-fes-world.test.mjs',
      'docs/b-phase7-route-audit.md',
    ],
    consumerRoutes: messages.length
      ? [
          {
            domain: 8,
            condition:
              'An explicitly addressed foreign task is SDK JavaScript kind55; its separately registered receiver remains a D8 consumer',
            module: 'src/native/sdk-javascript-task.mjs',
            removePhase: 8,
          },
        ]
      : [],
  })),
);
export function reviewedFESRoute(file, id) {
  return FES_ROUTE_AUDIT.find((row) => row.module === file && row.id === id);
}
const indirect = {
  'fes-control-driver': ['sendEngine'],
  'fes-coordinator': ['sendEngine'],
  'fes-effect-driver': ['sendEngine'],
  'fes-image-driver': ['sendEngine'],
  'fes-particle-driver': ['sendEngine'],
  'fes-sound': ['sendNativeEngine'],
  'fes-task': ['sendEngine', 'sendNativeEngine', 'getNativeFeature:task-memory'],
  fes: ['sendNativeEngine'],
};
export function reviewFESIndirect(file, site) {
  const name = file.match(/^src\/native\/([^/]+)\.mjs$/)?.[1],
    key = site.method + (site.feature ? ':' + site.feature : '');
  if (!indirect[name]?.includes(key)) return null;
  if (site.feature === 'task-memory')
    return 'Only an explicit context.nativePointer sender maps its D8 task pointer to the same JS private bank. Ordinary nativeFES copies carry nativeVariableContextKey directly; source checking enforces the guard.';
  if (name === 'fes-sound')
    return 'The bound Top sound receiver is the World-owned JS NativeSoundTask. Audible host output remains D8; no FES object or sound state is projected.';
  if (name === 'fes-task')
    return 'JS FES task/interpreter lifecycle and explicit parent-bank, Top sound/input and child FES/KCS messages. Ordinary task factories and current checkpoints retain the single World authorities.';
  if (name === 'fes')
    return 'Each installed FES wrapper has its own message/VM-output review in FES_ROUTE_AUDIT; default kind34 is JS, explicit foreign kind55 remains D8.';
  return 'The coordinator owns typed semantic objects and resource FIFO entries. Named World family tasks, Draw, controls, image/text, particles and effects are JS receivers; no original object constructor or producer record is requested.';
}
