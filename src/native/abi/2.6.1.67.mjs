// SPDX-License-Identifier: MPL-2.0
// Own normal data; physical executable layouts belong to the explicit oracle.
import { NATIVE_SEMANTICS } from './semantics.mjs';

const mainReserved = [
  0, 2, 3, 141, 169, 170, 172, 173, 180, 182, 184, 185, 187, 188, 189, 190, 191, 429, 439, 543, 544,
  545, 546, 547, 548, 550, 552, 553, 556, 559, 560, 561, 562, 563, 573, 574, 578, 579, 581, 626,
  627, 642, 643, 644, 652, 656, 660, 661, 670, 671, 672, 673, 686, 687, 906, 907, 908, 910, 911,
  912, 913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 926, 927, 928, 929, 930, 931,
  932, 933,
];
const mainConstantZero = [
  171, 174, 175, 176, 177, 178, 179, 181, 183, 186, 236, 432, 551, 554, 555, 575, 580, 909, 925,
];
const mainUnwritten = [140, 142, 549];
const legacyTextInitializers = [123, 418];
const legacyTextMutators = [124, 125, 557];
const legacyTextStateSlots = [126, 127, 128, 129, 131, 132, 138, 139, 456, 585, 599];
const rectangleOperations = [214, 215, 216, 217, 218];
const namePairOperations = [289, 290, 291, 292, 293];
const fesLocalOperations = [664, 665, 666, 667, 668];
const fesTarget = {
  name: 'fes',
  description: 'Native FES task ID',
  type: { kind: 'object-id', objectKind: 'FES' },
};
const databaseHandle = {
  name: 'database',
  description: 'Borrowed database handle',
  type: { kind: 'handle', handleKind: 'database', ownership: 'borrowed' },
};
const databaseFormat = (name, description) => ({
  name,
  description,
  type: {
    kind: 'pointer',
    addressSpace: 'vm',
    direction: 'in',
    target: { kind: 'format-string', encoding: 'CP932' },
  },
});
const dictionaryHandle = {
  name: 'dictionary',
  description: 'Borrowed dictionary handle',
  type: { kind: 'handle', handleKind: 'dictionary', ownership: 'borrowed' },
};
const dictionaryKey = {
  name: 'key',
  description: 'Guest CP932 format for a key',
  type: {
    kind: 'pointer',
    addressSpace: 'vm',
    direction: 'in',
    target: { kind: 'format-string', encoding: 'CP932' },
  },
};
const dictionaryKeyOutput = {
  name: 'destination',
  description: 'Guest CP932 key output with a terminating NUL',
  type: {
    kind: 'pointer',
    addressSpace: 'vm',
    direction: 'out',
    target: { kind: 'character', bits: 8, encoding: 'CP932' },
  },
};
const dictionaryWord = {
  name: 'value',
  description: 'Raw value word',
  type: { kind: 'bits', bits: 32 },
};
const dictionaryFloatCopies = [887, 891, 892];
const remainderEvidence =
  'Own 2.6.1.67 x87 FPREM retains the dividend sign for a nonzero exact multiple, completes large reductions, and selects native NaN payloads. Main and both Particle tables alias 0x499d30. The separate Generic wrapper at 0x55d9c0 calls the same CRT body. Each writes one f32 under control 1.';
const powerEvidence =
  'Own CRT startup 0x5b91d5 and 0x5bb8eb select the SSE2 power path at 0x5bcfd0 from 0x5b0890. Main61 and both Particle18 slots alias 0x499d90. Generic13 at 0x55da20 calls the same CRT body. Each writes one rounded f32 through control 1, including SSE2 identities and quiet NaN payloads.';
const randomEvidence =
  'Own 2.6.1.67 Main and Particle wrappers alias both complete native entry points. Separate MOT wrappers reach the same independent integer and real MT19937 streams. The real path rounds the converted unsigned high word at x87 single precision before scaling. Each wrapper consumes one value of its own stream and returns control 1.';
const triangleEvidence =
  'Own Main and both Particle tables share the complete wrapper at 0x4a25b0. The x87 path takes absolute operands, applies two native remainders and selects the signed quarter. Control 1 writes one single-precision word.';
const particleDistanceEvidence =
  'Own Particle tables share the six-float wrapper at 0x49a410. Its private distance body stores the three deltas at single precision, adds squared x and y before z, and stores the sum as f32 before the CRT square root. Control 1 writes the result.';
const particleStateSlots = [1, 2, 4, 5, 27, 28, 30, 31, 32, 35, 36, 39, 40];
const particleGeometrySlots = [22, 23, 24, 25, 26, 29, 38];
const particleRecoveredSlots = [
  ...particleStateSlots,
  ...particleGeometrySlots,
  3,
  18,
  33,
  34,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  19,
  20,
  21,
  41,
  42,
  37,
  43,
].sort((a, b) => a - b);
const particleStateEvidence = {
  ids: particleStateSlots,
  value:
    'Own 2.6.1.67 Particle tables share these complete wrappers for frame history, viewport, current position and quad, registers, exit, visibility and count. Position copies three x87 singles and clears W, quad copies four 28-byte vertices, registers write 32 single words, exit clears active with control 4, and visibility stores a full DWORD after an unsigned index check.',
};
const particleStateSignatures = {
  ids: [1, 2, 4, 36, 40],
  fields: { resultWritten: true },
};
const particleGeometryEvidence = [
  {
    ids: [29],
    value:
      'Own Particle tables alias the complete UV wrapper at 0x49a180. It reads the first and third raw f32 input words, subtracts one half, and writes four UV pairs divided by the retained texture dimensions under x87 single precision. The second and fourth arguments and other quad words remain unchanged. Control 2 leaves the result unwritten.',
  },
  {
    ids: [3],
    value:
      'Own shared Particle frame converter at 0x499ad0 preserves nonpositive input, rounds the unsigned rate and frame product under the default D3D9 x87 mode, then writes the low DWORD under control 1.',
  },
  {
    ids: [22, 23, 24, 25, 26, 38],
    value:
      'Own Particle tables alias the complete quad and viewport wrappers. Quad writes follow the original x87 operand ordering and preserve the remaining vertex words. The viewport query uses the SSE D3DX inverse selected by original initialization and writes four f32 values under control 2.',
  },
];

export default {
  id: 'cs2-2.6.1.67',
  profile: 'bokutomo-engine-2.6.1.67',
  engineVersion: '2.6.1.67',
  executableSha256: 'd1889d60dbe3350b068605f94a49ae8e93eb388ce66e7abc36607eed2eda7010',
  xmlEncoding: 'Shift_JIS',
  fileIO: { rawModeAndBoundedBuffer: true, defaultReadOnly: true },
  dictionary: { float32Copies: dictionaryFloatCopies },
  rectangles: { strictArity: true },
  calendar: { weekdayAlgorithm: 'century-integer' },
  text: {
    freeTypeCharacterEncoding: 'cp932',
    freeTypeVersion: '2.4.8',
    settingsCharacterBytes: 1,
    pathBytes: 260,
    plainSyntax: 'narrow',
    clipboardUsesCP932: true,
    legacyConfigurationBytes: 1128,
    legacyClearPublishes: true,
    legacyInitializerSlots: legacyTextInitializers,
    legacyInitializerBitmapBpp: 4,
    legacyGlyphAtlas: true,
    legacyGlyphKeepsTransparentRgb: true,
    legacyTaskWordOperations: [...legacyTextMutators, ...legacyTextStateSlots],
    formattedComparisonSecondBeforeFirst: true,
    tokenLiveCopy: true,
    doubleByteUnmappedSourceIsFalse: true,
    plainParenthesisTokens: true,
    spaceGroupUnmappedSourceIsEmpty: true,
    listEntryLiveCopy: true,
    listJoinLiveCopy: true,
    percentProduct: 'final-f32',
    configurationLayout: {
      fontBytes: 64,
      keyNameBytes: 32,
      keyStride: 36,
      bytes: 5592,
      encoding: 'CP932',
    },
    fesLayouts: {
      // The original configuration starts at word 190. Use the canonical
      // word 191 for the packet and the adjacent text layout fields.
      21: {
        dirty: 241,
        colors: 329,
        fontIndex: 236,
        flags: 318,
        weight: 231,
        shadow: 232,
        fix: 234,
        wipe: 235,
        profile: 333,
        shift: 338,
        category: null,
        fontBytes: 32,
        configBytes: 184,
        packetOutput: 1,
        resetKeepsLayout: true,
      },
    },
    layoutModes: [
      'view',
      'color',
      'vcolor',
      'acolor',
      'vacolor',
      'pcolor',
      'vpcolor',
      'margin',
      'move',
      'ruby',
      'frame',
      'font',
      'fontind',
      'shadow',
      'size',
      'rsize',
      'indent',
      'weight',
      'd_prof',
      'prof',
      'shift',
      'scrolltype',
      'wipewidth',
      'fontfix',
    ],
    resourceMessages: {
      first: {
        nv: null,
        cp932: 431,
        utf8: null,
      },
      clearCategory: false,
      maxOperation: 18,
      emptyEngineQueryWritesZero: true,
      cp932UsesNativeMessages: true,
      cp932SignedVramPosition: true,
      cp932DrawUsesPageLimit: true,
      cp932ReconfigureRetainsPageMarkers: true,
    },
  },
  configuration: {
    blockSizes: [5628, 60, 28, 12],
    keyHide: false,
    extendedPreferences: false,
    defaults: {
      font: 'ＭＳ ゴシック',
      title: 'CS2',
      message: [4, 4, 0, 15, 5, 1, 0, 1, 0, 100, 0, 4294967295, 0, 0, 0],
      effect: [0, 0, 1, 1, 1, 5, 0],
      window: [4294967295, 1, 1],
      voiceRecords: {
        count: 48,
        firstByte: 20,
        stride: 116,
        enabled: 1,
        masterPercent: 100,
        group: 100,
      },
      contVoice: 1,
      rawVolumePercent: 100,
    },
    language: null,
    windowActive: null,
    sceneAnimation: null,
    extendedQueries: null,
    fontPreferenceLimit: null,
  },
  math: {
    anglesUseX87: true,
    atan2UsesX87: true,
    powUsesSSE2Identities: true,
    trigUsesNativeReduction: true,
    remainderUsesX87: true,
    randomFloatUsesX87: true,
    interpreterUsesNativeScalarMath: true,
    lerpUsesX87: true,
    matrixCopyChunkBytes: 4,
    motionMatrixMultiplySSE: true,
    triangleWaveUsesX87: true,
    roundIntegerResult: 'int64-low-word',
    vectorLengthUsesX87: true,
    vectorTransformPairwise: true,
    vectorWordArithmeticUsesX87: true,
    matrixMultiplyUsesSSEWords: true,
    yawPitchRollUsesSSEWords: true,
  },
  particle: {
    taskMessageStart: 303,
    deferGraphAttachment: true,
    loadQuietsFloatWords: true,
    frameScale: 'x87-uint32',
    quadUsesX87: true,
    textureCoordinatesUseX87: true,
    distanceUsesX87: true,
    projectionBoundsUseX87: true,
    projectionBoundsUseSSE: true,
    attachmentPositionRequiresOwner: true,
    attachmentReadsRegistrationWord: true,
  },
  motion: {
    currentMatrixFallback: true,
    matrixMemoryOperationsUseNativeOrder: true,
    vectorOperationsUseNativeGeometry: true,
    vectorTransformUsesSSEWords: true,
    vectorNormalizeUsesSSEWords: true,
    matrixInverseUsesSSEWords: true,
    relativeRotationUsesSSEWords: true,
    vectorComponentsUseX87: true,
    nativeFilenameQuery: true,
    queryFormatsUnmappedAsEmpty: true,
    elapsedUsesX87: true,
    skipBypassesDelay: false,
    activeQueryUsesRawWord: true,
    addUsesFormat: true,
    registerWordsUseX87: true,
    splineUsesX87: true,
  },
  movie: { alwaysUseBgmVolume: true, redrawRequiresRunning: true },
  task: { childQueryUsesRouteEntries: true, kindQueryRejectsRetiringOwner: true },
  globalFile: {
    growthBytes: 524288,
    timestampMinimumBytes: 4,
    optionalTaskRecords: true,
    hostDataRequiresExplicitZeroRecord: true,
  },
  memory: { copyUsesMMX: true },
  gallery: { listVariantWidth: 64 },
  displayLog: { blockRecordWords: 6 },
  preload: { defaultCategory: 'image' },
  resources: { categoryCount: 64 },
  nameTable: { legacyFieldBytes: 32, fixedPairs: true, pairByteLimit: 64 * 1024 * 1024 },
  stringBank: { emptyGetResult: 0, expandUsesExistingBank: true, cssOwnerLookupOnly: true },
  database: {
    nullExportPolicy: 'reject-unwritten',
    nullImportPolicy: 'reject-unwritten',
    requiresMappedFormat: true,
  },
  sound: {
    banks: 32,
    mainLoadPacketBytes: 280,
    firstMessage: 174,
    lastMessage: 212,
    delegateFrom: 213,
    legacyTypes: ['bgm', 'se', 'voice', 'sysvoice'],
    legacyVolumeAliases: {
      bgm: 0,
      se: 1,
      voice: 2,
      sysvoice: 2,
    },
    filenamePolicy: {
      maximumBytes: 255,
      pairs: 'standard',
      caseFold: 'c-locale-ascii',
      lastSeparatorZero: 'retain-name',
      extensionScan: 'raw-backwards',
      classification: 'cp932-pair-directory',
      headComparison: 'raw-byte-prefix',
      directoryComparison: 'c-locale-bytewise',
    },
    controlBytes: null,
    missingIdPathFields: null,
    crossfade: false,
    positionRequires3D: true,
    spatialRequiresLoadedBuffer: true,
    allowQuotedFesNames: false,
    fesExtensions: null,
    fesLoadParameters: false,
    categoryLookupUsesFlatVoice: true,
    completionFrame: null,
  },
  language: {
    storage: null,
    singleTable: null,
    resetOnReload: null,
    archiveFallback: null,
    switchWindowProtocol: null,
    dynamicMenus: null,
    fixedFilename: null,
  },
  plugins: {
    emoteDriver: null,
    requiredRenderer: null,
  },
  capabilities: {
    nameTableAliases: false,
    effekseerTask: false,
    embeddedJavaScript: false,
    windowBaseAccelerators: true,
    unicodeOutput: false,
    inputNullText: true,
    taskDumpTopWriter: true,
    cubeFlipGridHeightProduct: null,
    steam: null,
    windowReturnTitle: null,
    windowLanguageAccelerators: null,
    broadcast: null,
    recordQueues: null,
    utf8Primitives: null,
    utf8Text: null,
    emoteFes: null,
    engineWorkers: null,
    hapMovieAnsiDriverPath: null,
    windowsMediaReader: null,
    systemEntropy: null,
  },
  messages: {
    channels: {
      base: {
        unmapped: 'reject',
        raw: [
          {
            min: 1,
            max: 1,
            offset: 0,
          },
          {
            min: 2,
            max: 2,
            offset: 0,
          },
          {
            min: 3,
            max: 3,
            offset: 0,
          },
          {
            min: 13,
            max: 13,
            offset: 0,
          },
          {
            min: 15,
            max: 15,
            offset: 0,
          },
          {
            min: 16,
            max: 16,
            offset: 0,
          },
          {
            min: 17,
            max: 17,
            offset: 0,
          },
          {
            min: 23,
            max: 23,
            offset: 0,
          },
          {
            min: 24,
            max: 24,
            offset: 0,
          },
          {
            min: 29,
            max: 29,
            offset: 0,
          },
          {
            min: 30,
            max: 30,
            offset: 0,
          },
          {
            min: 31,
            max: 31,
            offset: 0,
          },
          {
            min: 32,
            max: 32,
            offset: 0,
          },
          {
            min: 33,
            max: 33,
            offset: 0,
          },
          {
            min: 34,
            max: 34,
            offset: 0,
          },
          {
            min: 35,
            max: 35,
            offset: 0,
          },
          {
            min: 36,
            max: 36,
            offset: 0,
          },
          {
            min: 37,
            max: 37,
            offset: 0,
          },
          {
            min: 38,
            max: 38,
            offset: 0,
          },
        ],
        canonical: [
          {
            min: 1,
            max: 1,
            offset: 0,
          },
          {
            min: 2,
            max: 2,
            offset: 0,
          },
          {
            min: 3,
            max: 3,
            offset: 0,
          },
          {
            min: 13,
            max: 13,
            offset: 0,
          },
          {
            min: 15,
            max: 15,
            offset: 0,
          },
          {
            min: 16,
            max: 16,
            offset: 0,
          },
          {
            min: 17,
            max: 17,
            offset: 0,
          },
          {
            min: 23,
            max: 23,
            offset: 0,
          },
          {
            min: 24,
            max: 24,
            offset: 0,
          },
          {
            min: 29,
            max: 29,
            offset: 0,
          },
          {
            min: 30,
            max: 30,
            offset: 0,
          },
          {
            min: 31,
            max: 31,
            offset: 0,
          },
          {
            min: 32,
            max: 32,
            offset: 0,
          },
          {
            min: 33,
            max: 33,
            offset: 0,
          },
          {
            min: 34,
            max: 34,
            offset: 0,
          },
          {
            min: 35,
            max: 35,
            offset: 0,
          },
          {
            min: 36,
            max: 36,
            offset: 0,
          },
          {
            min: 37,
            max: 37,
            offset: 0,
          },
          {
            min: 38,
            max: 38,
            offset: 0,
          },
        ],
      },
      control: {
        unmapped: 'reject',
        raw: [
          { min: 368, max: 376, offset: -11, kinds: [41] },
          ...[6, 9, 10].map((id) => ({ min: id, max: id, offset: 0, kinds: [41] })),
          { min: 64, max: 65, offset: -3, kinds: [41] },
        ],
        canonical: [
          { min: 357, max: 365, offset: 11, kinds: [41] },
          ...[6, 9, 10].map((id) => ({ min: id, max: id, offset: 0, kinds: [41] })),
          { min: 61, max: 62, offset: 3, kinds: [41] },
        ],
      },
      screen: {
        unmapped: 'reject',
        raw: [
          { min: 377, max: 388, offset: -11 },
          { min: 516, max: 523, offset: -39 },
        ],
        canonical: [
          { min: 366, max: 377, offset: 11 },
          { min: 477, max: 484, offset: 39 },
        ],
      },
      area: {
        unmapped: 'reject',
        raw: [
          { min: 257, max: 259, offset: -11 },
          { min: 261, max: 261, offset: -11 },
          { min: 275, max: 275, offset: -11 },
        ],
        canonical: [
          { min: 246, max: 248, offset: 11 },
          { min: 250, max: 250, offset: 11 },
          { min: 264, max: 264, offset: 11 },
        ],
      },
      sound: {
        unmapped: 'reject',
        canonical: [
          {
            min: 1,
            max: 1,
            offset: 0,
          },
          {
            min: 2,
            max: 2,
            offset: 0,
          },
          {
            min: 3,
            max: 3,
            offset: 0,
          },
          {
            min: 13,
            max: 13,
            offset: 0,
          },
          {
            min: 15,
            max: 15,
            offset: 0,
          },
          {
            min: 16,
            max: 16,
            offset: 0,
          },
          {
            min: 17,
            max: 17,
            offset: 0,
          },
          {
            min: 22,
            max: 22,
            offset: 0,
          },
          {
            min: 23,
            max: 23,
            offset: 0,
          },
          {
            min: 24,
            max: 24,
            offset: 0,
          },
          {
            min: 29,
            max: 29,
            offset: 0,
          },
          {
            min: 30,
            max: 30,
            offset: 0,
          },
          {
            min: 31,
            max: 31,
            offset: 0,
          },
          {
            min: 32,
            max: 32,
            offset: 0,
          },
          {
            min: 33,
            max: 33,
            offset: 0,
          },
          {
            min: 34,
            max: 34,
            offset: 0,
          },
          {
            min: 35,
            max: 35,
            offset: 0,
          },
          {
            min: 36,
            max: 36,
            offset: 0,
          },
          {
            min: 37,
            max: 37,
            offset: 0,
          },
          {
            min: 38,
            max: 38,
            offset: 0,
          },
          {
            min: 158,
            max: 158,
            offset: 0,
          },
          {
            min: 174,
            max: 188,
            offset: 5,
          },
          {
            min: 190,
            max: 192,
            offset: 5,
          },
          {
            min: 195,
            max: 195,
            offset: 5,
          },
          {
            min: 200,
            max: 203,
            offset: 5,
          },
          {
            min: 204,
            max: 204,
            offset: 5,
          },
          {
            min: 205,
            max: 205,
            offset: 5,
          },
          {
            min: 211,
            max: 211,
            offset: 5,
          },
          {
            min: 212,
            max: 212,
            offset: 5,
          },
        ],
        raw: [
          {
            min: 1,
            max: 1,
            offset: 0,
          },
          {
            min: 2,
            max: 2,
            offset: 0,
          },
          {
            min: 3,
            max: 3,
            offset: 0,
          },
          {
            min: 13,
            max: 13,
            offset: 0,
          },
          {
            min: 15,
            max: 15,
            offset: 0,
          },
          {
            min: 16,
            max: 16,
            offset: 0,
          },
          {
            min: 17,
            max: 17,
            offset: 0,
          },
          {
            min: 22,
            max: 22,
            offset: 0,
          },
          {
            min: 23,
            max: 23,
            offset: 0,
          },
          {
            min: 24,
            max: 24,
            offset: 0,
          },
          {
            min: 29,
            max: 29,
            offset: 0,
          },
          {
            min: 30,
            max: 30,
            offset: 0,
          },
          {
            min: 31,
            max: 31,
            offset: 0,
          },
          {
            min: 32,
            max: 32,
            offset: 0,
          },
          {
            min: 33,
            max: 33,
            offset: 0,
          },
          {
            min: 34,
            max: 34,
            offset: 0,
          },
          {
            min: 35,
            max: 35,
            offset: 0,
          },
          {
            min: 36,
            max: 36,
            offset: 0,
          },
          {
            min: 37,
            max: 37,
            offset: 0,
          },
          {
            min: 38,
            max: 38,
            offset: 0,
          },
          {
            min: 179,
            max: 193,
            offset: -5,
          },
          {
            min: 195,
            max: 197,
            offset: -5,
          },
          {
            min: 200,
            max: 200,
            offset: -5,
          },
          {
            min: 205,
            max: 208,
            offset: -5,
          },
          {
            min: 209,
            max: 209,
            offset: -5,
          },
          {
            min: 210,
            max: 210,
            offset: -5,
          },
          {
            min: 216,
            max: 216,
            offset: -5,
          },
          {
            min: 217,
            max: 217,
            offset: -5,
          },
        ],
      },
      fesSound: {
        unmapped: 'reject',
        raw: [
          {
            min: 179,
            max: 179,
            offset: -5,
          },
          {
            min: 181,
            max: 181,
            offset: -5,
          },
          {
            min: 182,
            max: 182,
            offset: -5,
          },
          {
            min: 184,
            max: 184,
            offset: -5,
          },
          {
            min: 185,
            max: 185,
            offset: -5,
          },
          {
            min: 186,
            max: 186,
            offset: -5,
          },
          {
            min: 189,
            max: 189,
            offset: -5,
          },
          {
            min: 200,
            max: 200,
            offset: -5,
          },
          {
            min: 205,
            max: 205,
            offset: -5,
          },
          {
            min: 209,
            max: 209,
            offset: -5,
          },
          {
            min: 210,
            max: 210,
            offset: -5,
          },
          {
            min: 216,
            max: 216,
            offset: -5,
          },
          {
            min: 217,
            max: 217,
            offset: -5,
          },
        ],
      },
    },
    root: {
      start: 30,
      captionWide: false,
      soundReset: 189,
    },
    movieInput: { query: 32, gate: 143 },
    windowDirectClose: 0x433,
    windowCloseConfirmation: { caption: '終了', template: '%s を終了してよろしいですか？' },
    // Close preparation communicates the original raw 154 notification.
    soundBaseOnly: [22, 158],
    // Own Script input paths map raw 61/62/428 to the canonical hover,
    // input-state and system-message packets. Raw 30/31 use Base only.
    scriptForward: [4, 9, 10, 18, 19, 20, 21, 22, 64, 65, 446],
    scriptBaseOnly: [30, 31],
    scriptNotifications: { 570: 424, 571: 427, 572: 426 },
    screenEvent: null,
    tilePlaneCommand: null,
  },
  floatingPoint: {
    precisionBits: 24,
    rounding: 'nearest',
    x87ControlWord: null,
    mxcsr: null,
  },
  fes: {
    variableBankOffset: 1800,
    localAccessUsesNativeTypes: true,
    namedWordFormatSkipsUnmapped: true,
    discardLiteralAssignmentWrites: true,
    commonHeads: {
      shared: [
        '_redirect',
        '_redirect_clear',
        '_redirect_erase',
        'automove',
        'automoveex',
        'basebtnpri',
        'baseimg',
        'baseimg_pri',
        'bitcount',
        'break',
        'btnsimulate',
        'call',
        'cgreg',
        'cgreg_init',
        'cgreg_t',
        'cgregmax',
        'cgregnum',
        'cgregtbl',
        'check_install',
        'checktitle',
        'clipboard',
        'config',
        'config_open',
        'datasave',
        'dbgstr',
        'dbgtime',
        'debug',
        'decode',
        'deletebgbutton',
        'deletetask',
        'dic_appear',
        'dic_find',
        'dic_id',
        'dic_ind',
        'dic_max_appear',
        'dic_title',
        'dic_update',
        'dic_update_clear',
        'enablebgbutton',
        'endfes',
        'endif',
        'endkcs',
        'execfes',
        'execkcs',
        'exit',
        'exit_boot',
        'fileexist',
        'fontcom',
        'force_redraw',
        'fps_enable',
        'fps_get',
        'fw_actcode',
        'fw_activate',
        'fw_auth',
        'fw_destroy',
        'fw_hash',
        'fw_init',
        'fw_limitpos',
        'fw_status',
        'fw_uniquecode',
        'getconf',
        'getexvar',
        'getstbl',
        'gettime',
        'getweek',
        'if',
        'input_text',
        'isdebug',
        'keyskip',
        'lockactive',
        'maketask',
        'messagebox',
        'newsave',
        'next',
        'opensite',
        'rand',
        'randtbl',
        'rdraw',
        'react',
        'reset_frame',
        'resetactive',
        'restoremove',
        'result',
        'rettitle',
        'rfmos',
        'rwipe',
        'rwmos',
        'saveapend_str',
        'savecopy',
        'savedelete',
        'saveexchg',
        'saveexist',
        'saveget_str',
        'send',
        'sendbtn',
        'setconf',
        'setexvar',
        'setstbl',
        'sortsave',
        'sortsave2',
        'strcmp',
        'strvar',
        'sysvoice',
        'touch_enable',
        'touch_kill',
        'vram_get',
        'wait',
        'wbreak',
        'wndmenu',
        'xchgcursor',
      ],
      additions: [],
      count: 110,
      complete: true,
      comparison: 'byte-exact-cstring',
      reviewedBindings: ['engine67-common-wait-owned-parameters'],
    },
    configurationMessage: {
      liveObjects: null,
      notification: null,
      filenameComparison: null,
    },
    fileList: {
      patternEncoding: null,
      keyEncoding: null,
    },
    macroLiterals: { string: 'unescape-quote', character: 'wrap-raw' },
    controlResources: { kinds: [41], scroll2Skin: 'state-direct', scroll2Protocol: 'legacy' },
  },
  scene: {
    translations: false,
    cstFileMarkers: true,
    directTextNull: 'zero',
    legacyHistoryRecords: true,
    directPathResult: 'success',
    historyCaptureUsesExistingBank: true,
  },
  input: {
    bitmapMaskNativeRows: true,
    cursorWarpNativeBounds: true,
    cursorWarpRequiresForeground: true,
    planeSourceViaInput: true,
  },
  graphics: {
    formattedBitmapPhysical: true,
    drawDirtyUsesRawWord: true,
    emptyImageSizeWritesZero: true,
    imageFilterRequiresLayers: true,
    screenEffectRetimesOnActiveInit: [38, 39, 50, 51, 52],
    screenEffectPreserveStoppedClockKinds: [38, 39, 50, 51, 52],
    screenEffectBreakUsesLogicalCapture: true,
    screenEffectMosaic: { fadeInitializerWords: 6, retainShortWipe: true },
    screenEffectFloatArguments: {
      521: [2, 3, 4, 6, 7],
      522: [],
      523: [1, 2, 3, 4, 5, 6, 7, 8],
      524: [],
      525: [2, 3],
      526: [],
      527: [2, 3],
      528: [],
      529: [],
      530: [2, 3],
      853: [2, 3],
      854: [],
      855: [],
      856: [2, 3],
      857: [],
      860: [2, 3, 6, 7],
      861: [],
      905: [2, 3],
    },
    planeAlphaFlags: 1,
    drawEnablePendingPolicy: 'rising-edge',
    drawBitmapRequiresRenderer: true,
    textureCapsPolicy: 'virtual-d3d9',
    texturedBoundsQuery: null,
    coordinateModeRequiresGraph: true,
    planePoseQueriesRequireReply: true,
    planeResetReleasesTrackedInput: true,
    graphQueriesTrackResponse: true,
    planeImageSelectorHidesTarget: true,
    bitmapBlitUsesSourceSize: true,
    screenCaptureOpaque: true,
    sameSizeBitmapCopyClips: true,
    savedImageExpandsRGB24: true,
  },
  startup: {
    resourceCheck: 'before-defaults',
    verification: {
      codeEncoding: 'cp932',
      cipher: 'blowfish-le32',
      comparison: 'decrypted-c-string',
      defaultCodeBytes: [111, 112, 101, 110, 95, 99, 115, 50],
    },
    titleMode: 'raw',
    applicationServices: ['startup-sound', 'textures', 'title', 'root-script'],
    accelerators: 'ansi-resource',
  },
  tables: {
    main: {
      count: 938,
      slots: {
        unknown: [
          12, 81, 82, 89, 90, 91, 95, 96, 97, 98, 99, 115, 120, 121, 122, 130, 133, 134, 135, 144,
          145, 146, 147, 148, 151, 152, 153, 154, 192, 193, 194, 195, 199, 201, 202, 204, 205, 206,
          208, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235,
          237, 264, 279, 280, 281, 282, 283, 287, 288, 346, 350, 352, 360, 361, 375, 376, 377, 378,
          379, 380, 381, 382, 383, 384, 391, 395, 396, 398, 399, 405, 406, 407, 408, 409, 410, 411,
          412, 413, 414, 415, 416, 428, 430, 431, 433, 441, 442, 443, 444, 445, 446, 457, 460, 468,
          470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487,
          488, 489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505,
          506, 507, 508, 509, 510, 511, 512, 513, 532, 533, 538, 558, 564, 569, 582, 583, 584, 587,
          588, 589, 600, 601, 602, 603, 604, 622, 623, 624, 628, 629, 631, 632, 641, 648, 657, 662,
          663, 669, 681, 682, 688, 690, 691, 692, 701, 702, 703, 704, 705, 706, 707, 708, 709, 716,
          721, 722, 725, 729, 734, 735, 738, 742, 743, 744, 745, 746, 747, 748, 749, 750, 751, 752,
          753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766, 767, 768, 769, 770,
          771, 772, 773, 774, 775, 776, 777, 778, 779, 780, 781, 782, 783, 784, 791, 792, 793, 794,
          795, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809, 810, 811, 812,
          813, 814, 815, 816, 817, 818, 819, 820, 821, 822, 823, 824, 825, 826, 827, 828, 829, 830,
          831, 832, 837, 838, 839, 840, 841, 842, 843, 879, 880, 881, 903,
        ],
        recovered: [
          1, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
          28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
          50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
          72, 73, 74, 75, 76, 77, 78, 79, 80, 83, 84, 85, 86, 87, 88, 92, 93, 94, 100, 101, 102,
          103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 116, 117, 118, 119, 123, 124,
          125, 126, 127, 128, 129, 131, 132, 136, 137, 138, 139, 140, 142, 143, 149, 150, 155, 156,
          157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 196, 197, 198, 200, 203, 207,
          209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 238, 239, 240, 241, 242, 243, 244, 245,
          246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263,
          265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 284, 285, 286, 289,
          290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307,
          308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325,
          326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343,
          344, 345, 347, 348, 349, 351, 353, 354, 355, 356, 357, 358, 359, 362, 363, 364, 365, 366,
          367, 368, 369, 370, 371, 372, 373, 374, 385, 386, 387, 388, 389, 390, 392, 393, 394, 397,
          400, 401, 402, 403, 404, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 434, 435,
          436, 437, 438, 440, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 458, 459, 461, 462,
          463, 464, 465, 466, 467, 469, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525,
          526, 527, 528, 529, 530, 531, 534, 535, 536, 537, 539, 540, 541, 542, 549, 557, 565, 566,
          567, 568, 570, 571, 572, 576, 577, 585, 586, 590, 591, 592, 593, 594, 595, 596, 597, 598,
          599, 605, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615, 616, 617, 618, 619, 620, 621,
          625, 630, 633, 634, 635, 636, 637, 638, 639, 640, 645, 646, 647, 649, 650, 651, 653, 654,
          655, 658, 659, 664, 665, 666, 667, 668, 674, 675, 676, 677, 678, 679, 680, 683, 684, 685,
          689, 693, 694, 695, 696, 697, 698, 699, 700, 710, 711, 712, 713, 714, 715, 717, 718, 719,
          720, 723, 724, 726, 727, 728, 730, 731, 732, 733, 736, 737, 739, 740, 741, 785, 786, 787,
          788, 789, 790, 833, 834, 835, 836, 844, 845, 846, 847, 848, 849, 850, 851, 852, 853, 854,
          855, 856, 857, 858, 859, 860, 861, 862, 863, 864, 865, 866, 867, 868, 869, 870, 871, 872,
          873, 874, 875, 876, 877, 878, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893,
          894, 895, 896, 897, 898, 899, 900, 901, 902, 904, 905, 934, 935, 936, 937,
        ],
        reserved: mainReserved,
        'constant-zero': mainConstantZero,
      },
      evidence: [
        {
          ids: fesLocalOperations,
          value:
            'Own wrappers 0x4a0110–0x4a0230 send raw334–338 to the FES receiver at 0x44f200. The named write selects the interpreter’s own context and stores a CP932 byte key at index zero. Copies transfer exactly 2048 private bytes in the selected direction and leave both names and selection unchanged. Main667 reads the result word and uses control 1. Main668 clears that word, and all other wrappers return control 2 without a result write.',
        },
        {
          ids: [786],
          value:
            'Own 0x49e300 calls the signed century arithmetic at 0x50c960. January and February adjust year and month with DWORD wrap, the century and month terms truncate toward zero, and IDIV publishes the signed remainder modulo seven. Control 1 writes one DWORD.',
        },
        {
          ids: rectangleOperations,
          value:
            'Own 0x4b2760–0x4b29df translates signed RECTs, snapshots source values before writing, and uses the borrowed bitmap dimensions or zero dimensions for a null pointer. Intersection writes four zero words for an empty intersection. Main217 writes an emptiness boolean under control 1. All mutators return control 2 without a result write.',
        },
        {
          ids: namePairOperations,
          value:
            'Own 0x4b2370–0x4b25cc allocates and releases zeroed 40-byte name rows. Original CP932 formatting precedes the 32-byte field copy, ASCII byte folding selects the first matching name, and the ordered DWORD-pair lookup writes a terminated name. A miss leaves outputs unchanged. Both queries use control 2 for a null owner and otherwise write a boolean under control 1.',
        },
        { ids: [61], value: powerEvidence },
        {
          ids: [461],
          value:
            'Own 0x4a26f0 loads one f32 and invokes CRT 0x5b0d00. Original initialized hardware verifies finite, zero, negative, infinity, subnormal and NaN result words. Control 1 writes one rounded f32.',
        },
        {
          ids: [675, 676, 885, 886, 894, 895],
          value:
            'Own allocation and destruction of the ordered dictionary share the exact Main515 and Main516 bodies, including the same 32-byte map owner.',
        },
        {
          ids: [677, 678, 679, 680],
          value:
            'Own original wrappers set and remove formatted CP932 keys, read a supplied default on a miss, and copy the first byte-ordered key matching a raw DWORD value into guest memory.',
        },
        {
          ids: [887, 888, 889, 890, 891, 892, 893, 896, 897, 898, 899, 900, 901, 902],
          value:
            'Own dictionary wrappers share the live byte-ordered map. Packed rows contain a terminated key, untouched DWORD padding, then one value. Import preserves existing keys. Main887, Main891 and Main892 copy through x87 F32. The second family copies raw words.',
        },
        {
          ids: [29, 30, 31, 32],
          value:
            'Own kcFileServer formats CP932 name and mode, reads the first lowercase r/w byte, and uses read-only access for the default. Original IFile reads and writes use the wrapped DWORD size times count, report bytes transferred, and Main32 releases the owned handle without changing the guest result.',
        },
        {
          ids: [7],
          value:
            'Own task clock reads the current task frame-rate DWORD at offset 72 under control 1.',
        },
        {
          ids: [9],
          value:
            'Own window wrapper posts WM_CLOSE for a nonzero selector and 0x433 for zero. The App confirms with its fixed CP932 strings and both accepted paths deactivate rendering before posting 0x410. Shutdown then disables the Script tasks through the canonical close event.',
        },
        {
          ids: [10],
          value:
            'Own clipboard wrapper expands the guest CP932 format and converts literal backslash-n byte pairs to CR/LF before writing CF_TEXT. Original calls open, empty, allocate, lock, unlock, transfer, close. Control 2 leaves the result unwritten.',
        },
        {
          ids: [11],
          value:
            'Own local clock wrapper translates seven guest addresses, then writes year, month, weekday, day, hour, minute and second in order as DWORDs. Aliases preserve write order under control 2.',
        },
        {
          ids: [136, 137],
          value:
            'Own kind8 raw112 copies the borrowed bitmap through the initialized glyph managers using 0x54cc60. Raw113 retains the first signed rectangle for each low-16-bit character through 0x54dc60, including a distinct shadow manager when configured. A zero bitmap skips the send. The original glyph bitmap retains RGB when a resampled cell rounds to alpha zero. Both wrappers return control 2 without a result write.',
        },
        {
          ids: legacyTextStateSlots,
          value:
            'Own kind 8 receiver 0x491a80 consumes raw 101–104, 106–108, 114, 116, 118 and 119. It retains full option words and signed positions, adds a 40-byte break cell only within capacity, relays vertical alignment and copies both the current/default color and five font sizes. Main129 writes the live idle flag under control 1. A missing receiver leaves an original caller pointer in its scratch reply. Other wrappers return control 2 with no result.',
        },
        {
          ids: legacyTextInitializers,
          value:
            'Own kind 8 raw 97 checks the row capacity and copies 1128 bytes. Main123 and Main418 make the packet from 96 guest bytes and one or two counted CP932 line-break tables.',
        },
        {
          ids: legacyTextMutators,
          value:
            'Own kind 8 raw 99 takes expanded CP932 bytes from Main124. Raw 100 erases the bitmap, publishes it to an enabled output surface and resets the cursors. Raw 117 retains the full secondary color word. The wrappers return control 2 and leave the result untouched.',
        },
        {
          ids: [514],
          value:
            'Own wrapper 0x4ad930 formats CP932, expands the mounted mot resource path and searches the stored C-locale filename through 0x55bc30. A live manager copies all 144 base bytes to its working bank before searching. The original formats an unmapped name as empty. Control 1 writes a boolean, including zero for a null manager.',
        },
        {
          ids: [320],
          value:
            'Own 2.6.1.67 Main320 translates the local or shared VM pointer, then prepares the five-float records in place under the x87 single-precision control word. The original startup selects the SSE2 power helper. The result word is unwritten and control is 2.',
        },
        { ids: [33, 34], value: randomEvidence },
        {
          ids: [271, 272, 273, 274, 275, 426, 427, 693],
          value:
            'Own 2.6.1.67 Main Particle wrappers dispatch raw 303–305 and 307–310 to kind16 at 0x4864a0. The load copies 656 bytes with two CP932 names, count, priority, 32 registers and a clear external Draw word. The receiver resets clocks, returns the owned active word, preserves signed alpha below 255 and maps zero graph to -1. Load and query write control-1 results. Other wrappers leave the guest result untouched.',
        },
        {
          ids: [59],
          value: remainderEvidence,
        },
        {
          ids: [536, 537],
          value:
            'Own Main536 unwraps the retained bitmap and queries the low 16-bit key in the mode-zero attribute table at 0x5442c0. A hit copies five DWORDs in order: signed rectangle edges and raw color. A miss leaves the destinations unchanged. Main537 merges the source attribute tree through 0x5444c0 and 0x544350, replacing colliding entries with owned copies while retaining other keys. Both wrappers write success with control 1.',
        },
        {
          ids: [109, 149, 150],
          value:
            'Own Main109 dispatches BasePlane raw91 at 0x440fb2, which resolves Root32 and forwards Input raw132. Input 0x48e9dd translates source 16 to 2 and preserves the other full words. The wrapper writes zero on an unrouted task and returns control 1. Main149 writes signed projected x then y through Input raw121 even outside the game bounds. Main150 sends the low 16 bits of each coordinate and the full duration to raw133. Configuration, the foreground window and the original virtual bounds gate the planned move. Both cursor wrappers return control 2 without a result write.',
        },
        {
          ids: [611, 612, 613, 614, 615, 616, 617, 618, 619, 620, 621, 695, 884],
          value:
            'Own 2.6.1.67 kind-48 CP932 STRING at 0x442000 uses raw 431–441, 443 and 448. The fixed packet has 200 bytes and signed texture positions. Raw433 reformats the retained rows and page marks through 0x540630. Raw437 retains the page limit. Raw440 passes the owned image font resource and raw441 uses the low 16 character bits. Raw436 queries all pages and raw448 uses the retained limit; both return control 1 and write a word. The other wrappers return control 2 without a result write.',
        },
        {
          ids: [265, 266, 267, 268, 269, 270, 417, 787, 788],
          value:
            'Own 2.6.1.67 movie window wrappers at 0x4a5d30–0x4a60e4 resolve CP932 names in movie resources and use Root32 and Input raw139. The original raw Input receiver reaches the return-only method at 0x633920. Run sets the active latch before the graph call and retains the old repeat word on failure. Stop clears it only after both graph calls succeed. Redraw requires a prepared running owner. Main417 combines the BGM factor and the two mute words. Main787 reads the drawing rectangle through 0x52b100, and Main788 forwards signed edges. Open, play, stop, close, and playing write a result with control 1. Other calls leave the result unchanged with control 2.',
        },
        {
          ids: [56, 58, 60, 397],
          value:
            'Own 2.6.1.67 scalar wrappers load f32 operands through x87 and write one rounded f32 word via control 1. Main397 calls the original ordered atan2 through 0x5af65a, Main56/58 select the original ceiling and floor, and Main60 selects the original sqrt. The fixed CRT retains signed zero and NaN payloads at the tested boundaries.',
        },
        {
          ids: [860, 861],
          value:
            'Own 2.6.1.67 WBreak receiver 0x4770a0 copies a seven-DWORD packet on raw482, accepts the raw active DWORD on 483 and records the finish latch on 484. The geometry at 0x4763f0 covers the full screen, and the supported unpadded capture uses its logical dimensions. The original seeded shards use the x87 float stream. Callback 0x475fa0 uses unsigned deltas after active reinitialization. Stop preserves the clocks. Both KCS wrappers return 2 without a result write.',
        },
        {
          ids: [853, 854, 855],
          value:
            'Own 2.6.1.67 WipeMosaic receiver 0x47c2f0 uses raw 477 for five words, 478 for the second capture, and 479 for the complete active DWORD. It owns two working captures and transfers their cached mosaic pixels in the original time and source order, including duration zero or one. Active initialization retimes the animation. Stop leaves both clocks unchanged. All wrappers return 2 without writing the result.',
        },
        {
          ids: [856, 857],
          value:
            'Own 2.6.1.67 FadeMosaic receiver 0x4796d0 uses raw 480 for six words and raw 481 for the complete active DWORD. It retains the sixth DWORD at +0x94. Both original fade modes produce the same working texture and submission alpha across the observed values of that word. Active initialization retimes the animation and stop preserves the clocks. Null targets are ignored and both wrappers return control 2 without writing a result.',
        },
        {
          ids: [723],
          value:
            'Own 2.6.1.67 Main723 0x4a6450 sends a signed degree word to retained layer owner 0x568ed0. The original packed bitmap helper 0x543b70 acts on 90, 180 and 270 degrees and the owner rebuilds and sets its dirty DWORD even for other angles. A null handle returns without effect. Control 2 does not write a result.',
        },
        {
          ids: [727],
          value:
            'Own 2.6.1.67 Main727 0x4a65c0 sends a full axis word to retained layer owner 0x569000. The original packed bitmap helper 0x544070 uses zero for vertical reflection and any nonzero word for horizontal reflection. The owner rebuilds and sets its dirty DWORD. A null handle returns without effect. Control 2 does not write a result.',
        },
        {
          ids: [46],
          value:
            'Own 2.6.1.67 Main46 at 0x4b11b0 parses a signed narrow integer prefix only with a final percent byte. It converts the unsigned base to F32, multiplies by the exact signed integer, divides by 100 and only then rounds to F32 and truncates to the decimal integer written in place. A missing pointer, absent percent or failed parse leaves the destination unchanged. Control 2 never writes the result word.',
        },
        {
          ids: [74, 75, 76, 77],
          value:
            "Own 0x4aa3a0 reads raw13 and defaults to -1 for an unresolved target. Top and retiring recipients retain the caller pointer. 0x4aa4b0 enumerates signed ordered route keys whose immediate branch has the caller as its parent. 0x4aa3f0 follows the actual parent pointer, and 0x4aa410 queries raw31 for membership in the caller's Top registry, including null entries. Control 1 always writes the wrapper result.",
        },
        {
          ids: [521, 522, 523, 524],
          value:
            'Own 2.6.1.67 Screen kind35/36 receivers at 0x47f4a0 and 0x47ecc0 use raw367–370, 88-byte matrix and 36-byte rectangle packets, F32 fields and the raw active word. Main521 copies the guest matrix as sixteen DWORDs. The original wrappers all use control 2.',
        },
        {
          ids: [525, 526, 527, 528, 529],
          value:
            'Own 2.6.1.67 Screen kind37/38 at 0x47dca0/0x47d710 use raw371–375. They configure the shade radius, priority interval and fade duration, start the selected mode and latch its finish field. The fade in 0x47d1d0 uses unsigned 255-times-elapsed division. Active initialization retimes the fade; a stop preserves its clock. All wrappers return 2 without a guest result.',
        },
        {
          ids: [196, 197, 198, 200, 203],
          value:
            'Own 2.6.1.67 area wrappers 0x4b2a90–0x4b2f20 select initializers after Base message 13, then start, stop, query and finalize via raw246–248 and 250. The original crossfade receiver 0x482380 reads its 44-byte packet via raw264, retains the two borrowed bitmaps and writes its activity word on raw248. Main200 writes the result under control 1; the other wrappers return 2.',
        },
        {
          ids: [462, 463, 464],
          value:
            'Own 2.6.1.67 Draw kind15 raw287–289 query and set the sender-keyed retained layer and refresh its live material. Main462 initializes the result to -1 before routing and returns control 1; Main463/464 use control 2.',
        },
        {
          ids: [625],
          value:
            'Own 2.6.1.67 Main625 0x4a0ca0 directs raw284 to the Draw owner at 0x487978; it passes the sender-keyed entry and enabled DWORD, with control 2 and no result.',
        },
        {
          ids: [731, 732],
          value:
            'Own 2.6.1.67 wrappers 0x4a0f90/0x4a1090 build the 60-byte Draw packet with the Script image-owner field, seven F32 transforms and unsigned alpha clamped to 255. The kind15 receiver uses raw269/271 and retains the sender-keyed bitmap across replacement. Control 2 leaves the result untouched.',
        },
        {
          ids: [710, 711, 733],
          value:
            'Own 2.6.1.67 Script image owner 0x4a6d20/0x4a6c60/0x4a6e30 loads CP932 image lists, frees its retained layers, or creates a four-byte canvas. Load and create write a handle or zero under control 1; release uses control 2.',
        },
        {
          ids: [712, 714, 715, 717, 718, 719, 720, 724],
          value:
            'Own 2.6.1.67 image owner getters and setters read the decoded rectangle, canvas, offset, base or low-word attribute ID. Null owner and an owner without a backing bitmap have distinct result and output-write branches. Fixed script words agree with these local originals.',
        },
        {
          ids: [713, 726, 728, 730, 736, 737],
          value:
            'Own 2.6.1.67 Script image pixel and Canvas wrappers use the active layers for tone, expansion/blur, resize and filter, the live bitmap for a mask word and bottom-origin fill. The filter at 0x567a90 visits loaded layers; a generated canvas without layers retains its colors. Control 2 leaves the wrapper result untouched.',
        },
        {
          ids: [598],
          value:
            'Own 2.6.1.67 0x4a8210 formats the source, then 0x635550 splits raw comma bytes into a 256-byte scratch. Only success copies the nonempty first field to the translated destination. Control 1 always writes zero or one.',
        },
        {
          ids: [904],
          value:
            'Own 2.6.1.67 0x49e420 snapshots both CP932 comma lists before clearing the guest destination. Each literal @ selects the old field at the same index or the byte 0x30. Nonempty fields are joined with commas; control 2 writes no result.',
        },
        {
          ids: [263, 339],
          value:
            'Own 2.6.1.67 Draw kind15 switch 0x4872b0 selects raw276 or raw278. Main263 toggles the live sender-keyed item at 0x520ed0; Main339 adds signed extents to create the four rectangle words for the same item at 0x520f30. Control 2 writes no guest result.',
        },
        {
          ids: [534, 862],
          value:
            'Own 2.6.1.67 Draw raw293 stores the uncoerced DWORD at 0x487bb2. Raw299 at 0x48781d sets the dirty mark and refreshes only the four signed endpoints supplied by Main862. Main534 and Main862 use control 2 with no guest result.',
        },
        {
          ids: [520, 530, 531, 905],
          value:
            'Own 2.6.1.67 Screen kind39 receiver 0x47d090 reads active at raw366, initializes five words at 376, and starts/stops at 377. Main530 and 905 translate the bitmap, quiet the two F32 priorities and set gradient or threshold respectively. An active initialization retimes the effect; a stop leaves its previous clock. Main520 writes control 1 on null or active query; the other wrappers use control 2 with no result.',
        },
        {
          ids: [111],
          value:
            'Own 2.6.1.67 bitmap wrapper 0x4a8810 formats one CP932 string, iterates image-category tokens with the frame selector at 0x50da90, clips and blits later layers in the physical bitmap coordinate system, and releases each later source. It expands 24-bit primary images, records ownership on the calling Script and writes the bitmap or zero under control 1.',
        },
        {
          ids: [568, 858, 859],
          value:
            'Own 2.6.1.67 display capture group 0x52a980/0x52a9d0/0x52a9f0. Main568 prepares one capture and draws the two F32 priorities to index zero only on successful preparation. Main858 passes a signed target count to 0x527cc0. Main859 passes an index and two F32 priorities to 0x536e90. All three return control 2 without a result.',
        },
        {
          ids: [347, 348, 349],
          value:
            'Own 2.6.1.67 Main347–349 send Root Sound messages 190–192. 0x4c0f90 and 0x4c0fd0 resolve the loaded bank and delegate to its F32 velocity and Doppler setters. Message 192 writes bit zero of the bank control word, or zero for a bank outside 0–31. The setters use control 2; the query uses control 1.',
        },
        {
          ids: [565, 566],
          value:
            'Own 2.6.1.67 Main0x49dc80 and 0x49dca0 read the Script-selected view through +0x74. Receivers 0x52af20/0x52af30 expose capture mode and sequence at +0x84/+0x88, including unsigned wrap. Both return the DWORD through control 1.',
        },
        {
          ids: [567],
          value:
            'Own 2.6.1.67 Main0x49dea0 maps a narrow filename, formats the second CP932 operand and opens the named file in its runtime storage. It seeks to the original clamped length-minus-one position and writes the raw text plus CRLF. It returns control 2 without filling a result word.',
        },
        {
          ids: [935, 936],
          value:
            "Own 2.6.1.67 Main0x49c480 and 0x49c5d0 resolve Sound through Root raw 33. They build a zeroed 280-byte CP932 packet with loop marker at +272 and the low DWORD of unsigned frames×1000/60 at +276. Main935 uses raw 174/175. Main936 picks raw 200/201 by numeric group or raw 202/203 by the packet's zero type word. The original Sound owner uses the inclusive bank range and returns the allocated bank or -1 through control 1. Uninitialized invalid load types remain rejected.",
        },
        {
          ids: [304, 535],
          value:
            'Own 2.6.1.67 Main0x4ad570/0x4ad9c0 format the CP932 resource and resolve it in category mot before 0x55c110. The manager loads owned registers, optional extra bytes and the group. The eight-word delayed wrapper forwards the last DWORD as delay. A missing source or manager writes zero. Control 1 writes the new handle or zero.',
        },
        {
          ids: [306],
          value:
            'Own 2.6.1.67 Main0x4ad670 resolves a live manager entry through 0x55bce0. The shared original register loader 0x55d2b0 clamps at 256, transports F32 words through x87, zeroes the tail and sets active to one. A missing ID is a no-op. The wrapper returns control 2 without a result word.',
        },
        {
          ids: [107],
          value:
            'Own 2.6.1.67 Main0x4a43f0 queries the caller Top via raw 32, then sends Input raw 129 with the selected region key. The receiver reads its live +0x1c activity word. A missing match leaves the reply uninitialized. With a live match the wrapper writes the word and returns control 1.',
        },
        {
          ids: [937],
          value:
            'Own 2.6.1.67 Main0x49b460 gets the owning Input through Top raw 32 and calls Input raw 153 with zero parameters and flags. The receiver at 0x48edb4 clears exactly the two wheel-direction fields through 0x436b10. The wrapper returns control 2 without a result word.',
        },
        {
          ids: [852],
          value:
            'Own 2.6.1.67 Main0x4a2e80 reads the live setting at +0x6990 of the published configuration view. Constructor 0x42921e publishes the view at owner +0x210 and startup loader 0x42ba4d reads the GAME/log/static integer into owner +0x6ba0. The nullary wrapper writes the DWORD and returns control 1.',
        },
        {
          ids: [351],
          value:
            'Own 2.6.1.67 Main0x4ab7c0 maps both guest addresses and copies sixteen DWORDs forward with REP MOVSD, including destructive forward overlap. Returns control 2.',
        },
        {
          ids: [353, 354, 357],
          value:
            'Own 2.6.1.67 Main353/354 use x87 add/subtract and write each destination word before reading the next. Main357 reads the F32 factor through the second address and scales the original four components before replacing the destination. All return control 2 without filling the result word.',
        },
        {
          ids: [355, 356],
          value:
            'Own 2.6.1.67 helpers 0x52fe30/0x52fe70 sum four squared components in x87 and store the squared sum as F32. Main355 takes the square root of that stored word. Both return control 1. Own CreateDevice ordinary flags leave single-precision x87 with the extended exponent; the original raw result also verifies the underflow boundary.',
        },
        {
          ids: [358],
          value:
            'Own 2.6.1.67 Main0x4b2330 maps a four-F32 vector and a sixteen-F32 matrix. The SSE2 installer 0x5e7c2c selects the 0x5e8903 transform for both KCS and Motion consumers. It sums pairs of float32 products into a temporary vector before writing it, including aliases. Returns control 2 without a VM result.',
        },
        {
          ids: [606, 607, 844],
          value:
            'Own 2.6.1.67 Main0x4a2e40/0x4a2cb0/0x4a2cf0 format a CP932 filename and use 0x4289d0 to scan 48 owned 116-byte voice rows. Directory names use the last CP932-aware separator, raw extension removal, and the CRT comparison. Fallback lowercases the full name outside CP932 pairs and compares the nonempty head prefix. The wrappers write the row, play flag, or master-volume word through control 1. An absent row returns -1 or zero for the fields.',
        },
        {
          ids: [653],
          value:
            'Own 2.6.1.67 Main0x4a9db0 routes two words through raw Plane message 81. The receiver at 0x43ed9b stores the unchanged selector at +0x2a8 for VRAM mode. The wrapper discards the response and returns control 2.',
        },
        {
          ids: [654, 655],
          value:
            'Own 2.6.1.67 Main0x4a9de0 and 0x4a9e80 format CP932 arguments into two or one 256-byte destinations and send raw 82/83. The Plane switch 0x43ed20 maps both to the zero-result, no-state branch at 0x43fbcf. Both wrappers return control 2 without writing a VM result.',
        },
        {
          ids: [651, 694],
          value:
            "Own 2.6.1.67 Main0x4aa450 sends common Base raw24 with word 0xffffffff to reset the addressed task's exit code. Main0x4aa480 sends common Base raw29 with the unmodified word and flags zero, which preserves the task's effective clock while nonzero. Both discard the common message result and return control 2.",
        },
        {
          ids: [239, 249],
          value:
            "Own 2.6.1.67 Main0x4a2ef0/0x4a3880 resolve the target Script's two Scene histories through raw message 170. Selector zero is seen, nonzero is path. 0x505c90 and 0x506940 write and read their compact CP932 records. Both reject a missing container or history owner; restore also rejects an absent record. Each writes the status through control 1.",
        },
        {
          ids: [18, 20, 22],
          value:
            'Own 2.6.1.67 Main18 counts bytes after formatting. Main20 and Main22 format both inputs into narrow scratch destinations 0x8217e0 and 0x8213e0, then call the original signed narrow comparison or CRT ASCII case comparison in argument order. The lower second scratch may overwrite the first when it spans 1024 bytes.',
        },
        {
          ids: [23, 24],
          value:
            'Own 2.6.1.67 uses CP932 lead and trail decoder 0x50c460. Main23 accepts a character only when its end is strictly below the unsigned byte boundary; Main24 accepts up to the specified character count. The two writers put two NUL bytes in the live input and return the kept byte count.',
        },
        {
          ids: [26, 37],
          value:
            'Own 2.6.1.67 Main26 formats a narrow source and writes the CRT atof result as float32. Main37 builds signed decimal groups with optional plus only for positives and writes two NUL bytes without a return word.',
        },
        {
          ids: [38, 39, 40],
          value:
            'Own 2.6.1.67 Main38 copies from the live narrow source and converts backslash+t in separators to a tab. Main39 copies from the formatted scratch and converts backslash+tab. Both reserve two NUL bytes and return copied byte length. Main40 returns the lead/trail classification through 0x50c460, with zero on a null translation.',
        },
        {
          ids: [113],
          value:
            "Own 2.6.1.67 Main0x4a8c30 captures through view 0x52a440, which returns zero for an inactive view and otherwise makes a four-byte bitmap with forced opaque alpha. It registers the resulting bitmap with the caller's owner list and writes a control-1 handle.",
        },
        {
          ids: [116],
          value:
            'Own 2.6.1.67 Main0x4a7130 requires both bitmap handles, clips both rectangles, and chooses clipped row copy for equal requested dimensions and resampling otherwise. Returns control 2.',
        },
        {
          ids: [118],
          value:
            "Own 2.6.1.67 Main0x4a8ca0 allocates a new bitmap, copies the source state and pixels with 0x53f360 and adds it to the caller's owned bitmaps. Null source writes zero. Returns control 1.",
        },
        {
          ids: [241, 251],
          value:
            'Own 2.6.1.67 Main0x4a31a0 encodes format 4 through 0x53eba0/0x550810 (HG-2 signature at 0x66c8d8) in a CSS record. Reader Main0x4a42a0 decodes the first image, converts three-channel pixels to four with opaque alpha at 0x541980, and attaches it to the caller. Control 1 writes success or its owned handle.',
        },
        {
          ids: [213],
          value:
            'Own 2.6.1.67 Main0x4ab920 uses the caller variable owner at +0x68, extracts the raw guest expression, removes the final percent byte, and evaluates it through 0x5030b0. A missing owner or unmapped source returns zero. Control 1 always writes the result.',
        },
        {
          ids: [609, 610],
          value:
            'Own 2.6.1.67 variable owner 0x502910/0x502930 copies between its live words and backup by the original capacity measured in bytes. Control 2 does not write a result.',
        },
        {
          ids: [658, 659],
          value:
            'Own 2.6.1.67 private variable owner 0x502880/0x502860 uses the selected context at +0x24 and checks an unsigned 0..511 index. Get writes zero if absent and returns control 1; set returns control 2.',
        },
        {
          ids: [392],
          value:
            'Own 2.6.1.67 Main0x4b13a0 formats the source before copying, returns zero for an unmapped destination, and uses 0x549400, 0x549f20 and 0x544b40 to keep only rendered base bytes. The CP932 decoder 0x5463f0 shares 0x50c460; the narrow escape switch consumes unknown codes, recognizes wait reset and inline IDs, and filters ruby and control records through code 9. Control 1 writes the output byte count.',
        },
        {
          ids: [539],
          value:
            "Own 2.6.1.67 Main0x4aea30 translates source and output and takes a signed capacity. A raw bracket with a comma selects a list; bracketed dash expressions produce an inclusive signed range. The caller's variable evaluator 0x5030b0 supplies the words; control 1 writes the count.",
        },
        {
          ids: [540],
          value:
            'Own 2.6.1.67 Main0x4adfe0 counts raw byte offsets across runs of ASCII space. Zero index returns zero; index past the terminator returns 0xffffffff. Tabs and CP932 pairs do not create separators. Control 1 always writes its result.',
        },
        {
          ids: [27, 28],
          value:
            'Own 2.6.1.67 Main0x4b09b0 uses the zero-initialized guest heap allocation at 0x62de30 and reverse virtual translation 0x62cb90. Zero-sized allocations translate to 0xffffffff. Main0x4b09d0 at 0x62d6a0 frees only the exact mapped start of an allocated block; control 1 writes the success word.',
        },
        {
          ids: [35],
          value:
            'Own 2.6.1.67 Main0x4b0b70 translates destination and source, then invokes 0x50cc00. Zero counts and null translations return without access. The native x86 MMX probe 0x4fe409 selects forward aligned-size chunk copies 0x50c7b0/0x50c7e0, with the remaining lengths using the overlap-safe CRT path. Control 2 leaves the result unwritten.',
        },
        {
          ids: [242, 248, 252, 254, 389, 390],
          value:
            'Own 2.6.1.67 Main wrappers read and write the CSS global-file object directly. The nested raw snapshot uses 16 header bytes plus the used payload (0x51aa70/0x51aab0). Tag 0x51b2f0 reads header word three; clear 0x51a9b0 retains it while restoring 0x80000 capacity, and clone 0x51b030 copies the independent payload and header. Main254 caps raw bytes to both record and requested lengths and returns zero for an unmapped destination or absent record.',
        },
        {
          ids: [243, 253],
          value:
            "Own 2.6.1.67 uses the caller's CP932 string bank at +0xb4. The writer 0x51f470 only uses an existing bank, writes sorted word keys and NUL-terminated strings, and reports eight trailing bytes. Restore creates a bank only after finding the CSS record, replaces its entries and sets the caller's dirty word.",
        },
        {
          ids: [250],
          value:
            'Own 2.6.1.67 Main0x4a3980 resolves Script raw171 and looks up the named CSS entry. 0x5027c0 imports whole little-endian words starting at the unsigned destination index with capacity clipping and marks that bank dirty. Control 1 writes whether the owner and record were present.',
        },
        {
          ids: [576, 689],
          value:
            'Own 0x4a3ee0 sends a borrowed record through raw413 and 0x4a3ff0 sends an allocated and released tree through raw422 after lookup at 0x51ab30. Native Script and Top leave the caller result alias and source unchanged. An explicit record returns 1, and a miss returns 0. The allocated tail makes an unwritten record zero indeterminate.',
        },
        {
          ids: [836],
          value:
            'Own 0x4a4190 reads an explicit CSS record, allocates a referenced native buffer, copies its bytes and writes the original byte length to a guest DWORD. Control 1 writes the owned pointer or zero. An absent record leaves the length untouched.',
        },
        {
          ids: [869, 871, 873, 877, 878],
          value:
            'Own 0x4a13d0 formats four CP932 strings and constructs a 92-byte database. Loader 0x564d80 reads and parses the compiled KCDB table and selects the ordered normalized index. Own 0x4a1500 sets an indexed bit, 0x4a1570 imports 268-byte normalized flag rows, and dirty query/reset access owner +0x58. Import leaves dirty unchanged and a NULL owner leaves the import result unwritten.',
        },
        {
          ids: [874, 875],
          value:
            'Own 0x4a2720 joins the low 16 bits of two operands and writes the resulting DWORD through control 1. Own 0x4a2740 stores signed low and high 16-bit values in that order into translated guest DWORDs and returns control 2.',
        },
        {
          ids: [845, 846, 847],
          value:
            'Own 0x49e330–0x49e38e post raw 0x469–0x46b to the Script window without writing a result. Original app callback 0x405840 dispatches through menu owner 0x404f90 for display change, system minimize and close confirmation. Close preparation raw154 resets Input idle state at 0x48edc7; the live Sound receiver retains its result word at 0x48a663.',
        },
        {
          ids: [255],
          value:
            'Own 2.6.1.67 formats the filename and translates five out-addresses. The CSS reader at 0x51b0b0 checks the four-byte magic and obtains local modified time, then writes year, month, day, hour and minute; seconds use a private scratch word. Control 1 writes success and failures leave the output addresses untouched.',
        },
        {
          ids: [519],
          value:
            'Own 2.6.1.67 Main519 clears the translated destination, sets the result to zero, and tokenizes the live raw source using 0x50db80 and the space delimiter. The selected token copies with two zeros and writes one. A miss keeps only the initial byte clear. It returns control 1.',
        },
        {
          ids: [42, 43, 44],
          value:
            'Own 2.6.1.67 Main42 selects a NUL-list member by signed index and copies from live memory, writing the two terminators and success DWORD. Main43 tokenizes raw separators with balanced parenthesis groups through 0x50db80. Main44 clears first and joins the live range through its inclusive last index with trailing spaces, accepting -1 for the end. Main43/44 return control 2.',
        },
        {
          ids: [45],
          value:
            'Own 2.6.1.67 Main45 translates four pointers, computes needle and replacement lengths before clearing the first destination byte, then uses raw live substring search from 0x50d890 and byte copies from 0x50d8f0. Control 2 does not write a result.',
        },
        {
          ids: [47, 48, 49],
          value:
            'Own 2.6.1.67 narrow scanners use the exact lead/trail classification at 0x50c460. Main47 counts characters of a raw guest string, Main48 counts after formatting, and Main49 returns a raw byte displacement at a character boundary or the input byte length on a miss. Control 1 writes the DWORD.',
        },
        {
          ids: [882, 883],
          value:
            'Own 2.6.1.67 Main882 and Main883 format a 256-byte CP932 key and deliver FES raw 341 and 340 to the owned dictionary at 0x4cb220/0x4ca9f0. Missing key or unmapped key input returns zero for Main883, while a missing receiver result is rejected. Main882 has control 2 with no result; Main883 writes through control 1.',
        },
        {
          ids: [285, 286],
          value:
            'Own 2.6.1.67 Input wrappers resolve the caller’s input owner through Root raw 32. Raw 140 queries all four source slots at 0x435a90 and ORs their DWORDs into the result; Main285 starts at zero and returns control 1. Raw 141 clears region activity and rechecks cursor position; Main286 returns control 2.',
        },
        {
          ids: [50, 51, 52, 53, 54, 55],
          value:
            'Own 2.6.1.67 trigonometry wrappers load one f32 through x87, call the original six CRT operations at 0x5b0020, 0x5b0630, 0x5b0b20, 0x5b02a0, 0x5b0150 and 0x5b03f0, and store one rounded f32 via control 1. The initialized sine, cosine and tangent reduce large angles using their native CRT ranges. Generic uses separate wrappers to those same recipients. Both Particle tables alias the complete Main bodies.',
        },
        {
          ids: [257, 258, 259],
          value:
            'Own 2.6.1.67 Main257 and Main259 send 60-byte bitmap packets with 255-clamped alpha through Draw raw 269 and 271. Renderer paths 0x5218f0/0x521cf0 attach or replace the sender-keyed bitmap and its transform. Main258 sends raw 270; 0x521200 removes that key. Control 2 leaves the result unwritten.',
        },
        {
          ids: [261],
          value:
            'Own 2.6.1.67 Main261 requests Draw raw 274 and returns the borrowed renderer bitmap via control 1. The original accessor 0x51f9d0 requires an initialized renderer; missing target scratch or missing renderer fails explicitly.',
        },
        {
          ids: [112, 114],
          value:
            'Own 2.6.1.67 Main112 creates a four-byte Script bitmap through 0x52a3e0 and adds it to the owner list, returning the handle or zero. Main114 unlinks the owned bitmap and frees it through 0x52a7a0; control 2 has no result write.',
        },
        {
          ids: [362, 363, 369, 370, 371, 372, 373, 374],
          value:
            'Own 2.6.1.67 bitmap accessors at 0x4a7680, 0x4a76e0 and 0x4a7b80–0x4a7d90 read or write canvas size, offset, origin and packed color. Canvas size independently falls back to image dimensions when either field is zero. Alpha query applies offsets, returns zero outside 16/32-bit images and reads the exact alpha nibble or byte.',
        },
        {
          ids: [364, 365, 366, 368],
          value:
            'Own 2.6.1.67 Main365 formats an image file path, queries and reads its bytes through first-mode 3 and returns the owned buffer. Main364 imports a selected frame and promotes 24-bit data before attaching to the caller. Main368 clears exactly 36 translated destination bytes only on mapped nonnull handles. Main366 destroys the image buffer independently from imported pixels.',
        },
        {
          ids: [367],
          value:
            'Own 2.6.1.67 Main367 has a zero-source early return and uses 0x52a7c0 for the no-bitmap destination. It clips source and destination against their bounds, uses the source extent bounded by destination space and blends through 0x558170. Control 2 leaves the result untouched.',
        },
        {
          ids: [570, 571, 572],
          value:
            'Own 2.6.1.67 wrappers 0x4ade60, 0x4ade90 and 0x4adef0 send raw 424, 427 and 426 to the supplied target; Main571 reads one DWORD at a nonnull native pointer into L. Flags and W are zero; all leave the result untouched via control 2. Original Root and Script receiver paths do not write a result for these raw values.',
        },
        {
          ids: [577],
          value:
            "Own 2.6.1.67 Main577 sends raw 38 with the sole DWORD in L to the caller's Root. Its receiver table bound includes raw 38, which copies the Top field. Control 2 leaves the GCALL result untouched.",
        },
        {
          ids: [434, 436, 438],
          value:
            'Own 2.6.1.67 file-server wrappers clear through 0x513270, start the ordered queue at 0x5180b0 and age its entries at 0x5135f0. All use the cache enable field and return control 2 without writing a result.',
        },
        {
          ids: [435],
          value:
            'Own 2.6.1.67 Main435 formats the CP932 name and category, falls back to image for an unmapped category address, and resolves its resource through 0x512b70 before queuing first-mode 3 and signed age. Missing name scratch is guarded. Control 2.',
        },
        {
          ids: [437],
          value:
            'Own 2.6.1.67 Main437 returns one if the queue is disabled or if the signed threshold is at most the reported progress from 0x512b40. Control 1 writes the result.',
        },
        {
          ids: [696, 697],
          value:
            'Own 2.6.1.67 Main696 initializes the 248-byte display-log owner at 0x508b10 and its CP932 name configuration at 0x507fc0, then writes the handle through control 1. Main697 destroys the tables and releases the owner via 0x508e70.',
        },
        {
          ids: [698, 699, 700],
          value:
            'Own 2.6.1.67 Main698 formats scene, speaker and message at 0x62cee0 and appends CP932 rows through 0x5097a0. Main699 clears and rebuilds through the path history’s saved block counts and the named voice and paragraph commands. Main700 clears the translated destination and copies the speaker found by signed row index. All three return control 2.',
        },
        {
          ids: [785, 876],
          value:
            'Own 2.6.1.67 Main785 sets the unsigned block limit and prunes through 0x508150, with all ones as unlimited. Main876 clears the four tables through 0x508de0 and retains the block and row bases; both leave the VM result untouched.',
        },
        {
          ids: [850, 851],
          value:
            'Own 2.6.1.67 Main850/851 use CSS header offsets for four sections and two bases with 24-byte block records. Serialization 0x507650 and reread 0x508ff0 share the narrow speaker/scene/row sections. Restore prunes to the destination owner’s limit. Control 1 writes success.',
        },
        {
          ids: [155],
          value:
            'Own 2.6.1.67 Main155 resolves Sound through Root raw 33, formats the CP932 resource, clears a 280-byte packet, and sends bank and loop policy through raw 174/175 for streaming or static load. The packet branches write the result through control 1. Other types leave the result unwritten and are rejected.',
        },
        {
          ids: [156, 157, 158, 159, 160, 161, 162],
          value:
            'Own 2.6.1.67 Sound raw 176–182 perform release, counted play, pause, stop, playback status and signed volume write/read. The bank limit is 32. Main160 and Main162 write the DWORD result at control 1; other wrappers return control 2.',
        },
        {
          ids: [163, 164, 165, 166, 167, 168],
          value:
            'Own 2.6.1.67 Sound raw 183–188 use packed unsigned level and signed pan fades, a signed pan value and readback, two F32 distance inputs and an XYZ vector. Receivers 0x4c09d0/0x4c0a10 require a live buffer; position additionally requires configured 3D. Main165 writes the result via control 1.',
        },
        {
          ids: [284],
          value:
            'Own 2.6.1.67 Main284 formats the second operand as a CP932 Sound category path and probes its original read mode through 0x516020. It writes zero or one via control 1.',
        },
        {
          ids: [401, 403, 404],
          value:
            'Own 2.6.1.67 wrappers 0x49b350, 0x49b3b0 and 0x49b410 resolve the caller’s Input through Root raw 32. Input raw 145 forwards the cursor DWORD and reads it back; raw 146 writes the selected key gate, and raw 147 fills all 80 key gates with one. They return control 2 without writing a result.',
        },
        {
          ids: [305, 308],
          value:
            'Own 2.6.1.67 Main305 and Main308 set one or all start ticks at 0x55bd60 and copy the F32 speed through 0x55b2f0. Both return control 2 without writing a result.',
        },
        {
          ids: [307, 440],
          value:
            'Own 2.6.1.67 Main307/440 use the manager at 0x55b490/0x55b640. Updates defer new starts when requested, bypass the start gate for the all-ones frame, and convert unsigned elapsed ticks with the x87 speed. Delay blocks execution even after a skip. Finish runs a pass with frame -1 and skip 1, restoring those transient fields and the active word. Both report whether any record was processed.',
        },
        {
          ids: [309, 310, 311],
          value:
            'Own 2.6.1.67 Main309–311 return the active DWORD at 0x55d500 for a single ID and boolean existence for a matching group or the whole manager. Missing inputs write zero.',
        },
        {
          ids: [312, 313, 314],
          value:
            'Own 2.6.1.67 individual, group, and all skip routes reach 0x55d510, which writes one to the selected instance skip field. The wrappers return control 2 without writing the VM result.',
        },
        {
          ids: [143],
          value:
            "Own 2.6.1.67 Main143 formats the CP932 KCS resource filename, loads Script through raw 155 and binds its caller's shared memory through raw 166. Zero execution flag returns control 2, while a nonzero flag executes immediately and returns control 4 without writing the result word.",
        },
        {
          ids: [315, 316, 317],
          value:
            'Own 2.6.1.67 Main315 creates the owned three-DWORD MOT checkpoint envelope and reads the adjacent frame even at fixed one-word sites. Main316 refreshes its record bytes and grows only when needed. Main317 releases the buffer and envelope without writing a result. Receiver 0x55ba00 uses 0x434-byte CP932 records.',
        },
        {
          ids: [387, 388],
          value:
            'Own 2.6.1.67 Main387 stores the complete motion checkpoint capacity in the chosen CSS entry. Main388 reads the entry into an independent envelope and restores the provided manager through 0x55c460, using the supplied frame. A missing source writes zero.',
        },
        {
          ids: [328, 329, 332],
          value:
            'Own 2.6.1.67 Scene history wrappers format and strip the extension using 0x50c340. The seen record takes an unsigned maximum, the path coalesces the last matching record, and the two write wrappers return a success word. Missing seen query returns zero.',
        },
        {
          ids: [330, 331],
          value:
            'Own 2.6.1.67 Main330/331 clear the seen or path list respectively, through 0x505900/0x505a00, and return control 2 without a result write.',
        },
        {
          ids: [333, 334, 335],
          value:
            'Own 2.6.1.67 Main333 copies the clamped unsigned path index, CP932 name and value, or the empty name and -1 for an empty list. Main334/335 read or write the separate two-DWORD numbered-string key and its bounded bytes via 0x505ff0/0x506150.',
        },
        {
          ids: [336, 337],
          value:
            'Own 2.6.1.67 Main336 recognizes numbered references only with an existing caller string bank at +0xb4. Main337 scans a snapshot of the input bytes, replaces selected numbered values, drops missing references and terminates with two zeros. Both return control 2.',
        },
        {
          ids: [385, 386],
          value:
            'Own 2.6.1.67 Main385/386 select the native CSS entry and either seen or path by the fourth word. Consumers 0x505c90/0x506940 use 40-byte legacy history rows and 72-byte numbered-string records. Missing entry returns zero without replacing the loaded history.',
        },
        {
          ids: [934],
          value:
            'Own 2.6.1.67 Main934 formats the two CP932 names, then 0x506b30 copies the seen value to an absent destination. Control 2 and no result write.',
        },
        {
          ids: [633, 634],
          value:
            'Own 2.6.1.67 Main633 opens the formatted FES-category table in two reads and constructs an owned table at 0x5672d0. The parser at 0x567030 uses a numeric key and three 32-byte CP932 fields in each 100-byte record. It skips long primary names and clips the two rule fields to 31 bytes. Main634 destroys the owner.',
        },
        {
          ids: [635, 636, 637, 638],
          value:
            'Own 2.6.1.67 name queries read the exact primary field at 0x566a80 and preserve authored row order. Main636 reads the DWORD ID. Main637/638 copy the name or selected rule bytes through the translated destination. Misses use -1 for row or numeric ID, and zero for output queries.',
        },
        {
          ids: [639, 640],
          value:
            'Own 2.6.1.67 Main639 reads the first filename rule, truncates source to its rule length and matches stem and extension at 0x50cb80. Main640 uses both rule fields and 0x4abc90 replacement with raw byte selectors and the comma tail.',
        },
        {
          ids: [299, 301],
          value:
            'Own 2.6.1.67 Main299/301 read three 12-byte vectors, the 64-byte matrix, another 12-byte vector, a DWORD, two 12-byte vectors and a trailing DWORD. The 144-byte packet is copied into the separate base and working states by 0x55b200/0x55b260. Zero manager does not read operands.',
        },
        {
          ids: [300, 302],
          value:
            'Own 2.6.1.67 Main300/302 copy all 144 manager bytes back through the ordered nine guest destinations. Main302 writes the final DWORD only when the translated destination is present. The base getter requires its final destination. Control 2 leaves the GCALL result untouched.',
        },
        {
          ids: [303],
          value:
            'Own 2.6.1.67 Main303 calls 0x55b2c0, copying the complete working state into base through 36 DWORDs. Zero manager leaves state unchanged. Control 2 without result write.',
        },
        {
          ids: [863, 864],
          value:
            'Own 2.6.1.67 Main863 constructs the five-DWORD stack header with record size, zero count, increment, capacity and owned allocation, then returns the handle. Main864 frees the allocation and header and accepts a zero handle without a write.',
        },
        {
          ids: [865, 866, 867],
          value:
            'Own 2.6.1.67 fixed-record stack push at 0x4a2800 grows by its increment before translating the guest source. Pop at 0x4a28b0 copies exactly one record after decrementing the signed nonzero count. Both return one on success and zero on absent mappings. Main867 writes the current count or zero.',
        },
        {
          ids: [868],
          value:
            'Own 2.6.1.67 Main868 reallocates for mismatched size, increment or capacity, copies capacity times record size, and copies the count. Either zero handle skips copying. Control 2 leaves the GCALL result untouched.',
        },
        {
          ids: [515, 516],
          value:
            'Own 2.6.1.67 Main515 creates the 0x20-byte raw-key map through 0x45fa30 and writes the handle. Main516 destroys the owned map and frees it, skips a zero handle, and returns control 2 without a result write.',
        },
        {
          ids: [517, 518],
          value:
            'Own 2.6.1.67 Main517 and Main518 translate an unformatted guest CP932 key with 0x62ca80 and pass its NUL-terminated bytes to the exact-key lookup. Insert keeps the first value. Query returns the stored DWORD or 0xffffffff for a missing key or absent map.',
        },
        {
          ids: [322, 325],
          value:
            'Own 2.6.1.67 CST filename formatter 0x62cee0 and scene category 0x512b70 build the CP932 resource path. Main322 returns file presence. Main325 loads only CST through 0x505690 and returns success in the result word, or zero when the handle or file is absent. A missing file keeps the previous reader.',
        },
        {
          ids: [323, 324],
          value:
            'Own 2.6.1.67 Main323 creates an 8-byte owner with separate reader and history objects and returns its handle. Main324 releases the reader, history and owner and returns control 2 without a VM result.',
        },
        {
          ids: [326, 338, 608],
          value:
            'Own 2.6.1.67 CST type lookup 0x505810 treats negative indexes as block and line count requests, recognizes raw F0 and F1, and updates the CP932 filename and numeric marker. Main338 copies the current filename including its terminator and returns the marker. Main608 returns block count or -1 for an empty reader.',
        },
        {
          ids: [327],
          value:
            'Own 2.6.1.67 Main327 checks the translated output and reader pointer, then finds the requested line at 0x5057b0 and copies the CP932 bytes plus NUL. Invalid indexes or unavailable source return zero with the destination untouched. Control 1 returns the bytes excluding NUL.',
        },
        {
          ids: [541],
          value:
            'Own 2.6.1.67 Main541 gets the root mode1 texture owner through 0x52a220/0x53ff30 and sends four signed rectangle words to 0x5375c0. The receiver uses IntersectRect on each grid page and releases only existing intersections. Control 2 without a result write.',
        },
        {
          ids: [542],
          value:
            'Own 2.6.1.67 Main542 resolves the same texture owner and calls 0x537ff0 without guest operands. The zero-mode allocation loop fills missing page pointers and retains existing textures. Control 2 without a result write.',
        },
        {
          ids: [80],
          value:
            'Own 2.6.1.67 Main80 raw 42 at 0x43f040 releases the resource and replaces the Plane graph with its empty model through 0x52d5d0. Zero target and a completed request return control 2 without writing the GCALL result.',
        },
        {
          ids: [102],
          value:
            'Own 2.6.1.67 Main102 sends raw 74. SimplePlane at 0x4400d6 stores the selected image task DWORD then sends raw 44 with zero display state to that target via 0x43c230. Control 2 without a result write.',
        },
        {
          ids: [103],
          value:
            'Own 2.6.1.67 Main103 sends raw 75, which stores the full attribute DWORD at SimplePlane +0x100. Zero target does not dispatch. Control 2 without a result write.',
        },
        {
          ids: [402],
          value:
            'Own 2.6.1.67 Main402 sends raw 78 at 0x4403b4. The raw jump table at 0x440824 preserves blend selectors 1–5 and maps all other words to zero. The receiver updates the active model and retains the selection for later models. Control 2 without a result write.',
        },
        {
          ids: [683, 684, 685],
          value:
            'Own 2.6.1.67 Main683 formats a CP932 resource name, reads through mode 0x13, and constructs the native line table at 0x561950. Main684 releases the owner; zero is a no-op. Main685 matches exact section and key bytes through 0x561460, selects a zero-based ordinal in source order, and copies only a successful match to the translated destination. Main683/685 write handle or success with control 1; Main684 returns control 2.',
        },
        {
          ids: [674],
          value:
            'Own 2.6.1.67 Main674 0x49e130 formats two CP932 guest addresses through 0x62cee0. The owner at 0x428fc0 compares category names without ASCII case, scans 64 rows in original order and substitutes the selected 48-row flat voice archive for Sound. It writes the first index or signed -1 and returns control 1.',
        },
        {
          ids: [119],
          value:
            'Own 2.6.1.67 Main119 0x4a73f0 clears the two translated destinations and reads width and height of the owned bitmap through 0x53e660 and 0x541130. Aliased destinations retain height; an empty handle or backing leaves zero. Control 2 does not write the GCALL result.',
        },
        {
          ids: [394],
          value:
            'Own 2.6.1.67 Main394 unwraps the bitmap before sending BasePlane raw93. Its receiver selects the owning Input and forwards raw142. The mask builder samples physical rows at 0x541ae0 and packs a least-significant-bit-first canvas mask with offsets. Null backing removes the selected alpha mask; missing region leaves Input unchanged. Control 2 has no result write.',
        },
        {
          ids: [83],
          value:
            'Own 2.6.1.67 Main83 0x4a92d0 sends SimplePlane raw65 to 0x43f49b. The receiver removes its graph and clears both size fields, and dispatches raw86 to release a graph-tracked input registration. A zero task skips dispatch. Control 2 leaves the result untouched.',
        },
        {
          ids: [86, 87],
          value:
            'Own 2.6.1.67 Main86 and Main87 send SimplePlane raw58/59 with flag 1. Graph selection at 0x532ee0 prefers the geometry transform on zero and uses the texture or shared transform otherwise. The wrappers copy two or three F32 words to translated VM addresses and return control 2. Zero task returns without writes; an unwritten receiver reply is guarded.',
        },
        {
          ids: [343],
          value:
            'Own 2.6.1.67 Main343 sends translated width and height destinations to SimplePlane raw 72 at 0x44005f. It writes F32 values from +0xb0/+0xb4 when the receiver accepts those pointers and always returns control 2 without a result write.',
        },
        {
          ids: [344],
          value:
            'Own 2.6.1.67 Main344 sends translated input and selector to SimplePlane raw 54. The graph lookup at 0x532ee0 prefers the geometry transform for zero and the texture or shared model for a nonzero selector. The consumer at 0x53a080 copies 16 DWORDs into its transform and sets its matrix state. Control 2 with no result write.',
        },
        {
          ids: [345],
          value:
            'Own 2.6.1.67 Main345 reads the two F32 corner vectors supplied by SimplePlane raw 73 at 0x440089. It copies X/Y of each corner to four translated destinations and leaves the GCALL result untouched. A receiver that leaves the scratch vectors unwritten is guarded.',
        },
        {
          ids: [466],
          value:
            'Own 2.6.1.67 Main466 0x4a9bf0 sends raw 79 through SimplePlane 0x44047f. The active graph selector gates the full coordinate word stored at graph node +0x24. Zero target and absent graph leave state and the GCALL result unchanged.',
        },
        {
          ids: [467],
          value:
            'Own 2.6.1.67 Main467 0x4a9c30 translates the guest record pointer, converts each 64-byte record to an 80-byte node and sends count and nodes to SimplePlane raw 80 at 0x43f473. Each node contains its ordinal, texture ID, and ordered XYZ/UV columns. The model starts with a uniform color. Zero target and successful dispatch return control 2 without a result write.',
        },
        {
          ids: [78, 84, 85, 93, 94, 101],
          value:
            'Own 2.6.1.67 raw Plane 39 creates the 8-word textured rectangle; 48 changes position, 58/46 retain base Z while changing X/Y, 52 changes rotation, 60 clamps alpha and sends flag 1, and 63 changes the scale vector.',
        },
        {
          ids: [278],
          value:
            'Own 2.6.1.67 Main0x4b2710 copies the guest source before expanding it in place, uses the existing Script bank at +0xb4, and returns control 2. Own 0x51f270 parses signed narrow indexes, skips missing entries and emits two NUL bytes.',
        },
        {
          ids: [207, 294, 295],
          value:
            'Own 2.6.1.67 Main207 maps the guest output into the sixteen-word identity writer. Main294 allocates the 0x138-byte motion owner through 0x55c510 and writes its handle; Main295 calls 0x55c620 then frees a nonzero handle.',
        },
        {
          ids: [296, 297, 298, 586],
          value:
            'Own 2.6.1.67 motion owner receivers 0x55b380, 0x55bf20 and 0x55bff0 clear, unlink by motion ID, and erase members of a DWORD group. The 0x55b310 receiver stores the entire default flag at owner +0x134.',
        },
        {
          ids: [740, 741],
          value:
            'Own 2.6.1.67 viewport 0x49e220 writes two DWORDs for full_pos modes 0–2 and leaves Y untouched for other modes. Main741 reads fullscreen at Settings +0x78a4 and mw_pos at +0x78e4, writing zero while windowed.',
        },
        {
          ids: [450, 451, 630],
          value:
            'Own 2.6.1.67 Main wrappers 0x49fd80, 0x49fe20 and 0x49fe60 send FES raw 324–326. The task selects an existing label, stores the full _SAVEOBJ_ word or delivers the event and optional 32-byte object name plus index.',
        },
        {
          ids: [645, 646, 647],
          value:
            'Own 2.6.1.67 FES raw 329–331 select the private bank, preserve all 32 bits for unsigned indexes 0–511 and change the sleeping word at task +0x34c.',
        },
        {
          ids: [649, 650],
          value:
            'Own 2.6.1.67 Main wrappers 0x4a3540 and 0x4a3f70 transfer a 2048-byte FES private bank through raw 332/333 and a tagged global-file entry. A nonempty load selects _LOAD_ when that label exists.',
        },
        {
          ids: [340, 341, 342],
          value:
            'Own 2.6.1.67 Draw raw 279/280/281 cases render dirty output, clear the renderer, and force the full owned surface. The wrappers only read the target task word.',
        },
        {
          ids: [455],
          value:
            'Own 2.6.1.67 Draw raw285 removes the existing base renderer entry, copies the supplied bitmap into its owner, or hides the base when the bitmap is zero.',
        },
        {
          ids: [15, 16, 17, 19, 21, 25],
          value:
            'Own 2.6.1.67 narrow wrappers append the raw or formatted CP932 bytes, return byte length, reverse the raw comparison operands, and parse signed decimal or hexadecimal text.',
        },
        {
          ids: [594, 595, 596, 597],
          value:
            'Own 2.6.1.67 tone wrappers format the narrow resource filename, release the typed group table, and keep the conditional RGB out-words on successful CP932 group or alias lookup.',
        },
        {
          ids: [739],
          value:
            'Own 2.6.1.67 viewport wrapper doubles both truncated device offsets, reprojects the destination words and returns control 2.',
        },
        {
          ids: [790],
          value:
            'Own 2.6.1.67 configuration wrapper reads either eight-pair start/count table. An out-of-range unsigned index writes only the zero result word.',
        },
        {
          ids: [419, 420, 421],
          value:
            'Own 2.6.1.67 CG owner body allocates its list and selector tree, releases the owner, and clears only the selector registry.',
        },
        {
          ids: [422, 423],
          value:
            'Own 2.6.1.67 CG registration wrappers format the input and parse signed selector bytes. Registration also inserts the filename alias before its underscore.',
        },
        {
          ids: [424, 425],
          value:
            'Own 2.6.1.67 CG wrappers serialize and deserialize the selector registry in the supplied global-file record, returning a result DWORD.',
        },
        {
          ids: [458, 459],
          value:
            'Own 2.6.1.67 CG list and group wrappers use the config category, 64-byte variant stride, and the group selector table without a result write.',
        },
        {
          ids: [210, 212],
          value:
            'Own 2.6.1.67 Script bank wrappers read a bounded unsigned index with initialized zero on miss, or store the supplied DWORD in its context-value field.',
        },
        {
          ids: [454],
          value:
            'Own 2.6.1.67 Main454 translates the single destination address and copies the caller context through its first NUL, then returns control 2.',
        },
        {
          ids: [4, 5],
          value:
            'Own 2.6.1.67 zero-operand wrappers write timeGetTime or the task clock less its paused frames.',
        },
        {
          ids: [69, 70],
          value:
            'Own 2.6.1.67 Script wrappers build sender/code/word/word packets. Raw 167 dispatches with variable context, raw 168 appends the packet to the queue; both store the reply DWORD.',
        },
        {
          ids: [72, 73],
          value:
            'Own 2.6.1.67 Script raw169 exposes the active interpreter to the wrappers; the two translated byte spans are copied in opposite directions with no result write.',
        },
        {
          ids: [453],
          value:
            'Own 2.6.1.67 Main453 stores the entire operand in the current Script exit-code word and returns control 2.',
        },
        {
          ids: [106, 108, 110],
          value:
            'Own 2.6.1.67 BasePlane raw 89/90/92 update the active Input registration, preserve the full return latch and replace the recipient task identity. The two-operand wrappers leave the GCALL result untouched.',
        },
        {
          ids: [6],
          value:
            'Own 2.6.1.67 Main6 reads one DWORD, copies it into the result cell and returns control 1.',
        },
        {
          ids: [65],
          value:
            'Own 2.6.1.67 Main65 uses no operands and returns control 4 without writing the result.',
        },
        {
          ids: [57, 62, 63, 64, 318, 319],
          value:
            'Own 2.6.1.67 Main x87 fabs, angle conversions, signed integer absolute value, ordered interpolation and floor-plus-half integer64 conversion store the result word.',
        },
        { ids: [321], value: triangleEvidence },
        {
          ids: mainReserved,
          value:
            'Own 2.6.1.67 shared stub at 0x49d0e0 returns control 2 without reading operands or writing a result.',
        },
        {
          ids: mainConstantZero,
          value:
            'Own 2.6.1.67 shared stub at 0x4b3410 writes one zero result word and returns control 1.',
        },
        {
          ids: mainUnwritten,
          value:
            'Own 2.6.1.67 shared stub at 0x4aaef0 returns control 1 with the supplied result word untouched.',
        },
        {
          ids: [238, 240, 244, 245, 246, 277, 469, 833, 834, 835, 870, 872],
          value:
            '2.6.1.67 own close-message selected CFG, complete wrappers and direct persistence/bank/raw-buffer/database callees; finite owned-address and nonnull database-export domains only. Other slots remain unknown.',
        },
        {
          ids: [359],
          value:
            '2.6.1.67 own Main359 four VM blocks/control2, including guest byte0; own-helper proof in the ignored per-version packet.',
        },
        {
          ids: [465],
          value:
            '2.6.1.67 own Main465 Settings author DWORD/control1; unchanged author/CRC/RNG ordering.',
        },
        {
          ids: [605],
          value:
            '2.6.1.67 own Main605 filename formatter and flat gain chain/control1; finite CP932/255-byte/C-locale domain.',
        },
        {
          ids: [
            1, 8, 13, 14, 36, 41, 66, 67, 68, 71, 79, 88, 92, 100, 104, 105, 117, 209, 211, 247,
            256, 260, 262, 276, 393, 400, 447, 448, 449, 452, 590, 591, 592, 593, 789, 848, 849,
          ],
          value:
            '2.6.1.67 own wrapper/control/selected receiver and callback proof for startup -> flow -> title; closed entry checklist and per-wrapper captures retained in the ignored first-title evidence packet. Other slots stay unknown.',
        },
      ],
      signatures: [
        ...fesLocalOperations.map((id) => ({
          ids: [id],
          fields: {
            parameters:
              id === 664
                ? [
                    fesTarget,
                    {
                      name: 'name',
                      description: 'CP932 format for the private variable name',
                      type: {
                        kind: 'pointer',
                        addressSpace: 'vm',
                        direction: 'in',
                        target: { kind: 'format-string', encoding: 'CP932' },
                      },
                    },
                    NATIVE_SEMANTICS.main[id].signature.parameters[2],
                  ]
                : [fesTarget],
            resultWritten: id === 667,
            review: 'reviewed',
          },
        })),
        { ids: [786], fields: { resultWritten: true, review: 'reviewed' } },
        ...rectangleOperations.map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, i) => {
              if (parameter.type.kind === 'handle')
                return {
                  ...parameter,
                  type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  direction: id === 214 ? 'out' : id === 217 || i > 0 ? 'in' : 'inout',
                  addressSpace: 'vm',
                  target: { kind: 'record', name: 'signed 16-byte RECT' },
                },
              };
            }),
            resultWritten: id === 217,
            review: 'reviewed',
          },
        })),
        {
          ids: [289],
          fields: {
            result: { kind: 'handle', handleKind: 'name-pairs', ownership: 'owned' },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        ...namePairOperations.slice(1).map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) => {
              if (parameter.name === 'table')
                return {
                  ...parameter,
                  type: {
                    kind: 'handle',
                    handleKind: 'name-pairs',
                    ownership: id === 290 ? 'owned' : 'borrowed',
                  },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: parameter.type.target.kind === 'format-string' ? 'in' : 'out',
                  target:
                    parameter.name === 'name'
                      ? { ...parameter.type.target, encoding: 'CP932' }
                      : parameter.type.target,
                },
              };
            }),
            resultWritten: id < 292 ? false : null,
            review: 'reviewed',
          },
        })),
        { ids: [61, 461], fields: { resultWritten: true, review: 'reviewed' } },
        {
          ids: [845, 846, 847],
          fields: { review: 'reviewed' },
        },
        {
          ids: [869],
          fields: {
            parameters: [
              databaseFormat('filename', 'Mounted KCDB database filename'),
              databaseFormat('lineBreak', 'Database line break format'),
              databaseFormat('separator', 'Database separator format'),
              databaseFormat('first', 'Database prefix format'),
            ],
            result: { kind: 'handle', handleKind: 'database', ownership: 'owned' },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [871],
          fields: {
            parameters: [
              databaseHandle,
              {
                name: 'bit',
                description: 'Bit index reduced modulo 32',
                type: { kind: 'integer', bits: 32, signed: false },
              },
              databaseFormat('index', 'Database index format'),
            ],
            review: 'reviewed',
          },
        },
        {
          ids: [873],
          fields: {
            parameters: [
              databaseHandle,
              {
                name: 'source',
                description: 'Owned native buffer with row count and 268-byte flag rows',
                type: {
                  kind: 'pointer',
                  addressSpace: 'native',
                  direction: 'inout',
                  target: { kind: 'record', name: 'database-flags' },
                },
              },
            ],
            result: { kind: 'boolean', description: 'Whether a nonnull flag buffer was imported' },
            review: 'reviewed',
          },
        },
        {
          ids: [874],
          fields: { resultWritten: true, review: 'reviewed' },
        },
        {
          ids: [875],
          fields: {
            parameters: [
              NATIVE_SEMANTICS.main[875].signature.parameters[0],
              ...['lowSigned', 'highSigned'].map((name) => ({
                name,
                description: 'Translated guest DWORD for the signed halfword',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'integer', bits: 32, signed: true },
                },
              })),
            ],
            review: 'reviewed',
          },
        },
        {
          ids: [877],
          fields: { parameters: [databaseHandle], resultWritten: true, review: 'reviewed' },
        },
        {
          ids: [878],
          fields: { parameters: [databaseHandle], review: 'reviewed' },
        },
        {
          ids: [74, 77],
          fields: {
            parameters: [
              {
                name: 'task',
                description: 'Native task ID in the caller scope',
                type: { kind: 'object-id', objectKind: 'task' },
              },
            ],
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [75, 76],
          fields: {
            result: { kind: 'object-id', objectKind: 'task', description: 'Native task ID' },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [576, 689],
          fields: { review: 'reviewed' },
        },
        {
          ids: [836],
          fields: {
            parameters: [
              {
                name: 'globalFile',
                description: 'Source CSS container',
                type: { kind: 'handle', handleKind: 'global-file', ownership: 'borrowed' },
              },
              {
                name: 'record',
                description: 'Record key',
                type: { kind: 'integer', signed: false, bits: 32 },
              },
              {
                name: 'byteCount',
                description: 'Byte count written when a record is found',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'integer', signed: false, bits: 32 },
                },
              },
            ],
            result: {
              description: 'Owned native byte buffer released with Main834, or null',
              kind: 'pointer',
              addressSpace: 'native',
              direction: 'out',
              target: { kind: 'integer', signed: false, bits: 8 },
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [675, 885, 894],
          fields: {
            result: {
              kind: 'handle',
              description: 'New ordered dictionary or zero on allocation failure',
              handleKind: 'dictionary',
              ownership: 'owned',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [676, 886, 895],
          fields: {
            parameters: [
              {
                ...dictionaryHandle,
                description: 'Owned dictionary to release',
                type: { ...dictionaryHandle.type, ownership: 'owned' },
              },
            ],
            review: 'reviewed',
          },
        },
        {
          ids: [677, 896],
          fields: {
            parameters: [dictionaryHandle, dictionaryKey, dictionaryWord],
            review: 'reviewed',
          },
        },
        {
          ids: [887],
          fields: {
            parameters: [
              dictionaryHandle,
              dictionaryKey,
              {
                name: 'value',
                description: 'IEEE 754 single-precision value',
                type: { kind: 'float', bits: 32 },
              },
            ],
            review: 'reviewed',
          },
        },
        {
          ids: [678],
          fields: { parameters: [dictionaryHandle, dictionaryKey], review: 'reviewed' },
        },
        {
          ids: [679],
          fields: {
            parameters: [
              dictionaryHandle,
              dictionaryKey,
              { ...dictionaryWord, name: 'fallback', description: 'Word for a missing key' },
            ],
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [680],
          fields: {
            parameters: [dictionaryHandle, dictionaryWord, dictionaryKeyOutput],
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [888, 897],
          fields: {
            parameters: [dictionaryHandle, dictionaryKey],
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [889, 898],
          fields: { parameters: [dictionaryHandle], review: 'reviewed' },
        },
        {
          ids: [890, 899],
          fields: { parameters: [dictionaryHandle], resultWritten: true, review: 'reviewed' },
        },
        {
          ids: [891, 900],
          fields: {
            parameters: [
              dictionaryHandle,
              {
                name: 'destination',
                description: 'Packed dictionary output in owned native memory',
                type: {
                  kind: 'pointer',
                  addressSpace: 'native',
                  direction: 'out',
                  target: { kind: 'record', name: 'packed-dictionary' },
                },
              },
            ],
            review: 'reviewed',
          },
        },
        {
          ids: [892, 901],
          fields: {
            parameters: [
              dictionaryHandle,
              {
                name: 'source',
                description: 'Packed dictionary input in owned native memory',
                type: {
                  kind: 'pointer',
                  addressSpace: 'native',
                  direction: 'in',
                  target: { kind: 'record', name: 'packed-dictionary' },
                },
              },
            ],
            review: 'reviewed',
          },
        },
        {
          ids: [893, 902],
          fields: {
            parameters: [
              dictionaryHandle,
              {
                name: 'index',
                description: 'Byte-ordered key index',
                type: { kind: 'integer', bits: 32, signed: false },
              },
              dictionaryKeyOutput,
            ],
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [29],
          fields: {
            parameters: ['path', 'mode'].map((name) => ({
              description: 'Guest CP932 format',
              name,
              type: {
                addressSpace: 'vm',
                direction: 'in',
                kind: 'pointer',
                target: { encoding: 'CP932', kind: 'format-string' },
              },
            })),
            result: {
              description: 'Owned file handle or zero',
              handleKind: 'file',
              kind: 'handle',
              ownership: 'owned',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        { ids: [30, 31], fields: { resultWritten: true, review: 'reviewed' } },
        { ids: [32], fields: { review: 'reviewed' } },
        { ids: [7, 9, 11], fields: { review: 'reviewed' } },
        {
          ids: [10],
          fields: {
            parameters: [
              {
                description: 'Guest CP932 format for clipboard text',
                name: 'text',
                type: {
                  addressSpace: 'vm',
                  direction: 'in',
                  kind: 'pointer',
                  target: { encoding: 'CP932', kind: 'format-string' },
                },
              },
            ],
            review: 'reviewed',
          },
        },
        ...[136, 137].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) => {
              if (index === 0)
                return { ...parameter, type: { kind: 'object-id', objectKind: 'legacy-text' } };
              if (id === 136)
                return {
                  ...parameter,
                  type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                };
              return parameter;
            }),
            resultWritten: false,
            review: 'reviewed',
          },
        })),
        ...legacyTextStateSlots.map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? { ...parameter, type: { kind: 'object-id', objectKind: 'legacy-text' } }
                : parameter,
            ),
            resultWritten: id === 129,
            review: 'reviewed',
          },
        })),
        {
          ids: [123, 125, 418, 557],
          fields: { review: 'reviewed' },
        },
        {
          ids: [124],
          fields: {
            argumentWords: 2,
            parameters: [
              {
                description: 'Native kind 8 task ID',
                name: 'task',
                type: { kind: 'object-id', objectKind: 'legacy-text' },
              },
              {
                description: 'Guest pointer to CP932 format bytes',
                name: 'text',
                type: {
                  addressSpace: 'vm',
                  direction: 'in',
                  kind: 'pointer',
                  target: { encoding: 'CP932', kind: 'format-string' },
                },
              },
            ],
            review: 'reviewed',
          },
        },
        {
          ids: [514],
          fields: {
            parameters: [
              {
                name: 'manager',
                description: 'Motion manager handle',
                type: { kind: 'handle', handleKind: 'motion-manager', ownership: 'borrowed' },
              },
              {
                name: 'filename',
                description: 'Guest CP932 motion filename format',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
            ],
            result: { kind: 'boolean', description: 'A matching motion filename is present' },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [320],
          fields: {
            review: 'reviewed',
            parameters: [
              {
                description: 'VM pointer to the in-place five-float spline records',
                name: 'records',
                type: {
                  addressSpace: 'vm',
                  direction: 'inout',
                  kind: 'pointer',
                  target: { kind: 'record', name: 'fiveFloatRecord' },
                },
              },
              {
                description: 'Signed point count',
                name: 'count',
                type: { bits: 32, kind: 'integer', signed: true },
              },
            ],
          },
        },
        { ids: [33, 34], fields: { resultWritten: true } },
        { ids: [271, 274, 693], fields: { resultWritten: true } },
        { ids: [272, 273, 275, 426, 427], fields: { resultWritten: false } },
        { ids: [59], fields: { resultWritten: true } },
        {
          ids: [536],
          fields: {
            parameters: [
              {
                name: 'bitmap',
                description: 'Owned bitmap',
                type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
              },
              {
                name: 'selector',
                description: 'Low 16 bits select the attribute key',
                type: { kind: 'integer', bits: 16, signed: false },
              },
              ...['left', 'top', 'right', 'bottom', 'color'].map((name) => ({
                name,
                description: `Bitmap attribute ${name}`,
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'integer', bits: 32, signed: name !== 'color' },
                },
              })),
            ],
            resultWritten: true,
          },
        },
        { ids: [537], fields: { resultWritten: true } },
        {
          ids: [109],
          fields: {
            parameters: [
              {
                name: 'task',
                description: 'Native Plane task ID',
                type: { kind: 'object-id', objectKind: 'Plane' },
              },
            ],
            resultWritten: true,
          },
        },
        {
          ids: [149],
          fields: {
            parameters: ['x', 'y'].map((name) => ({
              name,
              description: `Signed virtual pointer coordinate ${name}`,
              type: {
                kind: 'pointer',
                addressSpace: 'vm',
                direction: 'out',
                target: { kind: 'integer', bits: 32, signed: true },
              },
            })),
            resultWritten: false,
          },
        },
        { ids: [150], fields: { resultWritten: false } },
        { ids: [616, 884], fields: { resultWritten: true } },
        {
          ids: [611, 612, 613, 614, 615, 617, 618, 619, 620, 621, 695],
          fields: { resultWritten: false },
        },
        { ids: [265, 266, 267, 268, 269], fields: { resultWritten: true } },
        { ids: [270, 417, 787, 788], fields: { resultWritten: false } },
        { ids: [56, 58, 60, 397], fields: { resultWritten: true } },
        { ids: [83, 86, 87, 119, 394], fields: { resultWritten: false } },
        { ids: [674, 683, 685], fields: { resultWritten: true } },
        { ids: [684], fields: { resultWritten: false } },
        {
          ids: [860],
          fields: {
            resultWritten: false,
            parameters: [
              {
                description: 'WBreak task ID',
                name: 'task',
                type: { kind: 'object-id', objectKind: 'WBreak' },
              },
              {
                description: 'u32 task clock duration',
                name: 'duration',
                type: { kind: 'integer', bits: 32, signed: false },
              },
              {
                description: 'f32 minimum draw priority',
                name: 'minimum',
                type: { kind: 'float', bits: 32 },
              },
              {
                description: 'f32 maximum draw priority',
                name: 'maximum',
                type: { kind: 'float', bits: 32 },
              },
              {
                description: 'i32 shard width in pixels',
                name: 'gridWidth',
                type: { kind: 'integer', bits: 32, signed: true },
              },
              {
                description: 'i32 shard height in pixels',
                name: 'gridHeight',
                type: { kind: 'integer', bits: 32, signed: true },
              },
              {
                description: 'f32 radial speed',
                name: 'radialSpeed',
                type: { kind: 'float', bits: 32 },
              },
              {
                description: 'f32 angular speed',
                name: 'angularSpeed',
                type: { kind: 'float', bits: 32 },
              },
            ],
          },
        },
        {
          ids: [861],
          fields: {
            resultWritten: false,
            parameters: [
              {
                description: 'WBreak task ID',
                name: 'task',
                type: { kind: 'object-id', objectKind: 'WBreak' },
              },
              {
                description: 'Complete active DWORD',
                name: 'active',
                type: { kind: 'bits', bits: 32 },
              },
            ],
          },
        },
        {
          ids: [853],
          fields: {
            resultWritten: false,
            parameters: [
              {
                name: 'task',
                description: 'WipeMosaic task ID',
                type: { kind: 'object-id', objectKind: 'WipeMosaic' },
              },
              {
                name: 'duration',
                description: 'u32 duration in task clock frames',
                type: { kind: 'integer', bits: 32, signed: false },
              },
              {
                name: 'minimum',
                description: 'f32 minimum draw priority',
                type: { kind: 'float', bits: 32 },
              },
              {
                name: 'maximum',
                description: 'f32 maximum draw priority',
                type: { kind: 'float', bits: 32 },
              },
              {
                name: 'maximumBlock',
                description: 'i32 maximum mosaic block size',
                type: { kind: 'integer', bits: 32, signed: true },
              },
              {
                name: 'linear',
                description: 'Nonzero selects linear mosaic expansion',
                type: { kind: 'bits', bits: 32 },
              },
            ],
          },
        },
        {
          ids: [854],
          fields: {
            resultWritten: false,
            parameters: [
              {
                name: 'task',
                description: 'WipeMosaic task ID',
                type: { kind: 'object-id', objectKind: 'WipeMosaic' },
              },
            ],
          },
        },
        {
          ids: [855],
          fields: {
            resultWritten: false,
            parameters: [
              {
                name: 'task',
                description: 'WipeMosaic task ID',
                type: { kind: 'object-id', objectKind: 'WipeMosaic' },
              },
              {
                name: 'active',
                description: 'Complete active DWORD',
                type: { kind: 'bits', bits: 32 },
              },
            ],
          },
        },
        {
          ids: [856],
          fields: {
            resultWritten: false,
            parameters: [
              {
                name: 'task',
                description: 'FadeMosaic task ID',
                type: { kind: 'object-id', objectKind: 'FadeMosaic' },
              },
              {
                name: 'duration',
                description: 'u32 duration in task clock frames',
                type: { kind: 'integer', bits: 32, signed: false },
              },
              {
                name: 'minimum',
                description: 'f32 minimum draw priority',
                type: { kind: 'float', bits: 32 },
              },
              {
                name: 'maximum',
                description: 'f32 maximum draw priority',
                type: { kind: 'float', bits: 32 },
              },
              {
                name: 'maximumBlock',
                description: 'i32 maximum mosaic block size',
                type: { kind: 'integer', bits: 32, signed: true },
              },
              {
                name: 'linear',
                description: 'Nonzero selects linear mosaic expansion',
                type: { kind: 'bits', bits: 32 },
              },
              {
                name: 'retainedWord',
                description: 'Additional DWORD copied to the FadeMosaic owner',
                type: { kind: 'bits', bits: 32 },
              },
            ],
          },
        },
        {
          ids: [857],
          fields: {
            resultWritten: false,
            parameters: [
              {
                name: 'task',
                description: 'FadeMosaic task ID',
                type: { kind: 'object-id', objectKind: 'FadeMosaic' },
              },
              {
                name: 'active',
                description: 'Complete active DWORD',
                type: { kind: 'bits', bits: 32 },
              },
            ],
          },
        },
        {
          ids: [723],
          fields: {
            resultWritten: false,
            parameters: [
              {
                description: 'Borrowed retained image owner',
                name: 'image',
                type: { kind: 'handle', handleKind: 'image-owner', ownership: 'borrowed' },
              },
              {
                description: 'i32 angle in degrees',
                name: 'angle',
                type: { kind: 'integer', bits: 32, signed: true },
              },
            ],
          },
        },
        {
          ids: [727],
          fields: {
            resultWritten: false,
            parameters: [
              {
                description: 'Borrowed retained image owner',
                name: 'image',
                type: { kind: 'handle', handleKind: 'image-owner', ownership: 'borrowed' },
              },
              {
                description: 'DWORD reflection axis, zero is vertical',
                name: 'horizontal',
                type: { kind: 'bits', bits: 32 },
              },
            ],
          },
        },
        {
          ids: [46],
          fields: {
            resultWritten: false,
            parameters: [
              {
                description: 'in/out NUL-terminated CP932 guest string',
                name: 'text',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'inout',
                  target: { kind: 'character', bits: 8, encoding: 'CP932' },
                },
              },
              {
                description: 'u32 scale base',
                name: 'base',
                type: { kind: 'integer', bits: 32, signed: false },
              },
            ],
          },
        },
        { ids: [200], fields: { resultWritten: true } },
        { ids: [462], fields: { resultWritten: true } },
        { ids: [710, 717, 718, 719, 720, 724, 733], fields: { resultWritten: true } },
        { ids: [598], fields: { resultWritten: true } },
        { ids: [520], fields: { resultWritten: true } },
        {
          ids: [111],
          fields: {
            parameters: [
              {
                name: 'filename',
                description: 'VMptr CP932 formatted image layers',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
            ],
            result: {
              description: 'owned bitmap handle, or zero',
              kind: 'handle',
              handleKind: 'bitmap',
              ownership: 'unknown',
            },
            resultWritten: true,
          },
        },
        {
          ids: [568],
          fields: {
            parameters: [
              { description: 'f32 minimum', name: 'minimum', type: { kind: 'float', bits: 32 } },
              { description: 'f32 maximum', name: 'maximum', type: { kind: 'float', bits: 32 } },
            ],
          },
        },
        {
          ids: [858],
          fields: {
            parameters: [
              {
                description: 'i32 count',
                name: 'count',
                type: { kind: 'integer', signed: true, bits: 32 },
              },
            ],
          },
        },
        {
          ids: [859],
          fields: {
            parameters: [
              {
                description: 'u32 index',
                name: 'index',
                type: { kind: 'integer', signed: false, bits: 32 },
              },
              { description: 'f32 minimum', name: 'minimum', type: { kind: 'float', bits: 32 } },
              { description: 'f32 maximum', name: 'maximum', type: { kind: 'float', bits: 32 } },
            ],
          },
        },
        { ids: [349], fields: { resultWritten: true } },
        { ids: [651, 694], fields: { resultWritten: false } },
        { ids: [239, 249], fields: { resultWritten: true } },
        { ids: [18, 20, 22, 23, 24, 26, 38, 39, 40], fields: { resultWritten: true } },
        { ids: [37], fields: { resultWritten: false } },
        { ids: [113, 118, 241, 251], fields: { resultWritten: true } },
        { ids: [116], fields: { resultWritten: false } },
        { ids: [213, 658], fields: { resultWritten: true } },
        { ids: [609, 610, 659], fields: { resultWritten: false } },
        { ids: [392], fields: { resultWritten: true } },
        { ids: [539, 540], fields: { resultWritten: true } },
        { ids: [27, 28], fields: { resultWritten: true } },
        { ids: [35], fields: { resultWritten: false } },
        {
          ids: [242, 243, 248, 250, 252, 253, 254, 255, 389, 390],
          fields: { resultWritten: true },
        },
        { ids: [519], fields: { resultWritten: true } },
        { ids: [42, 47, 48, 49], fields: { resultWritten: true } },
        { ids: [43, 44, 45], fields: { resultWritten: false } },
        { ids: [882], fields: { resultWritten: false } },
        { ids: [883], fields: { resultWritten: true } },
        { ids: [285], fields: { resultWritten: true } },
        { ids: [286], fields: { resultWritten: false } },
        { ids: [50, 51, 52, 53, 54, 55], fields: { resultWritten: true } },
        { ids: [257, 258, 259], fields: { resultWritten: false } },
        { ids: [261], fields: { resultWritten: true } },
        { ids: [112, 364, 365, 368, 370, 371, 372, 373, 374], fields: { resultWritten: true } },
        { ids: [114, 362, 363, 366, 367, 369], fields: { resultWritten: false } },
        { ids: [570, 571, 572, 577], fields: { resultWritten: false } },
        { ids: [434, 435, 436, 438], fields: { resultWritten: false } },
        { ids: [437], fields: { resultWritten: true } },
        { ids: [696, 850, 851], fields: { resultWritten: true } },
        { ids: [697, 698, 699, 700, 785, 876], fields: { resultWritten: false } },
        {
          ids: [156, 157, 158, 159, 161, 163, 164, 166, 167, 168],
          fields: { resultWritten: false },
        },
        { ids: [160, 162, 165, 284], fields: { resultWritten: true } },
        { ids: [401, 403, 404], fields: { resultWritten: false } },
        {
          ids: [307],
          fields: {
            parameters: [
              {
                description: 'handle manager',
                name: 'manager',
                type: { handleKind: 'unknown', kind: 'handle', ownership: 'unknown' },
              },
              {
                description: 'u32 frame',
                name: 'frame',
                type: { bits: 32, kind: 'integer', signed: false },
              },
              { description: 'bool deferStart', name: 'deferStart', type: { kind: 'boolean' } },
            ],
            resultWritten: true,
          },
        },
        {
          ids: [309],
          fields: {
            result: { kind: 'bits', description: 'raw active DWORD', bits: 32 },
            resultWritten: true,
          },
        },
        { ids: [310, 311, 440], fields: { resultWritten: true } },
        { ids: [305, 308, 312, 313, 314], fields: { resultWritten: false } },
        { ids: [143], fields: { resultWritten: false } },
        { ids: [315, 316, 387, 388], fields: { resultWritten: true } },
        { ids: [317], fields: { resultWritten: false } },
        { ids: [328, 329, 332, 333, 334, 335, 386], fields: { resultWritten: true } },
        { ids: [330, 331, 336, 337, 934], fields: { resultWritten: false } },
        { ids: [633, 635, 636, 637, 638, 639, 640], fields: { resultWritten: true } },
        { ids: [634], fields: { resultWritten: false } },
        { ids: [299, 300, 301, 302, 303], fields: { resultWritten: false } },
        { ids: [863, 865, 866, 867], fields: { resultWritten: true } },
        { ids: [864, 868], fields: { resultWritten: false } },
        { ids: [515, 518], fields: { resultWritten: true } },
        { ids: [516, 517], fields: { resultWritten: false } },
        { ids: [322, 323, 325, 326, 327, 338, 608], fields: { resultWritten: true } },
        { ids: [324], fields: { resultWritten: false } },
        { ids: [541, 542], fields: { resultWritten: false } },
        { ids: [80, 102, 103, 402], fields: { resultWritten: false } },
        {
          ids: [343],
          fields: {
            parameters: [
              {
                name: 'id',
                description: 'native plane ID',
                type: { kind: 'object-id', objectKind: 'plane' },
              },
              {
                name: 'width',
                description: 'VM out width',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'float', bits: 32 },
                },
              },
              {
                name: 'height',
                description: 'VM out height',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'float', bits: 32 },
                },
              },
            ],
            resultWritten: false,
            review: 'reviewed',
          },
        },
        {
          ids: [344],
          fields: {
            parameters: [
              {
                name: 'id',
                description: 'native plane ID',
                type: { kind: 'object-id', objectKind: 'plane' },
              },
              {
                name: 'matrix',
                description: 'VM in matrix',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'record', name: '16 float matrix' },
                },
              },
              {
                name: 'selector',
                description: 'zero selects the geometry transform',
                type: { kind: 'bits', bits: 32 },
              },
            ],
            resultWritten: false,
            review: 'reviewed',
          },
        },
        {
          ids: [345],
          fields: {
            parameters: [
              {
                name: 'id',
                description: 'native plane ID',
                type: { kind: 'object-id', objectKind: 'plane' },
              },
              {
                name: 'minX',
                description: 'VM out minX',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'float', bits: 32 },
                },
              },
              {
                name: 'minY',
                description: 'VM out minY',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'float', bits: 32 },
                },
              },
              {
                name: 'maxX',
                description: 'VM out maxX',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'float', bits: 32 },
                },
              },
              {
                name: 'maxY',
                description: 'VM out maxY',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'float', bits: 32 },
                },
              },
            ],
            resultWritten: false,
            review: 'reviewed',
          },
        },
        { ids: [78, 84, 85, 93, 94, 101], fields: { resultWritten: false } },
        { ids: [278], fields: { resultWritten: false } },
        { ids: [294], fields: { resultWritten: true } },
        { ids: [207, 295, 296, 297, 298, 586], fields: { resultWritten: false } },
        { ids: [740], fields: { resultWritten: false } },
        { ids: [741], fields: { resultWritten: true } },
        { ids: [646, 649, 650], fields: { resultWritten: true } },
        { ids: [340, 341, 342, 455], fields: { resultWritten: false } },
        { ids: [15, 16, 17, 19, 21, 25], fields: { resultWritten: true } },
        { ids: [594, 596, 597], fields: { resultWritten: true } },
        { ids: [595], fields: { resultWritten: false } },
        { ids: [739], fields: { resultWritten: false } },
        { ids: [790], fields: { resultWritten: true } },
        { ids: [419, 423, 424, 425], fields: { resultWritten: true } },
        { ids: [420, 421, 422, 458, 459], fields: { resultWritten: false } },
        { ids: [210], fields: { resultWritten: true } },
        { ids: [212, 454], fields: { resultWritten: false } },
        { ids: [4, 5, 69, 70], fields: { resultWritten: true } },
        { ids: [72, 73, 453], fields: { resultWritten: false } },
        { ids: [106, 108, 110], fields: { resultWritten: false } },
        { ids: [6, 57, 62, 63, 64, 318, 319, 321], fields: { resultWritten: true } },
        { ids: mainConstantZero, fields: { resultWritten: true } },
        {
          ids: mainUnwritten,
          fields: {
            argumentWords: null,
            parameters: { kind: 'ignored', description: 'ignored' },
            resultWritten: false,
          },
        },
        {
          ids: [238],
          fields: {
            argumentWords: 1,
            controlCodes: [1],
            parameters: [
              {
                name: 'tag',
                description: 'tag',
                type: {
                  kind: 'bits',
                  bits: 32,
                },
              },
            ],
            result: {
              kind: 'handle',
              handleKind: 'global-file',
              ownership: 'unknown',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [240],
          fields: {
            argumentWords: 5,
            controlCodes: [1],
            parameters: [
              {
                name: 'globalFile',
                description: 'globalFile',
                type: {
                  kind: 'handle',
                  handleKind: 'global-file',
                  ownership: 'borrowed',
                },
              },
              {
                name: 'entry',
                description: 'entry',
                type: {
                  kind: 'bits',
                  bits: 32,
                },
              },
              {
                name: 'task',
                description: 'native task ID; route lookup before bank access',
                type: {
                  kind: 'object-id',
                  objectKind: 'task',
                },
              },
              {
                name: 'first',
                description: 'first',
                type: {
                  kind: 'integer',
                  bits: 32,
                  signed: false,
                },
              },
              {
                name: 'count',
                description: 'count',
                type: {
                  kind: 'integer',
                  bits: 32,
                  signed: false,
                },
              },
            ],
            result: {
              kind: 'boolean',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [244],
          fields: {
            argumentWords: 4,
            controlCodes: [1],
            parameters: [
              {
                name: 'globalFile',
                description: 'globalFile',
                type: {
                  kind: 'handle',
                  handleKind: 'global-file',
                  ownership: 'borrowed',
                },
              },
              {
                name: 'entry',
                description: 'entry',
                type: {
                  kind: 'bits',
                  bits: 32,
                },
              },
              {
                name: 'bytes',
                description: 'bytes',
                type: {
                  kind: 'integer',
                  bits: 32,
                  signed: false,
                },
              },
              {
                name: 'source',
                description: 'translated guest bytes; VM address zero is valid',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: {
                    kind: 'integer',
                    bits: 8,
                    signed: false,
                  },
                },
              },
            ],
            result: {
              kind: 'boolean',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [245],
          fields: {
            argumentWords: 2,
            controlCodes: [1],
            parameters: [
              {
                name: 'globalFile',
                description: 'globalFile',
                type: {
                  kind: 'handle',
                  handleKind: 'global-file',
                  ownership: 'borrowed',
                },
              },
              {
                name: 'filename',
                description: 'filename',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: {
                    kind: 'format-string',
                    encoding: 'CP932',
                  },
                },
              },
            ],
            result: {
              kind: 'boolean',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [246],
          fields: {
            argumentWords: 1,
            controlCodes: [2],
            parameters: [
              {
                name: 'globalFile',
                description: 'globalFile',
                type: {
                  kind: 'handle',
                  handleKind: 'global-file',
                  ownership: 'borrowed',
                },
              },
            ],
            result: {
              kind: 'void',
            },
            resultWritten: false,
            review: 'reviewed',
          },
        },
        {
          ids: [277],
          fields: {
            argumentWords: 2,
            controlCodes: [1],
            parameters: [
              {
                name: 'index',
                description: 'index',
                type: {
                  kind: 'integer',
                  bits: 32,
                  signed: false,
                },
              },
              {
                name: 'destination',
                description: 'destination',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: {
                    kind: 'integer',
                    bits: 8,
                    signed: false,
                  },
                },
              },
            ],
            result: {
              kind: 'boolean',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [469],
          fields: {
            argumentWords: 2,
            controlCodes: [2],
            parameters: [
              {
                name: 'globalFile',
                description: 'globalFile',
                type: {
                  kind: 'handle',
                  handleKind: 'global-file',
                  ownership: 'borrowed',
                },
              },
              {
                name: 'entry',
                description: 'entry',
                type: {
                  kind: 'bits',
                  bits: 32,
                },
              },
            ],
            result: {
              kind: 'void',
            },
            resultWritten: false,
            review: 'reviewed',
          },
        },
        {
          ids: [833],
          fields: {
            argumentWords: 1,
            controlCodes: [1],
            parameters: [
              {
                name: 'bytes',
                description: 'bytes',
                type: {
                  kind: 'integer',
                  bits: 32,
                  signed: false,
                },
              },
            ],
            result: {
              kind: 'pointer',
              addressSpace: 'native',
              direction: 'out',
              target: {
                kind: 'integer',
                bits: 8,
                signed: false,
              },
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [834],
          fields: {
            argumentWords: 1,
            controlCodes: [2],
            parameters: [
              {
                name: 'block',
                description:
                  'unique NativeBufferMemory allocation data address, not VM offset or handle',
                type: {
                  kind: 'pointer',
                  addressSpace: 'native',
                  direction: 'in',
                  target: {
                    kind: 'integer',
                    bits: 8,
                    signed: false,
                  },
                },
              },
            ],
            result: {
              kind: 'void',
            },
            resultWritten: false,
            review: 'reviewed',
          },
        },
        {
          ids: [835],
          fields: {
            argumentWords: 4,
            controlCodes: [1],
            parameters: [
              {
                name: 'globalFile',
                description: 'globalFile',
                type: {
                  kind: 'handle',
                  handleKind: 'global-file',
                  ownership: 'borrowed',
                },
              },
              {
                name: 'entry',
                description: 'entry',
                type: {
                  kind: 'bits',
                  bits: 32,
                },
              },
              {
                name: 'bytes',
                description: 'bytes',
                type: {
                  kind: 'integer',
                  bits: 32,
                  signed: false,
                },
              },
              {
                name: 'source',
                description: 'source',
                type: {
                  kind: 'pointer',
                  addressSpace: 'native',
                  direction: 'in',
                  target: {
                    kind: 'integer',
                    bits: 8,
                    signed: false,
                  },
                },
              },
            ],
            result: {
              kind: 'boolean',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [870],
          fields: {
            argumentWords: 1,
            controlCodes: [2],
            parameters: [
              {
                name: 'database',
                description: 'database',
                type: {
                  kind: 'handle',
                  handleKind: 'database',
                  ownership: 'borrowed',
                },
              },
            ],
            result: {
              kind: 'void',
            },
            resultWritten: false,
            review: 'reviewed',
          },
        },
        {
          ids: [872],
          fields: {
            argumentWords: 2,
            controlCodes: [1],
            parameters: [
              {
                name: 'database',
                description:
                  'nonnull owned database; native NULL branch leaves out unwritten and is unsupported',
                type: {
                  kind: 'handle',
                  handleKind: 'database',
                  ownership: 'borrowed',
                },
              },
              {
                name: 'nullableDestination',
                description:
                  'zero queries exact size; nonzero is an owned NativeBufferMemory range',
                type: {
                  kind: 'pointer',
                  addressSpace: 'native',
                  direction: 'out',
                  target: {
                    kind: 'integer',
                    bits: 8,
                    signed: false,
                  },
                },
              },
            ],
            result: {
              kind: 'integer',
              bits: 32,
              signed: false,
            },
            resultWritten: null,
            review: 'reviewed',
          },
        },
        {
          ids: [385],
          fields: {
            argumentWords: 4,
            parameters: NATIVE_SEMANTICS.main[385].signature.parameters.slice(0, 4),
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [359],
          fields: {
            resultWritten: false,
          },
        },
        {
          ids: [465, 605],
          fields: {
            resultWritten: true,
          },
        },
        {
          ids: [
            1, 8, 36, 41, 67, 71, 79, 88, 92, 100, 104, 105, 117, 209, 211, 256, 260, 262, 276, 393,
            400, 447, 448, 449, 591, 593, 848, 849,
          ],
          fields: {
            resultWritten: false,
          },
        },
        {
          ids: [13, 14, 66, 68, 247, 452, 590, 592, 789],
          fields: {
            resultWritten: true,
          },
        },
      ],
    },
    generic: {
      count: 45,
      slots: {
        unknown: [0],
        recovered: [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
          26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
        ],
      },
      evidence: [
        {
          ids: [43],
          value:
            'Own MOT wrapper 0x55ddf0 loads three f32 angle words through x87, builds yaw/pitch/roll via selector-2 SSE polynomial quaternion 0x5ec343 and the scalar quaternion matrix body, then postmultiplies through native SSE2 0x5e89c3. Control 2 leaves the result unwritten.',
        },
        {
          ids: [44],
          value:
            'Own MOT wrapper 0x55e480 snapshots three VM operands and transforms its negative X/Z reference axes through selector-2 SSE2. Each direction uses Vec4Normalize, and MatrixRotationAxis independently uses the selector-2 Vec3Normalize threshold 2^-46 and its own reciprocal-square-root correction order. Three scalar FSINCOS axis matrices then postmultiply in order through SSE2. Control 2 leaves the result unwritten.',
        },
        {
          ids: [27],
          value:
            'Own MOT wrapper 0x55df00 resolves a mapped matrix or selects the current matrix through 0x530fa0. The native selector-2 inverse at 0x5eb93f forms packed adjugate rows, sums determinant pairs and refines the SSE reciprocal seed once. Zero and unordered determinants preserve the input. Physical results include unaligned local/shared matrices and the selected-current fallback. Control 2 leaves the result unwritten.',
        },
        {
          ids: [31],
          value:
            'Own MOT wrapper 0x55e070 calls 0x52fdc0 and the initialized selector-2 Vec4Normalize at 0x5e8cf0. It sums XY and ZW squared pairs, applies the SSE reciprocal-square-root seed and one Newton correction in single precision, and multiplies all four original words. Physical cases retain the unit-vector rounding, zero-vector indefinite values and NaN payload ordering. Control 2 leaves the result unwritten.',
        },
        {
          ids: [37],
          value:
            'Own MOT wrapper 0x55e1c0 snapshots the four vector words through 0x52fef0 and calls the native selector-2 SSE2 transform at 0x5e8903. Matrix rows are the left operands of each multiply and the final sum is XY plus ZW. Physical observations preserve left NaN payloads, generated negative indefinite values and overlapping matrix destinations. Control 2 leaves the result unwritten.',
        },
        {
          ids: [18, 19, 20, 21, 22],
          value:
            'Own MOT 0x55db10–0x55dd90 resolves three mapped single-precision component pointers. The rotation body snapshots all three coordinates and evaluates the initialized CRT sine and cosine in x87 order. Translation and scaling read each coordinate after the preceding write. The native result stays unwritten under control 2.',
        },
        { ids: [13], value: powerEvidence },
        { ids: [39, 40], value: randomEvidence },
        {
          ids: [11],
          value: remainderEvidence,
        },
        {
          ids: [32, 33, 34, 35, 36],
          value:
            'Own 2.6.1.67 Generic32–36 enter the same x87 vector functions as Main353–357. Four f32 values are added or subtracted in live address order. Length and squared length write one result word with control 1. Scale reads the factor before writing and uses the original raw NaN selection. Add, subtract and scale return control 2 without a result write.',
        },
        {
          ids: [23, 24, 25, 26, 28, 29, 30],
          value:
            'Own 2.6.1.67 Generic23–26 translate the guest matrix pointer and select the current matrix when it maps to null. The original routines postmultiply XYZ rotations, translation or scale and write identity. Generic28 copies sixteen live DWORDs in ascending order. Generic29 postmultiplies two mapped matrices through the default SSE2 dispatch at 0x5e89c3. Generic30 subtracts sixteen live f32 values in forward order. All seven return control 2 with the result untouched.',
        },
        {
          ids: [7, 8, 10, 12],
          value:
            'Own 2.6.1.67 MOT atan2, ceiling, floor and sqrt wrappers at 0x55d900, 0x55d930, 0x55d990 and 0x55d9f0 call the same fixed CRT functions as their Main counterparts. Each writes one rounded f32 via control 1.',
        },
        {
          ids: [1, 2, 3, 4, 5, 6],
          value:
            'Own 2.6.1.67 MOT wrappers select the same original six CRT routines as Main50–55 and write a rounded f32 via control 1.',
        },
        {
          ids: [9, 14, 15, 16],
          value:
            'Own 2.6.1.67 MOT scalar wrappers use the Main conversion constants and result transport, with one float or integer operand.',
        },
        {
          ids: [17, 38, 41, 42],
          value:
            '2.6.1.67 own wrapper/control/selected receiver and callback proof for startup -> flow -> title; closed entry checklist and per-wrapper captures retained in the ignored first-title evidence packet. Other slots stay unknown.',
        },
      ],
      signatures: [
        ...[18, 19, 20, 21, 22].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.generic[id].signature.parameters.map((param, index) =>
              index < 3
                ? {
                    ...param,
                    type: {
                      kind: 'pointer',
                      addressSpace: 'vm',
                      direction: 'inout',
                      target: { kind: 'float', bits: 32 },
                    },
                  }
                : param,
            ),
            resultWritten: false,
            review: 'reviewed',
          },
        })),
        { ids: [13], fields: { resultWritten: true, review: 'reviewed' } },
        { ids: [39, 40], fields: { resultWritten: true } },
        { ids: [11], fields: { resultWritten: true } },
        { ids: [32, 33, 36], fields: { resultWritten: false } },
        ...[27, 31, 37, 43, 44].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.generic[id].signature.parameters.map((parameter, i) =>
              parameter.type.kind === 'pointer'
                ? {
                    ...parameter,
                    type: {
                      ...parameter.type,
                      addressSpace: 'vm',
                      direction: i === 0 ? 'inout' : 'in',
                    },
                  }
                : parameter,
            ),
            resultWritten: false,
            review: 'reviewed',
          },
        })),
        { ids: [34, 35], fields: { resultWritten: true } },
        { ids: [23, 24, 25, 26, 28, 29, 30], fields: { resultWritten: false } },
        { ids: [7, 8, 10, 12], fields: { resultWritten: true } },
        { ids: [1, 2, 3, 4, 5, 6], fields: { resultWritten: true } },
        { ids: [9, 14, 15, 16], fields: { resultWritten: true } },
        {
          ids: [38],
          fields: {
            resultWritten: false,
          },
        },
        {
          ids: [17, 41, 42],
          fields: {
            resultWritten: true,
          },
        },
      ],
    },
    'particle-v1': {
      count: 44,
      slots: {
        unknown: [0],
        recovered: particleRecoveredSlots,
      },
      evidence: [
        { ids: [18], value: powerEvidence },
        { ids: [33, 34], value: randomEvidence },
        {
          ids: [16],
          value: remainderEvidence,
        },
        particleStateEvidence,
        ...particleGeometryEvidence,
        { ids: [37], value: particleDistanceEvidence },
        { ids: [43], value: triangleEvidence },
        {
          ids: [12, 13, 15, 17],
          value:
            'Own 2.6.1.67 Particle pointers for atan2, ceiling, floor and sqrt alias the complete corresponding Main bodies, including f32 result writes and control 1.',
        },
        {
          ids: [6, 7, 8, 9, 10, 11],
          value:
            'Own 2.6.1.67 Particle table aliases each complete Main50–55 body for the corresponding six CRT trigonometric operations.',
        },
        {
          ids: [14, 19, 20, 21, 41, 42],
          value:
            'Own 2.6.1.67 particle table pointers select the same complete Main bodies for absolute values, angle conversions, ordered interpolation and integer64 conversion.',
        },
      ],
      signatures: [
        { ids: [18], fields: { resultWritten: true, review: 'reviewed' } },
        { ids: [3, 37, 43], fields: { resultWritten: true } },
        { ids: [33, 34], fields: { resultWritten: true } },
        { ids: [16], fields: { resultWritten: true } },
        particleStateSignatures,
        { ids: [12, 13, 15, 17], fields: { resultWritten: true } },
        { ids: [6, 7, 8, 9, 10, 11], fields: { resultWritten: true } },
        { ids: [14, 19, 20, 21, 41, 42], fields: { resultWritten: true } },
      ],
    },
    'particle-v2': {
      count: 51,
      slots: {
        unknown: [0],
        recovered: [...particleRecoveredSlots, 44, 45, 46, 47, 48, 49, 50],
      },
      evidence: [
        { ids: [18], value: powerEvidence },
        { ids: [33, 34], value: randomEvidence },
        {
          ids: [16],
          value: remainderEvidence,
        },
        particleStateEvidence,
        ...particleGeometryEvidence,
        { ids: [37], value: particleDistanceEvidence },
        { ids: [43], value: triangleEvidence },
        {
          ids: [44, 45],
          value:
            'Own v2 wrappers pass the particle count times 112 to the full-array copy in opposite directions. Neither reads a guest argument or writes a result word.',
        },
        {
          ids: [46],
          value: 'Own v2 wrapper returns the attachment graph DWORD unchanged under control 1.',
        },
        {
          ids: [47],
          value:
            'Own v2 wrapper at 0x499860 resolves the renderer group and live model and returns the model registration DWORD unchanged under control 1. An unattached graph, absent device, unmatched owner or group, or missing model writes zero.',
        },
        {
          ids: [48, 49],
          value:
            'Own v2 wrappers resolve the renderer group and active model, write its base XY or position XYZ in pointer order, and return control 2. Device detachment writes zero. A registered graph without a live model has undefined original scratch and requires a live owner.',
        },
        {
          ids: [50],
          value:
            'Own 2.6.1.67 Particle v2 wrapper at 0x4999b0 stores modes 1 through 5 and maps every other DWORD to zero. Control 2 leaves the result untouched.',
        },
        {
          ids: [12, 13, 15, 17],
          value:
            'Own 2.6.1.67 Particle pointers for atan2, ceiling, floor and sqrt alias the complete corresponding Main bodies, including f32 result writes and control 1.',
        },
        {
          ids: [6, 7, 8, 9, 10, 11],
          value:
            'Own 2.6.1.67 Particle table aliases each complete Main50–55 body for the corresponding six CRT trigonometric operations.',
        },
        {
          ids: [14, 19, 20, 21, 41, 42],
          value:
            'Own 2.6.1.67 particle table pointers select the same complete Main bodies for absolute values, angle conversions, ordered interpolation and integer64 conversion.',
        },
      ],
      signatures: [
        { ids: [18], fields: { resultWritten: true, review: 'reviewed' } },
        { ids: [3, 37, 43], fields: { resultWritten: true } },
        {
          ids: [44, 45],
          fields: {
            argumentWords: null,
            parameters: { kind: 'ignored', description: 'The wrapper reads no input words.' },
          },
        },
        { ids: [46, 47], fields: { resultWritten: true } },
        ...[48, 49].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS['particle-v2'][id].signature.parameters.map(
              (parameter) => ({
                ...parameter,
                type: { ...parameter.type, addressSpace: 'vm', direction: 'out' },
              }),
            ),
            result: { description: 'void', kind: 'void' },
            resultWritten: false,
          },
        })),
        { ids: [33, 34], fields: { resultWritten: true } },
        { ids: [16], fields: { resultWritten: true } },
        particleStateSignatures,
        { ids: [12, 13, 15, 17], fields: { resultWritten: true } },
        { ids: [6, 7, 8, 9, 10, 11], fields: { resultWritten: true } },
        { ids: [14, 19, 20, 21, 41, 42], fields: { resultWritten: true } },
      ],
    },
  },
  unreviewed: {
    'text.resourceMessages.first.nv':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'text.resourceMessages.first.utf8':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.controlBytes':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.missingIdPathFields':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.fesExtensions':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.completionFrame':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'configuration.language':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'configuration.windowActive':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'configuration.sceneAnimation':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'configuration.extendedQueries':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'configuration.fontPreferenceLimit':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'plugins.emoteDriver':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'plugins.requiredRenderer':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'messages.screenEvent':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'messages.tilePlaneCommand':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'floatingPoint.x87ControlWord':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'floatingPoint.mxcsr':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'graphics.texturedBoundsQuery':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'fes.configurationMessage.liveObjects':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'fes.configurationMessage.notification':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'fes.configurationMessage.filenameComparison':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'fes.fileList.patternEncoding':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'fes.fileList.keyEncoding':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'language.storage':
      'Global translation service is unreviewed; the selected startup title uses the proven raw path. No absence claim for the whole engine.',
    'language.singleTable':
      'Global translation service is unreviewed; the selected startup title uses the proven raw path. No absence claim for the whole engine.',
    'language.resetOnReload':
      'Global translation service is unreviewed; the selected startup title uses the proven raw path. No absence claim for the whole engine.',
    'language.archiveFallback':
      'Global translation service is unreviewed; the selected startup title uses the proven raw path. No absence claim for the whole engine.',
    'language.switchWindowProtocol':
      'Global translation service is unreviewed; the selected startup title uses the proven raw path. No absence claim for the whole engine.',
    'language.dynamicMenus':
      'Global translation service is unreviewed; the selected startup title uses the proven raw path. No absence claim for the whole engine.',
    'language.fixedFilename':
      'Global translation service is unreviewed; the selected startup title uses the proven raw path. No absence claim for the whole engine.',
    'capabilities.cubeFlipGridHeightProduct':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.steam':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.windowReturnTitle':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.windowLanguageAccelerators':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.broadcast':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.recordQueues':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.utf8Primitives':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.utf8Text':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.emoteFes':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.engineWorkers':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.hapMovieAnsiDriverPath':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.windowsMediaReader':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
    'capabilities.systemEntropy':
      'No native capability value is inferred from a modern ABI or an unvisited old API; reject when that behavior is requested.',
  },
  layouts: {
    motionCheckpoint: {
      size: 1076,
      group: 36,
      registers: 40,
      nameBytes: 32,
      wide: false,
    },
    textCores: {
      cp932: {
        size: 72,
        configSize: 184,
      },
    },
  },
};
