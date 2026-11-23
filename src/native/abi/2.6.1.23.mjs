// SPDX-License-Identifier: MPL-2.0

export const engine23CommonHeads = {
  shared: [
    'automove',
    'basebtnpri',
    'baseimg',
    'baseimg_pri',
    'break',
    'call',
    'cgreg',
    'cgreg_init',
    'cgreg_t',
    'cgregmax',
    'cgregnum',
    'cgregtbl',
    'checktitle',
    'clipboard',
    'config',
    'config_open',
    'datasave',
    'dbgtime',
    'debug',
    'decode',
    'deletebgbutton',
    'deletetask',
    'endfes',
    'endif',
    'endkcs',
    'execfes',
    'execkcs',
    'exit',
    'fileexist',
    'fontcom',
    'force_redraw',
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
    'getstbl',
    'getweek',
    'if',
    'input_text',
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
    'rwipe',
    'saveapend_str',
    'savecopy',
    'savedelete',
    'saveexchg',
    'saveexist',
    'saveget_str',
    'send',
    'sendbtn',
    'setconf',
    'setstbl',
    'strvar',
    'sysvoice',
    'wait',
    'wbreak',
    'wndmenu',
    'xchgcursor',
  ],
  additions: [],
  count: 78,
  complete: true,
  comparison: 'byte-exact-cstring',
  reviewedBindings: ['engine23-common-wait-frame-reference'],
};

const mainEvidence = [
  {
    ids: [
      1, 5, 8, 9, 13, 14, 36, 66, 67, 68, 71, 79, 88, 92, 100, 104, 105, 117, 209, 210, 211, 238,
      240, 244, 245, 246, 247, 250, 254, 256, 260, 262, 276, 277, 359, 360, 393, 400, 447, 448, 449,
      452, 465, 469, 582, 583, 584, 590, 591, 592, 593, 789, 848, 849,
    ],
    value: 'Own 2.6.1.23 startup KCS calls, task receivers, compact Settings and close CSS removal',
  },
  {
    ids: [108],
    value:
      'Own 2.6.1.23 Main 0x48a2e0 sends raw Plane 88 with a 32-bit result and returns control 2',
  },
  {
    ids: [69],
    value: 'Own 2.6.1.23 Main 69 at 0x48a510 sends a synchronous packet through raw Script 159',
  },
  {
    ids: [70],
    value: 'Own 2.6.1.23 Main 70 at 0x48a5a0 sends four deferred packet words to raw Script 160',
  },
  {
    ids: [72, 73],
    value: 'Own 2.6.1.23 wrappers 0x48a630 and 0x48a6a0 copy VM bytes through raw Script 161',
  },
  {
    ids: [419, 420, 421, 422, 423, 424, 425, 458, 459],
    value:
      'Own 2.6.1.23 CG wrappers and owned tree, eight-byte selector nodes, 68-byte entries and 64-byte CGL variants',
  },
  {
    ids: [790],
    value: 'Own 2.6.1.23 Main 0x47d9b0 reads eight pairs per local or global variable range',
  },
  {
    ids: [15],
    value:
      'Own 2.6.1.23 Main 0x48aa10 appends raw bytes, writes two terminators and returns the destination',
  },
  {
    ids: [594, 595, 596, 597],
    value:
      'Own 2.6.1.23 tone-table wrappers 0x478f10–0x479110 open, release and query group or alias RGB words',
  },
  {
    ids: [739],
    value:
      'Own 2.6.1.23 Main 0x47bc50 doubles truncated device offset and projects it into two VM coordinates',
  },
  {
    ids: [740, 741],
    value:
      'Own 2.6.1.23 Main 0x47bcb0 projects three full-position modes and 0x47d950 queries fullscreen mw_pos',
  },
  {
    ids: [6, 64, 65],
    value:
      'Own 2.6.1.23 Main 0x47b3d0 copies a word, 0x48c600 takes signed absolute value, and 0x47b380 yields',
  },
  {
    ids: [318, 319],
    value:
      'Own 2.6.1.23 Main 0x48ce70 interpolates with x87 and 0x48cf50 writes the low word of an integer64',
  },
  {
    ids: [453],
    value: 'Own 2.6.1.23 Main 0x47b850 sets the full exit word on its caller',
  },
  {
    ids: [140, 142, 549],
    value: 'Own 2.6.1.23 shared 0x487a50 returns control 1 and leaves the GCALL sentinel untouched',
  },
  {
    ids: [450, 451],
    value: 'Own 2.6.1.23 FES raw 306 addresses a label; raw 307 retains the save-object DWORD',
  },
  {
    ids: [630],
    value:
      'Own 2.6.1.23 Main 0x47adc0 sends raw FES 308 with a formatted event and optional 36-byte object reference',
  },
  {
    ids: [645, 646, 647],
    value:
      'Own 2.6.1.23 raw FES 311–313 select the private 512-word bank or change the sleeping state',
  },
];
const toMessage = (min, offset = 0) => ({ min, max: min, offset });
const mainReserved = [
  0, 2, 3, 141, 169, 170, 172, 173, 180, 182, 184, 185, 187, 188, 189, 190, 191, 429, 439, 464, 543,
  544, 545, 546, 547, 548, 550, 552, 553, 556, 559, 560, 561, 562, 563, 573, 574, 578, 579, 581,
  626, 627, 642, 643, 644, 652, 656, 660, 661, 670, 671, 672, 673, 686, 687, 769, 770,
];
const mainConstantZero = [
  171, 174, 175, 176, 177, 178, 179, 181, 183, 186, 236, 432, 551, 554, 555, 575, 580,
];

// Literal GCALL widths in the fixed KCS, MOT and particle archives are
// observations independent of native admission or argument reads.
const mainObservedWidths = [
  {
    value: [0],
    ids: [
      4, 5, 33, 68, 76, 113, 286, 294, 323, 404, 419, 434, 436, 438, 465, 515, 542, 565, 566, 609,
      610, 696, 741, 789, 845, 846, 847, 852,
    ],
  },
  {
    value: [1],
    ids: [
      1, 6, 9, 10, 17, 25, 32, 47, 50, 51, 54, 57, 62, 63, 67, 71, 80, 83, 109, 111, 114, 118, 125,
      156, 159, 160, 197, 200, 203, 207, 209, 210, 212, 213, 238, 246, 247, 248, 261, 265, 267, 268,
      269, 270, 272, 273, 274, 278, 279, 283, 285, 287, 295, 296, 311, 314, 315, 317, 319, 324, 330,
      331, 340, 341, 342, 365, 366, 389, 390, 393, 420, 437, 440, 445, 448, 452, 453, 454, 461, 516,
      520, 549, 570, 572, 577, 581, 590, 591, 594, 595, 601, 605, 606, 607, 608, 615, 617, 628, 633,
      634, 651, 673, 681, 683, 684, 691, 697, 702, 710, 711, 844, 854, 858, 864,
    ],
  },
  {
    value: [2],
    ids: [
      8, 13, 14, 15, 16, 19, 21, 23, 29, 46, 49, 61, 81, 88, 92, 94, 95, 105, 106, 108, 112, 124,
      149, 157, 161, 196, 211, 243, 245, 252, 253, 258, 262, 266, 275, 276, 277, 280, 281, 282, 284,
      288, 298, 308, 310, 313, 316, 320, 325, 332, 338, 348, 358, 364, 369, 392, 394, 397, 400, 402,
      417, 422, 423, 426, 427, 439, 447, 449, 450, 451, 455, 458, 466, 469, 514, 518, 522, 524, 528,
      531, 534, 540, 545, 546, 547, 548, 551, 554, 555, 557, 567, 568, 571, 573, 580, 586, 598, 611,
      612, 613, 614, 619, 620, 635, 636, 646, 647, 653, 655, 670, 674, 687, 690, 694, 701, 723, 727,
      728, 733, 737, 739, 740, 785, 848, 849, 855, 857, 861, 863, 865, 866, 868,
    ],
  },
  {
    value: [3],
    ids: [
      35, 36, 41, 42, 43, 66, 78, 100, 119, 143, 150, 163, 201, 241, 242, 256, 260, 307, 326, 328,
      329, 343, 344, 346, 362, 363, 368, 372, 373, 387, 424, 425, 435, 441, 459, 517, 519, 539, 543,
      550, 552, 556, 559, 562, 563, 575, 576, 579, 592, 593, 600, 621, 625, 629, 639, 645, 649, 652,
      654, 686, 688, 689, 692, 700, 712, 714, 715, 717, 718, 719, 720, 726, 730, 786, 850, 851, 859,
    ],
  },
  {
    value: [4],
    ids: [
      30, 38, 44, 45, 69, 70, 72, 73, 79, 85, 86, 168, 206, 244, 250, 254, 327, 333, 336, 347, 359,
      385, 386, 388, 418, 527, 541, 544, 630, 640, 699, 713, 787, 790,
    ],
  },
  {
    value: [5],
    ids: [
      84, 87, 101, 218, 240, 318, 345, 433, 530, 560, 561, 596, 597, 604, 642, 643, 671, 672, 685,
      788, 862,
    ],
  },
  { value: [6], ids: [117, 271, 339, 644, 693, 736, 853, 856] },
  { value: [7], ids: [104, 304, 399, 536, 578, 698, 724] },
  { value: [8], ids: [521, 535, 860] },
  { value: [10], ids: [115, 116, 299, 301, 302, 367, 523, 735] },
  { value: [12], ids: [398] },
  { value: [13], ids: [257, 732] },
];
const mainCount = 869;
const mainObservedIds = new Set(mainObservedWidths.flatMap(({ ids }) => ids));
const mainUnobservedIds = Array.from({ length: mainCount }, (_, id) => id).filter(
  (id) => !mainObservedIds.has(id),
);
const baseMessages = [1, 2, 3].map((id) => toMessage(id));
const cursorVisibility = 21;
const soundMessages = [
  166, 167, 168, 169, 170, 171, 172, 173, 176, 181, 185, 187, 190, 191, 192, 193, 196, 197,
];
const toSound = (id) => toMessage(id + 13, -13);
const tables = (count, evidence = [], stubs = {}) => {
  const stubIds = Object.values(stubs).flat();
  const recovered = evidence.flatMap(({ ids }) => ids).sort((a, b) => a - b),
    known = new Set([...recovered, ...stubIds]);
  return {
    count,
    slots: {
      unknown: Array.from({ length: count }, (_, id) => id).filter((id) => !known.has(id)),
      ...(recovered.length ? { recovered } : {}),
      ...stubs,
    },
    ...(evidence.length ? { evidence } : {}),
  };
};

export default {
  id: 'cs2-2.6.1.23',
  profile: 'grisaia-jp-engine-2.6.1.23',
  engineVersion: '2.6.1.23',
  xmlEncoding: 'Shift_JIS',
  text: {
    settingsCharacterBytes: 1,
    pathBytes: 260,
    configurationLayout: {
      fontBytes: 64,
      keyNameBytes: 32,
      keyRows: 64,
      keyStride: 28,
      bytes: 3992,
      encoding: 'CP932',
    },
    fesLayouts: {
      21: {
        // The writer uses a leading scroll word and two trailing words in
        // its internal record. The original STRING packet omits them.
        dirty: 239,
        colors: 326,
        fontIndex: 236,
        flags: 315,
        weight: 231,
        shadow: 232,
        fix: 234,
        wipe: 235,
        profile: null,
        shift: null,
        category: null,
        fontBytes: 32,
        configBytes: 184,
        defaultFont: 'ＭＳ ゴシック',
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
      'shadow',
      'size',
      'rsize',
      'indent',
      'weight',
    ],
    resourceMessages: {
      first: { cp932: 407, nv: null, utf8: null },
      clearCategory: false,
      maxOperation: 12,
    },
  },
  configuration: {
    blockSizes: [2856, 56, 28, 12],
    keyHide: false,
    extendedPreferences: false,
    systemVoiceRows: 32,
    defaults: {
      font: 'ＭＳ ゴシック',
      title: 'CS2',
      message: [4, 4, 0, 15, 5, 1, 0, 1, 0, 100, 0, 4294967295, 0, 0],
      effect: [0, 0, 1, 1, 1, 5, 0],
      window: [4294967295, 1, 1],
      voiceRecords: {
        count: 32,
        firstByte: 20,
        stride: 88,
        enabled: 1,
        masterPercent: 100,
        group: 100,
        playWhenNamed: true,
      },
      contVoice: 0,
      rawVolumePercent: 100,
    },
    language: null,
    windowActive: null,
    sceneAnimation: null,
    extendedQueries: null,
  },
  globalFile: { growthBytes: 524288 },
  math: { lerpUsesX87: true, roundIntegerResult: 'int64-low-word' },
  stringBank: { emptyGetResult: 1 },
  database: { nullExportPolicy: null },
  sound: {
    banks: 32,
    firstMessage: 166,
    lastMessage: 197,
    delegateFrom: 198,
    legacyTypes: ['bgm', 'se', 'voice'],
    legacyVolumeAliases: { bgm: 0, se: 1, voice: 2 },
    filenamePolicy: {
      maximumBytes: 255,
      pairs: 'wide',
      caseFold: 'c-locale-ascii',
      lastSeparatorZero: 'retain-name',
      extensionScan: 'raw-backwards',
      classification: 'cp932-pair-directory',
      headComparison: 'raw-byte-prefix',
      directoryComparison: 'c-locale-bytewise',
    },
    controlBytes: 72,
    missingIdPathFields: null,
    crossfade: false,
    allowQuotedFesNames: null,
    fesExtensions: false,
    fesLoadParameters: false,
    fesPlaybackUpdates: false,
    completionFrame: null,
    loopPointEndPolicy: 'allow-unordered',
    loadMessageFormat: 'filename',
  },
  language: {
    storage: null,
    singleTable: null,
    resetOnReload: null,
    archiveFallback: null,
    switchWindowProtocol: null,
    dynamicMenus: null,
  },
  plugins: { emoteDriver: null, requiredRenderer: null },
  capabilities: {
    effekseerTask: false,
    embeddedJavaScript: false,
    windowBaseAccelerators: null,
    unicodeOutput: false,
    inputNullText: null,
    taskDumpTopWriter: null,
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
      base: { unmapped: 'reject', raw: baseMessages, canonical: baseMessages },
      control: { unmapped: 'reject', raw: [], canonical: [] },
      sound: {
        unmapped: 'reject',
        canonical: [
          ...baseMessages,
          toMessage(cursorVisibility, 22 - cursorVisibility),
          ...soundMessages.map((id) => toMessage(id, 13)),
        ],
        raw: [...baseMessages, toMessage(22, cursorVisibility - 22), ...soundMessages.map(toSound)],
      },
      fesSound: {
        unmapped: 'reject',
        raw: [166, 168, 169, 170, 171, 172, 173, 176, 187, 192, 196, 197].map(toSound),
      },
    },
    root: { start: 29, captionWide: false, soundReset: 181 },
    cursorVisibility,
    soundBaseOnly: [22],
    scriptForward: [9, 10, cursorVisibility, 64],
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
    variableBankOffset: 436,
    commonHeads: engine23CommonHeads,
    configurationMessage: {
      liveObjects: null,
      notification: null,
      filenameComparison: null,
    },
    fileList: { patternEncoding: null, keyEncoding: null },
    macroLiterals: { string: 'unescape-quote', character: 'wrap-raw' },
  },
  graphics: {
    drawEnablePendingPolicy: 'rising-edge',
    textureCapsPolicy: 'virtual-d3d9',
    texturedBoundsQuery: null,
  },
  gallery: { listVariantWidth: 64 },
  startup: {
    loosePath: 'config/startup.xml',
    resourceCheck: 'after-preferences',
    verification: {
      codeEncoding: 'cp932',
      cipher: 'blowfish-le32',
      comparison: 'decrypted-c-string',
      defaultCodeBytes: [],
    },
    titleMode: 'raw',
    applicationServices: ['startup-sound', 'textures', 'title', 'root-script'],
    accelerators: 'ansi-resource',
  },
  tables: {
    main: {
      ...tables(mainCount, mainEvidence, {
        reserved: mainReserved,
        'constant-zero': mainConstantZero,
      }),
      evidence: [
        ...mainEvidence,
        {
          ids: mainReserved,
          value: 'Own 2.6.1.23 shared 0x479660 body returns control 2 without reads or output',
        },
        {
          ids: mainConstantZero,
          value: 'Own 2.6.1.23 shared 0x487160 body writes zero and returns control 1',
        },
      ],
      observedArgumentWords: [...mainObservedWidths, { ids: mainUnobservedIds, value: [] }],
      signatures: [
        {
          ids: [6, 15, 64, 69, 70, 318, 319, 419, 423, 424, 425, 450, 594, 596, 597, 646, 741, 790],
          fields: { resultWritten: true },
        },
        { ids: mainConstantZero, fields: { resultWritten: true } },
        {
          ids: [65, 420, 421, 422, 451, 453, 458, 459, 595, 630, 645, 647, 739, 740],
          fields: { resultWritten: false },
        },
        {
          ids: [140, 142, 549],
          fields: {
            argumentWords: null,
            parameters: { kind: 'ignored', description: 'ignored' },
            resultWritten: false,
          },
        },
      ],
    },
    generic: {
      ...tables(45, [
        { ids: [16], value: 'Own 2.6.1.23 Generic 0x595650 writes the signed absolute value word' },
        { ids: [17, 38, 41], value: 'Own 2.6.1.23 MOT handlers and fixed-base logo motion calls' },
      ]),
      signatures: [{ ids: [16, 17, 41], fields: { resultWritten: true } }],
    },
    'particle-v1': tables(44),
    'particle-v2': tables(51),
  },
  layouts: {
    textCores: {
      cp932: {
        configSize: 184,
        packetSize: 188,
        nativeConfig: { size: 172, offsetInParser: 4 },
      },
    },
  },
  unreviewed: Object.fromEntries(
    [
      'configuration.language',
      'configuration.windowActive',
      'configuration.sceneAnimation',
      'configuration.extendedQueries',
      'database.nullExportPolicy',
      'sound.missingIdPathFields',
      'sound.allowQuotedFesNames',
      'sound.completionFrame',
      'language.storage',
      'language.singleTable',
      'language.resetOnReload',
      'language.archiveFallback',
      'language.switchWindowProtocol',
      'language.dynamicMenus',
      'plugins.emoteDriver',
      'plugins.requiredRenderer',
      'capabilities.windowBaseAccelerators',
      'capabilities.inputNullText',
      'capabilities.taskDumpTopWriter',
      'capabilities.cubeFlipGridHeightProduct',
      'capabilities.steam',
      'capabilities.windowReturnTitle',
      'capabilities.windowLanguageAccelerators',
      'capabilities.broadcast',
      'capabilities.recordQueues',
      'capabilities.utf8Primitives',
      'capabilities.utf8Text',
      'capabilities.emoteFes',
      'capabilities.engineWorkers',
      'capabilities.hapMovieAnsiDriverPath',
      'capabilities.windowsMediaReader',
      'capabilities.systemEntropy',
      'messages.screenEvent',
      'messages.tilePlaneCommand',
      'floatingPoint.x87ControlWord',
      'floatingPoint.mxcsr',
      'fes.configurationMessage.liveObjects',
      'fes.configurationMessage.notification',
      'fes.configurationMessage.filenameComparison',
      'fes.fileList.patternEncoding',
      'fes.fileList.keyEncoding',
      'graphics.texturedBoundsQuery',
    ].map((path) => [path, 'Outside the verified 2.6.1.23 startup and title bindings']),
  ),
};
