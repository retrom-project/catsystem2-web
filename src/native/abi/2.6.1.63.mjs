// SPDX-License-Identifier: MPL-2.0
// Candidate own normal data. Local registration only; no physical executable layouts.
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

const fesSoundReceivers = [173, 175, 176, 178, 179, 180, 183, 194, 199, 203, 204, 210, 211];
const soundReceivers = [
  ...fesSoundReceivers,
  174,
  177,
  181,
  182,
  187,
  188,
  189,
  190,
  192,
  200,
  201,
  202,
  208,
];
const toSoundRaw = (raw) => ({ min: raw + 6, max: raw + 6, offset: -6 });

export default {
  id: 'cs2-2.6.1.63',
  profile: 'rebellions-jp-engine-2.6.1.63',
  engineVersion: '2.6.1.63',
  xmlEncoding: 'Shift_JIS',
  text: {
    freeTypeCharacterEncoding: 'cp932',
    freeTypeVersion: '2.4.8',
    characterLengthPairs: 'wide',
    clipboardUsesCP932: true,
    listEntryLiveCopy: true,
    listJoinLiveCopy: true,
    tokenLiveCopy: true,
    plainParenthesisTokens: true,
    percentProduct: 'final-f32',
    settingsCharacterBytes: 1,
    pathBytes: 260,
    legacyConfigurationBytes: 1128,
    legacyClearPublishes: true,
    configurationLayout: {
      fontBytes: 64,
      keyNameBytes: 32,
      keyStride: 36,
      bytes: 5592,
      encoding: 'CP932',
    },
    fesLayouts: {
      // The original STRING configuration starts at word 190. The JS
      // layout stores that same packet at its canonical word 191.
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
        nv: 448,
        cp932: 430,
        utf8: null,
      },
      clearCategory: false,
      maxOperation: 17,
    },
    nvResetKeepsView: true,
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
  globalFile: { growthBytes: 524288 },
  displayLog: { blockRecordWords: 6 },
  dictionary: { float32Copies: [887, 891, 892] },
  calendar: { weekdayAlgorithm: 'century-integer' },
  math: {
    roundIntegerResult: 'int64-low-word',
    anglesUseX87: true,
    atan2UsesX87: true,
    lerpUsesX87: true,
    vectorTransformPairwise: true,
    motionMatrixMultiplySSE: true,
    mainMatrixMultiplySSE: true,
  },
  motion: {
    addUsesFormat: true,
    splineUsesX87: true,
    elapsedUsesX87: true,
    skipBypassesDelay: false,
  },
  movie: { alwaysUseBgmVolume: true },
  particle: {
    deferGraphAttachment: true,
    attachmentPositionRequiresOwner: true,
  },
  nameTable: { legacyFieldBytes: 32 },
  stringBank: { emptyGetResult: 1, cssOwnerLookupOnly: true },
  database: { nullExportPolicy: 'reject-unwritten', nullImportPolicy: 'reject-unwritten' },
  resources: { categoryCount: 64 },
  sound: {
    banks: 32,
    mainLoadPacketBytes: 280,
    firstMessage: 173,
    lastMessage: 211,
    delegateFrom: 212,
    legacyTypes: ['bgm', 'se', 'voice'],
    legacyVolumeAliases: {
      bgm: 0,
      se: 1,
      voice: 2,
    },
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
    controlBytes: null,
    missingIdPathFields: null,
    crossfade: false,
    allowQuotedFesNames: null,
    fesExtensions: false,
    fesLoadParameters: false,
    completionFrame: null,
    loopPointEndPolicy: 'strict-order',
    positionRequires3D: true,
    spatialRequiresLoadedBuffer: true,
    groupEndExclusive: true,
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
          { min: 353, max: 358, offset: -12, kinds: [40] },
          { min: 359, max: 367, offset: -12, kinds: [42] },
          ...[6, 9, 10].map((id) => ({ min: id, max: id, offset: 0, kinds: [40, 42] })),
          { min: 64, max: 65, offset: -3, kinds: [40, 42] },
        ],
        canonical: [
          { min: 341, max: 346, offset: 12, kinds: [40] },
          { min: 347, max: 355, offset: 12, kinds: [42] },
          ...[6, 9, 10].map((id) => ({ min: id, max: id, offset: 0, kinds: [40, 42] })),
          { min: 61, max: 62, offset: 3, kinds: [40, 42] },
        ],
      },
      area: {
        unmapped: 'reject',
        raw: [264, 273].map((id) => ({ min: id, max: id, offset: -12 })),
        canonical: [252, 261].map((id) => ({ min: id, max: id, offset: 12 })),
      },
      planeMovie: {
        unmapped: 'reject',
        raw: [
          { min: 43, max: 43, offset: -2 },
          { min: 87, max: 87, offset: -3 },
        ],
        canonical: [
          { min: 41, max: 41, offset: 2 },
          { min: 84, max: 84, offset: 3 },
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
          ...soundReceivers.map((raw) => ({ min: raw, max: raw, offset: 6 })),
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
          ...soundReceivers.map(toSoundRaw),
        ],
      },
      fesSound: {
        unmapped: 'reject',
        raw: fesSoundReceivers.map(toSoundRaw),
      },
    },
    root: {
      start: 30,
      captionWide: false,
      soundReset: 188,
    },
    movieInput: { query: 32, gate: 143 },
    windowDirectClose: 0x433,
    windowCloseConfirmation: { caption: '退出', template: '%s 确定要退出吗？' },
    soundBaseOnly: [22],
    scriptForward: [9, 10, 22],
    scriptBaseOnly: [30, 31],
    screenEvent: null,
    tilePlaneCommand: null,
    areaQueriesRequireReply: true,
  },
  floatingPoint: {
    precisionBits: 24,
    rounding: 'nearest',
    x87ControlWord: null,
    mxcsr: null,
  },
  fes: {
    variableBankOffset: 1800,
    buttonDrawNoop: true,
    legacySleepMask: true,
    // Own DEFINE and dynamic factory indexes. The internal object codes use
    // the shared representation, which has an additional CHTABLE3 member.
    definitionTypes: [
      'BASE',
      'CIMAGE',
      'IMAGE',
      'CPLANE',
      'PLANE',
      'VIEW',
      'BUTTON',
      'DRAW',
      'WIPE',
      'SOUND',
      'SNDTABLE',
      'PANEL',
      'SAVEPANEL',
      'SCROLL',
      'SCROLL2',
      'SLIDER',
      'BGTABLE',
      'BGTABLE2',
      'CHTABLE',
      'CHTABLE2',
      'STRING',
      'IMGWND',
      'PARTICLE',
      'LOGSTRING',
      'DIFIMAGE',
      'RDRAW',
      'RWIPE',
      'NUMIMG',
      'NVSTRING',
      'WBREAK',
      'RWMOS',
      'RFMOS',
      'M2PLANE',
    ],
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
      count: 109,
      complete: true,
      comparison: 'byte-exact-cstring',
      reviewedBindings: ['engine63-common-wait-owned-parameters'],
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
    trailingIntegerAfterCurrent: true,
    controlResources: {
      kinds: [40, 42],
      scrollProtocol: 'legacy',
      sliderProtocol: 'legacy',
      sliderRawMessages: true,
    },
  },
  input: {
    bitmapMaskNativeRows: true,
    cursorWarpNativeBounds: true,
    cursorWarpRequiresForeground: true,
  },
  graphics: {
    areaRasterX87: true,
    planeMovieLegacy: true,
    formattedBitmapPhysical: true,
    emptyImageSizeWritesZero: true,
    imageFilterRequiresLayers: true,
    planeAlphaFlags: 1,
    drawEnablePendingPolicy: 'rising-edge',
    bitmapBlitUsesSourceSize: true,
    screenCaptureOpaque: true,
    sameSizeBitmapCopyClips: true,
    savedImageExpandsRGB24: true,
    resizeRGB24: true,
    textureCapsPolicy: 'virtual-d3d9',
    texturedBoundsQuery: null,
    coordinateModeRequiresGraph: true,
  },
  gallery: { listVariantWidth: 64 },
  scene: {
    translations: false,
    legacyHistoryRecords: true,
    historyCaptureUsesExistingBank: true,
    cstFileMarkers: true,
    directTextNull: 'reject',
    directHistoryFormatFailure: 'zero',
    directPathResult: 'success',
  },
  startup: {
    resourceCheck: 'before-defaults',
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
      count: 938,
      slots: {
        unknown: [
          7, 11, 12, 18, 20, 22, 26, 27, 28, 31, 34, 37, 39, 40, 48, 52, 53, 55, 56, 58, 59, 60, 61,
          64, 65, 74, 75, 77, 80, 81, 82, 83, 86, 87, 89, 90, 91, 95, 96, 97, 98, 99, 102, 103, 106,
          107, 109, 110, 120, 121, 122, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137,
          138, 139, 144, 145, 146, 147, 148, 151, 152, 153, 154, 165, 166, 167, 192, 193, 194, 195,
          196, 197, 198, 199, 200, 202, 203, 208, 214, 215, 216, 217, 219, 220, 221, 222, 223, 224,
          225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 237, 239, 249, 255, 261, 264, 279,
          280, 281, 282, 283, 287, 288, 289, 290, 291, 292, 293, 305, 306, 309, 312, 321, 322, 334,
          335, 337, 340, 346, 349, 350, 351, 352, 353, 354, 355, 356, 357, 360, 361, 363, 369, 370,
          371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 381, 382, 383, 384, 391, 395, 396, 398,
          399, 401, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 428, 430, 431, 433,
          441, 442, 443, 444, 446, 456, 457, 460, 461, 462, 463, 467, 468, 470, 471, 472, 473, 474,
          475, 476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492,
          493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510,
          511, 512, 513, 514, 521, 522, 523, 524, 525, 526, 529, 532, 533, 538, 541, 558, 564, 569,
          570, 576, 582, 583, 584, 585, 587, 588, 589, 599, 600, 601, 602, 603, 608, 609, 610, 611,
          612, 613, 614, 615, 616, 617, 618, 619, 620, 621, 622, 623, 624, 628, 629, 631, 632, 641,
          648, 650, 655, 657, 658, 659, 662, 663, 664, 665, 666, 667, 668, 669, 677, 678, 679, 680,
          681, 682, 688, 689, 690, 691, 692, 695, 703, 704, 705, 706, 707, 708, 709, 716, 718, 719,
          720, 721, 722, 725, 729, 734, 735, 738, 740, 742, 743, 744, 745, 746, 747, 748, 749, 750,
          751, 752, 753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766, 767, 768,
          769, 770, 771, 772, 773, 774, 775, 776, 777, 778, 779, 780, 781, 782, 783, 784, 791, 792,
          793, 794, 795, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809, 810,
          811, 812, 813, 814, 815, 816, 817, 818, 819, 820, 821, 822, 823, 824, 825, 826, 827, 828,
          829, 830, 831, 832, 837, 838, 839, 840, 841, 842, 843, 845, 846, 847, 853, 854, 855, 856,
          857, 860, 861, 862, 871, 877, 878, 879, 880, 881, 884, 904, 905,
        ],
        reserved: mainReserved,
        'constant-zero': mainConstantZero,
        recovered: [
          1, 4, 5, 6, 8, 9, 10, 13, 14, 15, 16, 17, 19, 21, 23, 24, 25, 29, 30, 32, 33, 35, 36, 38,
          41, 42, 43, 44, 45, 46, 47, 49, 50, 51, 54, 57, 62, 63, 66, 67, 68, 69, 70, 71, 72, 73,
          76, 78, 79, 84, 85, 88, 92, 93, 94, 100, 101, 104, 105, 108, 111, 112, 113, 114, 115, 116,
          117, 118, 119, 123, 124, 125, 140, 142, 143, 149, 150, 155, 156, 157, 158, 159, 160, 161,
          162, 163, 164, 168, 201, 204, 205, 206, 207, 209, 210, 211, 212, 213, 218, 238, 240, 241,
          242, 243, 244, 245, 246, 247, 248, 250, 251, 252, 253, 254, 256, 257, 258, 259, 260, 262,
          263, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 284, 285, 286,
          294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 307, 308, 310, 311, 313, 314, 315,
          316, 317, 318, 319, 320, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 336, 338,
          339, 341, 342, 343, 344, 345, 347, 348, 358, 359, 362, 364, 365, 366, 367, 368, 385, 386,
          387, 388, 389, 390, 392, 393, 394, 397, 400, 402, 403, 404, 417, 418, 419, 420, 421, 422,
          423, 424, 425, 426, 427, 434, 435, 436, 437, 438, 440, 445, 447, 448, 449, 450, 451, 452,
          453, 454, 455, 458, 459, 464, 465, 466, 469, 515, 516, 517, 518, 519, 520, 527, 528, 530,
          531, 534, 535, 536, 537, 539, 540, 542, 549, 557, 565, 566, 567, 568, 571, 572, 577, 586,
          590, 591, 592, 593, 594, 595, 596, 597, 598, 604, 605, 606, 607, 625, 630, 633, 634, 635,
          636, 637, 638, 639, 640, 645, 646, 647, 649, 651, 653, 654, 674, 675, 676, 683, 684, 685,
          693, 694, 696, 697, 698, 699, 700, 701, 702, 710, 711, 712, 713, 714, 715, 717, 723, 724,
          726, 727, 728, 730, 731, 732, 733, 736, 737, 739, 741, 785, 786, 787, 788, 789, 790, 833,
          834, 835, 836, 844, 848, 849, 850, 851, 852, 858, 859, 863, 864, 865, 866, 867, 868, 869,
          870, 872, 873, 874, 875, 876, 882, 883, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894,
          895, 896, 897, 898, 899, 900, 901, 902, 903, 934, 935, 936, 937,
        ],
      },
      evidence: [
        {
          ids: [701, 702],
          value:
            'Own 0x4a8e50 and 0x4a9d50 use Plane raw41 and raw84. The mode-one hardware receiver at 0x43ece0 installs its prepared MPEG model with zero XYZ. The second call borrows the original movie registration or returns zero.',
        },
        {
          ids: [204, 205, 206],
          value:
            'Own matrix wrappers 0x4ab4e0/0x4ab530/0x4ab570 share the resolved original targets with MOT23–25. Native SSE2 selector 2 updates the translated 16-word row-vector matrix or the active World matrix, with control 2 and no result write.',
        },
        {
          ids: [201],
          value:
            'Own Main201 at 0x4b2bc0 queries raw13. Selector zero forwards raw252 to live Raster 0x484790 or raw261 to Hydro 0x482e30. Raster borrows the last three words and retains its graph, axis, state and live clock. Hydro returns unhandled without reading the packet.',
        },
        {
          ids: [119, 536, 537],
          value:
            'Own .63 0x4a7240 clears and fills the two translated size destinations. 0x4a7eb0 looks up the low WORD metadata key in mode zero through 0x5422e0 and writes four edges plus color on a hit. 0x4a7f80 merges two live attribute owners through 0x5424e0 and returns success.',
        },
        {
          ids: [149, 150, 286, 394],
          value:
            'Own Root raw32 selects Input. Raw121 writes the signed projected coordinate pair, raw133 uses packed low-word coordinates and full duration with enabled foreground and bounds gates, raw141 clears regions and resets both previous coordinates. Own Plane raw93 forwards raw142, whose bitmap helper samples native rows, retains offsets and packs nonzero alpha low-bit first.',
        },
        {
          ids: [577, 651],
          value:
            'Own .63 0x49deb0 writes the passed Top word through raw38 and 0x4aa2a0 resets the addressed Base exit status to minus one through raw24. Both calls leave the GCALL result unchanged.',
        },
        {
          ids: [10, 445],
          value:
            'Own 0x49d8f0 converts formatted narrow backslash-n bytes into CR/LF and writes CF_TEXT in the original clipboard order. Own 0x49dc80 sends one formatted CP932 message to MessageBoxA with the literal system error caption, MB_OK, and no script result.',
        },
        {
          ids: [33, 786, 874, 875],
          value:
            'Own 0x4b0920 enters the integer MT stream via 0x4395f0 and 0x413460. Own 0x49e1e0 calls signed integer century arithmetic at 0x50b820. Own 0x4a24d0/0x4a24f0 pack low words and unpack the signed halves to translated guest destinations in order.',
        },
        {
          ids: [675, 676, 885, 886, 894, 895],
          value:
            'Own dictionary allocation and release are exact pointer aliases of 515 and 516 at 0x49f840 and 0x4ae120. The same ordered byte-key owner crosses the two families.',
        },
        {
          ids: [887, 888, 889, 890, 891, 892, 893, 896, 897, 898, 899, 900, 901, 902],
          value:
            'Own .63 ordered dictionary readers share 0x49eae0, 0x49f640, 0x49e670 and 0x49e930. Set replaces the exact formatted key and import preserves existing keys. Packed names are NUL-terminated and DWORD-aligned. 887, 891 and 892 copy values through x87 F32, while 896, 900 and 901 copy full raw DWORDs.',
        },
        {
          ids: mainReserved,
          value:
            'Own 2.6.1.63 Main aliases ignore the guest argument block and return control 2 without reading or writing the result cell.',
        },
        {
          ids: mainConstantZero,
          value:
            'Own 2.6.1.63 Main aliases ignore the guest argument block, write a DWORD zero through the native result pointer and return control 1.',
        },
        {
          ids: [140, 142, 549],
          value:
            'Own 2.6.1.63 Main aliases return control 1 without a result write. The GCALL frame starts with the original unwritten-result sentinel and pushes that word.',
        },
        {
          ids: [6],
          value:
            'Own Main6 copies the sole operand directly to the result DWORD and returns control 1.',
        },
        {
          ids: [23, 24],
          value:
            'Own Main23 and Main24 scan the live narrow string with the wide CP932 pair decoder. Main23 keeps character ends strictly below the byte limit. Main24 caps the character count. Both store two NUL bytes at the boundary and return the retained byte count.',
        },
        {
          ids: [9],
          value:
            '2.6.1.63 own Main9 posts close confirmation or the raw 0x433 direct close. Both accepted paths hide the view and enqueue 0x410 for Script shutdown and cleanup.',
        },
        {
          ids: [72, 73, 76],
          value:
            'Own Script raw168 returns the target interpreter. Main72 and Main73 translate both guest byte spans and copy in opposite directions without a result write. Main76 follows the caller parent and writes its native task ID.',
        },
        {
          ids: [113, 116],
          value:
            'Own Main113 captures the active view into a caller-owned four-byte bitmap with opaque alpha and returns its handle, or zero. Main116 clips the source and destination rectangles and chooses copy or resample by their requested dimensions.',
        },
        {
          ids: [263, 464],
          value:
            'Own kind15 Draw raw275 changes the sender-keyed entry visibility. Raw288 refreshes the same key. Both form the 16-bit entry index over the native sender ID and return control 2.',
        },
        {
          ids: [694],
          value: 'Own Main694 sends raw29 to store the full Base task user DWORD.',
        },
        {
          ids: [123, 418],
          value:
            'Own kind8 raw97 gates on the row capacity at byte 60, then copies 1128 bytes. Main123 and Main418 build that packet from 96 guest bytes and one or two counted CP932 line-break lists.',
        },
        {
          ids: [124, 125, 557],
          value:
            'Own kind8 raw99 appends expanded CP932 bytes and rasterizes immediately outside timed display mode. Raw100 clears the owned bitmap and republishes when output is enabled. Raw117 stores the secondary color DWORD. The wrappers preserve the result cell and return control 2.',
        },
        {
          ids: [450, 451],
          value:
            'Own FES raw323 selects an existing CP932 label and returns the result or zero. Raw324 writes the complete FES save-object word without a result write.',
        },
        {
          ids: [647],
          value:
            'Own Main647 sends raw330 with the raw sleep DWORD. The receiver compares and stores this word, traverses recorded FES display resources on a change, and redraws on wake. The wrapper preserves the result and returns control 2.',
        },
        {
          ids: [649],
          value:
            'Own Main649 queries raw331 and copies the selected FES private bank through the same receiver. A null file or zero bank size returns zero. The successful 2048-byte transfer writes the requested CSS record and returns one.',
        },
        {
          ids: [241, 242, 243, 251, 252, 253],
          value:
            'Own CSS wrappers select the HG-2 bitmap encoder, raw nested CSS, or the caller string bank. Bitmap restore expands RGB24 to four bytes and registers its owner. The string-bank writer requires the existing owner and the reader initializes it only after finding the requested record. Nested read creates an independent container.',
        },
        {
          ids: [387, 388],
          value:
            'Own Main387 writes the buffer and capacity words from the motion checkpoint structure. Main388 makes an independent copy of the CSS bytes and restores a supplied MOT manager with the caller frame, or returns a detached checkpoint.',
        },
        {
          ids: [850, 851],
          value:
            'Own display-log CSS wrappers use the four section offsets and two base counters. Each stored block has six DWORDs, with a separate encoding for text and voice bytes.',
        },
        {
          ids: [852],
          value:
            'Own 0x4a2c30 writes the original GAME/log/static DWORD at configuration owner +0x6ba0 through the published view at +0x210, with zero arguments and control 1.',
        },
        {
          ids: [699],
          value:
            'Own 0x4a19e0 rebuilds the narrow display log through the saved scene path from its two handles and two formatted command names. It clears the old owner, appends only elapsed blocks and returns control 2.',
        },
        {
          ids: [271, 272, 273, 274, 275, 693],
          value:
            '2.6.1.63 own Particle wrappers use raw 302–304, 306 and 307. Raw 302 receives the family, two CP932 names, count, priority, 32 registers and a cleared draw word. Raw 306 writes the active word.',
        },
        {
          ids: [265, 266, 267, 268, 269, 270],
          value:
            '2.6.1.63 own movie open and close use Root32 and no-op Input139 with the renderer/cursor gate. The play, stop, status and redraw wrappers use the prepared and running words and the native repeat count.',
        },
        {
          ids: [417, 787, 788],
          value:
            '2.6.1.63 movie gain uses effective BGM volume, master and BGM mutes. The view and movie rectangle wrappers exchange left, top, width and height.',
        },
        {
          ids: [426, 427],
          value:
            '2.6.1.63 own Main426 and Main427 send raw Particle 308 and 309 with the second word in L. The owned receiver preserves signed alpha below 255 and maps higher alpha to 256. Zero attachment clears the graph reference.',
        },
        {
          ids: [218, 712, 715],
          value:
            '2.6.1.63 own Main712 reads the composed bitmap dimensions and initializes empty sizes to zero. Main715 reads both signed offsets. Main218 intersects a live RECT with the four caller edges and writes the empty RECT on a miss.',
        },
        {
          ids: [674],
          value:
            '2.6.1.63 own category query formats the filename and category. A Sound category first uses the voice row archive name. Both routes scan the original 64 category slots.',
        },
        {
          ids: [50, 51, 54, 57, 397],
          value:
            '2.6.1.63 own float32 sine, cosine, arccosine, absolute value and ordered atan2 wrappers write a float result and return control 1.',
        },
        {
          ids: [653, 654],
          value:
            '2.6.1.63 own raw Plane 81 stores the VRAM type. Raw 82 receives two 256-byte formatted strings and is the original empty SimplePlane branch.',
        },
        {
          ids: [639, 640],
          value:
            '2.6.1.63 own name-table filename rules compare a prefix of the pattern length with separate stem and extension wildcards. Replacement reads the two CP932 fields and expands the original live-buffer template.',
        },
        {
          ids: [565, 566, 567],
          value:
            '2.6.1.63 own ScreenView getters read the recording and counter DWORDs. Formatted output takes a literal filename and writes the CP932 line and CRLF at the last existing byte.',
        },
        {
          ids: [903],
          value:
            '2.6.1.63 own Root Sound lookup sends the formatted tag at raw 208. It reads the selected bank or first matching bank in order for selector -1, defaulting to zero.',
        },
        {
          ids: [604, 935, 936],
          value:
            '2.6.1.63 own 280-byte Sound load packets use fixed banks via raw 173/174 and allocated Sound groups via raw 199–202. Allocation scans the half-open group and falls back to a releasing bank. Option forms convert the unsigned ticks to milliseconds.',
        },
        {
          ids: [347, 348],
          value:
            '2.6.1.63 own wrappers send three velocity floats through Sound raw 189 and one Doppler float through raw 190. Both update an existing bank buffer.',
        },
        {
          ids: [606, 607, 844],
          value:
            '2.6.1.63 own voice row lookup matches a CP932-pair-aware directory first, then the first raw prefix of the lowercased full name. Main606 and Main607 return the row enable and master gain words. Main844 returns its signed index.',
        },
        {
          ids: [168, 358],
          value:
            '2.6.1.63 own Main168 sends three F32 words to Sound raw 187, gated by 3D configuration and a live bank buffer. Main358 maps both operands and writes the four temporary row-vector products. The normal SSE path reduces the two pairs in F32.',
        },
        {
          ids: [284],
          value:
            '2.6.1.63 own Main284 formats the second word, resolves the sound category and opens the resource in mode 3. It closes a successful open and returns its boolean with control 1.',
        },
        {
          ids: [111, 115, 118],
          value:
            '2.6.1.63 own scoped bitmap producer reads a space-delimited image list and numeric frame selectors, places overlays in physical bitmap coordinates and promotes RGB24. Main115 copies clipped source pixels and Main118 owns a deep bitmap clone.',
        },
        {
          ids: [937],
          value:
            '2.6.1.63 own zero-word wheel reset queries caller Top Input through raw 32 and clears both wheel directions through Input raw 153.',
        },
        {
          ids: [257, 259, 731, 732],
          value:
            '2.6.1.63 own raw Draw 268/270 receive a zeroed fifteen-word packet with source in the bitmap or image-owner slot, unsigned clamped opacity and the original transform order.',
        },
        {
          ids: [625],
          value:
            '2.6.1.63 own raw Draw 283 writes the requested animation enable and updates the caller layer and pending damage.',
        },
        {
          ids: [713, 723, 727, 728, 737],
          value:
            '2.6.1.63 own bitmap collection RGB multipliers, rotation, reflection and color filters. Main728 writes the raw mask word on the composed bitmap. Filters leave direct canvases alone.',
        },
        {
          ids: [339, 534],
          value:
            '2.6.1.63 own Main339 builds an ordered RECT and sends raw Draw 277. Main534 writes the dirty word through raw Draw 292.',
        },
        {
          ids: [717, 724],
          value:
            '2.6.1.63 own base-point and attribute queries read the composed bitmap. Attribute IDs narrow to sixteen bits and a hit writes five raw words.',
        },
        {
          ids: [520, 527, 528, 530, 531],
          value:
            '2.6.1.63 own retained transition query and fade/wipe wrappers use raw 365, 372, 373, 375 and 376 with the same ordered priority and duration packets.',
        },
        {
          ids: [568, 858, 859],
          value:
            '2.6.1.63 own Main568 captures slot zero after successful one-target allocation. Main858 prepares a caller count and Main859 captures a caller slot and priority range.',
        },
        {
          ids: [4, 17, 318],
          value:
            '2.6.1.63 own zero-word timeGetTime, raw narrow strlen and five-float x87 interpolation return a DWORD with control 1.',
        },
        {
          ids: [94, 453],
          value:
            '2.6.1.63 own Main94 clamps signed alpha and sends raw Plane 60 with flag 1. Main453 stores the current task exit word.',
        },
        {
          ids: [341],
          value:
            '2.6.1.63 own Main341 sends raw Draw 279, which clears the retained entries and bitmap then reinserts a visible base. The wrapper returns control 2.',
        },
        {
          ids: [43, 44],
          value:
            '2.6.1.63 own Main43 copies balanced parentheses literally into a NUL list. Main44 clears the destination before joining the inclusive range with trailing spaces.',
        },
        {
          ids: [307, 310, 313],
          value:
            '2.6.1.63 own motion update takes the caller clock and a start deferral flag. Activity and skip select records by group. A skipped record still honors its delay.',
        },
        {
          ids: [62, 63, 320, 535],
          value:
            '2.6.1.63 own x87 angle conversions and five-float motion splines. The eight-word delayed add uses the same formatted filename resolver as Main304.',
        },
        {
          ids: [258, 598],
          value:
            '2.6.1.63 own Main258 removes the sender-keyed Draw entry through raw 269. Main598 returns the first nonempty comma-delimited resource name.',
        },
        {
          ids: [710, 711, 714, 726, 730, 733, 736],
          value:
            '2.6.1.63 own Script image collection load and release, canvas dimensions, per-layer blur and resize, and four-byte canvas creation and fill.',
        },
        {
          ids: [539],
          value:
            '2.6.1.63 own Main539 evaluates scalar, list and range expressions through the caller bank, with bounded forward DWORD writes.',
        },
        {
          ids: [314],
          value: '2.6.1.63 own Main314 sets the skip word on each live MOT instance.',
        },
        {
          ids: [392],
          value:
            '2.6.1.63 own Main392 parses the formatted narrow text, emits base glyph bytes at the mapped destination and returns their byte count.',
        },
        {
          ids: [35, 311, 440],
          value:
            '2.6.1.63 own Main35 copies mapped bytes. Main311 queries the active MOT records and Main440 runs their final motion pass from the base state.',
        },
        {
          ids: [19, 21],
          value:
            '2.6.1.63 own Main19 compares signed bytes. Main21 folds ASCII and compares unsigned bytes. Both place the second raw operand first.',
        },
        {
          ids: [336],
          value:
            '2.6.1.63 own history capture copies numbered references from an already bound caller string bank.',
        },
        {
          ids: [45],
          value:
            '2.6.1.63 own Main45 clears the destination before its first raw byte search and reads forward from the live string buffers.',
        },
        {
          ids: [882, 883],
          value:
            '2.6.1.63 own FES raw 340 and 339 set or read a four-byte value under the formatted CP932 bytes.',
        },
        {
          ids: [285],
          value:
            '2.6.1.63 own Main285 finds the caller Top Input at raw 32 and combines the four key sources at raw 140.',
        },
        {
          ids: [112, 114, 362, 364, 367],
          value:
            '2.6.1.63 own Script bitmap creation, release, canvas query, packed frame decode and clipped blending from the actual source rectangle.',
        },
        {
          ids: [571, 572],
          value:
            '2.6.1.63 own wrappers send raw 426 with an optional dereferenced DWORD and raw 425 with zero payload to the supplied native target.',
        },
        {
          ids: [455],
          value:
            '2.6.1.63 own Draw raw 284 copies a source bitmap into its private base or hides the existing base when the source is zero.',
        },
        {
          ids: [454],
          value:
            '2.6.1.63 own Main454 copies the caller context NUL-terminated bytes into VM memory, with control 2 and no VM result.',
        },
        {
          ids: [934],
          value:
            '2.6.1.63 own formatted seen-history alias copies the source value to an absent destination and returns control 2.',
        },
        {
          ids: [696, 697, 698, 700, 876],
          value:
            '2.6.1.63 own configured CP932 backlog creation, ordered block append, speaker lookup, clear and release.',
        },
        {
          ids: [155, 156, 157, 158, 159, 160, 161, 162, 163, 164],
          value:
            '2.6.1.63 own Root Sound lookup, 280-byte formatted bank load and raw 173–183 receivers for playback, release, volume and pan.',
        },
        {
          ids: [403, 404],
          value:
            '2.6.1.63 own Root Input lookup raw 32 routes either a per-key gate at raw 146 or the zero-argument gate reset at raw 147.',
        },
        {
          ids: [248, 385, 386],
          value:
            '2.6.1.63 own global-file tag read and direct Scene seen/path import and export with 40-byte records and 72-byte numbered strings.',
        },
        {
          ids: [308, 785],
          value:
            '2.6.1.63 own MOT float speed setter and immediate unsigned display-log block-limit pruning.',
        },
        {
          ids: [365, 366, 368],
          value:
            '2.6.1.63 own image-category packed-buffer load, reference release and cleared 36-byte metadata result.',
        },
        {
          ids: [38],
          value:
            '2.6.1.63 own unformatted delimiter copy uses forward live reads, literal tab escape and an unsigned limit with two terminators.',
        },
        {
          ids: [69, 70, 143],
          value:
            '2.6.1.63 own Script transport packs four words for immediate raw 166 and queued raw 167. Script load and shared binding use raw 154 and 165.',
        },
        {
          ids: [389, 390],
          value:
            '2.6.1.63 own global-file clear replaces its record storage with 512 KiB and retains the tag. Clone owns the complete copied state.',
        },
        {
          ids: [315, 316, 317],
          value:
            '2.6.1.63 own MOT checkpoint creation, in-place refresh and release; the authored one-word create still reads the adjacent VM frame word.',
        },
        {
          ids: [49, 633, 634, 635, 636, 637, 638],
          value:
            '2.6.1.63 own 100-byte name-table rows, mounted FES-category file resolution and wide CP932 byte-boundary search.',
        },
        {
          ids: [296, 297, 298, 299, 300, 301, 302, 303, 304],
          value:
            '2.6.1.63 own MOT removal, 144-byte base and working transfers, and formatted KCS lookup with bounded registers and optional data.',
        },
        {
          ids: [42, 46, 212, 213, 278, 319, 519, 540],
          value:
            '2.6.1.63 own raw argument tokenizer, forward list copy, percentage conversion, Script expression and string-bank calls, and int64 rounding.',
        },
        {
          ids: [515, 516, 517, 518],
          value:
            '2.6.1.63 own raw CP932 command dictionary, binary key comparison, first insertion and minus-one lookup miss.',
        },
        {
          ids: [863, 864, 865, 866, 867, 868],
          value:
            '2.6.1.63 own fixed-record stack owner, signed-capacity growth, LIFO transfer, count and full-capacity copy.',
        },
        {
          ids: [323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 338],
          value:
            '2.6.1.63 own two-member scene owner, CP932 CatScene reader, unsigned history lists and file metadata records.',
        },
        {
          ids: [25, 683, 684, 685],
          value:
            '2.6.1.63 own integer-prefix parser and CP932 section-table wrappers, with ordered duplicate rows, optional output and explicit owner release.',
        },
        {
          ids: [542],
          value:
            '2.6.1.63 own zero-argument renderer wrapper allocates only missing configured texture pages in two depth passes.',
        },
        {
          ids: [434, 435, 436, 437, 438],
          value:
            '2.6.1.63 own preload clear, formatted category queue, start, signed threshold and age wrappers and file-server cache transitions.',
        },
        {
          ids: [16, 47],
          value:
            '2.6.1.63 own formatted append uses the current CP932 formatter and returns the original destination; the character count traverses CP932 pairs.',
        },
        {
          ids: [343, 345],
          value:
            '2.6.1.63 own Plane size and bounds wrappers, raw messages 72 and 73, and cached local geometry outputs on a live Plane.',
        },
        {
          ids: [84, 85, 93, 101, 344, 402],
          value:
            '2.6.1.63 own Plane transform and blend wrappers with raw messages 46, 48, 52, 54, 58, 63 and 78 and the matching live model receivers.',
        },
        {
          ids: [78, 466],
          value:
            '2.6.1.63 own textured rectangle packet and coordinate mode wrappers, raw Plane messages 39 and 79, and live D3D model ownership.',
        },
        {
          ids: [586],
          value:
            '2.6.1.63 own motion manager flag setter stores the full DWORD on a nonzero manager for use during motion creation.',
        },
        {
          ids: [207, 294, 295],
          value:
            '2.6.1.63 own motion manager constructor and release wrappers, identity matrix writer and VM pointer resolution.',
        },
        {
          ids: [741],
          value:
            '2.6.1.63 own zero-argument query writes the fullscreen Settings mw_pos word or zero when windowed and returns control 1.',
        },
        {
          ids: [630, 645, 646],
          value:
            '2.6.1.63 own FES notification and local bank wrappers with raw receivers 325, 328 and 329, the optional 32-byte object name and unsigned local range 0–511.',
        },
        {
          ids: [342],
          value:
            '2.6.1.63 own Draw force wrapper sends raw message 280 with zero parameters to mark the renderer dirty and force its full output.',
        },
        {
          ids: [15],
          value:
            '2.6.1.63 own raw narrow append copies words and trailing bytes into the destination, writes two terminators and returns its original VM address with control 1.',
        },
        {
          ids: [594, 595, 596, 597],
          value:
            '2.6.1.63 own formatted table open and release, CP932 group and alias lookup, and three RGB outputs on a matching entry.',
        },
        {
          ids: [790],
          value:
            '2.6.1.63 own range query reads eight local or global start/count pairs and leaves the outputs unchanged when the unsigned index is out of range.',
        },
        {
          ids: [739],
          value:
            '2.6.1.63 own border query doubles the device offsets and maps them to virtual coordinates before returning control 2.',
        },
        {
          ids: [5],
          value:
            '2.6.1.63 own zero-argument wrapper writes the current task clock minus its paused frame count as one DWORD and returns control 1.',
        },
        {
          ids: [419, 420, 421, 422, 423, 424, 425, 458, 459],
          value:
            '2.6.1.63 own CG wrappers, owned selector tree and list, formatted registrations, global-entry serialization and 64-byte list variants.',
        },
        {
          ids: [108],
          value:
            '2.6.1.63 own Script key-edge wrapper sends raw BasePlane message 90 with wParam zero and the requested latch word as lParam, then returns control 2 without a result.',
        },
        {
          ids: [100, 117, 452],
          value:
            '2.6.1.63 own idle Script wrappers and selected Plane color, VRAM/bitmap fill and Base exit-code receivers; observed first-flow caller and authored cold continuation.',
        },
        {
          ids: [869, 873],
          value:
            '2.6.1.63 own database resource load and CSS-host-buffer import wrappers. Import reads three DWORDs per selected 268-byte record and leaves the result unwritten for a NULL database.',
        },
        {
          ids: [238, 240, 244, 245, 469],
          value:
            '2.6.1.63 own close callback and CSS file create, bounded Script bank export, raw VM bytes, save and tagged-entry removal wrappers.',
        },
        {
          ids: [277],
          value:
            '2.6.1.63 own StringBank getter returns success for an existing C string including empty, and writes NUL with result zero for a missing entry.',
        },
        {
          ids: [833, 834, 835, 836],
          value:
            '2.6.1.63 own reference-prefixed host buffer allocation, release, tagged byte save and tagged byte read with separate guest byte-count output.',
        },
        {
          ids: [870, 872],
          value:
            '2.6.1.63 own database release and export wrappers; complete record count and 268-byte rows, NULL leaves the export result unwritten.',
        },
        {
          ids: [79, 88, 92, 104, 105, 848, 849],
          value:
            '2.6.1.63 own simple Plane construction and rectangle, position, visibility and Input-region wrapper/receiver chain. The simple Plane derives region geometry and priority before forwarding registration and flags.',
        },
        {
          ids: [1, 14, 36, 41],
          value:
            '2.6.1.63 own debug formatter, formatted string copy with two terminators, byte fill and delimiter-list writers.',
        },
        {
          ids: [29, 30, 32],
          value:
            '2.6.1.63 own file-open mode scan, bounded byte read with error-to-zero result and file-close wrappers.',
        },
        {
          ids: [210, 276],
          value:
            '2.6.1.63 own Script variable-bank bounds check and narrow string-bank writer with dirty bit.',
        },
        {
          ids: [590, 591, 592, 593],
          value:
            '2.6.1.63 own XML parse, release and node query wrappers including the prewritten integer default and existing-node byte store.',
        },
        {
          ids: [400],
          value:
            '2.6.1.63 own loop-table wrapper and Sound raw192: signed 64-bit ordered endpoints, filename mapping, duplicate start-word replacement and void control.',
        },
        {
          ids: [256, 260, 262],
          value:
            '2.6.1.63 own Draw factory, initialize, offset and enable wrappers selecting raw 267, 271 and 274. The enable receiver writes a pending word on a rising edge.',
        },
        {
          ids: [246, 247, 250, 254],
          value:
            '2.6.1.63 own CSS load, entry lookup, Script bank query, bounded DWORD import and VM copy wrappers; selected startup file owner and cleanup.',
        },
        {
          ids: [66, 67, 447, 448, 449],
          value:
            '2.6.1.63 own task factory and destruction wrappers and FES receiver messages 319 through 322 for attachment, source load, frame update and draw binding.',
        },
        {
          ids: [8, 13, 68, 71, 209, 211, 393, 789],
          value:
            '2.6.1.63 own entry wrappers and selected view, VM address, wait, number bank, settings and window receivers; verified narrow startup and Script wait.',
        },
        {
          ids: [359],
          value:
            '2.6.1.63 own Main359 four VM blocks/control2, including guest byte0; own-helper proof in the ignored per-version packet.',
        },
        {
          ids: [465],
          value:
            '2.6.1.63 own Main465 Settings author DWORD/control1; unchanged author/CRC/RNG ordering.',
        },
        {
          ids: [605],
          value:
            '2.6.1.63 own Main605 filename formatter and flat gain chain/control1; finite CP932/255-byte/C-locale domain.',
        },
      ],
      signatures: [
        { ids: [119, 149, 150, 286, 394, 577, 651], fields: { resultWritten: false } },
        { ids: [536, 537], fields: { resultWritten: true } },
        { ids: [33, 786, 874], fields: { resultWritten: true } },
        { ids: [10, 445, 875], fields: { resultWritten: false } },
        { ids: [675, 885, 888, 890, 893, 894, 897, 899, 902], fields: { resultWritten: true } },
        {
          ids: [676, 886, 887, 889, 891, 892, 895, 896, 898, 900, 901],
          fields: { resultWritten: false },
        },
        { ids: [699], fields: { resultWritten: false } },
        {
          ids: [140, 142, 549],
          fields: {
            argumentWords: null,
            parameters: { kind: 'ignored', description: 'The native handler reads no operands.' },
            result: { kind: 'bits', bits: 32, initialization: 'uninitialized' },
            resultWritten: false,
          },
        },
        {
          ids: [
            6, 23, 24, 76, 113, 241, 242, 243, 251, 252, 253, 387, 388, 450, 649, 850, 851, 852,
          ],
          fields: { resultWritten: true },
        },
        { ids: [9, 72, 73, 263, 451, 464, 694], fields: { resultWritten: false } },
        { ids: [271, 274, 693], fields: { resultWritten: true } },
        { ids: [272, 273, 275], fields: { resultWritten: false } },
        { ids: [265, 266, 267, 268, 269], fields: { resultWritten: true } },
        { ids: [270, 417, 787, 788], fields: { resultWritten: false } },
        { ids: [426, 427], fields: { resultWritten: false } },
        { ids: [218, 712, 715], fields: { resultWritten: false } },
        { ids: [50, 51, 54, 57, 397, 674], fields: { resultWritten: true } },
        { ids: [653, 654], fields: { resultWritten: false } },
        { ids: [639, 640], fields: { resultWritten: true } },
        { ids: [565, 566, 903], fields: { resultWritten: true } },
        { ids: [567], fields: { resultWritten: false } },
        { ids: [604, 935, 936], fields: { resultWritten: true } },
        { ids: [347, 348], fields: { resultWritten: false } },
        { ids: [606, 607, 844], fields: { resultWritten: true } },
        { ids: [168, 358], fields: { resultWritten: false } },
        { ids: [284], fields: { resultWritten: true } },
        { ids: [111, 118], fields: { resultWritten: true } },
        { ids: [115, 116], fields: { resultWritten: false } },
        { ids: [937], fields: { resultWritten: false } },
        { ids: [257, 259, 731, 732], fields: { resultWritten: false } },
        { ids: [625, 713, 723, 727, 728, 737], fields: { resultWritten: false } },
        { ids: [339, 534], fields: { resultWritten: false } },
        { ids: [717, 724], fields: { resultWritten: true } },
        { ids: [520], fields: { resultWritten: true } },
        { ids: [527, 528, 530, 531], fields: { resultWritten: false } },
        { ids: [568, 858, 859], fields: { resultWritten: false } },
        { ids: [4, 17, 318], fields: { resultWritten: true } },
        { ids: [94, 453], fields: { resultWritten: false } },
        { ids: [598, 710, 733], fields: { resultWritten: true } },
        { ids: [258, 711, 714, 726, 730, 736], fields: { resultWritten: false } },
        { ids: [539], fields: { resultWritten: true } },
        { ids: [314], fields: { resultWritten: false } },
        { ids: [392], fields: { resultWritten: true } },
        { ids: [35], fields: { resultWritten: false } },
        { ids: [311, 440], fields: { resultWritten: true } },
        { ids: [19, 21], fields: { resultWritten: true } },
        { ids: [336], fields: { resultWritten: false } },
        { ids: [45], fields: { resultWritten: false } },
        { ids: [882], fields: { resultWritten: false } },
        { ids: [883], fields: { resultWritten: true } },
        { ids: [285], fields: { resultWritten: true } },
        { ids: [112, 364], fields: { resultWritten: true } },
        { ids: [114, 362, 367], fields: { resultWritten: false } },
        { ids: [571, 572], fields: { resultWritten: false } },
        { ids: [454, 455], fields: { resultWritten: false } },
        { ids: [934], fields: { resultWritten: false } },
        { ids: [696], fields: { resultWritten: true } },
        { ids: [697, 698, 700, 876], fields: { resultWritten: false } },
        { ids: [155, 160, 162], fields: { resultWritten: true } },
        { ids: [156, 157, 158, 159, 161, 163, 164], fields: { resultWritten: false } },
        { ids: [403, 404], fields: { resultWritten: false } },
        { ids: [248, 386], fields: { resultWritten: true } },
        { ids: [308, 785], fields: { resultWritten: false } },
        { ids: [365, 368], fields: { resultWritten: true } },
        { ids: [366], fields: { resultWritten: false } },
        { ids: [38], fields: { resultWritten: true } },
        { ids: [69, 70], fields: { resultWritten: true } },
        { ids: [143], fields: { resultWritten: false } },
        { ids: [389, 390], fields: { resultWritten: true } },
        { ids: [315, 316], fields: { resultWritten: true } },
        { ids: [317], fields: { resultWritten: false } },
        { ids: [49, 633, 635, 636, 637, 638], fields: { resultWritten: true } },
        { ids: [634], fields: { resultWritten: false } },
        { ids: [296, 297, 298, 299, 300, 301, 302, 303], fields: { resultWritten: false } },
        { ids: [304, 307, 310, 535], fields: { resultWritten: true } },
        { ids: [313, 320], fields: { resultWritten: false } },
        { ids: [42, 213, 319, 519, 540], fields: { resultWritten: true } },
        { ids: [43, 44, 46, 212, 278], fields: { resultWritten: false } },
        { ids: [515, 518], fields: { resultWritten: true } },
        { ids: [516, 517], fields: { resultWritten: false } },
        { ids: [863, 865, 866, 867], fields: { resultWritten: true } },
        { ids: [864, 868], fields: { resultWritten: false } },
        { ids: [323, 325, 326, 327, 328, 329, 332, 333, 338], fields: { resultWritten: true } },
        { ids: [324, 330, 331], fields: { resultWritten: false } },
        { ids: [25, 683, 685], fields: { resultWritten: true } },
        { ids: [684], fields: { resultWritten: false } },
        { ids: [542, 543, 546, 550, 652], fields: { resultWritten: false } },
        { ids: [437], fields: { resultWritten: true } },
        { ids: [434, 435, 436, 438], fields: { resultWritten: false } },
        { ids: [16, 47], fields: { resultWritten: true } },
        { ids: mainConstantZero, fields: { resultWritten: true } },
        { ids: [343, 345], fields: { resultWritten: false } },
        { ids: [84, 85, 93, 101, 344, 402], fields: { resultWritten: false } },
        { ids: [78, 466], fields: { resultWritten: false } },
        { ids: [586], fields: { resultWritten: false } },
        { ids: [294], fields: { resultWritten: true } },
        { ids: [207, 295], fields: { resultWritten: false } },
        { ids: [741], fields: { resultWritten: true } },
        { ids: [5, 15, 419, 423, 424, 425, 594, 596, 597, 790], fields: { resultWritten: true } },
        { ids: [341, 342, 420, 421, 422, 458, 459, 595, 739], fields: { resultWritten: false } },
        { ids: [646], fields: { resultWritten: true } },
        { ids: [630, 645], fields: { resultWritten: false } },
        {
          ids: [385],
          fields: {
            argumentWords: 4,
            parameters: NATIVE_SEMANTICS.main[385].signature.parameters.slice(0, 4),
            resultWritten: true,
          },
        },
        {
          ids: [856],
          fields: {
            argumentWords: 7,
            parameters: [
              {
                name: 'arg0',
                description: 'Own seven-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg1',
                description: 'Own seven-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg2',
                description: 'Own seven-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg3',
                description: 'Own seven-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg4',
                description: 'Own seven-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg5',
                description: 'Own seven-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg6',
                description: 'Own seven-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
            ],
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
      ],
    },
    generic: {
      count: 45,
      slots: {
        unknown: [
          0, 3, 4, 6, 8, 10, 11, 12, 13, 15, 18, 19, 20, 21, 22, 24, 25, 27, 28, 29, 30, 31, 32, 33,
          34, 35, 36, 37, 39, 40,
        ],
        recovered: [1, 2, 5, 7, 9, 14, 16, 17, 23, 26, 38, 41, 42, 43, 44],
      },
      evidence: [
        {
          ids: [1, 2, 5, 7, 9, 14, 16, 42],
          value:
            '2.6.1.63 own MOT table scalar wrappers and the signed quarter-period triangle wave.',
        },
        {
          ids: [23, 26, 43, 44],
          value:
            '2.6.1.63 own MOT row-vector matrix operations use identity, successive XYZ rotations, yaw/pitch/roll, and axes from a reference transform. The normal SSE matrix product reduces the first and fourth rows in pairs.',
        },
        {
          ids: [17, 38, 41],
          value: '2.6.1.63-own-warning-title-motion-calls-wrappers-and-authored-control',
        },
      ],
      signatures: [
        { ids: [1, 2, 5, 7, 9, 14, 16, 42], fields: { resultWritten: true } },
        { ids: [23, 26, 43, 44], fields: { resultWritten: false } },
        { ids: [17, 41], fields: { resultWritten: true } },
        { ids: [38], fields: { resultWritten: false } },
      ],
    },
    'particle-v1': {
      count: 44,
      slots: {
        unknown: [
          0, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 29, 32, 33, 37, 39, 40, 41,
          42, 43,
        ],
        recovered: [1, 2, 5, 6, 7, 22, 23, 24, 25, 26, 27, 28, 30, 31, 34, 35, 36, 38],
      },
      evidence: [
        {
          ids: [1, 2, 5, 6, 7, 22, 23, 24, 25, 26, 27, 28, 30, 31, 34, 35, 36, 38],
          value:
            'Own 2.6.1.63 Particle v1 and v2 pointers resolve to the same bodies in this image and both loading branches bind the same particle owner. Fixed v1 calls exercise their frame, numeric, quad, position, register and projection packets.',
        },
      ],
      signatures: [
        { ids: [1, 2, 6, 7, 34, 36], fields: { resultWritten: true } },
        { ids: [5, 22, 23, 24, 25, 26, 27, 28, 30, 31, 35, 38], fields: { resultWritten: false } },
      ],
    },
    'particle-v2': {
      count: 51,
      slots: {
        unknown: [
          0, 3, 4, 8, 9, 10, 11, 13, 14, 15, 17, 18, 20, 29, 32, 33, 37, 42, 43, 44, 45, 46, 47, 48,
        ],
        recovered: [
          1, 2, 5, 6, 7, 12, 16, 19, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 34, 35, 36, 38, 39, 40,
          41, 49, 50,
        ],
      },
      evidence: [
        {
          ids: [12, 41],
          value:
            'Own 2.6.1.63 Particle atan2 and interpolation are physical aliases of Main 397 and 318. The original x87 wrappers read two and five F32 words respectively and return the computed result word.',
        },
        {
          ids: [49],
          value:
            'Own 2.6.1.63 Particle attachment query starts with a zero vector and resolves the live position model through the render owner. The wrapper translates three output addresses, writes the position in order, and returns control 2.',
        },
        {
          ids: [21, 39, 40],
          value:
            'Own 2.6.1.63 Particle v2 integer absolute value preserves the most negative word. Visibility writes one raw DWORD at an unsigned in-range index. The highest index is the particle count minus one.',
        },
        {
          ids: [7, 16, 22, 23, 24, 38],
          value:
            '2.6.1.63 own Particle v2 cosine and remainder write float results. The three rotation wrappers update four 28-byte vertices. The projection wrapper writes four bounds from the inverse view at the bank priority and requested depth.',
        },
        {
          ids: [1, 2, 5, 6, 19, 25, 26, 27, 28, 30, 31, 34, 35, 36, 50],
          value: '2.6.1.63-own-title-particle-v2-wrappers-receiver-and-authored-control',
        },
      ],
      signatures: [
        { ids: [12, 41], fields: { resultWritten: true } },
        { ids: [49], fields: { resultWritten: false } },
        { ids: [21, 40], fields: { resultWritten: true } },
        { ids: [39], fields: { resultWritten: false } },
        { ids: [7, 16], fields: { resultWritten: true } },
        { ids: [22, 23, 24, 38], fields: { resultWritten: false } },
        {
          ids: [1, 2, 6, 19, 34, 36],
          fields: { resultWritten: true },
        },
      ],
    },
  },
  unreviewed: {
    'text.resourceMessages.first.utf8':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.controlBytes':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.missingIdPathFields':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.allowQuotedFesNames':
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
      nv: {
        size: 488,
        configSize: 408,
        packetSize: 456,
        bitmapAt: 420,
        dirtyAt: 424,
      },
      cp932: {
        size: 72,
        defaultAt: 208,
        configSize: 184,
      },
    },
  },
};
