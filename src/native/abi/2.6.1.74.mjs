// SPDX-License-Identifier: MPL-2.0
// Reviewed per-version declarations and script-visible behavior.
export default {
  id: 'cs2-2.6.1.74',
  profile: 'sdk-4.01-engine-2.6.1.74',
  engineVersion: '2.6.1.74',
  xmlEncoding: 'Shift_JIS',
  text: {
    freeTypeCharacterEncoding: 'cp932',
    freeTypeVersion: '2.4.8',
    settingsCharacterBytes: 1,
    fesNVFontWritesName: true,
    pathBytes: 260,
    recordingPrefix: {
      units: 'bytes',
      limit: 64,
    },
    configurationLayout: {
      encoding: 'CP932',
      fontBytes: 64,
      keyNameBytes: 32,
      keyStride: 36,
      bytes: 5592,
      ownerOffset: 53288,
    },
    fesLayouts: {
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
        nv: 463,
        cp932: 444,
        utf8: 444,
      },
      clearCategory: false,
      maxOperation: 18,
    },
  },
  configuration: {
    blockSizes: [5628, 60, 28, 12],
    memory: {
      layout: {
        settingsOffset: 528,
        font: 53288,
        blocks: [58880, 64508, 64568, 64596],
        systemVoice: 64608,
        first: 52320,
        second: 53188,
        virtualSize: 1050,
        sizes: 1056,
        noSkip: 46960,
        frameImage: 49336,
        authorMode: 47888,
        autoPresets: 47916,
        variableCount: 49600,
        variableRanges: 49604,
        alphaPercent: 47532,
        soundGroups: 47620,
        autoSelect: 67872,
        pathBytes: 260,
        texture: 46204,
        log: 48960,
      },
      scalarFields: [
        ['scene.textFrame', 47908, 4],
        ['screen.width', 52320, 2],
        ['screen.height', 52322, 2],
        ['screen.fullWidth', 52324, 2],
        ['screen.fullHeight', 52326, 2],
        ['screen.currentWidth', 52328, 2],
        ['screen.currentHeight', 52330, 2],
        ['screen.fullWide', 52332, 4],
        ['screen.limit', 52336, 4],
        ['screen.fps', 52340, 4],
        ['screen.cursorMode', 52344, 4],
        ['texture.bpp', 52348, 4],
        ['texture.min', 52352, 4],
        ['texture.mag', 52356, 4],
        ['texture.dither', 52360, 4],
        ['sound.use3d', 52364, 4],
        ['sound.sticky', 52368, 4],
        ['sound.stereo', 52372, 4],
        ['general.imageCache', 52376, 4],
        ['screen.screensaver', 52380, 4],
        ['screen.camouflage', 52384, 4],
        ['general.gdiCap', 52388, 4],
        ['general.z32', 52392, 4],
        ['general.useZ', 52396, 4],
        ['screen.outInfo', 52400, 4],
        ['general.cache', 52404, 4],
        ['screen.mode', 53188, 4],
        ['screen.fullscreen', 53192, 4],
        ['screen.bpp', 53196, 4],
        ['d3d.hardTnL', 53200, 4],
        ['d3d.backBuffer', 53204, 4],
        ['d3d.light', 53208, 4],
        ['d3d.vsync', 53212, 4],
        ['d3d.antialias', 53216, 4],
        ['d3d.fogType', 53220, 4],
        ['d3d.textureSize', 53224, 4],
        ['d3d.textureCompression', 53228, 4],
        ['general.dualCore', 53236, 4],
        ['general.disableMovie', 53240, 4],
        ['general.disablePixelShader', 53244, 4],
        ['screen.fullSize', 53248, 4],
        ['screen.fullPosition', 53252, 4],
        ['screen.multiWindowPosition', 53256, 4],
        ['screen.wall', 53260, 4],
        ['general.waitD3DCommand', 53264, 4],
        ['screen.noFullResolution', 53268, 4],
        ['screen.setMode', 52316, 4],
        ['configuration.type', 53280, 4],
        ['window.drag', 53284, 4],
        ['screen.virtualWidth', 1050, 2],
        ['screen.virtualHeight', 1052, 2],
        ['screen.noSkip', 46960, 4],
        ['scene.autoSelect', 67872, 4],
        ['scene.staticLog', 49064, 4],
        ['application.touch', 52044, 4],
        ['general.renderTargetCount', 47892, 4],
        ['log.type', 48960, 4],
        ['log.col', 48964, 4],
        ['log.prof', 48968, 4],
        ['log.nameline', 48972, 4],
        ['log.indent', 49040, 4],
        ['log.nameindent', 49044, 4],
        ['log.dispMes', 49048, 4],
        ['log.dispName', 49052, 4],
        ['log.space', 49056, 4],
        ['log.escape', 49060, 4],
        ['log.crNext', 49068, 4],
      ],
      autoSelectBytes: 4,
    },
    extendedPreferences: false,
    language: false,
    keyHide: false,
    windowActive: false,
    sceneAnimation: false,
    fontPreferenceLimit: null,
    extendedQueries: false,
  },
  sound: {
    banks: 32,
    controlBytes: 120,
    firstMessage: 177,
    lastMessage: 218,
    missingIdPathFields: ['volume', 'play', 'sysplay', 'voicevol'],
    allowQuotedFesNames: false,
    crossfade: false,
    delegateFrom: 219,
    fesExtensions: false,
    fesLoadParameters: false,
    completionFrame: true,
  },
  language: {
    storage: 'bytes',
    singleTable: true,
    fixedFilename: 'language.txt',
    resetOnReload: false,
    archiveFallback: false,
    switchWindowProtocol: false,
    dynamicMenus: false,
  },
  plugins: {
    emoteDriver: 'placeholder',
    requiredRenderer: false,
  },
  capabilities: {
    cubeFlipGridHeightProduct: false,
    bitmapColorQuery: false,
    nameTableAliases: false,
    embeddedJavaScript: true,
    steam: false,
    windowReturnTitle: false,
    broadcast: false,
    recordQueues: false,
    unicodeOutput: false,
    utf8Primitives: false,
    utf8Text: false,
    emoteFes: false,
    engineWorkers: false,
    windowsMediaReader: false,
    systemEntropy: true,
    inputNullText: true,
    taskDumpTopWriter: true,
  },
  startup: {
    resourceCheck: 'before-defaults',
    accelerators: 'ansi-resource',
  },
  fes: {
    configurationMessage: { liveObjects: false, notification: null, filenameComparison: null },
    controlResources: { scroll2Skin: 'state-direct' },
    fileList: { patternEncoding: 'cp932', keyEncoding: 'cp932' },
    macroLiterals: { string: 'unescape-quote', character: 'wrap-raw' },
    variableBankOffset: 1800,
    imageBlockOffset: 1500,
    imageIndexOffset: 1064,
    imageTaskOffset: 1512,
    textTaskWords: {
      21: 240,
      29: 297,
    },
    controls: {
      13: {
        size: 508,
        task: 492,
        value: 328,
        priority: 484,
      },
      14: {
        size: 564,
        task: 524,
        value: 364,
        priority: 520,
      },
      15: {
        size: 560,
        task: 520,
        value: 364,
        priority: 516,
      },
    },
    images: {
      1: {
        size: 680,
      },
      2: {
        size: 1512,
      },
      6: {
        size: 1788,
      },
      11: {
        size: 1524,
      },
      12: {
        size: 2076,
      },
      16: {
        size: 1520,
      },
      17: {
        size: 1520,
      },
      18: {
        size: 1516,
      },
      19: {
        size: 1516,
      },
      20: {
        size: 1516,
      },
      22: {
        size: 1512,
      },
      25: {
        size: 960,
      },
      wrapperBytes: 276,
    },
    planes: {
      3: {
        size: 740,
      },
      4: {
        size: 764,
      },
      5: {
        size: 44,
      },
      offset: 852,
    },
    effects: {
      objects: {
        26: {
          size: 76,
        },
        27: {
          size: 144,
        },
        30: {
          size: 92,
        },
        31: {
          size: 84,
        },
        32: {
          size: 88,
        },
      },
    },
  },
  graphics: {
    resizeRGB24: false,
    compositeWideBase: false,
    preserveRGB24: true,
    renderSources: {
      stride: 72,
      bytes: 276,
    },
    deviceField: null,
    synchronization: null,
    retainedBytes: 196,
    graphTypes: 188,
  },
  floatingPoint: {
    x87ControlWord: 127,
    mxcsr: 8064,
    precisionBits: 24,
    rounding: 'nearest',
    evidence: 'ordinary Direct3D9 initialization; docs/ppi-compatibility.md',
  },
  messages: {
    screenEvent: 21,
    root: {
      start: 30,
      captionWide: false,
      field: 392,
      soundReset: 192,
    },
    scriptBaseOnly: [30, 31],
    movieInput: {
      query: 32,
      gate: 141,
    },
    imageOwnerOffset: 5,
    taskDumpWrapper: 34,
    areaNonReceiver: 262,
    channels: {
      fesSound: {
        raw: [
          {
            min: null,
            max: null,
            offset: -2,
          },
        ],
      },
      fesControl: {
        canonical: [
          {
            min: 348,
            max: null,
            offset: 5,
          },
          {
            min: 37,
            max: null,
            offset: 2,
          },
        ],
      },
      fesImage: {
        canonical: [
          {
            min: 275,
            max: 275,
            offset: 5,
          },
          {
            min: 276,
            max: 276,
            offset: 5,
          },
          {
            min: 284,
            max: 284,
            offset: 5,
          },
          {
            min: 288,
            max: 288,
            offset: 5,
          },
          {
            min: 290,
            max: 290,
            offset: 5,
          },
          {
            min: 294,
            max: 294,
            offset: 5,
          },
          {
            min: 37,
            max: null,
            offset: 2,
          },
        ],
      },
      fesParticle: {
        canonical: [
          {
            min: 309,
            max: 316,
            offset: 5,
          },
        ],
      },
      fesText: {
        canonical: [
          {
            min: 444,
            max: null,
            offset: 5,
          },
          {
            min: 37,
            max: null,
            offset: 2,
          },
        ],
      },
      fesNvText: {
        canonical: [
          {
            min: 463,
            max: null,
            offset: 26,
          },
          {
            min: 37,
            max: null,
            offset: 2,
          },
        ],
      },
      window: {
        canonical: [
          {
            min: 156,
            max: 156,
            offset: 2,
          },
          {
            min: 160,
            max: 160,
            offset: 2,
          },
        ],
        raw: [
          {
            min: 158,
            max: 158,
            offset: -2,
          },
          {
            min: 162,
            max: 162,
            offset: -2,
          },
        ],
      },
      sound: {
        canonical: [
          {
            min: 177,
            max: 218,
            offset: 2,
          },
        ],
        raw: [
          {
            min: 179,
            max: 220,
            offset: -2,
          },
        ],
      },
      textLegacy: {
        raw: [
          {
            min: 37,
            max: null,
            offset: -2,
          },
        ],
      },
      drawCommand: {
        canonical: [
          {
            min: null,
            max: null,
            offset: 5,
          },
        ],
      },
      effectCommand: {
        canonical: [
          {
            min: 490,
            max: 497,
            offset: 26,
          },
          {
            min: null,
            max: null,
            offset: 5,
          },
        ],
      },
      areaCommand: {
        canonical: [
          {
            min: 252,
            max: null,
            offset: 5,
          },
        ],
      },
      particleCommand: {
        canonical: [
          {
            min: null,
            max: null,
            offset: 5,
          },
        ],
      },
      planeCommand: {
        canonical: [
          {
            min: null,
            max: null,
            offset: 2,
          },
        ],
      },
      base: {
        canonical: [
          {
            min: 37,
            max: null,
            offset: 2,
            exceptKinds: [1],
          },
        ],
        raw: [
          {
            min: 39,
            max: null,
            offset: -2,
          },
        ],
      },
      draw: {
        raw: [
          {
            min: null,
            max: null,
            offset: -2,
          },
        ],
      },
      control: {
        canonical: [
          {
            min: null,
            max: null,
            offset: 0,
            kinds: [1, 13],
          },
          {
            min: 267,
            max: null,
            offset: 5,
            kinds: [15],
          },
          {
            min: 326,
            max: null,
            offset: 5,
            kinds: [34],
          },
          {
            min: 348,
            max: null,
            offset: 5,
            kinds: [40],
          },
          {
            min: 363,
            max: null,
            offset: 5,
            kinds: [41],
          },
          {
            min: 354,
            max: null,
            offset: 5,
            kinds: [42],
          },
          {
            min: 444,
            max: null,
            offset: 5,
            kinds: [48],
          },
          {
            min: 463,
            max: null,
            offset: 26,
            kinds: [49],
          },
          {
            min: 37,
            max: null,
            offset: 2,
          },
        ],
        raw: [
          {
            min: 331,
            max: null,
            offset: -5,
            kinds: [34],
          },
          {
            min: 353,
            max: null,
            offset: -5,
            kinds: [40],
          },
          {
            min: 368,
            max: null,
            offset: -5,
            kinds: [41],
          },
          {
            min: 359,
            max: null,
            offset: -5,
            kinds: [42],
          },
          {
            min: 39,
            max: null,
            offset: -2,
          },
        ],
      },
      area: {
        canonical: [
          {
            min: 252,
            max: 273,
            offset: 5,
          },
          {
            min: 37,
            max: null,
            offset: 2,
          },
        ],
        raw: [
          {
            min: 257,
            max: 278,
            offset: -5,
          },
          {
            min: 39,
            max: null,
            offset: -2,
          },
        ],
      },
      screen: {
        canonical: [
          {
            min: null,
            max: null,
            offset: 0,
            kinds: [1],
          },
          {
            min: 490,
            max: 497,
            offset: 26,
            kinds: [35, 36, 37, 38, 39, 50, 51, 52, 57, 58],
          },
          {
            min: 372,
            max: 390,
            offset: 5,
            kinds: [35, 36, 37, 38, 39, 50, 51, 52, 57, 58],
          },
          {
            min: 37,
            max: null,
            offset: 2,
          },
        ],
        raw: [
          {
            min: 516,
            max: 523,
            offset: -26,
          },
          {
            min: 377,
            max: 395,
            offset: -5,
          },
          {
            min: 39,
            max: null,
            offset: -2,
          },
        ],
      },
    },
    tilePlaneCommand: 44,
  },
  layouts: {
    motionCheckpoint: {
      size: 1076,
      group: 36,
      registers: 40,
      nameBytes: 32,
      wide: false,
    },
    bitmapMemory: {
      wrapperBytes: 276,
    },
    configurationQuery: {
      archive: 3192,
      soundLoaded: 135236,
      soundParts: 135272,
      soundMaster: 135284,
      query24D: 48172,
    },
    desktop: {
      fields: 67464,
    },
    executableResources: {
      wide: false,
    },
    fileServer: {
      size: 79140,
    },
    memoryFile: {
      size: 288,
      data: 272,
      length: 276,
      wide: false,
    },
    languageBank: {
      size: 64,
    },
    preferences: {
      directory: 2672,
      filename: 260,
      wide: false,
    },
    engineImage: {
      settingsOffset: 528,
      ownerBootstrapOffsets: [67876, 135500],
      allocationWords: [1, 3],
    },
    startupApplication: {
      graphicsBytes: 84,
    },
    startupInstance: {
      nameOffset: 1088,
    },
    optionalMenuCommands: [
      [46104, 118],
      [47368, 40034],
    ],
    startupSound: {
      directory: 2672,
      base: 135236,
      wide: false,
    },
    startupWindow: {
      menuFlag: 48804,
      titleOffset: 828,
    },
    systemInformation: {
      size: 1408,
      memory: 1372,
      directX: 408,
      manufacturer: 860,
      model: 1116,
      cpu: {
        fields: 540,
      },
      wide: false,
    },
    windowClass: {
      suffix: 'A',
    },
    windowPump: {
      mask: 1279,
    },
    fesGallery: {
      listOffset: 1740,
    },
    rasterKernel: {
      copyMMX: 580,
    },
    renderer: {
      bitmap: 116,
      bits: 120,
    },
    sceneMemory: {
      readerBytes: 304,
      translations: null,
    },
    screenCapture: {
      recording: 132,
      counter: 136,
      prefix: 140,
    },
    scriptMessageBox: {
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
        defaultAt: 196,
        configSize: 184,
      },
    },
  },
  // Explicit slot registration and differences from the shared semantic catalog.
  tables: {
    main: {
      count: 1009,
      slots: {
        recovered: [
          1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
          27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
          49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 74, 75, 76, 77, 81,
          95, 107, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126,
          127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 142, 143, 144, 145,
          146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163,
          164, 165, 166, 167, 168, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204,
          205, 206, 207, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223,
          224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 237, 238, 239, 240, 241, 242,
          243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 265, 266, 267, 268, 269,
          270, 271, 272, 273, 274, 275, 276, 277, 278, 284, 285, 286, 294, 295, 296, 297, 298, 299,
          300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317,
          318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335,
          336, 337, 338, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356, 357,
          358, 359, 360, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376,
          377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391, 392, 394, 395,
          396, 397, 398, 399, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
          415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 430, 431, 433, 434, 435,
          436, 437, 438, 440, 441, 444, 445, 446, 456, 458, 459, 460, 461, 464, 465, 466, 468, 469,
          470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487,
          488, 489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505,
          506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523,
          524, 525, 526, 527, 528, 529, 530, 531, 532, 535, 536, 537, 538, 539, 540, 541, 542, 549,
          557, 558, 564, 565, 566, 567, 568, 569, 570, 571, 572, 577, 582, 583, 584, 586, 587, 588,
          589, 590, 591, 592, 593, 594, 595, 596, 597, 598, 602, 603, 604, 605, 606, 607, 608, 609,
          610, 611, 612, 613, 614, 615, 616, 617, 618, 619, 620, 621, 622, 623, 624, 625, 628, 630,
          631, 632, 633, 634, 635, 636, 637, 638, 639, 640, 641, 645, 646, 647, 649, 650, 651, 653,
          654, 655, 658, 659, 664, 665, 666, 667, 668, 674, 675, 676, 677, 678, 679, 680, 681, 683,
          684, 685, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708,
          709, 710, 711, 712, 713, 714, 715, 716, 717, 718, 719, 720, 721, 722, 723, 724, 725, 726,
          727, 728, 729, 730, 731, 732, 733, 734, 735, 736, 737, 738, 739, 740, 741, 742, 743, 744,
          745, 746, 747, 748, 749, 750, 751, 752, 753, 754, 755, 756, 757, 758, 759, 760, 761, 762,
          763, 764, 765, 766, 767, 768, 769, 770, 771, 772, 773, 774, 775, 776, 777, 778, 779, 780,
          781, 782, 783, 784, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798,
          799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809, 810, 811, 812, 813, 814, 815, 816,
          817, 818, 819, 820, 821, 822, 823, 824, 825, 826, 827, 828, 829, 830, 831, 832, 833, 834,
          835, 836, 844, 845, 846, 847, 850, 851, 852, 853, 854, 855, 856, 857, 858, 859, 860, 861,
          863, 864, 865, 866, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876, 877, 878, 879, 880,
          881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898,
          899, 900, 901, 902, 903, 904, 905, 934, 935, 936, 937, 938, 939, 940, 941, 942, 943, 944,
          945, 946, 947, 948, 949, 950, 951, 952, 953, 954, 955, 956, 957, 958, 959, 960, 961, 962,
          963, 964, 967, 968, 969, 970, 971, 972, 974, 975, 976, 977, 978, 979, 980, 981, 982, 988,
          989, 990, 991, 992, 993, 994, 995, 996, 997, 998, 999, 1000, 1001, 1002, 1006,
        ],
        reserved: [
          0, 2, 3, 141, 169, 170, 172, 173, 180, 182, 184, 185, 187, 188, 189, 190, 191, 429, 439,
          543, 544, 545, 546, 547, 548, 550, 552, 553, 556, 559, 560, 561, 562, 563, 573, 574, 578,
          579, 581, 626, 627, 642, 643, 644, 652, 656, 660, 661, 670, 671, 672, 673, 686, 687, 906,
          907, 908, 910, 911, 912, 913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 926,
          927, 928, 929, 930, 931, 932, 933, 965, 966,
        ],
        'constant-zero': [
          171, 174, 175, 176, 177, 178, 179, 181, 183, 186, 236, 432, 551, 554, 555, 575, 580, 909,
          925,
        ],
        unknown: [
          66, 67, 68, 69, 70, 71, 72, 73, 78, 79, 80, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92,
          93, 94, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 108, 109, 110, 208, 256, 257,
          258, 259, 260, 261, 262, 263, 264, 279, 280, 281, 282, 283, 287, 288, 289, 290, 291, 292,
          293, 339, 340, 341, 342, 361, 393, 400, 428, 442, 443, 447, 448, 449, 450, 451, 452, 453,
          454, 455, 457, 462, 463, 467, 533, 534, 576, 585, 599, 600, 601, 629, 648, 657, 662, 663,
          669, 682, 688, 689, 690, 691, 692, 837, 838, 839, 840, 841, 842, 843, 848, 849, 862, 973,
          983, 984, 985, 986, 987, 1003, 1004, 1005, 1007, 1008,
        ],
      },
      signatures: [
        {
          ids: [1],
          fields: {
            review: 'needs-review',
            reviewReason:
              'SDK body confirms semantic, argument width and control; independent normal execution still requires debug-window transport and original formatter.',
          },
        },
        {
          ids: [6],
          fields: {
            result: {
              bits: 32,
              description: 'u32',
              kind: 'bits',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [9],
          fields: {
            review: 'needs-review',
            reviewReason:
              'SDK body confirms semantic, argument width and control; independent normal execution still requires window action transport.',
          },
        },
        {
          ids: [10],
          fields: {
            review: 'needs-review',
            reviewReason:
              'SDK body confirms semantic, argument width and control; independent normal execution still requires ANSI clipboard transport.',
          },
        },
        {
          ids: [11],
          fields: {
            review: 'needs-review',
            reviewReason:
              'SDK body confirms semantic, argument width and control; independent normal execution still requires controlled local-time provider.',
          },
        },
        {
          ids: [27],
          fields: {
            result: {
              addressSpace: 'vm',
              description: 'VMptr',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
            resultWritten: true,
            review: 'needs-review',
            reviewReason:
              'SDK body confirms semantic, argument width and control; independent normal execution still requires complete original VM allocation container.',
          },
        },
        {
          ids: [28],
          fields: {
            parameters: [
              {
                description: 'VMptr block',
                name: 'block',
                type: {
                  addressSpace: 'vm',
                  direction: 'unknown',
                  kind: 'pointer',
                  target: {
                    kind: 'unknown',
                  },
                },
              },
            ],
            resultWritten: true,
            review: 'needs-review',
            reviewReason:
              'SDK body confirms semantic, argument width and control; independent normal execution still requires complete original VM allocation container.',
          },
        },
        {
          ids: [
            29, 32, 219, 220, 221, 222, 225, 226, 229, 230, 231, 232, 233, 234, 235, 239, 240, 242,
            243, 245, 247, 248, 249, 250, 252, 253, 254, 255, 276, 277, 278, 322, 323, 324, 325,
            326, 327, 330, 331, 334, 335, 336, 337, 338, 385, 386, 419, 420, 421, 422, 423, 424,
            425, 458, 459, 608, 609, 610, 978, 979, 980, 981, 982, 990, 993,
          ],
          fields: {
            review: 'recovered',
          },
        },
        {
          ids: [30, 31],
          fields: {
            result: {
              bits: 32,
              description: 'u32 bytes',
              kind: 'integer',
              signed: false,
              unit: 'byte-count',
            },
            resultWritten: true,
            review: 'needs-review',
            reviewReason:
              'SDK body confirms semantic, argument width and control; independent normal execution still requires live original file manager.',
          },
        },
        {
          ids: [33, 34, 40, 42, 47, 48],
          fields: {
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [35, 36, 37, 41, 43, 44, 45, 65],
          fields: {
            review: 'reviewed',
          },
        },
        {
          ids: [38, 39],
          fields: {
            result: {
              bits: 32,
              description: 'u32 bytes',
              kind: 'integer',
              signed: false,
              unit: 'byte-count',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [49],
          fields: {
            result: {
              bits: 32,
              description: 'u32 byteOffset',
              kind: 'integer',
              signed: false,
              unit: 'byte-offset',
            },
            resultWritten: true,
            review: 'reviewed',
          },
        },
        {
          ids: [593],
          fields: {
            parameters: [
              {
                description: 'handle document',
                name: 'document',
                type: {
                  handleKind: 'xml-document',
                  kind: 'handle',
                  ownership: 'unknown',
                },
              },
              {
                description: 'char* inOutDefault',
                name: 'inOutDefault',
                type: {
                  addressSpace: 'vm',
                  direction: 'out',
                  kind: 'pointer',
                  target: {
                    bits: 8,
                    encoding: 'CP932',
                    kind: 'character',
                  },
                  writePolicy: 'conditional',
                },
              },
              {
                description: 'format* path',
                name: 'path',
                type: {
                  addressSpace: 'unknown',
                  direction: 'unknown',
                  kind: 'pointer',
                  target: {
                    encoding: 'unknown',
                    kind: 'format-string',
                  },
                },
              },
            ],
          },
        },
      ],
      observedArgumentWords: [
        {
          ids: [
            0, 2, 3, 7, 12, 18, 20, 22, 24, 26, 52, 53, 55, 56, 58, 59, 60, 64, 74, 75, 77, 82, 89,
            90, 91, 96, 97, 98, 99, 102, 103, 107, 110, 120, 121, 122, 123, 126, 127, 128, 129, 130,
            131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 144, 145, 146, 147, 148,
            151, 152, 153, 154, 155, 162, 164, 165, 166, 167, 169, 170, 171, 172, 173, 174, 175,
            176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192,
            193, 194, 195, 198, 199, 202, 205, 208, 214, 215, 216, 217, 223, 224, 227, 228, 236,
            237, 251, 259, 264, 289, 290, 291, 292, 293, 297, 300, 303, 305, 306, 309, 312, 321,
            349, 350, 351, 352, 353, 354, 355, 356, 357, 360, 361, 370, 371, 374, 375, 376, 377,
            378, 379, 380, 381, 382, 383, 384, 391, 395, 396, 401, 403, 405, 406, 407, 408, 409,
            410, 411, 412, 413, 414, 415, 416, 428, 429, 430, 431, 432, 442, 443, 444, 446, 456,
            457, 460, 462, 463, 467, 468, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480,
            481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 495, 496, 497,
            498, 499, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 525,
            526, 529, 532, 533, 537, 538, 553, 558, 564, 569, 574, 582, 583, 584, 585, 587, 588,
            589, 599, 602, 603, 616, 618, 622, 623, 624, 626, 627, 631, 632, 637, 638, 641, 648,
            650, 656, 657, 658, 659, 660, 661, 662, 663, 664, 665, 666, 667, 668, 669, 675, 676,
            677, 678, 679, 680, 682, 695, 698, 703, 704, 705, 706, 707, 708, 709, 716, 721, 722,
            725, 729, 731, 734, 738, 742, 743, 744, 745, 746, 747, 748, 749, 750, 751, 752, 753,
            754, 755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766, 767, 768, 769, 770,
            771, 772, 773, 774, 775, 776, 777, 778, 779, 780, 781, 782, 783, 784, 791, 792, 793,
            794, 795, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809, 810,
            811, 812, 813, 814, 815, 816, 817, 818, 819, 820, 821, 822, 823, 824, 825, 826, 827,
            828, 829, 830, 831, 832, 837, 838, 839, 840, 841, 842, 843, 883, 884, 888, 893, 897,
            912, 915, 919, 920, 922, 923, 935, 940, 941, 945, 949, 951, 952, 953, 954, 955, 958,
            959, 961, 962, 969, 973, 983, 984, 985, 986, 987, 996, 997, 1003, 1004, 1005, 1007,
            1008,
          ],
          value: [],
        },
        {
          ids: [
            1, 6, 9, 10, 17, 25, 27, 28, 32, 40, 47, 48, 50, 51, 54, 57, 62, 63, 67, 71, 80, 83,
            109, 111, 114, 118, 125, 156, 158, 159, 160, 197, 200, 203, 207, 209, 210, 212, 213,
            220, 234, 235, 238, 246, 247, 248, 261, 265, 267, 268, 269, 270, 272, 273, 274, 278,
            279, 283, 285, 287, 295, 296, 311, 314, 315, 317, 319, 322, 324, 330, 331, 340, 341,
            342, 365, 366, 389, 390, 393, 420, 421, 437, 440, 445, 448, 452, 453, 454, 461, 516,
            520, 549, 570, 572, 577, 581, 590, 591, 594, 595, 601, 605, 606, 607, 608, 615, 617,
            628, 633, 634, 651, 673, 681, 683, 684, 691, 697, 702, 710, 711, 833, 834, 844, 854,
            858, 864, 867, 870, 876, 877, 878, 886, 889, 890, 895, 898, 899, 908, 909, 930, 943,
            944, 946, 947, 948, 950, 956, 957, 960, 963, 964, 970, 980, 982, 989, 990, 995, 998,
            1000, 1001,
          ],
          value: [1],
        },
        {
          ids: [
            4, 5, 33, 34, 65, 68, 76, 113, 219, 225, 226, 286, 294, 323, 404, 419, 434, 436, 438,
            465, 515, 542, 565, 566, 609, 610, 696, 741, 789, 845, 846, 847, 852, 885, 894, 925,
            932, 933, 937, 938, 939, 942, 999,
          ],
          value: [0],
        },
        {
          ids: [
            8, 13, 14, 15, 16, 19, 21, 23, 29, 46, 49, 61, 81, 88, 92, 94, 95, 105, 106, 108, 112,
            124, 149, 157, 161, 196, 211, 221, 243, 245, 252, 253, 258, 262, 266, 275, 276, 277,
            280, 281, 282, 284, 288, 298, 308, 310, 313, 316, 320, 325, 332, 338, 348, 358, 364,
            369, 392, 394, 397, 400, 402, 417, 422, 423, 426, 427, 439, 447, 449, 450, 451, 455,
            458, 464, 466, 469, 514, 518, 522, 524, 528, 531, 534, 540, 545, 546, 547, 548, 551,
            554, 555, 557, 567, 568, 571, 573, 580, 586, 598, 611, 612, 613, 614, 619, 620, 635,
            636, 646, 647, 653, 655, 670, 674, 687, 690, 694, 701, 723, 727, 728, 733, 737, 739,
            740, 785, 848, 849, 855, 857, 861, 863, 865, 866, 868, 872, 873, 874, 891, 892, 900,
            901, 903, 904, 907, 911, 913, 914, 916, 918, 921, 926, 927, 928, 929, 931, 966, 968,
            972, 974, 975, 978, 979, 981, 988, 993, 1002, 1006,
          ],
          value: [2],
        },
        {
          ids: [11, 104, 304, 399, 536, 578, 724, 856, 967],
          value: [7],
        },
        {
          ids: [
            30, 31, 38, 39, 44, 45, 69, 70, 72, 73, 79, 85, 86, 168, 204, 206, 229, 230, 233, 244,
            249, 250, 254, 327, 333, 336, 337, 347, 359, 386, 388, 418, 527, 541, 544, 630, 640,
            699, 713, 787, 790, 835, 869, 880, 965, 976, 992,
          ],
          value: [4],
        },
        {
          ids: [
            35, 36, 37, 41, 42, 43, 66, 78, 100, 119, 143, 150, 163, 201, 222, 231, 232, 241, 242,
            256, 260, 263, 307, 326, 328, 329, 343, 344, 346, 362, 363, 368, 372, 373, 387, 424,
            425, 435, 441, 459, 517, 519, 539, 543, 550, 552, 556, 559, 562, 563, 575, 576, 579,
            592, 593, 600, 621, 625, 629, 639, 645, 649, 652, 654, 686, 688, 689, 692, 700, 712,
            714, 715, 717, 718, 719, 720, 726, 730, 786, 836, 850, 851, 859, 871, 875, 879, 881,
            882, 887, 896, 902, 906, 917, 924, 934, 991, 994,
          ],
          value: [3],
        },
        {
          ids: [
            84, 87, 93, 101, 218, 239, 240, 318, 334, 335, 345, 385, 433, 530, 560, 561, 596, 597,
            604, 642, 643, 671, 672, 685, 788, 862, 905, 910,
          ],
          value: [5],
        },
        {
          ids: [115, 116, 299, 301, 302, 367, 523, 735, 971],
          value: [10],
        },
        {
          ids: [117, 255, 271, 339, 644, 693, 736, 853, 936],
          value: [6],
        },
        {
          ids: [257, 732],
          value: [13],
        },
        {
          ids: [398],
          value: [12],
        },
        {
          ids: [521, 535, 860, 977],
          value: [8],
        },
      ],
      evidence: [
        {
          ids: [1, 9, 10, 11, 27, 28, 30, 31],
          value:
            'reviewed-SDK-2.6.1.74-table-and-wrapper-body; normal host/allocator execution pending; see docs/native-standard-review.md',
        },
        {
          ids: [
            4, 5, 7, 8, 12, 74, 75, 76, 77, 81, 95, 107, 111, 112, 113, 114, 115, 116, 117, 118,
            119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
            136, 137, 138, 139, 140, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153,
            154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 192, 193,
            194, 195, 204, 205, 206, 207, 214, 215, 216, 217, 218, 237, 238, 241, 244, 246, 251,
            265, 266, 267, 268, 269, 270, 284, 285, 286, 294, 295, 296, 297, 298, 299, 300, 301,
            302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318,
            319, 320, 321, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356,
            357, 358, 359, 360, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374,
            375, 376, 377, 378, 379, 380, 381, 382, 383, 384, 387, 388, 389, 390, 391, 392, 394,
            395, 396, 397, 398, 399, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412,
            413, 414, 415, 416, 417, 418, 430, 431, 433, 434, 435, 436, 437, 438, 440, 441, 444,
            445, 446, 456, 460, 461, 464, 465, 466, 468, 469, 470, 471, 472, 473, 474, 475, 476,
            477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493,
            494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510,
            511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527,
            528, 529, 530, 531, 532, 535, 536, 537, 538, 539, 540, 541, 542, 549, 557, 558, 564,
            565, 566, 567, 568, 569, 570, 571, 572, 577, 582, 583, 584, 586, 587, 588, 589, 594,
            595, 596, 597, 598, 602, 603, 604, 605, 606, 607, 611, 612, 613, 614, 615, 616, 617,
            618, 619, 620, 621, 622, 623, 624, 625, 628, 630, 631, 632, 641, 645, 646, 647, 649,
            650, 651, 653, 654, 655, 658, 659, 664, 665, 666, 667, 668, 674, 675, 676, 677, 678,
            679, 680, 681, 683, 684, 685, 694, 695, 696, 697, 698, 699, 700, 703, 704, 705, 706,
            707, 708, 709, 710, 711, 712, 713, 714, 715, 716, 717, 718, 719, 720, 721, 722, 723,
            724, 725, 726, 727, 728, 729, 730, 731, 732, 733, 734, 735, 736, 737, 738, 739, 740,
            741, 742, 743, 744, 745, 746, 747, 748, 749, 750, 751, 752, 753, 754, 755, 756, 757,
            758, 759, 760, 761, 762, 763, 764, 765, 766, 767, 768, 769, 770, 771, 772, 773, 774,
            775, 776, 777, 778, 779, 780, 781, 782, 783, 784, 785, 786, 787, 788, 789, 790, 791,
            792, 793, 794, 795, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807, 808,
            809, 810, 811, 812, 813, 814, 815, 816, 817, 818, 819, 820, 821, 822, 823, 824, 825,
            826, 827, 828, 829, 830, 831, 832, 833, 834, 835, 836, 844, 845, 846, 847, 850, 851,
            852, 853, 854, 855, 856, 857, 858, 859, 860, 861, 863, 864, 865, 866, 867, 868, 869,
            870, 871, 872, 873, 874, 875, 876, 877, 878, 879, 880, 881, 882, 883, 884, 885, 886,
            887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 899, 900, 901, 902, 903,
            904, 905, 935, 936, 937, 938, 939, 940, 941, 942, 943, 944, 945, 946, 947, 948, 949,
            950, 951, 952, 953, 954, 955, 956, 957, 958, 959, 960, 961, 962, 963, 964, 967, 968,
            969, 970, 971, 972, 977, 991, 992, 994, 995, 996, 997, 998, 999, 1000, 1001, 1002,
          ],
          value: 'pinned-2.6.1.74-wrapper-and-subsystem-contract',
        },
        {
          ids: [6, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 65],
          value:
            'reviewed-SDK-2.6.1.74-table-wrapper-body-and-authored-GCALL; see docs/native-standard-review.md',
        },
        {
          ids: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 46],
          value: 'both-pinned-original-basic-string-wrappers-and-full-memory-differential',
        },
        {
          ids: [
            29, 32, 219, 220, 221, 222, 225, 226, 229, 230, 231, 232, 233, 234, 235, 239, 240, 242,
            243, 245, 247, 248, 249, 250, 252, 253, 254, 255, 276, 277, 278, 322, 323, 324, 325,
            326, 327, 330, 331, 334, 335, 336, 337, 338, 385, 386, 419, 420, 421, 422, 423, 424,
            425, 458, 459, 608, 609, 610, 978, 979, 980, 981, 982, 990, 993,
          ],
          value:
            'reviewed-SDK-2.6.1.74-main-table-wrapper-body-and-normal-JS-dispatch; docs/native-domain4-review.md',
        },
        {
          ids: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64],
          value: 'both-pinned-scalar-wrappers-and-28524-full-fpu-differential-comparisons',
        },
        {
          ids: [196, 197, 198, 199, 200, 201, 202, 203],
          value: 'both-pinned-area-effect-wrappers-and-native-receiver-browser-tests',
        },
        {
          ids: [209, 210, 211, 212, 213],
          value: 'both-pinned-variable-primitive-wrappers-and-27892-differential-comparisons',
        },
        {
          ids: [223, 328],
          value: 'both-pinned-original-seen-mark-wrappers-and-raw-history-differential',
        },
        {
          ids: [224, 228, 329, 333],
          value: 'both-pinned-original-scene-path-wrappers-and-raw-history-differential',
        },
        {
          ids: [227, 332],
          value: 'both-pinned-original-seen-query-wrappers-and-raw-history-differential',
        },
        {
          ids: [271, 272, 273, 274, 275, 426, 427, 693],
          value: 'both-pinned-particle-wrappers-and-original-receiver-tests',
        },
        {
          ids: [590, 591, 592, 593],
          value: 'both-pinned-original-xml-wrappers-and-fresh-world-ownership',
        },
        {
          ids: [633, 634, 635, 636, 637, 638, 639, 640],
          value: 'both-pinned-original-name-table-wrappers-and-15684-differential-comparisons',
        },
        {
          ids: [701, 702, 988, 989],
          value: 'both-pinned-plane-movie-wrappers-and-rendered-filtergraph-browser-tests',
        },
        {
          ids: [934],
          value: 'both-pinned-original-scene-alias-wrappers-and-raw-history-differential',
        },
        {
          ids: [974, 975, 976, 1006],
          value: 'pinned-sdk-javascript-wrappers-and-original-kcs-v8-world-test',
        },
      ],
      migrationReview: [
        {
          ids: [241, 251, 611, 612, 613, 614, 615, 616, 617, 618, 619, 620, 621, 695, 884],
          value: {
            decision: 'js-owned-inputs',
            evidence: 'docs/native-domain5-review.md',
            phase: 5,
          },
        },
      ],
    },
    generic: {
      count: 45,
      slots: {
        recovered: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
          25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
        ],
      },
      evidence: [
        {
          ids: [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
          ],
          value: 'both-pinned-generic-wrappers-and-2160-native-differential-cases',
        },
      ],
    },
    'particle-v1': {
      count: 44,
      slots: {
        declared: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
          25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
        ],
      },
      evidence: [
        {
          ids: [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
          ],
          value: 'sdk-4.01-header-and-pinned-game-wrapper',
        },
      ],
    },
    'particle-v2': {
      count: 51,
      slots: {
        declared: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
          25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
          47, 48, 49, 50,
        ],
      },
      evidence: [
        {
          ids: [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
            46, 47, 48, 49, 50,
          ],
          value: 'sdk-4.01-header-and-pinned-game-wrapper',
        },
      ],
    },
  },
};
