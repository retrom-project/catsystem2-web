// SPDX-License-Identifier: MPL-2.0
// Reviewed table/ID semantics. Presence here never enables a profile slot.
export const NATIVE_SEMANTICS = freeze({
  main: {
    1: {
      name: 'debug.print',
      family: 'debug',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    4: {
      name: 'clock.milliseconds',
      family: 'clock',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    5: {
      name: 'task.clock',
      family: 'task',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    6: {
      name: 'word.identity',
      family: 'word',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    7: {
      name: 'task.frameRate',
      family: 'task',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    8: {
      name: 'view.dimensions',
      family: 'view',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr width',
            name: 'width',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr height',
            name: 'height',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    9: {
      name: 'application.exit',
      family: 'application',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'bool closeWindow',
            name: 'closeWindow',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    10: {
      name: 'clipboard.copy',
      family: 'clipboard',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    11: {
      name: 'clock.localDate',
      family: 'clock',
      signature: {
        argumentWords: 7,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32* year',
            name: 'year',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* month',
            name: 'month',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* weekday',
            name: 'weekday',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* day',
            name: 'day',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* hour',
            name: 'hour',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* minute',
            name: 'minute',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* second',
            name: 'second',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    12: {
      name: 'view.setCameraNear',
      family: 'view',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'f32 distance',
            name: 'distance',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    13: {
      name: 'string.copy',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'bytes',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'vm',
              direction: 'in',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'bytes',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          addressSpace: 'vm',
          description: 'pointer',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            bits: 8,
            encoding: 'bytes',
            kind: 'character',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    14: {
      name: 'string.copyFormatted',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'format* source',
            name: 'source',
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
        result: {
          addressSpace: 'unknown',
          description: 'pointer',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            kind: 'unknown',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    15: {
      name: 'string.append',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'inout',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'bytes',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'vm',
              direction: 'in',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'bytes',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          addressSpace: 'vm',
          description: 'pointer',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            bits: 8,
            encoding: 'bytes',
            kind: 'character',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    16: {
      name: 'string.appendFormatted',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'format* source',
            name: 'source',
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
        result: {
          addressSpace: 'unknown',
          description: 'pointer',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            kind: 'unknown',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    17: {
      name: 'string.byteLength',
      family: 'string',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* text',
            name: 'text',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    18: {
      name: 'string.formattedByteLength',
      family: 'string',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    19: {
      name: 'string.compareReverse',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* first',
            name: 'first',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* second',
            name: 'second',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    20: {
      name: 'string.compareFormatted',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* first',
            name: 'first',
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
          {
            description: 'format* second',
            name: 'second',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    21: {
      name: 'string.compareReverseIgnoreCase',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* first',
            name: 'first',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* second',
            name: 'second',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    22: {
      name: 'string.compareFormattedIgnoreCase',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* first',
            name: 'first',
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
          {
            description: 'format* second',
            name: 'second',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    23: {
      name: 'string.truncateBytes',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* text',
            name: 'text',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'u32 byteLimit',
            name: 'byteLimit',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    24: {
      name: 'string.truncateCharacters',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* text',
            name: 'text',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'u32 characters',
            name: 'characters',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    25: {
      name: 'number.parseInteger',
      family: 'number',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    26: {
      name: 'number.parseFloat',
      family: 'number',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    27: {
      name: 'memory.allocate',
      family: 'memory',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          addressSpace: 'vm',
          description: 'pointer',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            kind: 'unknown',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    28: {
      name: 'memory.free',
      family: 'memory',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'pointer block',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    29: {
      name: 'file.open',
      family: 'file',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
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
          {
            description: 'format* mode',
            name: 'mode',
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
        result: {
          description: 'handle',
          handleKind: 'file',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    30: {
      name: 'file.read',
      family: 'file',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'byte* destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'out',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32 size',
            name: 'size',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'handle file',
            name: 'file',
            type: {
              handleKind: 'file',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
          unit: 'byte-count',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    31: {
      name: 'file.write',
      family: 'file',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'byte* source',
            name: 'source',
            type: {
              addressSpace: 'vm',
              direction: 'in',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32 size',
            name: 'size',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'handle file',
            name: 'file',
            type: {
              handleKind: 'file',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
          unit: 'byte-count',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    32: {
      name: 'file.close',
      family: 'file',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle file',
            name: 'file',
            type: {
              handleKind: 'file',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    33: {
      name: 'random.integer',
      family: 'random',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    34: {
      name: 'random.float',
      family: 'random',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    35: {
      name: 'memory.copy',
      family: 'memory',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'byte* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'byte* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    36: {
      name: 'memory.fill',
      family: 'memory',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'byte* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32 byteValue',
            name: 'byteValue',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    37: {
      name: 'number.formatThousands',
      family: 'number',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'i32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'bool showPlus',
            name: 'showPlus',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    38: {
      name: 'string.copyUntilSeparator',
      family: 'string',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* separators',
            name: 'separators',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'u32 capacity',
            name: 'capacity',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
          unit: 'byte-count',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    39: {
      name: 'string.copyFormattedUntilSeparator',
      family: 'string',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'format* source',
            name: 'source',
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
          {
            description: 'char* separators',
            name: 'separators',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'u32 capacity',
            name: 'capacity',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
          unit: 'byte-count',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    40: {
      name: 'string.isDoubleByte',
      family: 'string',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* text',
            name: 'text',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    41: {
      name: 'list.split',
      family: 'list',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'byte* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* separators',
            name: 'separators',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    42: {
      name: 'list.select',
      family: 'list',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'byte* list',
            name: 'list',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'i32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    43: {
      name: 'list.splitGroups',
      family: 'list',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'byte* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* separators',
            name: 'separators',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    44: {
      name: 'list.join',
      family: 'list',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'byte* list',
            name: 'list',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'i32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 last',
            name: 'last',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    45: {
      name: 'string.replace',
      family: 'string',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* needle',
            name: 'needle',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* replacement',
            name: 'replacement',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    46: {
      name: 'number.resolvePercentage',
      family: 'number',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* text',
            name: 'text',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'u32 base',
            name: 'base',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    47: {
      name: 'string.characterLength',
      family: 'string',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* text',
            name: 'text',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    48: {
      name: 'string.formattedCharacterLength',
      family: 'string',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    49: {
      name: 'string.findAtCharacterBoundary',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* text',
            name: 'text',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'char* needle',
            name: 'needle',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
          unit: 'byte-offset',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    50: {
      name: 'math.sin',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 radians',
            name: 'radians',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    51: {
      name: 'math.cos',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 radians',
            name: 'radians',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    52: {
      name: 'math.tan',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 radians',
            name: 'radians',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    53: {
      name: 'math.asin',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    54: {
      name: 'math.acos',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    55: {
      name: 'math.atan',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    56: {
      name: 'math.ceil',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    57: {
      name: 'math.abs',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    58: {
      name: 'math.floor',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    59: {
      name: 'math.fmod',
      family: 'math',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 numerator',
            name: 'numerator',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 denominator',
            name: 'denominator',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    60: {
      name: 'math.sqrt',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    61: {
      name: 'math.pow',
      family: 'math',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 power',
            name: 'power',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    62: {
      name: 'math.degreeToRadian',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 degrees',
            name: 'degrees',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    63: {
      name: 'math.radianToDegree',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 radians',
            name: 'radians',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    64: {
      name: 'math.integerAbs',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'i32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    65: {
      name: 'task.yield',
      family: 'task',
      signature: {
        argumentWords: 0,
        controlCodes: [4],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    66: {
      name: 'task.create',
      family: 'task',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 kind',
            name: 'kind',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'handle parent',
            name: 'parent',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    67: {
      name: 'task.destroy',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    68: {
      name: 'task.current',
      family: 'task',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    69: {
      name: 'task.send',
      family: 'task',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word message',
            name: 'message',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word wParam',
            name: 'wParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    70: {
      name: 'task.post',
      family: 'task',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word message',
            name: 'message',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word wParam',
            name: 'wParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    71: {
      name: 'task.waitMessage',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [4],
        parameters: [
          {
            description: 'word* fourWordBuffer',
            name: 'fourWordBuffer',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
        ],
        result: {
          completion: 'suspend',
          description: 'suspend void',
          kind: 'void',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    72: {
      name: 'task.readMemory',
      family: 'task',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr remote',
            name: 'remote',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    73: {
      name: 'task.writeMemory',
      family: 'task',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr remote',
            name: 'remote',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    74: {
      name: 'task.kind',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    75: {
      name: 'task.child',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    76: {
      name: 'task.parent',
      family: 'task',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    77: {
      name: 'task.exists',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    78: {
      name: 'plane.createBitmap',
      family: 'plane',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    79: {
      name: 'plane.assignBitmap',
      family: 'plane',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    80: {
      name: 'plane.releaseBitmap',
      family: 'plane',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    81: {
      name: 'plane.loadKX2',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    83: {
      name: 'plane.resetBase',
      family: 'plane',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    84: {
      name: 'plane.setPosition',
      family: 'plane',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'u32 coordinateMode',
            name: 'coordinateMode',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    85: {
      name: 'plane.setBaseXY',
      family: 'plane',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'u32 geometryOrTexture',
            name: 'geometryOrTexture',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    86: {
      name: 'plane.getBaseXY',
      family: 'plane',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 geometryOrTexture',
            name: 'geometryOrTexture',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    87: {
      name: 'plane.getPositionXYZ',
      family: 'plane',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr z',
            name: 'z',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 coordinateMode',
            name: 'coordinateMode',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    88: {
      name: 'plane.setPriority',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    89: {
      name: 'plane.priority',
      family: 'plane',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    90: {
      name: 'plane.inheritPosition',
      family: 'plane',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 xOffset',
            name: 'xOffset',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 yOffset',
            name: 'yOffset',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 zOffset',
            name: 'zOffset',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    91: {
      name: 'plane.stopInheritingPosition',
      family: 'plane',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    92: {
      name: 'plane.setVisible',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    93: {
      name: 'plane.setRotation',
      family: 'plane',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'u32 coordinateMode',
            name: 'coordinateMode',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    94: {
      name: 'plane.setAlpha',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    95: {
      name: 'plane.registerGraphInput',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    98: {
      name: 'plane.hasBitmap',
      family: 'plane',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    99: {
      name: 'plane.clear',
      family: 'plane',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    100: {
      name: 'plane.setColor',
      family: 'plane',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word colorARGB',
            name: 'colorARGB',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word override',
            name: 'override',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    101: {
      name: 'plane.setScale',
      family: 'plane',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'u32 coordinateMode',
            name: 'coordinateMode',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    102: {
      name: 'plane.setImageSelector',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    103: {
      name: 'plane.setAttribute',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    104: {
      name: 'plane.setRectangle',
      family: 'plane',
      signature: {
        argumentWords: 7,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    105: {
      name: 'plane.setColor',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word color',
            name: 'color',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    106: {
      name: 'plane.setToneTable',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    107: {
      name: 'input.activeWord',
      family: 'input',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'word owner',
            name: 'owner',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    108: {
      name: 'plane.setMode',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    109: {
      name: 'plane.flags',
      family: 'plane',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    110: {
      name: 'plane.setFlags',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    111: {
      name: 'bitmap.load',
      family: 'bitmap',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    112: {
      name: 'bitmap.create',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    113: {
      name: 'screenCapture.bitmap',
      family: 'screenCapture',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle bitmap',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    114: {
      name: 'bitmap.release',
      family: 'bitmap',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    115: {
      name: 'bitmap.copy',
      family: 'bitmap',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle destinationOrVRAM',
            name: 'destinationOrVRAM',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'handle source',
            name: 'source',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 sourceX',
            name: 'sourceX',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceY',
            name: 'sourceY',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceWidth',
            name: 'sourceWidth',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceHeight',
            name: 'sourceHeight',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    116: {
      name: 'bitmap.copyClipped',
      family: 'bitmap',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle destination',
            name: 'destination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'handle source',
            name: 'source',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 sourceX',
            name: 'sourceX',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceY',
            name: 'sourceY',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceWidth',
            name: 'sourceWidth',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceHeight',
            name: 'sourceHeight',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    117: {
      name: 'bitmap.fill',
      family: 'bitmap',
      signature: {
        argumentWords: 6,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmapOrScreen',
            name: 'bitmapOrScreen',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'word color',
            name: 'color',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    118: {
      name: 'bitmap.clone',
      family: 'bitmap',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    119: {
      name: 'bitmap.size',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr width',
            name: 'width',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr height',
            name: 'height',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    120: {
      name: 'bitmap.composite',
      family: 'bitmap',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle destination',
            name: 'destination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr imageRecords',
            name: 'imageRecords',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr rectangle',
            name: 'rectangle',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    121: {
      name: 'bitmap.tone',
      family: 'bitmap',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word red',
            name: 'red',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word green',
            name: 'green',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word blue',
            name: 'blue',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    122: {
      name: 'bitmap.resize',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle|nativePtr bitmap',
            name: 'bitmap',
            type: {
              alternatives: [
                {
                  handleKind: 'unknown',
                  kind: 'handle',
                  ownership: 'unknown',
                },
                {
                  addressSpace: 'native',
                  direction: 'unknown',
                  kind: 'pointer',
                  target: {
                    kind: 'unknown',
                  },
                },
              ],
              kind: 'union',
            },
          },
          {
            description: 'u32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    123: {
      name: 'legacyText.configure',
      family: 'legacyText',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr font96',
            name: 'font96',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr CP932Characters',
            name: 'CP932Characters',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    124: {
      name: 'legacyText.append',
      family: 'legacyText',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* text',
            name: 'text',
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
          {
            description: '...formatArguments',
            name: 'formatArguments',
            type: {
              elementType: {
                kind: 'unknown',
              },
              kind: 'variadic',
              role: 'format-arguments',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    125: {
      name: 'legacyText.message104',
      family: 'legacyText',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    126: {
      name: 'legacyText.message106',
      family: 'legacyText',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word wParam',
            name: 'wParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    127: {
      name: 'legacyText.message107',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    128: {
      name: 'legacyText.message105',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    129: {
      name: 'legacyText.query108',
      family: 'legacyText',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    130: {
      name: 'legacyText.message109',
      family: 'legacyText',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    131: {
      name: 'legacyText.message110',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    132: {
      name: 'legacyText.message112',
      family: 'legacyText',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    133: {
      name: 'legacyText.message113',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    134: {
      name: 'legacyText.unhandled114',
      family: 'legacyText',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr CP932Characters',
            name: 'CP932Characters',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    135: {
      name: 'legacyText.unhandled115',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    136: {
      name: 'legacyText.imageFont',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    137: {
      name: 'legacyText.glyph',
      family: 'legacyText',
      signature: {
        argumentWords: 6,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u16 character',
            name: 'character',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word a',
            name: 'a',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word b',
            name: 'b',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word c',
            name: 'c',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word d',
            name: 'd',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    138: {
      name: 'legacyText.message118',
      family: 'legacyText',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word wParam',
            name: 'wParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    139: {
      name: 'legacyText.message111',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word lParam',
            name: 'lParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    140: {
      name: 'reserved.unwrittenWord',
      family: 'reserved',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: '...ignoredArguments',
            name: 'ignoredArguments',
            type: {
              elementType: {
                kind: 'ignored',
              },
              kind: 'variadic',
              role: 'ignored-arguments',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    142: {
      name: 'reserved.unwrittenWord',
      family: 'reserved',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: '...ignoredArguments',
            name: 'ignoredArguments',
            type: {
              elementType: {
                kind: 'ignored',
              },
              kind: 'variadic',
              role: 'ignored-arguments',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    143: {
      name: 'script.load',
      family: 'script',
      signature: {
        argumentWords: 3,
        controlCodes: [2, 4],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'bool initialExecute',
            name: 'initialExecute',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    144: {
      name: 'input.register',
      family: 'input',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'word sender',
            name: 'sender',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'i32 priority',
            name: 'priority',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr rectangle',
            name: 'rectangle',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'word mask',
            name: 'mask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    145: {
      name: 'input.unregisterCurrentTask',
      family: 'input',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    146: {
      name: 'input.setPriority',
      family: 'input',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle owner',
            name: 'owner',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 priority',
            name: 'priority',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    147: {
      name: 'input.setRectangle',
      family: 'input',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle owner',
            name: 'owner',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr rectangle',
            name: 'rectangle',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    148: {
      name: 'input.setMask',
      family: 'input',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle owner',
            name: 'owner',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mask',
            name: 'mask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    149: {
      name: 'input.cursorPosition',
      family: 'input',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    150: {
      name: 'input.warpCursor',
      family: 'input',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'u16 x',
            name: 'x',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u16 y',
            name: 'y',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 frames',
            name: 'frames',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    151: {
      name: 'input.beginText',
      family: 'input',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* initial',
            name: 'initial',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    152: {
      name: 'input.textStatus',
      family: 'input',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    153: {
      name: 'input.textValue',
      family: 'input',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    154: {
      name: 'input.setCursorAutoHide',
      family: 'input',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word enabled',
            name: 'enabled',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 timeAt60Hz',
            name: 'timeAt60Hz',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    155: {
      name: 'sound.loadBank',
      family: 'sound',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word unused',
            name: 'unused',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'u32 loadType',
            name: 'loadType',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    156: {
      name: 'sound.releaseBank',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    157: {
      name: 'sound.playBank',
      family: 'sound',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 loopCount',
            name: 'loopCount',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    158: {
      name: 'sound.pauseBank',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    159: {
      name: 'sound.stopBank',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    160: {
      name: 'sound.bankIsPlaying',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    161: {
      name: 'sound.setBankVolume',
      family: 'sound',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i32 volume',
            name: 'volume',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    162: {
      name: 'sound.bankVolume',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    163: {
      name: 'sound.fadeBankVolume',
      family: 'sound',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u16 targetVolume',
            name: 'targetVolume',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u16 frames',
            name: 'frames',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    164: {
      name: 'sound.setBankPan',
      family: 'sound',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i32 pan',
            name: 'pan',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    165: {
      name: 'sound.bankPan',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    166: {
      name: 'sound.fadeBankPan',
      family: 'sound',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i16 targetPan',
            name: 'targetPan',
            type: {
              bits: 16,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u16 frames',
            name: 'frames',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    167: {
      name: 'sound.setBankDistances',
      family: 'sound',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'f32 ignored',
            name: 'ignored',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 maximumDistance',
            name: 'maximumDistance',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    168: {
      name: 'sound.setBankPosition',
      family: 'sound',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    192: {
      name: 'registry.queryExists',
      family: 'registry',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* softwarePath',
            name: 'softwarePath',
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
          {
            description: 'format* valueName',
            name: 'valueName',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    193: {
      name: 'registry.readBytes',
      family: 'registry',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* softwarePath',
            name: 'softwarePath',
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
          {
            description: 'format* valueName',
            name: 'valueName',
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
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 byteCapacity',
            name: 'byteCapacity',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    194: {
      name: 'registry.writeDWORD',
      family: 'registry',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* softwarePath',
            name: 'softwarePath',
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
          {
            description: 'format* valueName',
            name: 'valueName',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    195: {
      name: 'registry.writeNarrowString',
      family: 'registry',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* softwarePath',
            name: 'softwarePath',
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
          {
            description: 'format* valueName',
            name: 'valueName',
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
          {
            description: 'VMptr byteString',
            name: 'byteString',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    196: {
      name: 'areaEffect.initialize',
      family: 'areaEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr kindSpecificPacket',
            name: 'kindSpecificPacket',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    197: {
      name: 'areaEffect.start',
      family: 'areaEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    198: {
      name: 'areaEffect.finish',
      family: 'areaEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    199: {
      name: 'areaEffect.sendMatrix',
      family: 'areaEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr matrix64',
            name: 'matrix64',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    200: {
      name: 'areaEffect.active',
      family: 'areaEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    201: {
      name: 'areaEffect.updateRaster',
      family: 'areaEffect',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr parameters',
            name: 'parameters',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    202: {
      name: 'areaEffect.replaceSources',
      family: 'areaEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr sourcePair',
            name: 'sourcePair',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    203: {
      name: 'areaEffect.finishActive',
      family: 'areaEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    204: {
      name: 'matrix.rotateXYZ',
      family: 'matrix',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr matrixOrGlobal',
            name: 'matrixOrGlobal',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    205: {
      name: 'matrix.translate',
      family: 'matrix',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr matrixOrGlobal',
            name: 'matrixOrGlobal',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    206: {
      name: 'matrix.scale',
      family: 'matrix',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr matrixOrGlobal',
            name: 'matrixOrGlobal',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    207: {
      name: 'matrix.identity',
      family: 'matrix',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr matrixOrGlobal',
            name: 'matrixOrGlobal',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    208: {
      name: 'task.dumpTree',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    209: {
      name: 'variables.initialize',
      family: 'variables',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 capacity',
            name: 'capacity',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    210: {
      name: 'variables.get',
      family: 'variables',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    211: {
      name: 'variables.set',
      family: 'variables',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    212: {
      name: 'variables.setContextValue',
      family: 'variables',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    213: {
      name: 'variables.evaluate',
      family: 'variables',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* expression',
            name: 'expression',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    214: {
      name: 'rectangle.clear',
      family: 'rectangle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    215: {
      name: 'rectangle.union',
      family: 'rectangle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    216: {
      name: 'rectangle.unionBitmap',
      family: 'rectangle',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'handle nullableBitmap',
            name: 'nullableBitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    217: {
      name: 'rectangle.isEmpty',
      family: 'rectangle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr rectangle',
            name: 'rectangle',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    218: {
      name: 'rectangle.intersect',
      family: 'rectangle',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'i32 left',
            name: 'left',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 top',
            name: 'top',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 right',
            name: 'right',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 bottom',
            name: 'bottom',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    219: {
      name: 'scene.initializeTaskContext',
      family: 'scene',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    220: {
      name: 'taskScene.load',
      family: 'taskScene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    221: {
      name: 'taskScene.typeOrCount',
      family: 'taskScene',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    222: {
      name: 'taskScene.text',
      family: 'taskScene',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    223: {
      name: 'taskScene.markSeen',
      family: 'taskScene',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    224: {
      name: 'taskScene.appendPath',
      family: 'taskScene',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    225: {
      name: 'taskScene.clearSeen',
      family: 'taskScene',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    226: {
      name: 'taskScene.clearPath',
      family: 'taskScene',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    227: {
      name: 'taskScene.seenValue',
      family: 'taskScene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    228: {
      name: 'taskScene.pathAt',
      family: 'taskScene',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'char* filename',
            name: 'filename',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'word* value',
            name: 'value',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    229: {
      name: 'taskScene.setHistoryString',
      family: 'taskScene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* value',
            name: 'value',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    230: {
      name: 'taskScene.getHistoryString',
      family: 'taskScene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    231: {
      name: 'taskScene.captureHistoryStrings',
      family: 'taskScene',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    232: {
      name: 'taskScene.expandHistoryStrings',
      family: 'taskScene',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    233: {
      name: 'scene.expandTaskHistoryStrings',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    234: {
      name: 'scene.copyTaskHistory',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    235: {
      name: 'taskScene.currentFilename',
      family: 'taskScene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    237: {
      name: 'memory.freeVoid',
      family: 'memory',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'pointer block',
            name: 'block',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    238: {
      name: 'globalFile.create',
      family: 'globalFile',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'word tag',
            name: 'tag',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    239: {
      name: 'scene.saveTaskHistory',
      family: 'scene',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'bool path',
            name: 'path',
            type: {
              kind: 'boolean',
            },
          },
          {
            description: 'bool includeExtra',
            name: 'includeExtra',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    240: {
      name: 'variables.saveRange',
      family: 'variables',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    241: {
      name: 'image.saveEntry',
      family: 'image',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    242: {
      name: 'globalFile.saveNested',
      family: 'globalFile',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle childFile',
            name: 'childFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    243: {
      name: 'strings.save',
      family: 'strings',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    244: {
      name: 'globalFile.saveBytes',
      family: 'globalFile',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'byte* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    245: {
      name: 'globalFile.write',
      family: 'globalFile',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    246: {
      name: 'globalFile.close',
      family: 'globalFile',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    247: {
      name: 'globalFile.read',
      family: 'globalFile',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    248: {
      name: 'globalFile.tag',
      family: 'globalFile',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    249: {
      name: 'scene.restoreTaskHistory',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'bool path',
            name: 'path',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    250: {
      name: 'variables.restoreRange',
      family: 'variables',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    251: {
      name: 'image.loadEntry',
      family: 'image',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    252: {
      name: 'globalFile.readNested',
      family: 'globalFile',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    253: {
      name: 'strings.restore',
      family: 'strings',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    254: {
      name: 'globalFile.readBytes',
      family: 'globalFile',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'byte* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32 capacity',
            name: 'capacity',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    255: {
      name: 'globalFile.modifiedTime',
      family: 'globalFile',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'u32* year',
            name: 'year',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* month',
            name: 'month',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* day',
            name: 'day',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* hour',
            name: 'hour',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32* minute',
            name: 'minute',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    256: {
      name: 'draw.initialize',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 capacity',
            name: 'capacity',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    257: {
      name: 'draw.addBitmap',
      family: 'draw',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word rotation',
            name: 'rotation',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word transformMode',
            name: 'transformMode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    258: {
      name: 'draw.remove',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    259: {
      name: 'draw.updateBitmap',
      family: 'draw',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word rotation',
            name: 'rotation',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word transformMode',
            name: 'transformMode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    260: {
      name: 'draw.setVisible',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    261: {
      name: 'draw.count',
      family: 'draw',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    262: {
      name: 'draw.setPriority',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word priority',
            name: 'priority',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    263: {
      name: 'draw.setValue',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    264: {
      name: 'draw.clear',
      family: 'draw',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    265: {
      name: 'movie.open',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    266: {
      name: 'movie.play',
      family: 'movie',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 repeatCount',
            name: 'repeatCount',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    267: {
      name: 'movie.stop',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    268: {
      name: 'movie.close',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    269: {
      name: 'movie.playing',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    270: {
      name: 'movie.redraw',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    271: {
      name: 'particle.loadScript',
      family: 'particle',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* program',
            name: 'program',
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
          {
            description: 'format* texture',
            name: 'texture',
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
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'f32 priority',
            name: 'priority',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'VMptr registers32',
            name: 'registers32',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    272: {
      name: 'particle.start',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    273: {
      name: 'particle.stop',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    274: {
      name: 'particle.isActive',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    275: {
      name: 'particle.setRegisters',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr registers32',
            name: 'registers32',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    276: {
      name: 'strings.set',
      family: 'strings',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'char* value',
            name: 'value',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    277: {
      name: 'strings.get',
      family: 'strings',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    278: {
      name: 'strings.expand',
      family: 'strings',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* inOutText',
            name: 'inOutText',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    284: {
      name: 'sound.fileExists',
      family: 'sound',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'word unused',
            name: 'unused',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    285: {
      name: 'input.keySources',
      family: 'input',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 keyIndex',
            name: 'keyIndex',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    286: {
      name: 'input.refreshRegions',
      family: 'input',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    289: {
      name: 'namePairs.allocate',
      family: 'namePairs',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 third',
            name: 'third',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    290: {
      name: 'namePairs.free',
      family: 'namePairs',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    291: {
      name: 'namePairs.append',
      family: 'namePairs',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    292: {
      name: 'namePairs.findName',
      family: 'namePairs',
      signature: {
        argumentWords: 4,
        controlCodes: [1, 2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'word* first',
            name: 'first',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
          {
            description: 'word* second',
            name: 'second',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
        ],
        result: {
          availability: 'conditional',
          description: 'conditional-bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    293: {
      name: 'namePairs.findPair',
      family: 'namePairs',
      signature: {
        argumentWords: 4,
        controlCodes: [1, 2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* name',
            name: 'name',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          availability: 'conditional',
          description: 'conditional-bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    294: {
      name: 'motion.createManager',
      family: 'motion',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    295: {
      name: 'motion.deleteManager',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    296: {
      name: 'motion.clear',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    297: {
      name: 'motion.remove',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle motion',
            name: 'motion',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    298: {
      name: 'motion.removeGroup',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    299: {
      name: 'motion.setBase',
      family: 'motion',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'vec3* base',
            name: 'base',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* position',
            name: 'position',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vram',
            name: 'vram',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'matrix4* rotation',
            name: 'rotation',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'vec3* scale',
            name: 'scale',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word color',
            name: 'color',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'vec3* size',
            name: 'size',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vramSize',
            name: 'vramSize',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word display',
            name: 'display',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    300: {
      name: 'motion.getBase',
      family: 'motion',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'vec3* base',
            name: 'base',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* position',
            name: 'position',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vram',
            name: 'vram',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'matrix4* rotation',
            name: 'rotation',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'vec3* scale',
            name: 'scale',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word* color',
            name: 'color',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
          {
            description: 'vec3* size',
            name: 'size',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vramSize',
            name: 'vramSize',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word* display',
            name: 'display',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    301: {
      name: 'motion.setWorking',
      family: 'motion',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'vec3* base',
            name: 'base',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* position',
            name: 'position',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vram',
            name: 'vram',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'matrix4* rotation',
            name: 'rotation',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'vec3* scale',
            name: 'scale',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word color',
            name: 'color',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'vec3* size',
            name: 'size',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vramSize',
            name: 'vramSize',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word display',
            name: 'display',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    302: {
      name: 'motion.getWorking',
      family: 'motion',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'vec3* base',
            name: 'base',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* position',
            name: 'position',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vram',
            name: 'vram',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'matrix4* rotation',
            name: 'rotation',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'vec3* scale',
            name: 'scale',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word* color',
            name: 'color',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
          {
            description: 'vec3* size',
            name: 'size',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'vec3* vramSize',
            name: 'vramSize',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vec3',
              },
            },
          },
          {
            description: 'word* optionalDisplay',
            name: 'optionalDisplay',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    303: {
      name: 'motion.commitWorking',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    304: {
      name: 'motion.add',
      family: 'motion',
      signature: {
        argumentWords: 7,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'word* registers',
            name: 'registers',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'byte* extra',
            name: 'extra',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32 extraBytes',
            name: 'extraBytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    305: {
      name: 'motion.setStartFrame',
      family: 'motion',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle motionOrAll',
            name: 'motionOrAll',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 frame',
            name: 'frame',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    306: {
      name: 'motion.setRegisters',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle motion',
            name: 'motion',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word* registers',
            name: 'registers',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    307: {
      name: 'motion.update',
      family: 'motion',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 frame',
            name: 'frame',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'bool skip',
            name: 'skip',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    308: {
      name: 'motion.setSpeed',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 speed',
            name: 'speed',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    309: {
      name: 'motion.isActive',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle motion',
            name: 'motion',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    310: {
      name: 'motion.isGroupActive',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    311: {
      name: 'motion.isAnyActive',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    312: {
      name: 'motion.skip',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle motion',
            name: 'motion',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    313: {
      name: 'motion.skipGroup',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    314: {
      name: 'motion.skipAll',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    315: {
      name: 'motion.createCheckpoint',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 frame',
            name: 'frame',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    316: {
      name: 'motion.refreshCheckpoint',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle checkpoint',
            name: 'checkpoint',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 frame',
            name: 'frame',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    317: {
      name: 'motion.freeCheckpoint',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle checkpoint',
            name: 'checkpoint',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    318: {
      name: 'math.linearInterpolate',
      family: 'math',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 areaMin',
            name: 'areaMin',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 areaMax',
            name: 'areaMax',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 inputMin',
            name: 'inputMin',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 inputMax',
            name: 'inputMax',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    319: {
      name: 'math.roundInteger',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    320: {
      name: 'math.prepareSpline',
      family: 'math',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'fiveFloatRecord* records',
            name: 'records',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'fiveFloatRecord',
              },
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    321: {
      name: 'math.triangleWave',
      family: 'math',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 phase',
            name: 'phase',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 period',
            name: 'period',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    322: {
      name: 'scene.exists',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    323: {
      name: 'scene.create',
      family: 'scene',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    324: {
      name: 'scene.close',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    325: {
      name: 'scene.load',
      family: 'scene',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    326: {
      name: 'scene.typeOrCount',
      family: 'scene',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    327: {
      name: 'scene.text',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    328: {
      name: 'scene.markSeen',
      family: 'scene',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    329: {
      name: 'scene.appendPath',
      family: 'scene',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    330: {
      name: 'scene.clearSeen',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    331: {
      name: 'scene.clearPath',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    332: {
      name: 'scene.seenValue',
      family: 'scene',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    333: {
      name: 'scene.pathAt',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'char* filename',
            name: 'filename',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'word* value',
            name: 'value',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    334: {
      name: 'scene.setHistoryString',
      family: 'scene',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* value',
            name: 'value',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    335: {
      name: 'scene.getHistoryString',
      family: 'scene',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    336: {
      name: 'scene.captureHistoryStrings',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    337: {
      name: 'scene.expandHistoryStrings',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'char* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    338: {
      name: 'scene.currentFilename',
      family: 'scene',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    339: {
      name: 'draw.setClip',
      family: 'draw',
      signature: {
        argumentWords: 6,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    340: {
      name: 'draw.push',
      family: 'draw',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    341: {
      name: 'draw.pop',
      family: 'draw',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    342: {
      name: 'draw.refresh',
      family: 'draw',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle surface',
            name: 'surface',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    343: {
      name: 'graph.size',
      family: 'graph',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task id',
            name: 'id',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'VMptr width',
            name: 'width',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr height',
            name: 'height',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    344: {
      name: 'graph.matrix',
      family: 'graph',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task id',
            name: 'id',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'VMptr matrix',
            name: 'matrix',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'word textureTransform',
            name: 'textureTransform',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    345: {
      name: 'graph.bounds',
      family: 'graph',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'task id',
            name: 'id',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'VMptr minX',
            name: 'minX',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr minY',
            name: 'minY',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr maxX',
            name: 'maxX',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr maxY',
            name: 'maxY',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    346: {
      name: 'plane.sendKX3Path',
      family: 'plane',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'word wParam',
            name: 'wParam',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    347: {
      name: 'sound.setBankVelocity',
      family: 'sound',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    348: {
      name: 'sound.setBankDoppler',
      family: 'sound',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'f32 factor',
            name: 'factor',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    349: {
      name: 'sound.volumeFadePending',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    350: {
      name: 'matrix.inverse',
      family: 'matrix',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr nullableMatrix4',
            name: 'nullableMatrix4',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    351: {
      name: 'matrix.copy',
      family: 'matrix',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr destinationMatrix4',
            name: 'destinationMatrix4',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr sourceMatrix4',
            name: 'sourceMatrix4',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    352: {
      name: 'vector4.normalize',
      family: 'vector4',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr inOut',
            name: 'inOut',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    353: {
      name: 'vector4.add',
      family: 'vector4',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr inOut',
            name: 'inOut',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr right',
            name: 'right',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    354: {
      name: 'vector4.subtract',
      family: 'vector4',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr inOut',
            name: 'inOut',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr right',
            name: 'right',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    355: {
      name: 'vector4.length',
      family: 'vector4',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr vector',
            name: 'vector',
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
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    356: {
      name: 'vector4.lengthSquared',
      family: 'vector4',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr vector',
            name: 'vector',
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
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    357: {
      name: 'vector4.scale',
      family: 'vector4',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr inOut',
            name: 'inOut',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr scaleFloat',
            name: 'scaleFloat',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    358: {
      name: 'vector4.transform',
      family: 'vector4',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr inOut',
            name: 'inOut',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr matrix4',
            name: 'matrix4',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    359: {
      name: 'configuration.getBlocks',
      family: 'configuration',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'byte* voice',
            name: 'voice',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'byte* message',
            name: 'message',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'byte* effect',
            name: 'effect',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'byte* window',
            name: 'window',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    360: {
      name: 'configuration.setBlocks',
      family: 'configuration',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'byte* voice',
            name: 'voice',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'byte* message',
            name: 'message',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'byte* effect',
            name: 'effect',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    362: {
      name: 'bitmap.canvasSize',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle nullableBitmap',
            name: 'nullableBitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr width',
            name: 'width',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr height',
            name: 'height',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    363: {
      name: 'bitmap.offset',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle nullableBitmap',
            name: 'nullableBitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    364: {
      name: 'imageData.decode',
      family: 'imageData',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle imageData',
            name: 'imageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'handle bitmap',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    365: {
      name: 'imageData.load',
      family: 'imageData',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle imageData',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    366: {
      name: 'imageData.release',
      family: 'imageData',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle imageData',
            name: 'imageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    367: {
      name: 'bitmap.blit',
      family: 'bitmap',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle nullableDestination',
            name: 'nullableDestination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 dx',
            name: 'dx',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 dy',
            name: 'dy',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 destinationWidth',
            name: 'destinationWidth',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 destinationHeight',
            name: 'destinationHeight',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'handle nullableSource',
            name: 'nullableSource',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 sx',
            name: 'sx',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sy',
            name: 'sy',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceWidth',
            name: 'sourceWidth',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceHeight',
            name: 'sourceHeight',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    368: {
      name: 'imageData.frameInfo',
      family: 'imageData',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle imageData',
            name: 'imageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr info36',
            name: 'info36',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    369: {
      name: 'bitmap.multiplyPackedColor',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word color',
            name: 'color',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    370: {
      name: 'bitmap.alphaAt',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 canvasX',
            name: 'canvasX',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 canvasY',
            name: 'canvasY',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    371: {
      name: 'bitmap.base',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    372: {
      name: 'bitmap.setCanvasSize',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    373: {
      name: 'bitmap.setOffset',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    374: {
      name: 'bitmap.setBase',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    375: {
      name: 'imageData.fileInfo',
      family: 'imageData',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'VMptr info36',
            name: 'info36',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    376: {
      name: 'bitmap.colorTransform',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    377: {
      name: 'bitmap.hasAlpha',
      family: 'bitmap',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    378: {
      name: 'bitmap.setAlphaHint',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word enabled',
            name: 'enabled',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    379: {
      name: 'historyCursor.create',
      family: 'historyCursor',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 slotCount',
            name: 'slotCount',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    380: {
      name: 'historyCursor.release',
      family: 'historyCursor',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle cursor',
            name: 'cursor',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    381: {
      name: 'historyCursor.move',
      family: 'historyCursor',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle cursor',
            name: 'cursor',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word forward',
            name: 'forward',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    382: {
      name: 'historyCursor.text',
      family: 'historyCursor',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle cursor',
            name: 'cursor',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 slot',
            name: 'slot',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr message',
            name: 'message',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr speaker',
            name: 'speaker',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    383: {
      name: 'historyCursor.command',
      family: 'historyCursor',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle cursor',
            name: 'cursor',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 slot',
            name: 'slot',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr command',
            name: 'command',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'i32 ordinal',
            name: 'ordinal',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    384: {
      name: 'historyCursor.position',
      family: 'historyCursor',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle cursor',
            name: 'cursor',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 slot',
            name: 'slot',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr pathIndex',
            name: 'pathIndex',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    385: {
      name: 'scene.saveHistory',
      family: 'scene',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'bool path',
            name: 'path',
            type: {
              kind: 'boolean',
            },
          },
          {
            description: 'bool includeExtra',
            name: 'includeExtra',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    386: {
      name: 'scene.restoreHistory',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'bool path',
            name: 'path',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    387: {
      name: 'motion.saveCheckpointEntry',
      family: 'motion',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle motionCheckpoint',
            name: 'motionCheckpoint',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    388: {
      name: 'motion.loadCheckpointEntry',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle nullableMotionManager',
            name: 'nullableMotionManager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word restoreFlags',
            name: 'restoreFlags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    389: {
      name: 'globalFile.clear',
      family: 'globalFile',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    390: {
      name: 'globalFile.clone',
      family: 'globalFile',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle sourceGlobalFile',
            name: 'sourceGlobalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    391: {
      name: 'legacyText.query119',
      family: 'legacyText',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    392: {
      name: 'text.extractPlainCP932',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'format* source',
            name: 'source',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    393: {
      name: 'environment.enableSettingsMenu',
      family: 'environment',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'bool enabled',
            name: 'enabled',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    394: {
      name: 'input.captureBitmapMask',
      family: 'input',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'taskID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'handle bitmapOrNull',
            name: 'bitmapOrNull',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    395: {
      name: 'input.setCursorImage',
      family: 'input',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr CP932Filename',
            name: 'CP932Filename',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u16 hotspotX',
            name: 'hotspotX',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u16 hotspotY',
            name: 'hotspotY',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    396: {
      name: 'input.cursorVisible',
      family: 'input',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    397: {
      name: 'math.atan2',
      family: 'math',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    398: {
      name: 'plane.configureTrail',
      family: 'plane',
      signature: {
        argumentWords: 12,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'i32 samples',
            name: 'samples',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 interval',
            name: 'interval',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'f32 offsetX',
            name: 'offsetX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 offsetY',
            name: 'offsetY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 offsetZ',
            name: 'offsetZ',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'f32 scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleZ',
            name: 'scaleZ',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word depth',
            name: 'depth',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    399: {
      name: 'plane.pushTrailSample',
      family: 'plane',
      signature: {
        argumentWords: 7,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'VMptr vector1',
            name: 'vector1',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr vector2',
            name: 'vector2',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr vector3',
            name: 'vector3',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr matrix4',
            name: 'matrix4',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'word state',
            name: 'state',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word attributes',
            name: 'attributes',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    400: {
      name: 'sound.readLoopPointTable',
      family: 'sound',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word unused',
            name: 'unused',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    401: {
      name: 'input.setCursorEnabled',
      family: 'input',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word enabled',
            name: 'enabled',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    402: {
      name: 'graph.blend',
      family: 'graph',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task id',
            name: 'id',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    403: {
      name: 'input.setKeyEnabled',
      family: 'input',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word enabled',
            name: 'enabled',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    404: {
      name: 'input.enableAllKeys',
      family: 'input',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    405: {
      name: 'galleryVariants.open',
      family: 'galleryVariants',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    406: {
      name: 'galleryVariants.close',
      family: 'galleryVariants',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    407: {
      name: 'galleryVariants.groupCount',
      family: 'galleryVariants',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    408: {
      name: 'galleryVariants.fileCount',
      family: 'galleryVariants',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    409: {
      name: 'galleryVariants.firstChoiceCount',
      family: 'galleryVariants',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 file',
            name: 'file',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    410: {
      name: 'galleryVariants.secondChoiceCount',
      family: 'galleryVariants',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 file',
            name: 'file',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    411: {
      name: 'galleryVariants.reference',
      family: 'galleryVariants',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 file',
            name: 'file',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    412: {
      name: 'galleryNames.open',
      family: 'galleryNames',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    413: {
      name: 'galleryNames.close',
      family: 'galleryNames',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    414: {
      name: 'galleryNames.count',
      family: 'galleryNames',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    415: {
      name: 'galleryNames.contains',
      family: 'galleryNames',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u32 column',
            name: 'column',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    416: {
      name: 'galleryNames.name',
      family: 'galleryNames',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u32 column',
            name: 'column',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    417: {
      name: 'movie.volume',
      family: 'movie',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 volume',
            name: 'volume',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    418: {
      name: 'legacyText.configureLineBreaks',
      family: 'legacyText',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr font96',
            name: 'font96',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr firstCP932List',
            name: 'firstCP932List',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr secondCP932List',
            name: 'secondCP932List',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    419: {
      name: 'cg.create',
      family: 'cg',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    420: {
      name: 'cg.release',
      family: 'cg',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    421: {
      name: 'cg.clear',
      family: 'cg',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    422: {
      name: 'cg.register',
      family: 'cg',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* reference',
            name: 'reference',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    423: {
      name: 'cg.contains',
      family: 'cg',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* reference',
            name: 'reference',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    424: {
      name: 'cg.save',
      family: 'cg',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    425: {
      name: 'cg.load',
      family: 'cg',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    426: {
      name: 'particle.setAlpha',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'i32 alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    427: {
      name: 'particle.attachGraph',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word task',
            name: 'task',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word graphID',
            name: 'graphID',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    430: {
      name: 'image.hasAnimationFile',
      family: 'image',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    431: {
      name: 'imageData.containerInfo',
      family: 'imageData',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle imageData',
            name: 'imageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr info36',
            name: 'info36',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    433: {
      name: 'plane.makeTiled',
      family: 'plane',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'f32 tileWidth',
            name: 'tileWidth',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 tileHeight',
            name: 'tileHeight',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'i32 columns',
            name: 'columns',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 rows',
            name: 'rows',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    434: {
      name: 'preload.clear',
      family: 'preload',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    435: {
      name: 'preload.queue',
      family: 'preload',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'format* category',
            name: 'category',
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
          {
            description: 'word lifetime',
            name: 'lifetime',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    436: {
      name: 'preload.start',
      family: 'preload',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    437: {
      name: 'preload.complete',
      family: 'preload',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'i32 threshold',
            name: 'threshold',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    438: {
      name: 'preload.age',
      family: 'preload',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    440: {
      name: 'motion.finish',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    441: {
      name: 'screenCapture.setRecording',
      family: 'screenCapture',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'word enabled',
            name: 'enabled',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* prefix',
            name: 'prefix',
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
          {
            description: 'word counter',
            name: 'counter',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    444: {
      name: 'file.moduleVersion',
      family: 'file',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr major',
            name: 'major',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr minor',
            name: 'minor',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr build',
            name: 'build',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr revision',
            name: 'revision',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    445: {
      name: 'window.messageBox',
      family: 'window',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    446: {
      name: 'bitmap.opaqueBounds',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr rectangle',
            name: 'rectangle',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    447: {
      name: 'fes.start',
      family: 'fes',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    448: {
      name: 'fes.update',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    449: {
      name: 'fes.bindSurface',
      family: 'fes',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle surface',
            name: 'surface',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    450: {
      name: 'fes.jump',
      family: 'fes',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* label',
            name: 'label',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    451: {
      name: 'fes.setSaveObject',
      family: 'fes',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    452: {
      name: 'fes.exitCode',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    453: {
      name: 'fes.setCurrentExitCode',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'i32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    454: {
      name: 'fes.contextName',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    455: {
      name: 'draw.copyBaseImage',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle surface',
            name: 'surface',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    456: {
      name: 'legacyText.message120',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    458: {
      name: 'cg.loadList',
      family: 'cg',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    459: {
      name: 'cg.registerGroup',
      family: 'cg',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle registrations',
            name: 'registrations',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'format* reference',
            name: 'reference',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    460: {
      name: 'bitmap.composeFile',
      family: 'bitmap',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    461: {
      name: 'math.log10',
      family: 'math',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    462: {
      name: 'draw.getValue',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    463: {
      name: 'draw.setAuxiliary',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    464: {
      name: 'draw.refreshEntry',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    465: {
      name: 'configuration.authorMode',
      family: 'configuration',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    466: {
      name: 'plane.setCoordinateMode',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    468: {
      name: 'bitmap.rotateRightAngle',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle|nativePtr bitmap',
            name: 'bitmap',
            type: {
              alternatives: [
                {
                  handleKind: 'unknown',
                  kind: 'handle',
                  ownership: 'unknown',
                },
                {
                  addressSpace: 'native',
                  direction: 'unknown',
                  kind: 'pointer',
                  target: {
                    kind: 'unknown',
                  },
                },
              ],
              kind: 'union',
            },
          },
          {
            description: 'i32 degrees',
            name: 'degrees',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    469: {
      name: 'globalFile.removeEntry',
      family: 'globalFile',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    470: {
      name: 'tileGame.create',
      family: 'tileGame',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    471: {
      name: 'tileGame.release',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    472: {
      name: 'tileGame.start',
      family: 'tileGame',
      signature: {
        argumentWords: 9,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 players',
            name: 'players',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'word option1',
            name: 'option1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word option2',
            name: 'option2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word option3',
            name: 'option3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word option4',
            name: 'option4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word option5',
            name: 'option5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr opponentOptions',
            name: 'opponentOptions',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr scoreOptions4',
            name: 'scoreOptions4',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    473: {
      name: 'tileGame.pollEvent',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    474: {
      name: 'tileGame.command10006',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selection',
            name: 'selection',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    475: {
      name: 'tileGame.playerCount',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    476: {
      name: 'tileGame.currentPlayer',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    477: {
      name: 'tileGame.query5',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word player',
            name: 'player',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    478: {
      name: 'tileGame.query6',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word player',
            name: 'player',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    479: {
      name: 'tileGame.query7',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word player',
            name: 'player',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    480: {
      name: 'tileGame.eventArgument',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    481: {
      name: 'tileGame.eventArgumentCount',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    482: {
      name: 'tileGame.decodeReference',
      family: 'tileGame',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word reference',
            name: 'reference',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr type',
            name: 'type',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr player',
            name: 'player',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr index',
            name: 'index',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    483: {
      name: 'tileGame.command10004',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word firstDie',
            name: 'firstDie',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word secondDie',
            name: 'secondDie',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    484: {
      name: 'tileGame.query3',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    485: {
      name: 'tileGame.command10008',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selection',
            name: 'selection',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    486: {
      name: 'tileGame.cachedAction',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr fourWords',
            name: 'fourWords',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    487: {
      name: 'tileGame.query4Action',
      family: 'tileGame',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word player',
            name: 'player',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr fourWords',
            name: 'fourWords',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    488: {
      name: 'tileGame.command10007',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selection',
            name: 'selection',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    489: {
      name: 'tileGame.command10005',
      family: 'tileGame',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word player',
            name: 'player',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word third',
            name: 'third',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    490: {
      name: 'tileGame.cachedResult',
      family: 'tileGame',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr first',
            name: 'first',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr second',
            name: 'second',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    491: {
      name: 'tileGame.query11Element',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    492: {
      name: 'tileGame.query23',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    493: {
      name: 'tileGame.query26',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    494: {
      name: 'tileGame.query16',
      family: 'tileGame',
      signature: {
        argumentWords: 7,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr first',
            name: 'first',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr second',
            name: 'second',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr third',
            name: 'third',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr fourth',
            name: 'fourth',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr fifth',
            name: 'fifth',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    495: {
      name: 'tileGame.query18',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    496: {
      name: 'tileGame.roundAndSeats',
      family: 'tileGame',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr first',
            name: 'first',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr second',
            name: 'second',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr third',
            name: 'third',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr seats4',
            name: 'seats4',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    497: {
      name: 'tileGame.query14',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    498: {
      name: 'tileGame.query17',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    499: {
      name: 'tileGame.query24',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    500: {
      name: 'tileGame.query25',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    501: {
      name: 'tileGame.cacheEvent',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    502: {
      name: 'tileGame.query19',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr fourWords',
            name: 'fourWords',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    503: {
      name: 'tileGame.command10009',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr playerWords',
            name: 'playerWords',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    504: {
      name: 'tileGame.query12',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    505: {
      name: 'tileGame.command',
      family: 'tileGame',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word command',
            name: 'command',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'i32 wordCount',
            name: 'wordCount',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr words',
            name: 'words',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    506: {
      name: 'tileGame.cachedChoice',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    507: {
      name: 'tileGame.command10014',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selection',
            name: 'selection',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    508: {
      name: 'tileGame.query28',
      family: 'tileGame',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    509: {
      name: 'tileGame.command10014Result',
      family: 'tileGame',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    510: {
      name: 'tileGame.query29Action',
      family: 'tileGame',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word player',
            name: 'player',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr fourWords',
            name: 'fourWords',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    511: {
      name: 'tileGame.command10012',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selection',
            name: 'selection',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    512: {
      name: 'tileGame.query11List',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr fourteenWords',
            name: 'fourteenWords',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    513: {
      name: 'tileGame.query4First',
      family: 'tileGame',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle context',
            name: 'context',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word player',
            name: 'player',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    514: {
      name: 'motion.hasFilename',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    515: {
      name: 'dictionary.create',
      family: 'dictionary',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    516: {
      name: 'dictionary.release',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    517: {
      name: 'dictionary.insertFirst',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr rawKey',
            name: 'rawKey',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    518: {
      name: 'dictionary.getRawKey',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr rawKey',
            name: 'rawKey',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    519: {
      name: 'string.selectSpaceGroup',
      family: 'string',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    520: {
      name: 'screenEffect.command208',
      family: 'screenEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    521: {
      name: 'screenEffect.command209',
      family: 'screenEffect',
      signature: {
        argumentWords: 8,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument5',
            name: 'argument5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument6',
            name: 'argument6',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument7',
            name: 'argument7',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    522: {
      name: 'screenEffect.command20A',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    523: {
      name: 'screenEffect.command20B',
      family: 'screenEffect',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument5',
            name: 'argument5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument6',
            name: 'argument6',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument7',
            name: 'argument7',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument8',
            name: 'argument8',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument9',
            name: 'argument9',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    524: {
      name: 'screenEffect.command20C',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    525: {
      name: 'screenEffect.command20D',
      family: 'screenEffect',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    526: {
      name: 'screenEffect.command20E',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    527: {
      name: 'screenEffect.command20F',
      family: 'screenEffect',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    528: {
      name: 'screenEffect.command210',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    529: {
      name: 'screenEffect.command211',
      family: 'screenEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    530: {
      name: 'screenEffect.command212',
      family: 'screenEffect',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    531: {
      name: 'screenEffect.command213',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    532: {
      name: 'screenEffect.command214',
      family: 'screenEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    534: {
      name: 'draw.setMode',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    535: {
      name: 'motion.addDelayed',
      family: 'motion',
      signature: {
        argumentWords: 8,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'word* registers',
            name: 'registers',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'bits',
              },
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'byte* extra',
            name: 'extra',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'u32 extraBytes',
            name: 'extraBytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 delay',
            name: 'delay',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    536: {
      name: 'bitmap.getAttribute',
      family: 'bitmap',
      signature: {
        argumentWords: 7,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr left',
            name: 'left',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr top',
            name: 'top',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr right',
            name: 'right',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr bottom',
            name: 'bottom',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr color',
            name: 'color',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    537: {
      name: 'bitmap.copyAttributes',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle destination',
            name: 'destination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle source',
            name: 'source',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    538: {
      name: 'bitmap.filter',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle bitmap',
            name: 'bitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    539: {
      name: 'arguments.evaluate',
      family: 'arguments',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr source',
            name: 'source',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'i32 capacity',
            name: 'capacity',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    540: {
      name: 'arguments.tokenOffset',
      family: 'arguments',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr source',
            name: 'source',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    541: {
      name: 'texture.releaseRectangle',
      family: 'texture',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    542: {
      name: 'texture.allocateMissingPages',
      family: 'texture',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    549: {
      name: 'reserved.unwrittenWord',
      family: 'reserved',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: '...ignoredArguments',
            name: 'ignoredArguments',
            type: {
              elementType: {
                kind: 'ignored',
              },
              kind: 'variadic',
              role: 'ignored-arguments',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    557: {
      name: 'legacyText.setSecondaryColor',
      family: 'legacyText',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word color',
            name: 'color',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    558: {
      name: 'bitmap.mirror',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle nullableBitmap',
            name: 'nullableBitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word horizontal',
            name: 'horizontal',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    564: {
      name: 'bitmap.setMask',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle nullableBitmap',
            name: 'nullableBitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mask',
            name: 'mask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    565: {
      name: 'screenCapture.recording',
      family: 'screenCapture',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    566: {
      name: 'screenCapture.counter',
      family: 'screenCapture',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    567: {
      name: 'file.writeFormattedLine',
      family: 'file',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr filename',
            name: 'filename',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'format* line',
            name: 'line',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    568: {
      name: 'screenEffect.command238',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    569: {
      name: 'sound.decoderLength',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32 codecDependentUnit',
          kind: 'integer',
          signed: false,
          unit: 'codec-dependent',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    570: {
      name: 'task.message442',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    571: {
      name: 'task.message445',
      family: 'task',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'PEptr nullableWord',
            name: 'nullableWord',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    572: {
      name: 'task.message444',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    577: {
      name: 'task.setTopValue',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    582: {
      name: 'configuration.systemVoiceEnabled',
      family: 'configuration',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'i32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    583: {
      name: 'configuration.randomSystemVoice',
      family: 'configuration',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    584: {
      name: 'configuration.setSystemVoiceEnabled',
      family: 'configuration',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'i32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    586: {
      name: 'motion.setDefaultFlags',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle manager',
            name: 'manager',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    587: {
      name: 'sound.staticCompletionCount',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    588: {
      name: 'sound.readLoopStartUndefinedResult',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'uninitialized word',
          initialization: 'uninitialized',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    589: {
      name: 'configuration.words24D',
      family: 'configuration',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr first',
            name: 'first',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr second',
            name: 'second',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    590: {
      name: 'xml.open',
      family: 'xml',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'xml-document',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    591: {
      name: 'xml.close',
      family: 'xml',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
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
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    592: {
      name: 'xml.integer',
      family: 'xml',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
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
            description: 'i32 fallback',
            name: 'fallback',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    593: {
      name: 'xml.string',
      family: 'xml',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
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
                encoding: 'UTF-8',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    594: {
      name: 'characterNames.open',
      family: 'characterNames',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    595: {
      name: 'characterNames.close',
      family: 'characterNames',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    596: {
      name: 'characterNames.groupColor',
      family: 'characterNames',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* group',
            name: 'group',
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
          {
            description: 'VMptr red',
            name: 'red',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr green',
            name: 'green',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr blue',
            name: 'blue',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    597: {
      name: 'characterNames.nameColor',
      family: 'characterNames',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'VMptr red',
            name: 'red',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr green',
            name: 'green',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr blue',
            name: 'blue',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    598: {
      name: 'resource.baseName',
      family: 'resource',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* source',
            name: 'source',
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
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    602: {
      name: 'sound.registerGroup',
      family: 'sound',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'word id',
            name: 'id',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word typeCode',
            name: 'typeCode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'i32 minimumBank',
            name: 'minimumBank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 maximumBank',
            name: 'maximumBank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'word volume',
            name: 'volume',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    603: {
      name: 'sound.unregisterGroup',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word id',
            name: 'id',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    604: {
      name: 'sound.loadGroup',
      family: 'sound',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word unused',
            name: 'unused',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'bool byId',
            name: 'byId',
            type: {
              kind: 'boolean',
            },
          },
          {
            description: 'u32 loadType',
            name: 'loadType',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32 bank',
          kind: 'integer',
          meaning: 'bank-index',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    605: {
      name: 'legacySound.groupGain',
      family: 'legacySound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    606: {
      name: 'legacySound.playWord',
      family: 'legacySound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    607: {
      name: 'legacySound.masterVolume',
      family: 'legacySound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    608: {
      name: 'scene.blockCount',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    609: {
      name: 'variables.backup',
      family: 'variables',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    610: {
      name: 'variables.restore',
      family: 'variables',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    611: {
      name: 'text.defaultConfiguration',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr record',
            name: 'record',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    612: {
      name: 'text.configure',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr record',
            name: 'record',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    613: {
      name: 'text.updateConfiguration',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr record',
            name: 'record',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    614: {
      name: 'text.appendFormatted',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    615: {
      name: 'text.clear',
      family: 'text',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    616: {
      name: 'text.remaining',
      family: 'text',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    617: {
      name: 'text.finish',
      family: 'text',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    618: {
      name: 'text.mark',
      family: 'text',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    619: {
      name: 'text.setPageLimit',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 limit',
            name: 'limit',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    620: {
      name: 'text.setImageFont',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle nativeImageData',
            name: 'nativeImageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    621: {
      name: 'text.setCharacterImage',
      family: 'text',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u16 character',
            name: 'character',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i32 selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    622: {
      name: 'draw.imageData',
      family: 'draw',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle imageData',
            name: 'imageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 rotation',
            name: 'rotation',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word transformMode',
            name: 'transformMode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    623: {
      name: 'draw.replaceImageData',
      family: 'draw',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle imageData',
            name: 'imageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 rotation',
            name: 'rotation',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word transformMode',
            name: 'transformMode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    624: {
      name: 'draw.loadAnimation',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    625: {
      name: 'draw.animationEnabled',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word enabled',
            name: 'enabled',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    628: {
      name: 'configuration.setAuthorMode',
      family: 'configuration',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    630: {
      name: 'fes.notifyObject',
      family: 'fes',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* event',
            name: 'event',
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
          {
            description: 'format* object',
            name: 'object',
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
          {
            description: 'word index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    631: {
      name: 'fes.createObject',
      family: 'fes',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 type',
            name: 'type',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    632: {
      name: 'fes.initializeObjects',
      family: 'fes',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* columns',
            name: 'columns',
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
          {
            description: 'format* row',
            name: 'row',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    633: {
      name: 'nameTable.open',
      family: 'nameTable',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    634: {
      name: 'nameTable.close',
      family: 'nameTable',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    635: {
      name: 'nameTable.findAlias',
      family: 'nameTable',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* alias',
            name: 'alias',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    636: {
      name: 'nameTable.numericId',
      family: 'nameTable',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    637: {
      name: 'nameTable.name',
      family: 'nameTable',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    638: {
      name: 'nameTable.field',
      family: 'nameTable',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u32 field',
            name: 'field',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    639: {
      name: 'nameTable.matchesFilename',
      family: 'nameTable',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    640: {
      name: 'nameTable.replaceFilename',
      family: 'nameTable',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    641: {
      name: 'bitmap.scaleAlpha',
      family: 'bitmap',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle|nativePtr bitmap',
            name: 'bitmap',
            type: {
              alternatives: [
                {
                  handleKind: 'unknown',
                  kind: 'handle',
                  ownership: 'unknown',
                },
                {
                  addressSpace: 'native',
                  direction: 'unknown',
                  kind: 'pointer',
                  target: {
                    kind: 'unknown',
                  },
                },
              ],
              kind: 'union',
            },
          },
          {
            description: 'u32 percentage',
            name: 'percentage',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    645: {
      name: 'fes.setLocal',
      family: 'fes',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    646: {
      name: 'fes.getLocal',
      family: 'fes',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    647: {
      name: 'fes.sleep',
      family: 'fes',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    649: {
      name: 'fes.saveLocalBank',
      family: 'fes',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'nativeID fes',
            name: 'fes',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    650: {
      name: 'fes.loadLocalBank',
      family: 'fes',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'nativeID fes',
            name: 'fes',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    651: {
      name: 'task.resetExitCode',
      family: 'task',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    653: {
      name: 'task.message84',
      family: 'task',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    654: {
      name: 'task.message85',
      family: 'task',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'format* first',
            name: 'first',
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
          {
            description: 'format* second',
            name: 'second',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    655: {
      name: 'task.message86',
      family: 'task',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'format* value',
            name: 'value',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    657: {
      name: 'draw.getAuxiliary',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    658: {
      name: 'variable.privateGet',
      family: 'variable',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    659: {
      name: 'variable.privateSet',
      family: 'variable',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    664: {
      name: 'fes.setNamedLocal',
      family: 'fes',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    665: {
      name: 'fes.copyPrivateFromCaller',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    666: {
      name: 'fes.copyPrivateToCaller',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    667: {
      name: 'fes.result',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    668: {
      name: 'fes.clearResult',
      family: 'fes',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    674: {
      name: 'resources.categoryIndex',
      family: 'resources',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'format* category',
            name: 'category',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    675: {
      name: 'dictionary.create',
      family: 'dictionary',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    676: {
      name: 'dictionary.release',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    677: {
      name: 'dictionary.setFormatted',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* key',
            name: 'key',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    678: {
      name: 'dictionary.removeFormatted',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* key',
            name: 'key',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    679: {
      name: 'dictionary.getFormattedOr',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* key',
            name: 'key',
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
          {
            description: 'word fallback',
            name: 'fallback',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    680: {
      name: 'dictionary.firstKeyForValue',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr key',
            name: 'key',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    681: {
      name: 'image.warmup',
      family: 'image',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    683: {
      name: 'sectionTable.load',
      family: 'sectionTable',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    684: {
      name: 'sectionTable.release',
      family: 'sectionTable',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    685: {
      name: 'sectionTable.get',
      family: 'sectionTable',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle table',
            name: 'table',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* section',
            name: 'section',
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
          {
            description: 'format* key',
            name: 'key',
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
          {
            description: 'i32 ordinal',
            name: 'ordinal',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    693: {
      name: 'particle.loadPlugin',
      family: 'particle',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* program',
            name: 'program',
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
          {
            description: 'format* texture',
            name: 'texture',
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
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'f32 priority',
            name: 'priority',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'VMptr registers32',
            name: 'registers32',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    694: {
      name: 'task.setUserValue',
      family: 'task',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    695: {
      name: 'text.setSpeed',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 speed',
            name: 'speed',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    696: {
      name: 'displayLog.create',
      family: 'displayLog',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    697: {
      name: 'displayLog.release',
      family: 'displayLog',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    698: {
      name: 'displayLog.append',
      family: 'displayLog',
      signature: {
        argumentWords: 7,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* scene',
            name: 'scene',
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
          {
            description: 'u32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'format* text',
            name: 'text',
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
          {
            description: 'word voice',
            name: 'voice',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word paragraph',
            name: 'paragraph',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    699: {
      name: 'displayLog.rebuild',
      family: 'displayLog',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle sceneData',
            name: 'sceneData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* voiceCommand',
            name: 'voiceCommand',
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
          {
            description: 'format* paragraphCommand',
            name: 'paragraphCommand',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    700: {
      name: 'displayLog.speakerName',
      family: 'displayLog',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    701: {
      name: 'movie.planeLoad',
      family: 'movie',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word planeTask',
            name: 'planeTask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    702: {
      name: 'movie.planeBorrow',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'word planeTask',
            name: 'planeTask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'borrowed handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'borrowed',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    703: {
      name: 'draw.loadRenderSources',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* manifest',
            name: 'manifest',
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
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'i32 initializationCount',
            name: 'initializationCount',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    704: {
      name: 'draw.releaseRenderSources',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr sources',
            name: 'sources',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    705: {
      name: 'bitmap.resize',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle|nativePtr bitmap',
            name: 'bitmap',
            type: {
              alternatives: [
                {
                  handleKind: 'unknown',
                  kind: 'handle',
                  ownership: 'unknown',
                },
                {
                  addressSpace: 'native',
                  direction: 'unknown',
                  kind: 'pointer',
                  target: {
                    kind: 'unknown',
                  },
                },
              ],
              kind: 'union',
            },
          },
          {
            description: 'u32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    706: {
      name: 'draw.retainedGeometry',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'nativePtr retainedSource',
            name: 'retainedSource',
            type: {
              addressSpace: 'native',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr metadata36',
            name: 'metadata36',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    707: {
      name: 'draw.retainedSource',
      family: 'draw',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'nativePtr retainedSource',
            name: 'retainedSource',
            type: {
              addressSpace: 'native',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 rotation',
            name: 'rotation',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word transformMode',
            name: 'transformMode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    708: {
      name: 'draw.updateRetainedSource',
      family: 'draw',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'nativePtr retainedSource',
            name: 'retainedSource',
            type: {
              addressSpace: 'native',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 rotation',
            name: 'rotation',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word visible',
            name: 'visible',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word transformMode',
            name: 'transformMode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    709: {
      name: 'draw.borrowRetainedFrame',
      family: 'draw',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'nativePtr retainedSource',
            name: 'retainedSource',
            type: {
              addressSpace: 'native',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'i32 ordinal',
            name: 'ordinal',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          addressSpace: 'native',
          description: 'nativePtr',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            kind: 'unknown',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    710: {
      name: 'imageOwner.load',
      family: 'imageOwner',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    711: {
      name: 'imageOwner.release',
      family: 'imageOwner',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    712: {
      name: 'imageOwner.size',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr width',
            name: 'width',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr height',
            name: 'height',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    713: {
      name: 'imageOwner.scaleRGB',
      family: 'imageOwner',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word blue',
            name: 'blue',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word green',
            name: 'green',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word red',
            name: 'red',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    714: {
      name: 'imageOwner.canvasSize',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr width',
            name: 'width',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr height',
            name: 'height',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    715: {
      name: 'imageOwner.offset',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    716: {
      name: 'imageOwner.multiplyColor',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word ARGB',
            name: 'ARGB',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    717: {
      name: 'imageOwner.base',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    718: {
      name: 'imageOwner.setCanvasSize',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    719: {
      name: 'imageOwner.setOffset',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    720: {
      name: 'imageOwner.setBase',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    721: {
      name: 'imageOwner.hasAlpha',
      family: 'imageOwner',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    722: {
      name: 'imageOwner.setAlphaHint',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word enabled',
            name: 'enabled',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    723: {
      name: 'imageOwner.rotate',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 degrees',
            name: 'degrees',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    724: {
      name: 'imageOwner.attribute',
      family: 'imageOwner',
      signature: {
        argumentWords: 7,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u16 index',
            name: 'index',
            type: {
              bits: 16,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr a',
            name: 'a',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr b',
            name: 'b',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr c',
            name: 'c',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr d',
            name: 'd',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr e',
            name: 'e',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    725: {
      name: 'imageOwner.copyAttributes',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle destination',
            name: 'destination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle source',
            name: 'source',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    726: {
      name: 'imageOwner.blur',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 radiusX',
            name: 'radiusX',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 radiusY',
            name: 'radiusY',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    727: {
      name: 'imageOwner.flip',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word horizontal',
            name: 'horizontal',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    728: {
      name: 'imageOwner.setMask',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mask',
            name: 'mask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    729: {
      name: 'imageOwner.scaleAlpha',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word percent',
            name: 'percent',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    730: {
      name: 'imageOwner.resize',
      family: 'imageOwner',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 canvasWidth',
            name: 'canvasWidth',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 canvasHeight',
            name: 'canvasHeight',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    731: {
      name: 'imageOwner.draw',
      family: 'imageOwner',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID surface',
            name: 'surface',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 angle',
            name: 'angle',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word display',
            name: 'display',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    732: {
      name: 'imageOwner.replaceDraw',
      family: 'imageOwner',
      signature: {
        argumentWords: 13,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID surface',
            name: 'surface',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseX',
            name: 'baseX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 baseY',
            name: 'baseY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 angle',
            name: 'angle',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleX',
            name: 'scaleX',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 scaleY',
            name: 'scaleY',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word alpha',
            name: 'alpha',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word display',
            name: 'display',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    733: {
      name: 'imageOwner.create',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    734: {
      name: 'imageOwner.blendRect',
      family: 'imageOwner',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle readSource',
            name: 'readSource',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'handle writeDestination',
            name: 'writeDestination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 sourceX',
            name: 'sourceX',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceY',
            name: 'sourceY',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceWidth',
            name: 'sourceWidth',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceHeight',
            name: 'sourceHeight',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    735: {
      name: 'imageOwner.copyRect',
      family: 'imageOwner',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle readSource',
            name: 'readSource',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'handle writeDestination',
            name: 'writeDestination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 sourceX',
            name: 'sourceX',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceY',
            name: 'sourceY',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceWidth',
            name: 'sourceWidth',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 sourceHeight',
            name: 'sourceHeight',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    736: {
      name: 'imageOwner.fill',
      family: 'imageOwner',
      signature: {
        argumentWords: 6,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle nullableImage',
            name: 'nullableImage',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'word ARGB',
            name: 'ARGB',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    737: {
      name: 'imageOwner.colorMode',
      family: 'imageOwner',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle image',
            name: 'image',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    738: {
      name: 'fes.setObjectImageData',
      family: 'fes',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'handle nativeImageData',
            name: 'nativeImageData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    739: {
      name: 'view.borderOffset',
      family: 'view',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    740: {
      name: 'view.fullPositionCoordinates',
      family: 'view',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    741: {
      name: 'configuration.multiWindowPosition',
      family: 'configuration',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    742: {
      name: 'questionDatabase.create',
      family: 'questionDatabase',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    743: {
      name: 'questionDatabase.release',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    744: {
      name: 'questionDatabase.loadQuestions',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    745: {
      name: 'questionDatabase.questionCount',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    746: {
      name: 'questionDatabase.questionText',
      family: 'questionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    747: {
      name: 'questionDatabase.image',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    748: {
      name: 'questionDatabase.answerText',
      family: 'questionDatabase',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 answer',
            name: 'answer',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    749: {
      name: 'questionDatabase.operation2ED',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    750: {
      name: 'questionDatabase.loadConfigurations',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    751: {
      name: 'questionDatabase.selectConfiguration',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    752: {
      name: 'questionDatabase.configuredCount',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    753: {
      name: 'questionDatabase.operation2F1',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    754: {
      name: 'questionDatabase.configurationName',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    755: {
      name: 'questionDatabase.rival',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    756: {
      name: 'questionDatabase.rivalType',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    757: {
      name: 'questionDatabase.rivalImage',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    758: {
      name: 'questionDatabase.rivalPosition',
      family: 'questionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr x',
            name: 'x',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr y',
            name: 'y',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    759: {
      name: 'questionDatabase.memberEnabled',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 member',
            name: 'member',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    760: {
      name: 'questionDatabase.backgroundMusic',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    761: {
      name: 'questionDatabase.disabledMask',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    762: {
      name: 'questionDatabase.experience',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    763: {
      name: 'questionDatabase.outcomeValues',
      family: 'questionDatabase',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr playerWin',
            name: 'playerWin',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr playerLose',
            name: 'playerLose',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr rivalWin',
            name: 'rivalWin',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr rivalLose',
            name: 'rivalLose',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    764: {
      name: 'questionDatabase.rebuildPool',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    765: {
      name: 'questionDatabase.selectQuestion',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    766: {
      name: 'questionDatabase.operation2FE',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    767: {
      name: 'questionDatabase.exportState',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'PEptr nullableDestination',
            name: 'nullableDestination',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    768: {
      name: 'questionDatabase.importState',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'PEptr source',
            name: 'source',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    769: {
      name: 'questionDatabase.operation301',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    770: {
      name: 'questionDatabase.operation302',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    771: {
      name: 'questionDatabase.operation303',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    772: {
      name: 'questionDatabase.operation304',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    773: {
      name: 'questionDatabase.clearMemberFlags',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    774: {
      name: 'questionDatabase.enableMember',
      family: 'questionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 member',
            name: 'member',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    775: {
      name: 'questionDatabase.hasPartners',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    776: {
      name: 'questionDatabase.operation308',
      family: 'questionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 genre',
            name: 'genre',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    777: {
      name: 'questionDatabase.operation309',
      family: 'questionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 genre',
            name: 'genre',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word group',
            name: 'group',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    778: {
      name: 'questionDatabase.clearAddedGenres',
      family: 'questionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle questionDatabase',
            name: 'questionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    779: {
      name: 'selectionDatabase.create',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    780: {
      name: 'selectionDatabase.release',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    781: {
      name: 'selectionDatabase.registerName',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    782: {
      name: 'selectionDatabase.load',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    783: {
      name: 'selectionDatabase.count',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    784: {
      name: 'selectionDatabase.at',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    785: {
      name: 'displayLog.setBlockLimit',
      family: 'displayLog',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 limit',
            name: 'limit',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    786: {
      name: 'calendar.weekday',
      family: 'calendar',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'i32 year',
            name: 'year',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 month',
            name: 'month',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 day',
            name: 'day',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    787: {
      name: 'view.drawingRectangle',
      family: 'view',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr first',
            name: 'first',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr second',
            name: 'second',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr third',
            name: 'third',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr fourth',
            name: 'fourth',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    788: {
      name: 'movie.rectangle',
      family: 'movie',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    789: {
      name: 'configuration.variableCount',
      family: 'configuration',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    790: {
      name: 'configuration.variableRange',
      family: 'configuration',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'bool global',
            name: 'global',
            type: {
              kind: 'boolean',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr start',
            name: 'start',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr count',
            name: 'count',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    791: {
      name: 'compiledTable.load',
      family: 'compiledTable',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    792: {
      name: 'compiledTable.release',
      family: 'compiledTable',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle compiledTable',
            name: 'compiledTable',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    793: {
      name: 'compiledTable.word',
      family: 'compiledTable',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle compiledTable',
            name: 'compiledTable',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* column',
            name: 'column',
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
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    794: {
      name: 'compiledTable.bytes',
      family: 'compiledTable',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle compiledTable',
            name: 'compiledTable',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* column',
            name: 'column',
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
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    795: {
      name: 'missionDatabase.load',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    796: {
      name: 'missionDatabase.release',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    797: {
      name: 'missionDatabase.setLevel',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 level',
            name: 'level',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    798: {
      name: 'missionDatabase.level',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    799: {
      name: 'missionDatabase.setPlace',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 place',
            name: 'place',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    800: {
      name: 'missionDatabase.operation320',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    801: {
      name: 'missionDatabase.complete',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    802: {
      name: 'missionDatabase.countCompletions',
      family: 'missionDatabase',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr completed',
            name: 'completed',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr count',
            name: 'count',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'i32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 last',
            name: 'last',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    803: {
      name: 'missionDatabase.completionStatus',
      family: 'missionDatabase',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr completed',
            name: 'completed',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr repeated',
            name: 'repeated',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    804: {
      name: 'missionDatabase.filename',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    805: {
      name: 'missionDatabase.characterAt',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 ordinal',
            name: 'ordinal',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    806: {
      name: 'missionDatabase.questionTable',
      family: 'missionDatabase',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    807: {
      name: 'missionDatabase.operation327',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 character',
            name: 'character',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    808: {
      name: 'missionDatabase.operation328',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 character',
            name: 'character',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    809: {
      name: 'missionDatabase.operation329',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    810: {
      name: 'missionDatabase.operation32A',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 amount',
            name: 'amount',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    811: {
      name: 'missionDatabase.operation32B',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 character',
            name: 'character',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i32 delta',
            name: 'delta',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    812: {
      name: 'missionDatabase.operation32C',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 character',
            name: 'character',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i32 delta',
            name: 'delta',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    813: {
      name: 'missionDatabase.operation32D',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 character',
            name: 'character',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    814: {
      name: 'missionDatabase.operation32E',
      family: 'missionDatabase',
      signature: {
        argumentWords: 8,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'VMptr output1',
            name: 'output1',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr output2',
            name: 'output2',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr output3',
            name: 'output3',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr output4',
            name: 'output4',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr output5',
            name: 'output5',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr output6',
            name: 'output6',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    815: {
      name: 'missionDatabase.updateAvailability',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    816: {
      name: 'missionDatabase.updateSelection',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr words',
            name: 'words',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'i32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    817: {
      name: 'missionDatabase.operation331',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 type',
            name: 'type',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    818: {
      name: 'missionDatabase.operation332',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 type',
            name: 'type',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    819: {
      name: 'missionDatabase.operation333',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 type',
            name: 'type',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    820: {
      name: 'missionDatabase.field',
      family: 'missionDatabase',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u32 field',
            name: 'field',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    821: {
      name: 'missionDatabase.reset',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    822: {
      name: 'missionDatabase.operation336',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    823: {
      name: 'missionDatabase.exportState',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'PEptr nullableDestination',
            name: 'nullableDestination',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    824: {
      name: 'missionDatabase.importState',
      family: 'missionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'PEptr nullableSource',
            name: 'nullableSource',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    825: {
      name: 'missionDatabase.operation339',
      family: 'missionDatabase',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'u32 selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    826: {
      name: 'missionDatabase.elapsed',
      family: 'missionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 mission',
            name: 'mission',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    827: {
      name: 'missionDatabase.advanceElapsed',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    828: {
      name: 'missionDatabase.clearTotal',
      family: 'missionDatabase',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle missionDatabase',
            name: 'missionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    829: {
      name: 'selectionDatabase.operation33D',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 row',
            name: 'row',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    830: {
      name: 'selectionDatabase.operation33E',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    831: {
      name: 'selectionDatabase.operation33F',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    832: {
      name: 'selectionDatabase.operation340',
      family: 'selectionDatabase',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle selectionDatabase',
            name: 'selectionDatabase',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    833: {
      name: 'hostMemory.allocate',
      family: 'hostMemory',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          addressSpace: 'pe',
          description: 'PEptr',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            kind: 'unknown',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    834: {
      name: 'hostMemory.free',
      family: 'hostMemory',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'PEptr block',
            name: 'block',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    835: {
      name: 'globalFile.writeHostData',
      family: 'globalFile',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 bytes',
            name: 'bytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'PEptr source',
            name: 'source',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    836: {
      name: 'globalFile.readHostData',
      family: 'globalFile',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr byteCount',
            name: 'byteCount',
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
        result: {
          addressSpace: 'pe',
          description: 'PEptr',
          direction: 'unknown',
          kind: 'pointer',
          target: {
            kind: 'unknown',
          },
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    844: {
      name: 'legacySound.rowIndex',
      family: 'legacySound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    845: {
      name: 'window.toggleDisplayMode',
      family: 'window',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    846: {
      name: 'window.minimize',
      family: 'window',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    847: {
      name: 'window.requestClose',
      family: 'window',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    848: {
      name: 'plane.setFilter',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word filter',
            name: 'filter',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    849: {
      name: 'plane.setReferenceCapture',
      family: 'plane',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    850: {
      name: 'displayLog.save',
      family: 'displayLog',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word tag',
            name: 'tag',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    851: {
      name: 'displayLog.load',
      family: 'displayLog',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word tag',
            name: 'tag',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    852: {
      name: 'configuration.staticLog',
      family: 'configuration',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    853: {
      name: 'screenEffect.command355',
      family: 'screenEffect',
      signature: {
        argumentWords: 6,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument5',
            name: 'argument5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    854: {
      name: 'screenEffect.command356',
      family: 'screenEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    855: {
      name: 'screenEffect.command357',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    856: {
      name: 'screenEffect.command358',
      family: 'screenEffect',
      signature: {
        argumentWords: 7,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument5',
            name: 'argument5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument6',
            name: 'argument6',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    857: {
      name: 'screenEffect.command359',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    858: {
      name: 'screenEffect.command35A',
      family: 'screenEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    859: {
      name: 'screenEffect.command35B',
      family: 'screenEffect',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    860: {
      name: 'screenEffect.command35C',
      family: 'screenEffect',
      signature: {
        argumentWords: 8,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument5',
            name: 'argument5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument6',
            name: 'argument6',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument7',
            name: 'argument7',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    861: {
      name: 'screenEffect.command35D',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    862: {
      name: 'draw.setRectangle',
      family: 'draw',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word width',
            name: 'width',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word height',
            name: 'height',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    863: {
      name: 'recordStack.create',
      family: 'recordStack',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 recordBytes',
            name: 'recordBytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word growthRecords',
            name: 'growthRecords',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    864: {
      name: 'recordStack.release',
      family: 'recordStack',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle stack',
            name: 'stack',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    865: {
      name: 'recordStack.push',
      family: 'recordStack',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle stack',
            name: 'stack',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    866: {
      name: 'recordStack.pop',
      family: 'recordStack',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle stack',
            name: 'stack',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    867: {
      name: 'recordStack.count',
      family: 'recordStack',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle stack',
            name: 'stack',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    868: {
      name: 'recordStack.copy',
      family: 'recordStack',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle destination',
            name: 'destination',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle source',
            name: 'source',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    869: {
      name: 'database.load',
      family: 'database',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'format* optionA',
            name: 'optionA',
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
          {
            description: 'format* optionB',
            name: 'optionB',
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
          {
            description: 'format* optionC',
            name: 'optionC',
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
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    870: {
      name: 'database.release',
      family: 'database',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle database',
            name: 'database',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    871: {
      name: 'database.setFlag',
      family: 'database',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle database',
            name: 'database',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word bit',
            name: 'bit',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* index',
            name: 'index',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    872: {
      name: 'database.exportFlags',
      family: 'database',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle database',
            name: 'database',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'PEptr nullableDestination',
            name: 'nullableDestination',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    873: {
      name: 'database.importFlags',
      family: 'database',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle database',
            name: 'database',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'PEptr nullableSource',
            name: 'nullableSource',
            type: {
              addressSpace: 'pe',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    874: {
      name: 'math.packWords',
      family: 'math',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'word low',
            name: 'low',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word high',
            name: 'high',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    875: {
      name: 'math.unpackWords',
      family: 'math',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'word packed',
            name: 'packed',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr lowSigned',
            name: 'lowSigned',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr highSigned',
            name: 'highSigned',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    876: {
      name: 'displayLog.clear',
      family: 'displayLog',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    877: {
      name: 'database.dirty',
      family: 'database',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle database',
            name: 'database',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    878: {
      name: 'database.clearDirty',
      family: 'database',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle database',
            name: 'database',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    879: {
      name: 'draw.bindAnimationSound',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word soundBank',
            name: 'soundBank',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    880: {
      name: 'draw.setAnimationVariable',
      family: 'draw',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word key',
            name: 'key',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    881: {
      name: 'draw.setAnimationSoundThreshold',
      family: 'draw',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word entry',
            name: 'entry',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 threshold',
            name: 'threshold',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    882: {
      name: 'fes.setNamed',
      family: 'fes',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    883: {
      name: 'fes.getNamed',
      family: 'fes',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle fes',
            name: 'fes',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    884: {
      name: 'text.remainingPage',
      family: 'text',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle task',
            name: 'task',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    885: {
      name: 'dictionary.create',
      family: 'dictionary',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    886: {
      name: 'dictionary.release',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    887: {
      name: 'dictionary.set',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* key',
            name: 'key',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    888: {
      name: 'dictionary.get',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* key',
            name: 'key',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    889: {
      name: 'dictionary.clear',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    890: {
      name: 'dictionary.serializedSize',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    891: {
      name: 'dictionary.export',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    892: {
      name: 'dictionary.import',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    893: {
      name: 'dictionary.keyAt',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    894: {
      name: 'dictionary.create',
      family: 'dictionary',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    895: {
      name: 'dictionary.release',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    896: {
      name: 'dictionary.set',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* key',
            name: 'key',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    897: {
      name: 'dictionary.get',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* key',
            name: 'key',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    898: {
      name: 'dictionary.clear',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    899: {
      name: 'dictionary.serializedSize',
      family: 'dictionary',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    900: {
      name: 'dictionary.export',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    901: {
      name: 'dictionary.import',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    902: {
      name: 'dictionary.keyAt',
      family: 'dictionary',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    903: {
      name: 'sound.tagValue',
      family: 'sound',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'i32 bankOrAll',
            name: 'bankOrAll',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'format* tag',
            name: 'tag',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    904: {
      name: 'string.mergeCommaFields',
      family: 'string',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr inOut',
            name: 'inOut',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'format* replacement',
            name: 'replacement',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    905: {
      name: 'screenEffect.command389',
      family: 'screenEffect',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    906: {
      name: 'emote.message524',
      family: 'emote',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* model',
            name: 'model',
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
          {
            description: 'word flags',
            name: 'flags',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    907: {
      name: 'emote.message526',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    908: {
      name: 'emote.message527',
      family: 'emote',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    909: {
      name: 'emote.message528',
      family: 'emote',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    910: {
      name: 'emote.message529',
      family: 'emote',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr outA',
            name: 'outA',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr outB',
            name: 'outB',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr outC',
            name: 'outC',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    911: {
      name: 'emote.message530Default',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    912: {
      name: 'emote.message530Named',
      family: 'emote',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    913: {
      name: 'emote.message530Dictionary',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    914: {
      name: 'emote.message532Default',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    915: {
      name: 'emote.message532Named',
      family: 'emote',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    916: {
      name: 'emote.message532Dictionary',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    917: {
      name: 'emote.message533',
      family: 'emote',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    918: {
      name: 'emote.message535',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    919: {
      name: 'emote.message536',
      family: 'emote',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    920: {
      name: 'emote.message538',
      family: 'emote',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    921: {
      name: 'emote.message538Dictionary',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    922: {
      name: 'emote.globalCommand39A',
      family: 'emote',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    923: {
      name: 'emote.globalCommand39B',
      family: 'emote',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    924: {
      name: 'emote.message540',
      family: 'emote',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    925: {
      name: 'emote.constantOne',
      family: 'emote',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    926: {
      name: 'emote.message534',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    927: {
      name: 'emote.message541',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    928: {
      name: 'emote.message542',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    929: {
      name: 'emote.message543',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    930: {
      name: 'emote.message544',
      family: 'emote',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    931: {
      name: 'emote.message545',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    932: {
      name: 'emote.globalCommand3A4',
      family: 'emote',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    933: {
      name: 'emote.globalCommand3A5',
      family: 'emote',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    934: {
      name: 'scene.aliasSeen',
      family: 'scene',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* source',
            name: 'source',
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
          {
            description: 'format* destination',
            name: 'destination',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    935: {
      name: 'sound.loadBankWithOption',
      family: 'sound',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 bank',
            name: 'bank',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'word unused',
            name: 'unused',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'u32 loadType',
            name: 'loadType',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 framesOption',
            name: 'framesOption',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    936: {
      name: 'sound.loadGroupWithOption',
      family: 'sound',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word unused',
            name: 'unused',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
          {
            description: 'bool byId',
            name: 'byId',
            type: {
              kind: 'boolean',
            },
          },
          {
            description: 'u32 loadType',
            name: 'loadType',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 framesOption',
            name: 'framesOption',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32 bank',
          kind: 'integer',
          meaning: 'bank-index',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    937: {
      name: 'input.resetWheel',
      family: 'input',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    938: {
      name: 'sound.configurationLoaded',
      family: 'sound',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    939: {
      name: 'sound.master.volume',
      family: 'sound',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    940: {
      name: 'sound.master.play',
      family: 'sound',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    941: {
      name: 'sound.master.sysplay',
      family: 'sound',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    942: {
      name: 'sound.master.mute',
      family: 'sound',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    943: {
      name: 'sound.filename.volume',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    944: {
      name: 'sound.filename.play',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    945: {
      name: 'sound.filename.sysplay',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    946: {
      name: 'sound.filename.mastervol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    947: {
      name: 'sound.filename.voicevol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    948: {
      name: 'sound.filename.skipvol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    949: {
      name: 'sound.filename.mute',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    950: {
      name: 'sound.type.volume',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    951: {
      name: 'sound.type.play',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    952: {
      name: 'sound.type.sysplay',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    953: {
      name: 'sound.type.mastervol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    954: {
      name: 'sound.type.voicevol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    955: {
      name: 'sound.type.skipvol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    956: {
      name: 'sound.type.mute',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    957: {
      name: 'sound.key.volume',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    958: {
      name: 'sound.key.play',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    959: {
      name: 'sound.key.sysplay',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    960: {
      name: 'sound.key.mastervol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    961: {
      name: 'sound.key.voicevol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    962: {
      name: 'sound.key.skipvol',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    963: {
      name: 'sound.key.mute',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* selector',
            name: 'selector',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    964: {
      name: 'sound.effectiveVolume',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    965: {
      name: 'emote.message547',
      family: 'emote',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'word valueA',
            name: 'valueA',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word valueB',
            name: 'valueB',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    966: {
      name: 'emote.message531Dictionary',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    967: {
      name: 'screenEffect.command3C7',
      family: 'screenEffect',
      signature: {
        argumentWords: 7,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument5',
            name: 'argument5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument6',
            name: 'argument6',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    968: {
      name: 'screenEffect.command3C8',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    969: {
      name: 'screenEffect.command3C9',
      family: 'screenEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    970: {
      name: 'screenEffect.command3CA',
      family: 'screenEffect',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    971: {
      name: 'screenEffect.command3CB',
      family: 'screenEffect',
      signature: {
        argumentWords: 10,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument2',
            name: 'argument2',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument3',
            name: 'argument3',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument4',
            name: 'argument4',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument5',
            name: 'argument5',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument6',
            name: 'argument6',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument7',
            name: 'argument7',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument8',
            name: 'argument8',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument9',
            name: 'argument9',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    972: {
      name: 'screenEffect.command3CC',
      family: 'screenEffect',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word argument0',
            name: 'argument0',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word argument1',
            name: 'argument1',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    974: {
      name: 'javascript.linkScript',
      family: 'javascript',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'nativeID script',
            name: 'script',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    975: {
      name: 'javascript.load',
      family: 'javascript',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    976: {
      name: 'javascript.call',
      family: 'javascript',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID targetOrParent',
            name: 'targetOrParent',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'format* functionName',
            name: 'functionName',
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
          {
            description: 'u32 firstString',
            name: 'firstString',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i32 count',
            name: 'count',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    977: {
      name: 'displayLog.appendPath',
      family: 'displayLog',
      signature: {
        argumentWords: 8,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* scene',
            name: 'scene',
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
          {
            description: 'u32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
          {
            description: 'format* text',
            name: 'text',
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
          {
            description: 'word voice',
            name: 'voice',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'word paragraph',
            name: 'paragraph',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'u32 pathIndex',
            name: 'pathIndex',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    978: {
      name: 'scene.setPathExtra',
      family: 'scene',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    979: {
      name: 'scene.pathExtra',
      family: 'scene',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    980: {
      name: 'scene.messageCount',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    981: {
      name: 'scene.copyExtra',
      family: 'scene',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle source',
            name: 'source',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    982: {
      name: 'scene.lastPathIndex',
      family: 'scene',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    988: {
      name: 'movie.planeEffectLoad',
      family: 'movie',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'word planeTask',
            name: 'planeTask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    989: {
      name: 'movie.planeEffectBorrow',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'word planeTask',
            name: 'planeTask',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'borrowed handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'borrowed',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    990: {
      name: 'globalFile.removeFile',
      family: 'globalFile',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    991: {
      name: 'scene.appendCheckpoint',
      family: 'scene',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 position',
            name: 'position',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'format* configuration',
            name: 'configuration',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    992: {
      name: 'scene.restoreCheckpoint',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr sceneIndex',
            name: 'sceneIndex',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr position',
            name: 'position',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'format* configuration',
            name: 'configuration',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    993: {
      name: 'scene.copyPath',
      family: 'scene',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle source',
            name: 'source',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    994: {
      name: 'scene.pruneCheckpoints',
      family: 'scene',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle sceneData',
            name: 'sceneData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'u32 pathIndex',
            name: 'pathIndex',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'i32 position',
            name: 'position',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    995: {
      name: 'sound.effectiveVoiceVolume',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    996: {
      name: 'movie.mode',
      family: 'movie',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'word mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    997: {
      name: 'movie.renderGate',
      family: 'movie',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'bool enabled',
            name: 'enabled',
            type: {
              kind: 'boolean',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    998: {
      name: 'movie.positionMilliseconds',
      family: 'movie',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle movie',
            name: 'movie',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    999: {
      name: 'configuration.sceneAutoSelect',
      family: 'configuration',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1000: {
      name: 'sound.sameIdForFilename',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1001: {
      name: 'sound.idForFilename',
      family: 'sound',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1002: {
      name: 'script.replaceConfigured',
      family: 'script',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'format* source',
            name: 'source',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1006: {
      name: 'javascript.setOption',
      family: 'javascript',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'nativeID target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'unknown',
            },
          },
          {
            description: 'word option',
            name: 'option',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1010: {
      name: 'recordQueue.create',
      family: 'recordQueue',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'u32 recordBytes',
            name: 'recordBytes',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'handle',
          handleKind: 'unknown',
          kind: 'handle',
          ownership: 'unknown',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1011: {
      name: 'recordQueue.release',
      family: 'recordQueue',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle queue',
            name: 'queue',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1012: {
      name: 'recordQueue.push',
      family: 'recordQueue',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle queue',
            name: 'queue',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr source',
            name: 'source',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1013: {
      name: 'recordQueue.pop',
      family: 'recordQueue',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle queue',
            name: 'queue',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'VMptr destination',
            name: 'destination',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1024: {
      name: 'recordQueue.constantOne',
      family: 'recordQueue',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle queue',
            name: 'queue',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1025: {
      name: 'emote.selectMessage548Or549',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'word selector',
            name: 'selector',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1026: {
      name: 'bitmap.pixelAt',
      family: 'bitmap',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle nullableBitmap',
            name: 'nullableBitmap',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'i32 canvasX',
            name: 'canvasX',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 canvasY',
            name: 'canvasY',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1027: {
      name: 'emote.message551',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* name',
            name: 'name',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1028: {
      name: 'emote.message553',
      family: 'emote',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'format* unusedName',
            name: 'unusedName',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1029: {
      name: 'emote.message554Count',
      family: 'emote',
      signature: {
        argumentWords: 3,
        controlCodes: [1],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1030: {
      name: 'emote.message554Item',
      family: 'emote',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'word index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'bits',
            },
          },
          {
            description: 'VMptr nameA',
            name: 'nameA',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr nameB',
            name: 'nameB',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1031: {
      name: 'globalFile.writePreservingTime',
      family: 'globalFile',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle globalFile',
            name: 'globalFile',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* filename',
            name: 'filename',
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
        result: {
          description: 'bool',
          kind: 'boolean',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1033: {
      name: 'scene.localizedText',
      family: 'scene',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'format* language',
            name: 'language',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1034: {
      name: 'displayLog.rebuildLanguage',
      family: 'displayLog',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'handle log',
            name: 'log',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'handle sceneData',
            name: 'sceneData',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* voiceCommand',
            name: 'voiceCommand',
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
          {
            description: 'format* paragraphCommand',
            name: 'paragraphCommand',
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
          {
            description: 'format* languageCommand',
            name: 'languageCommand',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1035: {
      name: 'taskScene.localizedText',
      family: 'taskScene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'format* language',
            name: 'language',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1036: {
      name: 'configuration.languagePrefixes',
      family: 'configuration',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'VMptr mainPrefix',
            name: 'mainPrefix',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr subtitlePrefix',
            name: 'subtitlePrefix',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1037: {
      name: 'scene.utf8Text',
      family: 'scene',
      signature: {
        argumentWords: 4,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1038: {
      name: 'scene.localizedUtf8Text',
      family: 'scene',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle scene',
            name: 'scene',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'char* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
          {
            description: 'i32 block',
            name: 'block',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'i32 line',
            name: 'line',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'format* language',
            name: 'language',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1039: {
      name: 'clipboard.copyUTF8',
      family: 'clipboard',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* UTF8Text',
            name: 'UTF8Text',
            type: {
              addressSpace: 'vm',
              direction: 'in',
              kind: 'pointer',
              target: {
                decoderContract: 'native-permissive',
                encoding: 'UTF-8',
                kind: 'format-string',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1040: {
      name: 'log.writeUTF8',
      family: 'log',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* UTF8Text',
            name: 'UTF8Text',
            type: {
              addressSpace: 'vm',
              direction: 'in',
              kind: 'pointer',
              target: {
                decoderContract: 'native-permissive',
                encoding: 'UTF-8',
                kind: 'format-string',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1041: {
      name: 'steam.initialize',
      family: 'steam',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1042: {
      name: 'steam.setAchievement',
      family: 'steam',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* achievement',
            name: 'achievement',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1043: {
      name: 'steam.achievement',
      family: 'steam',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'format* achievement',
            name: 'achievement',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1044: {
      name: 'steam.resetStatsUnwrittenWord',
      family: 'steam',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1045: {
      name: 'utf8.truncateBytes',
      family: 'utf8',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr text',
            name: 'text',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 byteLimit',
            name: 'byteLimit',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1046: {
      name: 'utf8.truncateCharacters',
      family: 'utf8',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr text',
            name: 'text',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'u32 characterLimit',
            name: 'characterLimit',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1047: {
      name: 'emote.message552',
      family: 'emote',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1048: {
      name: 'emote.message550',
      family: 'emote',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'task target',
            name: 'target',
            type: {
              kind: 'object-id',
              objectKind: 'task',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1049: {
      name: 'text.extractPlainUTF8',
      family: 'text',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr destination',
            name: 'destination',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'format* source',
            name: 'source',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1050: {
      name: 'configuration.sceneAnimation',
      family: 'configuration',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1051: {
      name: 'utf8.findCP932Key',
      family: 'utf8',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'VMptr UTF8Text',
            name: 'UTF8Text',
            type: {
              addressSpace: 'vm',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'unknown',
              },
            },
          },
          {
            description: 'VMptr CP932Key',
            name: 'CP932Key',
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
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1052: {
      name: 'dictionary.findKeyPrefix',
      family: 'dictionary',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'handle dictionary',
            name: 'dictionary',
            type: {
              handleKind: 'unknown',
              kind: 'handle',
              ownership: 'unknown',
            },
          },
          {
            description: 'format* query',
            name: 'query',
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
        result: {
          bits: 32,
          description: 'word',
          kind: 'bits',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    1053: {
      name: 'configuration.setLanguage',
      family: 'configuration',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'u32 kind',
            name: 'kind',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'u32 index',
            name: 'index',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1054: {
      name: 'window.postMessage468',
      family: 'window',
      signature: {
        argumentWords: 0,
        controlCodes: [2],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
  },
  generic: {
    0: {
      name: 'debug.print',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'format* text',
            name: 'text',
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
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1: {
      name: 'math.sin',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    2: {
      name: 'math.cos',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    3: {
      name: 'math.tan',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    4: {
      name: 'math.asin',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    5: {
      name: 'math.acos',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    6: {
      name: 'math.atan',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    7: {
      name: 'math.atan2',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    8: {
      name: 'math.ceil',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    9: {
      name: 'math.abs',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    10: {
      name: 'math.floor',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    11: {
      name: 'math.fmod',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    12: {
      name: 'math.sqrt',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    13: {
      name: 'math.pow',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 first',
            name: 'first',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 second',
            name: 'second',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    14: {
      name: 'math.degreeToRadian',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    15: {
      name: 'math.radianToDegree',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    16: {
      name: 'math.integerAbs',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'i32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    17: {
      name: 'math.roundInteger',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'i32',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    18: {
      name: 'vector.rotateX',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'f32* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32 radians',
            name: 'radians',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    19: {
      name: 'vector.rotateY',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'f32* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32 radians',
            name: 'radians',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    20: {
      name: 'vector.rotateZ',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'f32* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32 radians',
            name: 'radians',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    21: {
      name: 'vector.translate',
      family: 'motion',
      signature: {
        argumentWords: 6,
        controlCodes: [2],
        parameters: [
          {
            description: 'f32* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32 dx',
            name: 'dx',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 dy',
            name: 'dy',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 dz',
            name: 'dz',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    22: {
      name: 'vector.scale',
      family: 'motion',
      signature: {
        argumentWords: 6,
        controlCodes: [2],
        parameters: [
          {
            description: 'f32* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'f32 sx',
            name: 'sx',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 sy',
            name: 'sy',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 sz',
            name: 'sz',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    23: {
      name: 'matrix.rotateXYZ',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    24: {
      name: 'matrix.translate',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    25: {
      name: 'matrix.scale',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'f32 x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    26: {
      name: 'matrix.identity',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    27: {
      name: 'matrix.inverse',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    28: {
      name: 'matrix.copy',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* destination',
            name: 'destination',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'matrix4* source',
            name: 'source',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    29: {
      name: 'matrix.multiply',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'matrix4* right',
            name: 'right',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    30: {
      name: 'matrix.subtract',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'matrix4* right',
            name: 'right',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    31: {
      name: 'vector4.normalize',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'vector4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    32: {
      name: 'vector4.add',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'vector4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
          {
            description: 'vector4* right',
            name: 'right',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    33: {
      name: 'vector4.subtract',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'vector4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
          {
            description: 'vector4* right',
            name: 'right',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    34: {
      name: 'vector4.length',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'vector4* value',
            name: 'value',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    35: {
      name: 'vector4.lengthSquared',
      family: 'motion',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'vector4* value',
            name: 'value',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    36: {
      name: 'vector4.scale',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'vector4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
          {
            description: 'f32* scale',
            name: 'scale',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    37: {
      name: 'vector4.transform',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'vector4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector4',
              },
            },
          },
          {
            description: 'matrix4* matrix',
            name: 'matrix',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    38: {
      name: 'motion.exit',
      family: 'motion',
      signature: {
        argumentWords: 0,
        controlCodes: [4],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    39: {
      name: 'random.integer',
      family: 'motion',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'u32',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    40: {
      name: 'random.float',
      family: 'motion',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    41: {
      name: 'math.linearInterpolate',
      family: 'motion',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 areaMin',
            name: 'areaMin',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 areaMax',
            name: 'areaMax',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 inputMin',
            name: 'inputMin',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 inputMax',
            name: 'inputMax',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    42: {
      name: 'math.triangleWave',
      family: 'motion',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'f32 value',
            name: 'value',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 period',
            name: 'period',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'f32',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    43: {
      name: 'matrix.rotateYawPitchRoll',
      family: 'motion',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'f32 yaw',
            name: 'yaw',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 pitch',
            name: 'pitch',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'f32 roll',
            name: 'roll',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    44: {
      name: 'matrix.rotateRelative',
      family: 'motion',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'matrix4* inOut',
            name: 'inOut',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'matrix4* reference',
            name: 'reference',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'matrix4',
              },
            },
          },
          {
            description: 'vector3* radians',
            name: 'radians',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                kind: 'record',
                name: 'vector3',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
  },
  'particle-v1': {
    0: {
      name: 'DbgMessage',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* mes',
            name: 'mes',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1: {
      name: 'GetFrame',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    2: {
      name: 'GetBeforeFrame',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    3: {
      name: 'CalcFrame',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'dword frame',
            name: 'frame',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    4: {
      name: 'GetFps',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    5: {
      name: 'GetScreenSize',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'dword* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'dword* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    6: {
      name: 'sin',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    7: {
      name: 'cos',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    8: {
      name: 'tan',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    9: {
      name: 'asin',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    10: {
      name: 'acos',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    11: {
      name: 'atan',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    12: {
      name: 'atan2',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    13: {
      name: 'ceil',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    14: {
      name: 'fabs',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    15: {
      name: 'floor',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    16: {
      name: 'fmod',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float a',
            name: 'a',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float b',
            name: 'b',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    17: {
      name: 'sqrt',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    18: {
      name: 'pow',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float a',
            name: 'a',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float b',
            name: 'b',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    19: {
      name: 'Deg2Rad',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float d',
            name: 'd',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    20: {
      name: 'Rad2Deg',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    21: {
      name: 'abs',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'long r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    22: {
      name: 'rotate_x',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    23: {
      name: 'rotate_y',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    24: {
      name: 'rotate_z',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    25: {
      name: 'trans',
      family: 'particle',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    26: {
      name: 'scale',
      family: 'particle',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    27: {
      name: 'SetPos',
      family: 'particle',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    28: {
      name: 'GetPos',
      family: 'particle',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    29: {
      name: 'SetTex',
      family: 'particle',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'long x1',
            name: 'x1',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'long y1',
            name: 'y1',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'long x2',
            name: 'x2',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'long y2',
            name: 'y2',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    30: {
      name: 'GetBox',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    31: {
      name: 'SetBox',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    32: {
      name: 'exit',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [4],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    33: {
      name: 'rand',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    34: {
      name: 'frand',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    35: {
      name: 'GetReg',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* reg',
            name: 'reg',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    36: {
      name: 'GetNow',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    37: {
      name: 'GetDistance',
      family: 'particle',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'float x1',
            name: 'x1',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y1',
            name: 'y1',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z1',
            name: 'z1',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float x2',
            name: 'x2',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y2',
            name: 'y2',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z2',
            name: 'z2',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    38: {
      name: 'ParsScreen',
      family: 'particle',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float* x1',
            name: 'x1',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y1',
            name: 'y1',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* x2',
            name: 'x2',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y2',
            name: 'y2',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    39: {
      name: 'SetShow',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'dword no',
            name: 'no',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'long show',
            name: 'show',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    40: {
      name: 'GetMax',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    41: {
      name: 'LinearInt',
      family: 'particle',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'float as',
            name: 'as',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float ae',
            name: 'ae',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float ns',
            name: 'ns',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float ne',
            name: 'ne',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float n',
            name: 'n',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    42: {
      name: 'round',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    43: {
      name: 'triwave',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float a',
            name: 'a',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
  },
  'particle-v2': {
    0: {
      name: 'DbgMessage',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'char* mes',
            name: 'mes',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 8,
                encoding: 'unknown',
                kind: 'character',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    1: {
      name: 'GetFrame',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    2: {
      name: 'GetBeforeFrame',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    3: {
      name: 'CalcFrame',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'dword frame',
            name: 'frame',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    4: {
      name: 'GetFps',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    5: {
      name: 'GetScreenSize',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'dword* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
          {
            description: 'dword* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'integer',
                signed: false,
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    6: {
      name: 'sin',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    7: {
      name: 'cos',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    8: {
      name: 'tan',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    9: {
      name: 'asin',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    10: {
      name: 'acos',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    11: {
      name: 'atan',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    12: {
      name: 'atan2',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    13: {
      name: 'ceil',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    14: {
      name: 'fabs',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    15: {
      name: 'floor',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    16: {
      name: 'fmod',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float a',
            name: 'a',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float b',
            name: 'b',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    17: {
      name: 'sqrt',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    18: {
      name: 'pow',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float a',
            name: 'a',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float b',
            name: 'b',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    19: {
      name: 'Deg2Rad',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float d',
            name: 'd',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    20: {
      name: 'Rad2Deg',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    21: {
      name: 'abs',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'long r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    22: {
      name: 'rotate_x',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    23: {
      name: 'rotate_y',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    24: {
      name: 'rotate_z',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    25: {
      name: 'trans',
      family: 'particle',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    26: {
      name: 'scale',
      family: 'particle',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    27: {
      name: 'SetPos',
      family: 'particle',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'float x',
            name: 'x',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y',
            name: 'y',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    28: {
      name: 'GetPos',
      family: 'particle',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    29: {
      name: 'SetTex',
      family: 'particle',
      signature: {
        argumentWords: 4,
        controlCodes: [2],
        parameters: [
          {
            description: 'long x1',
            name: 'x1',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'long y1',
            name: 'y1',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'long x2',
            name: 'x2',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
          {
            description: 'long y2',
            name: 'y2',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    30: {
      name: 'GetBox',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    31: {
      name: 'SetBox',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* v',
            name: 'v',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    32: {
      name: 'exit',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [4],
        parameters: [],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    33: {
      name: 'rand',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    34: {
      name: 'frand',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    35: {
      name: 'GetReg',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* reg',
            name: 'reg',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    36: {
      name: 'GetNow',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    37: {
      name: 'GetDistance',
      family: 'particle',
      signature: {
        argumentWords: 6,
        controlCodes: [1],
        parameters: [
          {
            description: 'float x1',
            name: 'x1',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y1',
            name: 'y1',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z1',
            name: 'z1',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float x2',
            name: 'x2',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float y2',
            name: 'y2',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float z2',
            name: 'z2',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    38: {
      name: 'ParsScreen',
      family: 'particle',
      signature: {
        argumentWords: 5,
        controlCodes: [2],
        parameters: [
          {
            description: 'float z',
            name: 'z',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float* x1',
            name: 'x1',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y1',
            name: 'y1',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* x2',
            name: 'x2',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y2',
            name: 'y2',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    39: {
      name: 'SetShow',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'dword no',
            name: 'no',
            type: {
              bits: 32,
              kind: 'integer',
              signed: false,
            },
          },
          {
            description: 'long show',
            name: 'show',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    40: {
      name: 'GetMax',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'dword',
          kind: 'integer',
          signed: false,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    41: {
      name: 'LinearInt',
      family: 'particle',
      signature: {
        argumentWords: 5,
        controlCodes: [1],
        parameters: [
          {
            description: 'float as',
            name: 'as',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float ae',
            name: 'ae',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float ns',
            name: 'ns',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float ne',
            name: 'ne',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float n',
            name: 'n',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    42: {
      name: 'round',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [1],
        parameters: [
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    43: {
      name: 'triwave',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [1],
        parameters: [
          {
            description: 'float a',
            name: 'a',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
          {
            description: 'float r',
            name: 'r',
            type: {
              bits: 32,
              kind: 'float',
            },
          },
        ],
        result: {
          bits: 32,
          description: 'float',
          kind: 'float',
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    44: {
      name: 'ResetVertex',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'long no',
            name: 'no',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    45: {
      name: 'BackupVertex',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'long no',
            name: 'no',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
    46: {
      name: 'GetAttach',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    47: {
      name: 'GetAttachShow',
      family: 'particle',
      signature: {
        argumentWords: 0,
        controlCodes: [1],
        parameters: [],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    48: {
      name: 'GetAttachBase',
      family: 'particle',
      signature: {
        argumentWords: 2,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    49: {
      name: 'GetAttachPos',
      family: 'particle',
      signature: {
        argumentWords: 3,
        controlCodes: [2],
        parameters: [
          {
            description: 'float* x',
            name: 'x',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* y',
            name: 'y',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
          {
            description: 'float* z',
            name: 'z',
            type: {
              addressSpace: 'unknown',
              direction: 'unknown',
              kind: 'pointer',
              target: {
                bits: 32,
                kind: 'float',
              },
            },
          },
        ],
        result: {
          bits: 32,
          description: 'long',
          kind: 'integer',
          signed: true,
        },
        resultWritten: null,
        review: 'declared',
      },
    },
    50: {
      name: 'SetBlendMode',
      family: 'particle',
      signature: {
        argumentWords: 1,
        controlCodes: [2],
        parameters: [
          {
            description: 'long mode',
            name: 'mode',
            type: {
              bits: 32,
              kind: 'integer',
              signed: true,
            },
          },
        ],
        result: {
          description: 'void',
          kind: 'void',
        },
        resultWritten: false,
        review: 'declared',
      },
    },
  },
});

// Unknown is a lack of a proved semantic; the other two are explicit native stubs.
export const NATIVE_SLOT_DEFAULTS = freeze({
  reserved: {
    name: 'reserved.noop',
    family: 'reserved',
    signature: {
      argumentWords: null,
      controlCodes: [2],
      parameters: {
        description: 'ignored',
        kind: 'ignored',
      },
      result: {
        description: 'void',
        kind: 'void',
      },
      resultWritten: false,
      review: 'declared',
    },
  },
  unknown: {
    name: null,
    family: 'unrecovered',
    signature: {
      argumentWords: null,
      controlCodes: [],
      parameters: null,
      result: {
        kind: 'unknown',
      },
      resultWritten: null,
      review: 'needs-review',
    },
  },
  'constant-zero': {
    name: 'reserved.zero',
    family: 'reserved',
    signature: {
      argumentWords: null,
      controlCodes: [1],
      parameters: {
        description: 'ignored',
        kind: 'ignored',
      },
      result: {
        bits: 32,
        description: 'word',
        kind: 'bits',
      },
      resultWritten: null,
      review: 'declared',
    },
  },
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
