// SPDX-License-Identifier: MPL-2.0
import engine74 from './2.6.1.74.mjs';
import engine76 from './2.6.1.76.mjs';

export function validateABI(abi) {
  validatePlainData(abi);
  if (!abi || abi.id !== `cs2-${abi.engineVersion}` || typeof abi.profile !== 'string')
    throw new Error('Invalid CatSystem2 ABI identity');
  if (!['Shift_JIS', 'UTF-8'].includes(abi.xmlEncoding) || !Number.isInteger(abi.sound?.banks))
    throw new Error(`Invalid ABI services ${abi.id}`);
  validateBehavior(abi);
  for (const table of ['main', 'generic', 'particle-v1', 'particle-v2']) {
    const definition = abi.tables?.[table];
    if (
      !Number.isInteger(definition?.count) ||
      definition.count <= 0 ||
      definition.entries?.length !== definition.count
    )
      throw new Error(`Incomplete ABI table ${abi.id}/${table}`);
    definition.entries.forEach((entry, id) => {
      if (
        entry.id !== id ||
        !['unknown', 'declared', 'recovered', 'reserved', 'constant-zero'].includes(entry.status) ||
        !Array.isArray(entry.controlCodes) ||
        entry.controlCodes.some((code) => !Number.isInteger(code) || code < 0 || code > 5) ||
        !entry.signature ||
        (entry.name !== null && typeof entry.name !== 'string')
      )
        throw new Error(`Invalid ABI entry ${abi.id}/${table}/${id}`);
    });
  }
  return abi;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const NATIVE_ABIS = freeze(
  Object.fromEntries([engine74, engine76].map((abi) => [abi.profile, validateABI(abi)])),
);

export function nativeABI(profile) {
  const abi = Object.hasOwn(NATIVE_ABIS, profile) ? NATIVE_ABIS[profile] : undefined;
  if (!abi)
    throw new Error(
      `Unregistered CatSystem2 ABI ${profile}; provide reviewed per-version ABI data`,
    );
  return abi;
}

export function abiForEngineVersion(version) {
  const abi = Object.values(NATIVE_ABIS).find((candidate) => candidate.engineVersion === version);
  if (!abi)
    throw new Error(
      `Unregistered CatSystem2 engine ${version}; provide reviewed per-version ABI data`,
    );
  return abi;
}

function validateBehavior(abi) {
  const {
    text,
    configuration,
    sound,
    language,
    plugins,
    capabilities,
    messages,
    floatingPoint,
    fes,
    graphics,
    startup,
  } = abi;
  if (
    ![1, 2].includes(text?.settingsCharacterBytes) ||
    !Number.isSafeInteger(text?.pathBytes) ||
    !text?.configurationLayout ||
    !text?.fesLayouts ||
    !Array.isArray(text?.layoutModes) ||
    !Array.isArray(configuration?.blockSizes) ||
    configuration.blockSizes.length !== 4 ||
    configuration.blockSizes.some((size) => !Number.isSafeInteger(size) || size <= 0) ||
    !configuration?.memory?.layout ||
    !Array.isArray(configuration?.memory?.scalarFields) ||
    !Array.isArray(sound?.missingIdPathFields) ||
    !Number.isSafeInteger(sound?.controlBytes) ||
    !['bytes', 'text'].includes(language?.storage) ||
    !['native', 'placeholder'].includes(plugins?.emoteDriver) ||
    !capabilities ||
    [
      'embeddedJavaScript',
      'cubeFlipGridHeightProduct',
      'steam',
      'windowReturnTitle',
      'broadcast',
      'recordQueues',
      'unicodeOutput',
      'utf8Primitives',
      'utf8Text',
      'emoteFes',
      'engineWorkers',
      'windowsMediaReader',
      'systemEntropy',
      'inputNullText',
      'taskDumpTopWriter',
    ].some((name) => typeof capabilities[name] !== 'boolean') ||
    [
      'extendedPreferences',
      'language',
      'keyHide',
      'windowActive',
      'sceneAnimation',
      'extendedQueries',
    ].some((name) => typeof configuration[name] !== 'boolean') ||
    [
      'singleTable',
      'resetOnReload',
      'archiveFallback',
      'switchWindowProtocol',
      'dynamicMenus',
    ].some((name) => typeof language[name] !== 'boolean') ||
    !Number.isSafeInteger(messages?.screenEvent) ||
    !Number.isSafeInteger(text?.resourceMessages?.first?.cp932) ||
    !abi.layouts ||
    !abi.layouts.motionCheckpoint ||
    !abi.layouts.memoryFile ||
    !abi.layouts.systemInformation ||
    !Number.isSafeInteger(messages?.tilePlaneCommand) ||
    !Number.isSafeInteger(fes?.variableBankOffset) ||
    !graphics ||
    !startup ||
    floatingPoint?.precisionBits !== 24 ||
    floatingPoint?.rounding !== 'nearest' ||
    floatingPoint?.x87ControlWord !== 0x7f ||
    floatingPoint?.mxcsr !== 0x1f80
  )
    throw new Error(`Invalid ABI behavior data ${abi.id}`);
  for (const definition of Object.values(messages?.channels ?? {})) {
    for (const rules of Object.values(definition)) {
      if (!Array.isArray(rules)) throw new Error(`Invalid ABI message rules ${abi.id}`);
      for (const rule of rules) {
        if (
          ![rule.min, rule.max].every((value) => value === null || Number.isSafeInteger(value)) ||
          !Number.isSafeInteger(rule.offset) ||
          (rule.min !== null && rule.max !== null && rule.min > rule.max) ||
          [rule.kinds, rule.exceptKinds].some(
            (kinds) =>
              kinds !== undefined &&
              (!Array.isArray(kinds) || kinds.some((kind) => !Number.isSafeInteger(kind))),
          )
        )
          throw new Error(`Invalid ABI message rule ${abi.id}`);
      }
    }
  }
  if (!messages?.channels?.base || !messages?.channels?.control || !messages?.root)
    throw new Error(`Incomplete ABI message data ${abi.id}`);
}

function validatePlainData(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (
    !value ||
    typeof value !== 'object' ||
    (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
  )
    throw new Error('ABI must contain JSON-serializable plain data');
  for (const item of Object.values(value)) validatePlainData(item);
}
