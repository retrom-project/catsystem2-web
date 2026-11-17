// SPDX-License-Identifier: MPL-2.0
import engine63 from './2.6.1.63.mjs';
import engine67 from './2.6.1.67.mjs';
import engine74 from './2.6.1.74.mjs';
import engine76 from './2.6.1.76.mjs';
import { validateNativeSignature, nativeSignatureDifferences } from './signature.mjs';
import { resolveNativeTables } from './tables.mjs';
import { validateFESCommonHeads, lookupFESCommonHead } from './fes-common-heads.mjs';

export function resolveABI(registration) {
  validatePlainData(registration);
  return validateABI({ ...registration, tables: resolveNativeTables(registration.tables) });
}

export function validateABI(abi) {
  validatePlainData(abi);
  if (!abi || abi.id !== `cs2-${abi.engineVersion}` || typeof abi.profile !== 'string')
    throw new Error('Invalid CatSystem2 ABI identity');
  if (!['Shift_JIS', 'UTF-8'].includes(abi.xmlEncoding) || !Number.isInteger(abi.sound?.banks))
    throw new Error(`Invalid ABI services ${abi.id}`);
  validateBehavior(abi);
  if (typeof abi.capabilities?.effekseerTask !== 'boolean')
    throw new Error(`Invalid Effekseer task capability ${abi.id}`);
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
      try {
        validateNativeSignature(entry.signature);
        if (
          nativeSignatureDifferences(entry.signature, {
            ...entry.signature,
            parameters: entry.parameters,
            result: entry.result,
            controlCodes: entry.controlCodes,
          }).length
        )
          throw new Error('Mirrored declaration fields disagree');
      } catch (error) {
        throw new Error(`Invalid ABI signature ${abi.id}/${table}/${id}: ${error.message}`);
      }
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
  Object.fromEntries(
    [engine74, engine76, engine63, engine67].map((abi) => [abi.profile, resolveABI(abi)]),
  ),
);

export function nativeABI(profile) {
  const abi = Object.hasOwn(NATIVE_ABIS, profile) ? NATIVE_ABIS[profile] : undefined;
  if (!abi)
    throw new Error(
      `Unregistered CatSystem2 ABI ${profile}; provide reviewed per-version ABI data`,
    );
  return abi;
}

export function nativeFESCommonHead(profile, bytes) {
  return lookupFESCommonHead(nativeABI(profile).fes.commonHeads, bytes);
}

export function abiForEngineVersion(version) {
  const abi = Object.values(NATIVE_ABIS).find((candidate) => candidate.engineVersion === version);
  if (!abi)
    throw new Error(
      `Unregistered CatSystem2 engine ${version}; provide reviewed per-version ABI data`,
    );
  return abi;
}

function validateConfiguration(abi) {
  const { text, configuration } = abi,
    unit = text?.settingsCharacterBytes,
    layout = text?.configurationLayout,
    keyRows = layout?.keyRows === undefined ? 80 : layout.keyRows,
    voice = configuration?.defaults?.voiceRecords,
    shortVoice = voice?.count === 32 && voice.stride === 88,
    word = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff,
    minimumBlocks = shortVoice ? [2856, 56, 28, 12] : [5628, 60, 28, 12];
  if (
    ![1, 2].includes(unit) ||
    ![64, 80].includes(keyRows) ||
    !layout ||
    !['fontBytes', 'keyNameBytes', 'keyStride', 'bytes'].every(
      (name) => word(layout[name]) && layout[name] > 0,
    ) ||
    layout.encoding !== (unit === 1 ? 'CP932' : 'UTF-16LE') ||
    layout.fontBytes % unit !== 0 ||
    layout.keyNameBytes % unit !== 0 ||
    layout.keyStride % 4 !== 0 ||
    (keyRows === 64
      ? unit !== 1 || configuration?.keyHide !== false || layout.keyStride !== 28
      : layout.keyStride < (configuration?.keyHide ? 40 : 36)) ||
    layout.bytes !==
      layout.fontBytes * 2 + 24 + keyRows * (layout.keyNameBytes + layout.keyStride) ||
    voice?.firstByte !== 20 ||
    (!shortVoice && (voice.count !== 48 || voice.stride !== 116)) ||
    (Object.hasOwn(voice, 'playWhenNamed') && typeof voice.playWhenNamed !== 'boolean') ||
    (Object.hasOwn(configuration, 'systemVoiceRows') &&
      ![32, 48].includes(configuration.systemVoiceRows)) ||
    !Array.isArray(configuration?.blockSizes) ||
    configuration.blockSizes.length !== 4 ||
    configuration.blockSizes.some(
      (size, index) =>
        !word(size) ||
        size % 4 !== 0 ||
        (shortVoice ? size !== minimumBlocks[index] : size < minimumBlocks[index]),
    )
  )
    throw new Error(`Invalid ABI behavior data ${abi.id}: canonical configuration layout`);
  return shortVoice ? 14 : 15;
}

function behaviorAt(abi, path) {
  return path.split('.').reduce((value, name) => value?.[name], abi);
}

function validateUnreviewed(abi) {
  if (abi.unreviewed === undefined) return;
  if (!abi.unreviewed || Object.getPrototypeOf(abi.unreviewed) !== Object.prototype)
    throw new Error(`Invalid ABI behavior data ${abi.id}: unreviewed map`);
  for (const [path, reason] of Object.entries(abi.unreviewed))
    if (
      !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(path) ||
      typeof reason !== 'string' ||
      !reason.length ||
      behaviorAt(abi, path) !== null
    )
      throw new Error(`Invalid ABI behavior data ${abi.id}: unreviewed ${path}`);
}

// An explicit unknown is data, not a false capability or a modern default.
// Consumers use this accessor at the real operation; metadata remains plain data.
export function nativeABIBehavior(profile, path) {
  const abi = nativeABI(profile),
    value = behaviorAt(abi, path);
  if (value === undefined || Object.hasOwn(abi.unreviewed ?? {}, path))
    throw new Error(`Unreviewed ABI behavior ${profile}/${path}`);
  return value;
}

function validateBehavior(abi) {
  const messageWords = validateConfiguration(abi);
  validateUnreviewed(abi);
  const defaults = abi.configuration.defaults,
    word = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
  if (
    !defaults ||
    typeof defaults.font !== 'string' ||
    typeof defaults.title !== 'string' ||
    ![
      ['message', messageWords],
      ['effect', 7],
      ['window', 3],
    ].every(
      ([name, count]) =>
        Array.isArray(defaults[name]) &&
        defaults[name].length === count &&
        defaults[name].every(word),
    ) ||
    !word(defaults.contVoice) ||
    !word(defaults.rawVolumePercent) ||
    !['enabled', 'masterPercent', 'group'].every((name) => word(defaults.voiceRecords[name])) ||
    !Array.isArray(abi.sound.legacyTypes) ||
    !abi.sound.legacyTypes.length ||
    abi.sound.legacyTypes.length !== new Set(abi.sound.legacyTypes).size ||
    abi.sound.legacyTypes.some((name) => typeof name !== 'string' || !/^[a-z]+$/.test(name)) ||
    !abi.sound.legacyVolumeAliases ||
    Object.values(abi.sound.legacyVolumeAliases).some(
      (value) => !Number.isInteger(value) || value < 0 || value > 2,
    ) ||
    !['ascii-byte-directory', 'cp932-pair-directory'].includes(
      abi.sound.filenamePolicy?.classification,
    ) ||
    !['wide', 'standard'].includes(abi.sound.filenamePolicy?.pairs)
  )
    throw new Error(`Invalid ABI normal configuration defaults ${abi.id}`);
  const filename = abi.sound.filenamePolicy;
  if (
    filename.classification === 'cp932-pair-directory' &&
    (filename.maximumBytes !== 255 ||
      !['wide', 'standard'].includes(filename.pairs) ||
      filename.caseFold !== 'c-locale-ascii' ||
      filename.lastSeparatorZero !== 'retain-name' ||
      filename.extensionScan !== 'raw-backwards' ||
      filename.headComparison !== 'raw-byte-prefix' ||
      filename.directoryComparison !== 'c-locale-bytewise')
  )
    throw new Error(`Invalid ABI normal filename policy ${abi.id}`);
  if (
    Object.hasOwn(abi.sound, 'sameIdAllowsUnconfiguredSoundTree') &&
    typeof abi.sound.sameIdAllowsUnconfiguredSoundTree !== 'boolean'
  )
    throw new Error(`Invalid ABI Sound same-ID policy ${abi.id}`);
  if (
    Object.hasOwn(abi.sound, 'loopPointEndPolicy') &&
    abi.sound.loopPointEndPolicy !== 'strict-order'
  )
    throw new Error(`Invalid ABI Sound loop-point end policy ${abi.id}`);
  if (
    Object.hasOwn(abi.fes ?? {}, 'definitionMissIsDiagnostic') &&
    typeof abi.fes.definitionMissIsDiagnostic !== 'boolean'
  )
    throw new Error(`Invalid ABI FES definition diagnostic policy ${abi.id}`);
  if (
    Object.hasOwn(abi.database ?? {}, 'nullImportPolicy') &&
    abi.database.nullImportPolicy !== 'reject-unwritten'
  )
    throw new Error(`Invalid ABI database NULL import policy ${abi.id}`);
  const valid = (path, predicate) =>
      Object.hasOwn(abi.unreviewed ?? {}, path) || predicate(behaviorAt(abi, path)),
    bool = (value) => typeof value === 'boolean',
    integer = Number.isSafeInteger,
    oneOf =
      (...values) =>
      (value) =>
        values.includes(value),
    capabilities = [
      'effekseerTask',
      'embeddedJavaScript',
      'cubeFlipGridHeightProduct',
      'steam',
      'windowReturnTitle',
      'windowBaseAccelerators',
      'windowLanguageAccelerators',
      'broadcast',
      'recordQueues',
      'unicodeOutput',
      'utf8Primitives',
      'utf8Text',
      'emoteFes',
      'engineWorkers',
      'hapMovieAnsiDriverPath',
      'windowsMediaReader',
      'systemEntropy',
      'inputNullText',
      'taskDumpTopWriter',
    ],
    checks = [
      ['text.settingsCharacterBytes', oneOf(1, 2)],
      ['text.pathBytes', integer],
      ['text.fesLayouts', (v) => v && typeof v === 'object'],
      ['text.layoutModes', Array.isArray],
      ['text.resourceMessages.first.cp932', integer],
      ['sound.missingIdPathFields', Array.isArray],
      ['sound.controlBytes', integer],
      ['globalFile.growthBytes', oneOf(0x10000, 0x80000)],
      ['stringBank.emptyGetResult', oneOf(0, 1)],
      ['database.nullExportPolicy', oneOf('sentinel', 'reject-unwritten')],
      ['language.storage', oneOf('bytes', 'text')],
      ['plugins.emoteDriver', oneOf('native', 'placeholder')],
      ['messages.screenEvent', integer],
      ['messages.tilePlaneCommand', integer],
      ['layouts', (v) => v && typeof v === 'object'],
      ['fes.variableBankOffset', integer],
      ['fes.configurationMessage.liveObjects', bool],
      ['fes.configurationMessage.notification', oneOf(null, 'MES_CHANGECONFIG')],
      ['fes.configurationMessage.filenameComparison', oneOf(null, 'c-locale-ascii')],
      ['fes.fileList.patternEncoding', oneOf('cp932', 'cp932-as-utf16le')],
      ['fes.fileList.keyEncoding', oneOf('cp932', 'utf16le')],
      ['fes.macroLiterals.string', oneOf('raw', 'unescape-quote')],
      ['fes.macroLiterals.character', oneOf('raw', 'wrap-raw')],
      ['graphics.drawEnablePendingPolicy', oneOf(null, 'value', 'rising-edge')],
      ['graphics.textureCapsPolicy', oneOf(null, 'virtual-d3d9')],
      ['graphics.texturedBoundsQuery', oneOf(null, 'model-and-pages')],
      ['floatingPoint.x87ControlWord', oneOf(0x7f)],
      ['floatingPoint.mxcsr', oneOf(0x1f80)],
      ...capabilities.map((name) => ['capabilities.' + name, bool]),
      ...[
        'extendedPreferences',
        'language',
        'keyHide',
        'windowActive',
        'sceneAnimation',
        'extendedQueries',
      ].map((name) => ['configuration.' + name, bool]),
      ...[
        'singleTable',
        'resetOnReload',
        'archiveFallback',
        'switchWindowProtocol',
        'dynamicMenus',
      ].map((name) => ['language.' + name, bool]),
    ];
  if (
    checks.some(([path, predicate]) => !valid(path, predicate)) ||
    !['before-defaults', 'after-preferences'].includes(abi.startup?.resourceCheck) ||
    abi.startup.verification?.cipher !== 'blowfish-le32' ||
    !['cp932', 'utf8'].includes(abi.startup.verification?.codeEncoding) ||
    !['decrypted-c-string', 'open-cs2-literal'].includes(abi.startup.verification?.comparison) ||
    abi.floatingPoint?.precisionBits !== 24 ||
    abi.floatingPoint?.rounding !== 'nearest'
  )
    throw new Error(`Invalid ABI behavior data ${abi.id}`);
  if (
    Object.hasOwn(abi.startup, 'loosePath') &&
    (typeof abi.startup.loosePath !== 'string' ||
      !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.xml$/.test(abi.startup.loosePath))
  )
    throw new Error(`Invalid ABI loose startup path ${abi.id}`);
  const services = abi.startup.applicationServices;
  if (
    !Array.isArray(services) ||
    services.length !== new Set(services).size ||
    !services.length ||
    services.at(-1) !== 'root-script' ||
    services.some(
      (name) =>
        ![
          'steam-if-capable',
          'startup-sound',
          'textures',
          'global-strings',
          'title',
          'm2',
          'root-script',
        ].includes(name),
    ) ||
    !['startup-sound', 'textures', 'title', 'root-script'].every((name) =>
      services.includes(name),
    ) ||
    !['raw', 'global-string'].includes(abi.startup.titleMode)
  )
    throw new Error(`Invalid ABI startup services ${abi.id}`);
  for (const definition of Object.values(abi.messages?.channels ?? {})) {
    if (definition.unmapped !== undefined && !['identity', 'reject'].includes(definition.unmapped))
      throw new Error(`Invalid ABI unmapped-message policy ${abi.id}`);
    for (const [direction, rules] of Object.entries(definition)) {
      if (direction === 'unmapped') continue;
      if (!['raw', 'canonical'].includes(direction) || !Array.isArray(rules))
        throw new Error(`Invalid ABI message rules ${abi.id}`);
      for (const rule of rules) {
        if (
          ![rule.min, rule.max].every((value) => value === null || integer(value)) ||
          !integer(rule.offset) ||
          (rule.min !== null && rule.max !== null && rule.min > rule.max) ||
          [rule.kinds, rule.exceptKinds].some(
            (kinds) =>
              kinds !== undefined &&
              (!Array.isArray(kinds) || kinds.some((kind) => !integer(kind))),
          )
        )
          throw new Error(`Invalid ABI message rule ${abi.id}`);
      }
    }
  }
  if (!abi.messages?.channels?.base || !abi.messages?.channels?.control || !abi.messages?.root)
    throw new Error(`Incomplete ABI message data ${abi.id}`);
  for (const field of ['soundBaseOnly', 'scriptForward']) {
    const ids = abi.messages[field];
    if (
      ids !== undefined &&
      (!Array.isArray(ids) || ids.some((id) => !word(id)) || new Set(ids).size !== ids.length)
    )
      throw new Error(`Invalid ABI message policy ${abi.id}/${field}`);
  }
  const root = abi.messages.root;
  if (
    !Number.isInteger(root.start) ||
    root.start < 0 ||
    root.start > 0xfffffff7 ||
    typeof root.captionWide !== 'boolean' ||
    !Number.isInteger(root.soundReset) ||
    root.soundReset < 0 ||
    root.soundReset > 0xffffffff
  )
    throw new Error(`Invalid ABI Root protocol ${abi.id}`);
  if (
    Object.hasOwn(abi.startup.verification, 'defaultCodeBytes') &&
    !Object.hasOwn(abi.unreviewed ?? {}, 'startup.verification.defaultCodeBytes') &&
    (!Array.isArray(abi.startup.verification.defaultCodeBytes) ||
      abi.startup.verification.defaultCodeBytes.some(
        (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
      ))
  )
    throw new Error(`Invalid ABI startup code default bytes ${abi.id}`);
  validateFESCommonHeads(abi.fes.commonHeads);
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
