// SPDX-License-Identifier: MPL-2.0
// Own normal data; physical executable layouts belong to the explicit oracle.
export default {
  id: 'cs2-2.6.1.67',
  profile: 'bokutomo-engine-2.6.1.67',
  engineVersion: '2.6.1.67',
  xmlEncoding: 'Shift_JIS',
  text: {
    settingsCharacterBytes: 1,
    pathBytes: 260,
    configurationLayout: {
      fontBytes: 64,
      keyNameBytes: 32,
      keyStride: 36,
      bytes: 5592,
      encoding: 'CP932',
    },
    fesLayouts: null,
    layoutModes: null,
    resourceMessages: {
      first: {
        nv: null,
        cp932: null,
        utf8: null,
      },
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
  stringBank: { emptyGetResult: 0 },
  database: { nullExportPolicy: 'reject-unwritten' },
  sound: {
    banks: 32,
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
    allowQuotedFesNames: null,
    fesExtensions: null,
    fesLoadParameters: false,
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
          {
            min: 174,
            max: 174,
            offset: 5,
          },
          {
            min: 176,
            max: 176,
            offset: 5,
          },
          {
            min: 177,
            max: 177,
            offset: 5,
          },
          {
            min: 179,
            max: 179,
            offset: 5,
          },
          {
            min: 180,
            max: 180,
            offset: 5,
          },
          {
            min: 181,
            max: 181,
            offset: 5,
          },
          {
            min: 184,
            max: 184,
            offset: 5,
          },
          {
            min: 195,
            max: 195,
            offset: 5,
          },
          {
            min: 200,
            max: 200,
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
    soundBaseOnly: [22],
    scriptForward: [22],
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
    macroLiterals: {
      string: null,
      character: null,
    },
    controlResources: null,
  },
  graphics: {
    drawEnablePendingPolicy: 'rising-edge',
    textureCapsPolicy: 'virtual-d3d9',
    texturedBoundsQuery: null,
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
          0, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
          28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
          52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 69, 70, 72, 73, 74, 75, 76, 77,
          78, 80, 81, 82, 83, 84, 85, 86, 87, 89, 90, 91, 93, 94, 95, 96, 97, 98, 99, 101, 102, 103,
          106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 118, 119, 120, 121, 122, 123, 124,
          125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142,
          143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160,
          161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178,
          179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196,
          197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 210, 212, 213, 214, 215, 216,
          217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234,
          235, 236, 237, 239, 241, 242, 243, 248, 249, 250, 251, 252, 253, 254, 255, 257, 258, 259,
          261, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 278, 279, 280, 281,
          282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299,
          300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317,
          318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335,
          336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353,
          354, 355, 356, 357, 358, 360, 361, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372,
          373, 374, 375, 376, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390,
          391, 392, 394, 395, 396, 397, 398, 399, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410,
          411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428,
          429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439, 440, 441, 442, 443, 444, 445, 446,
          450, 451, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 466, 467, 468, 470,
          471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487, 488,
          489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505, 506,
          507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524,
          525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542,
          543, 544, 545, 546, 547, 548, 549, 550, 551, 552, 553, 554, 555, 556, 557, 558, 559, 560,
          561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573, 574, 575, 576, 577, 578,
          579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589, 594, 595, 596, 597, 598, 599, 600,
          601, 602, 603, 604, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615, 616, 617, 618, 619,
          620, 621, 622, 623, 624, 625, 626, 627, 628, 629, 630, 631, 632, 633, 634, 635, 636, 637,
          638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 650, 651, 652, 653, 654, 655,
          656, 657, 658, 659, 660, 661, 662, 663, 664, 665, 666, 667, 668, 669, 670, 671, 672, 673,
          674, 675, 676, 677, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691,
          692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708, 709,
          710, 711, 712, 713, 714, 715, 716, 717, 718, 719, 720, 721, 722, 723, 724, 725, 726, 727,
          728, 729, 730, 731, 732, 733, 734, 735, 736, 737, 738, 739, 740, 741, 742, 743, 744, 745,
          746, 747, 748, 749, 750, 751, 752, 753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763,
          764, 765, 766, 767, 768, 769, 770, 771, 772, 773, 774, 775, 776, 777, 778, 779, 780, 781,
          782, 783, 784, 785, 786, 787, 788, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799, 800,
          801, 802, 803, 804, 805, 806, 807, 808, 809, 810, 811, 812, 813, 814, 815, 816, 817, 818,
          819, 820, 821, 822, 823, 824, 825, 826, 827, 828, 829, 830, 831, 832, 836, 837, 838, 839,
          840, 841, 842, 843, 844, 845, 846, 847, 850, 851, 852, 853, 854, 855, 856, 857, 858, 859,
          860, 861, 862, 863, 864, 865, 866, 867, 868, 869, 871, 873, 874, 875, 876, 877, 878, 879,
          880, 881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897,
          898, 899, 900, 901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911, 912, 913, 914, 915,
          916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932, 933,
          934, 935, 936, 937,
        ],
        recovered: [
          1, 8, 13, 14, 36, 41, 66, 67, 68, 71, 79, 88, 92, 100, 104, 105, 117, 209, 211, 238, 240,
          244, 245, 246, 247, 256, 260, 262, 276, 277, 359, 393, 400, 447, 448, 449, 452, 465, 469,
          590, 591, 592, 593, 605, 789, 833, 834, 835, 848, 849, 870, 872,
        ],
      },
      evidence: [
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
        unknown: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25,
          26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 39, 40, 43, 44,
        ],
        recovered: [17, 38, 41, 42],
      },
      evidence: [
        {
          ids: [17, 38, 41, 42],
          value:
            '2.6.1.67 own wrapper/control/selected receiver and callback proof for startup -> flow -> title; closed entry checklist and per-wrapper captures retained in the ignored first-title evidence packet. Other slots stay unknown.',
        },
      ],
      signatures: [
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
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
          25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
          47, 48, 49, 50,
        ],
      },
    },
  },
  unreviewed: {
    'text.fesLayouts':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'text.layoutModes':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'text.resourceMessages.first.nv':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'text.resourceMessages.first.cp932':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'text.resourceMessages.first.utf8':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    layouts:
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.controlBytes':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.missingIdPathFields':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'sound.allowQuotedFesNames':
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
    'fes.macroLiterals.string':
      'Not admitted by the selected own first normal construction/three native wrappers; require own evidence at the actual consumer.',
    'fes.macroLiterals.character':
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
  layouts: null,
};
