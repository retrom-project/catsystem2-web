// SPDX-License-Identifier: MPL-2.0
// Candidate own normal data. Local registration only; no physical executable layouts.
const fesSoundReceivers = [173, 175, 176, 178, 179, 180, 183, 194, 199, 203, 204, 210, 211];
const soundReceivers = [...fesSoundReceivers, 188, 192];
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
    listEntryLiveCopy: true,
    plainParenthesisTokens: true,
    percentProduct: 'final-f32',
    settingsCharacterBytes: 1,
    pathBytes: 260,
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
        nv: null,
        cp932: 430,
        utf8: null,
      },
      clearCategory: false,
      maxOperation: 17,
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
  globalFile: { growthBytes: 524288 },
  math: { roundIntegerResult: 'int64-low-word' },
  stringBank: { emptyGetResult: 1 },
  database: { nullExportPolicy: 'reject-unwritten', nullImportPolicy: 'reject-unwritten' },
  sound: {
    banks: 32,
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
        raw: [],
        canonical: [],
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
    soundBaseOnly: [22],
    scriptForward: [9, 10, 22],
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
    controlResources: null,
  },
  graphics: {
    drawEnablePendingPolicy: 'rising-edge',
    textureCapsPolicy: 'virtual-d3d9',
    texturedBoundsQuery: null,
    coordinateModeRequiresGraph: true,
  },
  gallery: { listVariantWidth: 64 },
  scene: {
    translations: false,
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
          0, 2, 3, 4, 6, 7, 9, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 31, 33, 34,
          35, 37, 38, 39, 40, 43, 44, 45, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61,
          62, 63, 64, 65, 69, 70, 72, 73, 74, 75, 76, 77, 80, 81, 82, 83, 86, 87, 89, 90, 91, 94,
          95, 96, 97, 98, 99, 102, 103, 106, 107, 109, 110, 111, 112, 113, 114, 115, 116, 118, 119,
          120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137,
          138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155,
          156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173,
          174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191,
          192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 208, 214, 215,
          216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233,
          234, 235, 236, 237, 239, 241, 242, 243, 248, 249, 251, 252, 253, 255, 257, 258, 259, 261,
          263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 279, 280, 281, 282, 283,
          284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 296, 297, 298, 299, 300, 301, 302, 303,
          304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 320, 321, 322,
          334, 335, 336, 337, 339, 340, 341, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356,
          357, 358, 360, 361, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375,
          376, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391, 392, 394,
          395, 396, 397, 398, 399, 401, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
          415, 416, 417, 418, 426, 427, 428, 429, 430, 431, 432, 433, 439, 440, 441, 442, 443, 444,
          445, 446, 450, 451, 453, 454, 455, 456, 457, 460, 461, 462, 463, 464, 467, 468, 470, 471,
          472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489,
          490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505, 506, 507,
          508, 509, 510, 511, 512, 513, 514, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530,
          531, 532, 533, 534, 535, 536, 537, 538, 539, 541, 544, 545, 547, 548, 549, 551, 552, 553,
          554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571,
          572, 573, 574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 587, 588, 589, 598,
          599, 600, 601, 602, 603, 604, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615, 616, 617,
          618, 619, 620, 621, 622, 623, 624, 625, 626, 627, 628, 629, 631, 632, 633, 634, 635, 636,
          637, 638, 639, 640, 641, 642, 643, 644, 647, 648, 649, 650, 651, 653, 654, 655, 656, 657,
          658, 659, 660, 661, 662, 663, 664, 665, 666, 667, 668, 669, 670, 671, 672, 673, 674, 675,
          676, 677, 678, 679, 680, 681, 682, 686, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696,
          697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711, 712, 713, 714,
          715, 716, 717, 718, 719, 720, 721, 722, 723, 724, 725, 726, 727, 728, 729, 730, 731, 732,
          733, 734, 735, 736, 737, 738, 740, 742, 743, 744, 745, 746, 747, 748, 749, 750, 751, 752,
          753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766, 767, 768, 769, 770,
          771, 772, 773, 774, 775, 776, 777, 778, 779, 780, 781, 782, 783, 784, 785, 786, 787, 788,
          791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807, 808,
          809, 810, 811, 812, 813, 814, 815, 816, 817, 818, 819, 820, 821, 822, 823, 824, 825, 826,
          827, 828, 829, 830, 831, 832, 837, 838, 839, 840, 841, 842, 843, 844, 845, 846, 847, 850,
          851, 852, 853, 854, 855, 856, 857, 858, 859, 860, 861, 862, 871, 874, 875, 876, 877, 878,
          879, 880, 881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896,
          897, 898, 899, 900, 901, 902, 903, 904, 905, 906, 907, 909, 910, 911, 912, 913, 914, 915,
          916, 917, 918, 919, 920, 921, 922, 923, 924, 927, 928, 929, 930, 931, 932, 933, 934, 935,
          936, 937,
        ],
        reserved: [543, 546, 550, 652, 908, 926],
        'constant-zero': [925],
        recovered: [
          1, 5, 8, 13, 14, 15, 16, 25, 29, 30, 32, 36, 41, 42, 46, 47, 66, 67, 68, 71, 78, 79, 84,
          85, 88, 92, 93, 100, 101, 104, 105, 108, 117, 207, 209, 210, 211, 212, 213, 238, 240, 244,
          245, 246, 247, 250, 254, 256, 260, 262, 276, 277, 278, 294, 295, 319, 323, 324, 325, 326,
          327, 328, 329, 330, 331, 332, 333, 338, 342, 343, 344, 345, 359, 393, 400, 402, 419, 420,
          421, 422, 423, 424, 425, 434, 435, 436, 437, 438, 447, 448, 449, 452, 458, 459, 465, 466,
          469, 515, 516, 517, 518, 519, 540, 542, 586, 590, 591, 592, 593, 594, 595, 596, 597, 605,
          630, 645, 646, 683, 684, 685, 739, 741, 789, 790, 833, 834, 835, 836, 848, 849, 863, 864,
          865, 866, 867, 868, 869, 870, 872, 873,
        ],
      },
      evidence: [
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
          ids: [543, 546, 550, 652],
          value:
            '2.6.1.63 own Main table binds these authored startup calls to one no-op returning control 2 without writing a result.',
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
          ids: [908, 926],
          value:
            '2.6.1.63 own Main table binds the authored adjacent optional-animation calls to the same no-op entry returning control 2.',
        },
        {
          ids: [925],
          value:
            '2.6.1.63 own Main table binds this zero-argument optional-animation probe to an explicit zero writer returning control 1.',
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
        { ids: [42, 213, 319, 519, 540], fields: { resultWritten: true } },
        { ids: [46, 212, 278], fields: { resultWritten: false } },
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
        { ids: [925], fields: { resultWritten: true } },
        { ids: [343, 345], fields: { resultWritten: false } },
        { ids: [84, 85, 93, 101, 344, 402], fields: { resultWritten: false } },
        { ids: [78, 466], fields: { resultWritten: false } },
        { ids: [586], fields: { resultWritten: false } },
        { ids: [294], fields: { resultWritten: true } },
        { ids: [207, 295], fields: { resultWritten: false } },
        { ids: [741], fields: { resultWritten: true } },
        { ids: [5, 15, 419, 423, 424, 425, 594, 596, 597, 790], fields: { resultWritten: true } },
        { ids: [342, 420, 421, 422, 458, 459, 595, 739], fields: { resultWritten: false } },
        { ids: [646], fields: { resultWritten: true } },
        { ids: [630, 645], fields: { resultWritten: false } },
        {
          ids: [385],
          fields: {
            argumentWords: 4,
            parameters: [
              {
                name: 'arg0',
                description: 'Own four-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg1',
                description: 'Own four-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg2',
                description: 'Own four-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
              {
                name: 'arg3',
                description: 'Own four-word arity; semantic/type not admitted.',
                type: {
                  kind: 'unknown',
                },
              },
            ],
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
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25,
          26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 39, 40, 42, 43, 44,
        ],
        recovered: [17, 38, 41],
      },
      evidence: [
        {
          ids: [17, 38, 41],
          value: '2.6.1.63-own-warning-title-motion-calls-wrappers-and-authored-control',
        },
      ],
      signatures: [
        { ids: [17, 41], fields: { resultWritten: true } },
        { ids: [38], fields: { resultWritten: false } },
      ],
    },
    'particle-v1': {
      count: 44,
      slots: {
        unknown: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
          25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
        ],
      },
    },
    'particle-v2': {
      count: 51,
      slots: {
        unknown: [
          0, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 29, 32, 33, 37,
          38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
        ],
        recovered: [1, 2, 5, 6, 19, 25, 26, 27, 28, 30, 31, 34, 35, 36, 50],
      },
      evidence: [
        {
          ids: [1, 2, 5, 6, 19, 25, 26, 27, 28, 30, 31, 34, 35, 36, 50],
          value: '2.6.1.63-own-title-particle-v2-wrappers-receiver-and-authored-control',
        },
      ],
      signatures: [
        {
          ids: [1, 2, 6, 19, 34, 36],
          fields: { resultWritten: true },
        },
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
    'fes.controlResources':
      'Control skin/resource policy is unreviewed; require own evidence when a control task is actually constructed.',
  },
  layouts: {
    textCores: {
      cp932: {
        size: 72,
        defaultAt: 208,
        configSize: 184,
      },
    },
  },
};
