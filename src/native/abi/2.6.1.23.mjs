// SPDX-License-Identifier: MPL-2.0

import {
  NATIVE_SEMANTICS,
  nativePreferenceDataSignatures,
  nativeContentDatabaseSignatures,
  NATIVE_TILE_GAME_IDS as tileGameOperations,
  NATIVE_TILE_GAME_SIGNATURES,
} from './semantics.mjs';

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

const legacyTaskWordOperations = [126, 127, 128, 129, 131, 132, 138, 139];
const legacyTextServices = [130, 133, 134, 135, 391, 456, 585, 599];
const areaAdditionalServices = [198, 199, 202];
const viewMeshServices = [12, 467];
const rectangleOperations = [214, 215, 216, 217];
const mainGeometryOperations = [350, 351, 352, 353, 354, 355, 356, 357];
const motionGeometryOperations = [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37];
const motionComponentOperations = [18, 19, 20, 21, 22];
const taskSceneOperations = [
  219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 235,
];
const crossTaskSceneOperations = [233, 234];
const explicitHistoryStringOperations = [334, 335, 337];
const taskSceneCSSOperations = [239, 249];
const historyCursorOperations = [379, 380, 381, 382, 383, 384];
const questionDatabaseOperations = Array.from({ length: 37 }, (_, i) => 742 + i).filter(
  (id) => id !== 769 && id !== 770,
);
const rawDataOperations = [833, 834, 835, 836];
function rawDataSignatures() {
  const bytes = { kind: 'character', bits: 8, encoding: 'bytes' };
  return rawDataOperations.map((id) => {
    const signature = NATIVE_SEMANTICS.main[id].signature;
    return {
      ids: [id],
      fields: {
        resultWritten: id !== 834,
        ...([833, 836].includes(id)
          ? {
              result: {
                kind: 'pointer',
                addressSpace: 'native',
                direction: 'inout',
                target: bytes,
              },
            }
          : {}),
        parameters: signature.parameters.map((parameter) => {
          if (parameter.type.kind === 'handle')
            return {
              ...parameter,
              type: { kind: 'handle', handleKind: 'global-file', ownership: 'borrowed' },
            };
          if (parameter.type.kind !== 'pointer') return parameter;
          return {
            ...parameter,
            type: {
              kind: 'pointer',
              addressSpace: id === 836 ? 'vm' : 'native',
              direction: id === 834 ? 'inout' : id === 836 ? 'out' : 'in',
              target: id === 836 ? { kind: 'integer', bits: 32, signed: false } : bytes,
            },
          };
        }),
      },
    };
  });
}
const compiledDatabaseOperations = [791, 792, 793, 794];
const selectionDatabaseOperations = [779, 780, 781, 782, 783, 784, 829, 830, 831, 832];
const missionDatabaseOperations = Array.from({ length: 34 }, (_, i) => 795 + i);

function geometrySignatures(table, ids) {
  return ids.map((id) => {
    const { name, signature } = NATIVE_SEMANTICS[table][id],
      resultWritten = signature.controlCodes.includes(1);
    return {
      ids: [id],
      fields: {
        resultWritten,
        parameters: signature.parameters.map((parameter, index) => {
          const matrix =
              name.startsWith('matrix.') || (index === 1 && name === 'vector4.transform'),
            direction = index || resultWritten ? 'in' : name === 'matrix.copy' ? 'out' : 'inout',
            target =
              index === 1 && name === 'vector4.scale'
                ? { kind: 'float', bits: 32 }
                : { kind: 'record', name: matrix ? 'matrix4' : 'vector4' };
          return { ...parameter, type: { kind: 'pointer', direction, addressSpace: 'vm', target } };
        }),
      },
    };
  });
}

const mainEvidence = [
  {
    ids: [442, 443],
    value:
      'Own fixed SDK23 Main442 resets the caller kcTaskScript accumulator at +0x1e4, returns control2 and leaves its output unwritten. Main443 writes u32(x + (x >>> 2)) and returns control1. True original CRT/FileServer/Window/View/Top and actual factory-loaded VM run23 total GCALLs and8 normal Script updates: Base precedes raw accumulation, mode0 still accumulates, inactivity skips it, completion happens after the current increment, same Script reload retains the word and a new Script starts at constructor zero. The raw word is independently produced by the original Q32/carry/delayed-step algorithm fed by actual browser cooperative-wait returns; its units are scheduler-dependent, not elapsed milliseconds. A browser observation of24 natural rAF returns includes independent current-checkpoint cold and ordinary rendering. Unqualified update sources remain guarded; this does not reproduce Windows Sleep returns or add timing state to GAME_SAVE.',
  },
  {
    ids: [532],
    value:
      'Own Main532 returns control2 without writing its output. Target0 skips routing; actual Base0 and Wipe39 raw354 both return unhandled1 and leave the reply and task state untouched. A separate true original loaded-VM group initializes the Wipe frame through actual parent100/102 updates and Base41a760 before start: current102/start100/end104 and activity remain unchanged across Main532. Factory/support/carrier/cleanup included27 total GCALLs; original dependency bodies and normal disposal are intact. This is an unhandled action, not a finish operation; other receiver kinds stay guarded.',
  },
  {
    ids: [669],
    value:
      'Own Main669 builds the actual zeroed0x290 external Particle load packet: PTCL/image paths, count at260, zero priority at264,32 register words at268, external flag at396 and an owned formatted extra name at400. True original CRT/FileServer/Window/View/Top and Main66 kind16 plus Main143-loaded VM run the wrapper against Base and two normal loaded KCS2 banks. The wrapper writes1 and returns control1 independently of the receiver reply. The receiver owns its packet, replaces the old bank, skips its own texture/graph path in external mode and preserves normal start/stop/query and actual Task/Script destruction. Other receiver shapes and later extra-name consumers remain protected.',
  },
  {
    ids: viewMeshServices,
    value:
      'Own SDK23 Main12 selects the actual initialized mode1 manager through kcView+8 and writes its near float at+0xd8, without requesting a repaint. Main467 translates and converts64B VM records to80B native records before kind2 raw78; the original manager owns two copies, rejects an occupied model key, and admits a new model after actual Main83 unload. Real Script GCALLs, finite3D projection, released bitmap-to-VRAM source and actual COM draw submissions were observed; platform Present is a separate memory leaf.',
  },
  {
    ids: [622, 623, 624, 703, 704, 706, 707, 708, 709],
    value:
      'Own complete HG2v25 multi-frame and HG3 GCALLs run the actual initialized platform/Script/Draw chain. Main703 produces72-byte tag1 bitmap or tag2 actual0xc4 source records;704 clears/releases them. Main706 writes nine geometry words and709 borrows ordinal0/1 independently of frame IDs0/2. Main707/708 retain a source and update transforms;624 explicitly loads ANM. Main622/623 decode real Main365 buffers and rebuild frame owners even for the same descriptor, retaining the source identity and any loaded ANM owner. The original frame map stores every HG2/HG3 frame, including one frame; prior own HG2v10/v20 decoder proofs supply their single-frame contracts. Caller release preserves Draw ownership, pixels, removal/destruction and independent cold continuation. The same initialized Main703 tag1 accepts primary BI_RGB BMP24/32 pixels and returns zero with cleared record pairs for valid PNG. Actual normal bitmap-with-ANM and array-retained sources also preserve their container/program across encoded rebinding; the shared array sees new frames/geometry with unchanged source references. Nested image-owner rebinding and other decoded formats remain guarded.',
  },

  {
    ids: [663],
    value:
      'Own Main663 at0x480680 sends raw282 with width/height to the real ImageList receiver and0x59c0a0 existing renderer resize. Complete GCALLs keep the renderer and retained entries, release its0x114 output and tile allocations, create the new output and repaint actual pixels at10x8 then4x3 after caller source release. Original borrowed addresses may be reused by the allocator; release events establish the lifetime. Independent cold continuation preserves logical resource identity. This is a distinct resize service, not the shared entry-replacement message.',
  },
  {
    ids: [259, 263, 264, 462, 463, 657],
    value:
      'Own complete Main259/263/264/462/463/657 GCALLs use the actual Top kind15 ImageList constructor, initialized renderer and Main365/428 decoded bitmap. Main259 raw256 updates an existing key or inserts a new one;263 changes its shown word;462/463 query and change the entry layer;657 borrows its live bitmap and returns zero for an absent key. Main264 writes the count scratch but returns control2, so it pushes no VM value. Actual CPU pixels, mapped outputs,1/2/0 counts, source release with retained references, entry removal and real parent-update destruction match. The missing layer query preserves the wrapper initial minus-one value. Uninitialized renderer count/layer shapes remain guarded.',
  },
  {
    ids: [731],
    value:
      'Own complete Main731 at0x4808e0 uses the actual Main66 kind15 kcTaskImageList0x90, original raw253 initialized renderer0x3c and Main710 loaded image owner. The wrapper copies the owner into field3 of its60-byte descriptor and sends raw254 with the caller/layer key, float32 transform, clamped alpha, shown and mode words. Actual disabled Draw Main340/raw264 renders CPU pixels without a device output; Main261 returns its borrowed bitmap. Original source-owner release retains the Draw input, entry removal clears it and the real parent update deletes the retired Draw. Full KCS pixels, controls, resource counts and independent cold match the shared logical retained-source graph; no GPU publication fence is changed.',
  },
  {
    ids: [430, 460],
    value:
      'Own complete Main430/460 Script GCALLs use the original system-information singleton, file server, Settings, software kcView and constructor-loaded ANM table. Main430 tests direct readable ANM and basename table fallback, first duplicate insertion and case-sensitive stored keys; no ANM execution is involved. Main460 returns an explicitly owned0x114 bitmap without entering the Script automatic list: ordinary HG3 frame zero retains RGB24, while selector composition allocates an RGBA result and combines valid named layers with original anchors, offsets and pixels. Eight positive forms cover HG2/HG3 files, RGB24, one/multiple selectors, skipped zero selectors and narrow multi-character basenames. Further valid BMP24/32 Main460 GCALLs preserve RGBA primary pixels and explicit release; valid PNG returns zero without automatic bitmap ownership. Selector formats remain separately bound. No desktop/GPU action or synthetic receiver is used.',
  },
  {
    ids: [716, 721, 722, 725, 729, 734],
    value:
      'Own complete Script GCALLs use the original kcFileServer singleton, complete Settings defaults, software kcView and true Top/Script constructors. Main710 creates a real64-byte loaded image owner with its nonempty native layer vector;733 creates an independent blank target. Main716 packed multiplication and729 alpha scaling visit loaded layers,721 reads the live output alpha hint,722 changes that hint,725 copies a nonempty HG3 attribute tree and734 blends a legal source/target rectangle. All output pixels, metadata, copied attribute words, controls and Script+0x9c automatic-list references are compared. Further actual Main710 single-layer HG3 RGB24 factories and Main7343-to4,4-to3,3-to3 rectangles match full pixels and independent cold. RGBA mask1 into RGB24 has no native dispatch function: its complete control2 wrapper preserves target pixels. Null or bitmap-less721 leaves the original result unwritten and remains guarded; blank owners are not passed to the layer iterators.',
  },
  {
    ids: [375, 431],
    value:
      'Own Main375 at0x4897b0 formats the CP932 image path, reads at most1024 bytes through the explicit IFile boundary and executes the original nine-word header parser. Own431 at0x489a90 consumes the true Main365 twenty-byte descriptor, zeros its nine-word output and runs the whole HG2/HG3 container parser. Full actual Script GCALLs compare distinct mapped spans and surrounding seeded words for valid HG2/HG3, including the HG2 header depth-derived word and the container helper untouched word after wrapper zeroing. Both return control1; no synthetic native owner, text patch or invalid-output probe is used.',
  },
  {
    ids: [376, 446, 468, 537, 538, 558, 564, 641],
    value:
      'Own loaded Script GCALLs run all three Main376 color modes and Main468 rotation,538 blur,558 mirror,564 raw mask and641 alpha scaling on actual Main365/428-owned asymmetric HG3 pixels. Main537 copies a nonempty ats0007 attribute tree into a real Main112 bitmap; Main536 then reads the five copied words, including transformed attributes after rotation/mirror. Main446 copies its mapped RECT into native stack scratch, scans the live bitmap there and returns1 when pixel storage exists; it never copies that rectangle back, including a wholly transparent bitmap. Full physical pixels, metadata, VM outputs and Script ownership are compared through the normal complete wrappers.',
  },
  {
    ids: [428, 648],
    value:
      'Own Main428 at0x4899e0 decodes an ordinal frame from the actual Main365 twenty-byte encoded resource, writes the resolved frame ID through its third live VM argument, converts RGB24 to RGBA32 and inserts the real0x114 bitmap owner into Script+0x98. Main648 at0x489ea0 uses0x4d86a0 to compose HG2/HG3 tile IDs0–8 into a new bitmap: corners, repeated edges and repeated center, with normal partial edge clips. Actual loaded Script GCALLs preserve distinct ordinal/ID values, opaque and alpha pixels, typed resource/list ownership and explicit release. Unsupported formats and unproved empty/smaller target shapes stay guarded; this is not a blank-size constructor. Valid BMP24/32 and PNG Main428 calls return zero, preserve the third VM output and add no Script bitmap. Main648 on those files instead returns a real null-storage owner and inserts it in the automatic list; the JS null-storage bitmap wrapper preserves that defined owner/list identity with no pixel allocation through explicit release, Script destruction and independent cold. Storage-dependent queries retain their guards.',
  },
  {
    ids: [370, 371, 374, 377, 378],
    value:
      'Own 2.6.1.23 Main370/371/374/377/378 run through the actual loader-bound Script VM and original Main112 automatic bitmap list. The real 0x114 wrapper owns the original 0x58 bitmap at vtable0x628a44. Signed base pairs, mapped VM outputs, alpha sampling and cached alpha hints preserve their control1/2 contracts and original pixel bytes. Main377 with no owner leaves its result unwritten and remains guarded; the ordinary live-owner query is admitted.',
  },
  {
    ids: [629],
    value:
      'Own 2.6.1.23 Main629 complete GCALL and original formatter expand the first three fixed VM CP932 operands in order as file, parameters and directory. ShellExecuteA borrows the Script HWND, uses operation open and show5, and discards every OS result through control2. Sixteen own cases cover distinct and aliased inputs, global expansions, shared addresses, 259-byte strings and ignored trailing words with unchanged VM source memory. The browser host reports real HTTP(S) popup availability; other schemes, Windows arguments and working directories remain unsupported capability domains, not fabricated success. Zero/short frames and overlong native temporaries are not admitted.',
  },
  {
    ids: [738],
    value:
      'Own 2.6.1.23 Main738 sends raw321 to a constructed, loaded FES owner. Full GCALL uses original Main365-owned 20-byte descriptors holding a valid encoded HG3 resource. A new key retains once; a duplicate key retains neither its previous descriptor again nor a different candidate. A second key shares one descriptor, caller release leaves both cache references, Main67 retirement retains them, and the original FES deleting destructor releases the descriptor and owner after ordinary static resource-list initialization. The wrapper returns control2 without a result write. Unknown foreign pointers and incomplete renderer/3D shapes are not inferred from these encoded-byte ownership cases.',
  },
  {
    ids: [631, 632],
    value:
      'Own 2.6.1.23 complete Main631/632 wrappers and loaded FES receiver after true Main66 owners and Main143-loaded VM. Positive BASE count2 creates separately addressable event receivers with indices0/1; STRING type20 constructs its deferred resource owner. Both raw packet strings from Main632 expand argv1, and argv2 is not dereferenced, including an unmapped incoming word. Count and CP932 name are copied into the native stack packet. Both wrappers return control2 without a result write; unknown object types and subsequent unproved renderer shapes retain their guards.',
  },
  {
    ids: [664, 665, 666, 667, 668],
    value:
      'Own 2.6.1.23 Main664–668 complete GCALLs after true Main66 Top/Script/FES construction and Main143-loaded Script VM. Named CP932 private values override system operands, including stored zero and absent indexed names. Copies transfer 2048 bytes between actual caller and FES contexts; an unloaded caller without a private context copies nothing. Names and context selection are independent. Main667 returns control 1; all mutators return control 2 without writing a result. The authored loaded notification executes synchronously and reaches no platform message pump; this does not establish arbitrary IO or rendering transaction behavior.',
  },
  {
    ids: [144, 145, 146, 147, 148, 151, 152, 153, 154, 395, 396, 401],
    value:
      'Own 2.6.1.23 Top/Input constructors and actual Main66 kind11 factory, complete KCS dispatcher and Input receiver. Main144–148 use raw Input 119/120/121/122/124, text132/133/134 and autohide135; image140/query141/enable142. Signed priority and duplicate ordering, live copied RECT/NULL clear and raw masks match. The own text worker/dialog callback preserves pending0/confirm1/cancel2, CP932 bytes through NUL and limit16/capacity256. Thread/Win32 IO and borrowed renderer image/visibility/query are explicit service boundaries. Six own Input frames deliver down/held/up through an authored consumed callback and stop after unregister. Main67 retirement retains Input; its own deleting destructor separately frees owned allocations while borrowing device/renderer. Native scratch/padding and uninitialized .23 NULL text are not normalized.',
  },
  {
    ids: [444],
    value:
      'Own 2.6.1.23 Main444 reads four fixed live VM destinations and queries the actual main module RT_VERSION through GetModuleFileNameA(0). The original metadata helper, delimiter and integer parsing run through full GCALLs with real resource bytes. It stores four zero-extended low16 components in order through control2, preserving shared, aliased, argument-overlapping, zero-declared-width and trailing-word shapes. Missing translation or FileVersion leaves defined zero components. Captured OS Version API failures also zero them but do not supply absent browser module authority. The browser uses its uniquely selected module metadata; native uninitialized numeric scratch and overlong fixed string fields remain diagnostic.',
  },

  {
    ids: [192, 193, 194, 195],
    value:
      'Own 2.6.1.23 Registry wrappers run the original formatter, ANSI HKCU Software path, typed value calls and fixed live argv through full GCALLs. Each returns control 1; missing keys/values or API failures return zero and opened key handles close. DWORD zero is a successful existence query; raw narrow strings use strlen without formatting. Short buffers remain untouched, null translations query required byte length, and VM/shared/aliased destinations retain native write order. The ordinary browser platform uses the existing private persistent HKCU owner, not the system registry.',
  },

  {
    ids: [166, 167],
    value:
      'Own Main166 and Main167 complete GCALLs preserve this build’s packed signed 16-bit target pan, unsigned 16-bit duration and control-2 stack contract. The actual Sound receiver stores the pan fade fields at its native current-minus-base frame, without changing unrelated control words. Main167 ignores its first float and stores only the second as maximum distance on a loaded primary DirectSound buffer, preserving minimum distance and capturing the actual DirectSound output calls. Absent device/backend/buffer and out-of-range banks retain their native no-change behavior. The other global native backend has no proved browser host mapping and remains open; it is independent of per-file streaming/static mode. A missing 3D output interface still retains the static buffer maximum. These setter proofs do not claim a playback-device or subsequent fade-tick differential.',
  },
  {
    ids: [602, 603],
    value:
      'Own complete Main602/603 GCALLs reach this build’s Sound receiver and actual ordered group tree. Registration stores all five raw words, retains signed range bounds, preserves the first record on duplicate ID and does not normalize reversed ranges. Removal of an absent ID is silent; a removed ID can be registered anew. Zero, high-bit and highest unsigned IDs retain their independent records. Native tree insertion, erasure and destruction release every bounded group allocation. No audio-device playback is performed by these two commands.',
  },
  {
    ids: [165, 349, 569, 587],
    value:
      'Own full GCALLs execute this build’s Sound receiver and static-buffer query path. Pan retains its signed raw word; fade-pending returns bit zero, including zero for invalid banks. In the primary DirectSound backend, decoder length comes from the loaded buffer’s decoded-stream virtual query for either per-file load type, with no narrowing of its DWORD result; absent devices, missing buffers and invalid banks return zero. The other native backend remains a separate open shape. The primary buffer completion DWORD counts actual static playback notifications, including finite repeats and repeat-count zero. Pause preserves it; Play and Stop clear it; release and a later stream load retain it until playback resets it. Own Main155 creation, original notification callbacks and Main157/158/159/160/587 full-GCALL chains confirm these transitions. Absent global backends return zero. Its active-device invalid-bank path leaves the native result unwritten and remains diagnostic. All captured Sound/device bytes remain unchanged.',
  },
  {
    ids: [589],
    value:
      'Own Main589 at 0x47ba70 translates both VM destinations before writing the two queryWords from this build, in order and without a result. Local, shared, aliased destinations and outputs over argument words agree through full GCALLs and cold restore. Independently observed Main582/584 shapes retain mapped raw words across this compact build’s canonical preference/system-voice banks and earlier queryWords aliases -2555/-2554, including DWORD index multiplication wrap. The existing input-block and random-selection contracts remain enabled; unrepresented configuration fields remain diagnostic.',
  },
  {
    ids: [361, 533],
    value:
      'Own Main361 at 0x47d730 saves both preference groups through the actual XML tree and captured file writer, irrespective of dirty state, retaining signed words, CP932 font/key data and the eight profile-listed omissions. Creation failure or a partial write does not change control 2, and all temporary owners are released. Main533 at 0x47d770 sets the manager refresh latch. The actual Root callback at 0x4184f0 updates the Root before broadcasting raw10 with embedded raw18, requests the client rectangle, and then clears the latch. Its Script raw18 receiver queues 0xffff0011, matching shared canonical event19. Sound raw18 returns zero without a device and one with a device. Requests merge, absent Root retains them, and paused/inactive rendering skips the dirty write.',
  },
  {
    ids: tileGameOperations,
    value:
      'Own 2.6.1.23 Main470–513 have independently verified word counts and controls through the full GCALL bridge. All registered Tile initializers construct one process-wide model and auxiliary rules scratch, then seed its independent stream from local calendar fields. Contexts own four vectors and retain event/choice/result caches while sharing the model. Standard two/four-player rounds, all seventeen command codes, eight deal policies, abilities, preserved-inventory reference swaps, winning score/payment/result decoding, historical choices/melds, cached replay, mapped local/shared/aliased outputs and release isolation match the original. Original pre-action notifications use the automatic activation return, and ready queries also accept a positive scored complete hand. Six native AI profiles additionally verify automatic pre-action, declaration cancellation/refund, score protection and late-wall abilities. Cold JS checkpoints retain the shared model/RNG and independent contexts.',
  },

  {
    ids: rawDataOperations,
    value:
      'Own 2.6.1.23 wrappers 0x485060–0x4851f0 own raw HeapAlloc data with a signed reference header, independent CSS blob writes/reads and mapped size outputs. Bounded allocation failures return zero without publishing the size; actual Question/Mission state exports and imports use the same author raw/CSS GCALL chain.',
  },
  {
    ids: compiledDatabaseOperations,
    value:
      'Own 2.6.1.23 Main 0x474ca0–0x474f40 owns the 16-byte KCDB parser and maps its named columns through 0x4be430/0x4be4a0. Actual native memory-file construction, size/read and destruction feed the original zlib parser; 1–4-byte numeric fields, wider numeric misses and exact raw field copies match production GCALL.',
  },
  {
    ids: selectionDatabaseOperations,
    value:
      'Own 2.6.1.23 wrappers 0x475930–0x475b80 construct the 12-byte Selection owner at 0x494830. The original 0x494b70 KCDB load preserves the names/work on failure and replaces only tables on success; CP932 name registration, first duplicate wins, signed marked moves and the 1000-swap integer-RNG hole redistribution retain native vector element boundaries in production GCALL.',
  },
  {
    ids: missionDatabaseOperations,
    value:
      'Own 2.6.1.23 wrappers 0x475b80–0x476380 construct the 20-byte Mission owner at 0x4963f0 and load authored KCDB through 0x496d10 and the original 0x4be1e0 parser. Conditions, character statistics, priority/tag selection, completion and the 36-byte state header with 24-byte mission/28-byte character rows match independent production GCALL.',
  },
  {
    ids: questionDatabaseOperations,
    value:
      'Own 2.6.1.23 wrappers 0x474f40–0x475930 construct the 740-byte Question owner at 0x4912d0; its 0x48d570 loader uses the original 0x4be1e0 KCDB/zlib parser, CP932 configuration/pool/state operations and 12-byte header with 88-byte save records. Main769/770 remain the own no-op stubs.',
  },
  {
    ids: mainGeometryOperations,
    value:
      'Own 2.6.1.23 wrappers map VM matrix and vector records through 0x50c020. The Main and paired MOT lanes have matching control words, x87 memory order and scalar PC24 outputs.',
  },
  {
    ids: [11],
    value:
      'Own 2.6.1.23 wrapper 0x47b580 translates seven VM destinations before GetLocalTime. It writes year, month, weekday, day, hour, minute and second as DWORDs in that order.',
  },
  {
    ids: rectangleOperations,
    value:
      'Own 2.6.1.23 wrappers 0x486000–0x4861b0 use signed Win32 RECT records, ordered alias-safe union and physical bitmap dimensions.',
  },
  {
    ids: [26, 37],
    value:
      'Own 2.6.1.23 0x48ae30 formats and parses a narrow float32 value, and 0x48b080 writes grouped signed DWORD digits with two trailing zeros.',
  },
  {
    ids: [237],
    value:
      'Own 2.6.1.23 Main 0x485d50 uses the Main 28 VM block release helper, writes its scratch result and returns control 2',
  },
  {
    ids: [27, 28],
    value:
      'Own 2.6.1.23 wrappers 0x48ae70 and 0x48ae90 allocate zeroed VM blocks and release only the mapped block start, compacting the guest addresses.',
  },
  {
    ids: [289, 290, 291, 292, 293],
    value:
      'Own 2.6.1.23 wrappers 0x4829c0, 0x4850c0 and 0x482a30–0x482c46 use an owned array of 40-byte CP932 rows and two DWORD values. The original GCALL confirms creation, release, conditional query results and write order.',
  },
  {
    ids: [123],
    value:
      'Own 2.6.1.23 0x487a60 builds a 1128-byte raw94 configuration with one counted CP932 table and an empty second table for the same Task 8 receiver as Main 418.',
  },
  {
    ids: legacyTaskWordOperations,
    value:
      'Own 2.6.1.23 wrappers 0x487d80–0x488110 send raw 98–101, 103–105 and 111 to the kind 8 receiver at 0x41bc80. State, rows and the optional query owner were compared.',
  },
  {
    ids: legacyTextServices,
    value:
      'Own 2.6.1.23 Main wrappers and kind 8 receiver 0x41bc80: actual Script GCALLs cover mark-limited drawing, restart budget, CP932 temporary conversion, ignored raw 107/108, borrowed bitmap query, indentation, current/default color and five font sizes. Complete mode 1 view constructors establish visible drawing; mode 0 early returns are recorded separately.',
  },
  {
    ids: [616],
    value:
      'Own 2.6.1.23 Main 616 and kind 48 raw 412 read the actual configured STRING writer: pending source returns signed -1 without parsing, page-limited drawing leaves one character, normal task updates preserve the page limit, and finish/clear give 0/-1. Real VM comparison, bitmap ownership and destruction were checked after complete mode 1 constructors.',
  },
  {
    ids: areaAdditionalServices,
    value:
      'Own 2.6.1.23 wrappers 0x486a10/0x486a40/0x486b90 and actual Main66 kind26/27/Base constructors: raw232 forces the initialized bitmap endpoint, raw236 copies a complete local matrix but the reviewed receivers leave it unhandled, and raw234 replaces only the two borrowed bitmap pointers after a written kind26/27 query. Complete Script GCALLs cover live pixels, unchanged refs and two-level destruction.',
  },
  {
    ids: [136, 137],
    value:
      'Own 2.6.1.23 wrappers 0x488010 and 0x488050 send raw 109 and 110 to each configured kind 8 glyph manager. Atlas normalization and first-insertion glyph records were checked through original GCALL.',
  },
  {
    ids: [120],
    value:
      'Own 2.6.1.23 wrapper 0x488d50 reads a signed RECT and an array of 12-byte bitmap records, clears the clipped target and selects physical pixel kernels.',
  },
  {
    ids: [121, 713],
    value:
      'Own 2.6.1.23 wrappers 0x488f70 and 0x476610 check neutral factors before dereferencing the owner; the shared 0x4d9590 kernel scales the three physical color bytes.',
  },
  {
    ids: [122, 705],
    value:
      'Own 2.6.1.23 aliases at 0x48A120 use the same owned bitmap resize, x87 dimension words, raster interpolation and integer-cell averaging.',
  },
  {
    ids: [405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416],
    value:
      'Own 2.6.1.23 gallery wrappers 0x47C3D0–0x47C853 load the FES variants or names resource, and share close and count bodies across both typed layouts.',
  },
  {
    ids: [7],
    value:
      'Own 2.6.1.23 Main 0x48C460 aliases both Particle slot 4 entries and writes the owning task DWORD at +0x48.',
  },
  {
    ids: [53, 55, 56, 58, 59, 60, 321],
    value:
      'Own 2.6.1.23 Main entries alias Particle v1 and v2 slots 9, 11, 13, 15, 16, 17 and 43. Physical x86 GCALL confirms one written float32 word, using the Core x87 PC24 arithmetic for the triangle wave.',
  },
  {
    ids: [576, 689],
    value:
      'Own 2.6.1.23 wrappers 0x484DE0 and 0x484EF0 read an existing CSS record before raw 389 and 398. Return words are verified for the absent 3D owner and neutral Top and Script recipients.',
  },
  {
    ids: [701, 702],
    value:
      'Own 2.6.1.23 wrappers 0x47EB70 and 0x47FC30 route Plane raw 40 and 82. The hardware mode-one renderer installs a prepared movie model with zero XYZ, and its lookup returns the original owner registration.',
  },
  {
    ids: [10],
    value:
      'Own 2.6.1.23 0x47B480 formats and normalizes CP932 bytes, then opens the caller window clipboard and transfers CF_TEXT.',
  },
  {
    ids: [441],
    value:
      'Own 2.6.1.23 0x47B6B0 and 0x4C6ED0 write the recording DWORDs and narrow prefix. Frame recording advances only when the view obtains the bitmap.',
  },
  {
    ids: [201],
    value:
      'Own 2.6.1.23 0x486AF0 queries raw 12, then sends Raster raw 238 or Hydro raw 247 for selector zero. Raster changes exactly three float words while retaining its attached graph and phase.',
  },
  {
    ids: [95, 109],
    value:
      'Own 2.6.1.23 0x47F2A0 registers Plane raw 83 geometry. Own 0x48A310 queries Plane or BasePlane raw 89 and routes Input raw 129 for the complete source word.',
  },
  {
    ids: [61, 461],
    value:
      'Own 2.6.1.23 0x48C590 and 0x481C60 write the CRT power and base-10 logarithm results. The original CPU gate selects SSE2 under the ordinary masked environment, and the wrappers publish float32 through x87.',
  },
  {
    ids: [346],
    value:
      'Own 2.6.1.23 0x47ED90 formats CP932 and resolves the KX3 directory before raw 66. Plane and BasePlane leave the payload, owner and result untouched.',
  },
  {
    ids: [433],
    value:
      'Own 2.6.1.23 0x47F890 routes Plane raw 42. With a live mode-1 device and an unregistered parent it creates row-major child planes. The empty parent has no defined bounds.',
  },
  {
    ids: [398, 399],
    value:
      'Own 2.6.1.23 Main 0x47F6D0 and 0x47F770 use Plane raw 74 and 75. Their retained history has 128-byte entries and explicit samples defer drawing.',
  },
  {
    ids: [204, 205, 206],
    value:
      'Own 2.6.1.23 0x4865D0, 0x486620 and 0x486670 apply scalar PC24 rotation, translation or scale to a mapped or current matrix.',
  },
  {
    ids: [662],
    value:
      'Own 2.6.1.23 0x486740 writes the entire guest matrix through the original scalar YPR quaternion path and returns control 2.',
  },
  {
    ids: [735],
    value:
      'Own 2.6.1.23 0x476E20 clips two retained rectangles and writes packed destination rows in physical order. An empty destination owner routes the source rectangle to VRAM.',
  },
  {
    ids: [723, 727],
    value:
      'Own 2.6.1.23 0x476930 and 0x476A90 rewrite retained bitmap layers through the packed rotation and reflection helpers. The owner rebuilds its image and marks the retained layer updated.',
  },
  {
    ids: [681],
    value:
      'Own 2.6.1.23 0x489F40 formats the CP932 resource name, resolves the image category, and uses 0x4C64B0 to load and release a temporary owner without writing a result.',
  },
  {
    ids: [514],
    value:
      'Own 2.6.1.23 0x482830 formats CP932 and resolves the MOT category filename. 0x5966d0 copies the manager base bank to working and compares the resulting name against its retained record basenames.',
  },
  {
    ids: [445],
    value:
      'Own 2.6.1.23 0x47b800 formats mapped CP932 text and passes the system error caption and zero buttons flag to the application dialog.',
  },
  {
    ids: [845, 846, 847],
    value:
      'Own 2.6.1.23 0x47bdf0–0x47be4e post raw 0x469–0x46b to the script window. The window owner routes these to display toggle, minimize or the fixed close-confirmation dialog.',
  },
  {
    ids: [99, 106, 110, 394],
    value:
      'Own 2.6.1.23 Plane raw 84, 87, 90 and 91 release the input region, select its active word, set its receiver or install an owned copy of the bitmap mask.',
  },
  {
    ids: [150],
    value:
      'Own 2.6.1.23 0x4874a0 resolves Top raw 31 and sends raw Input 130 with two unsigned halves and the unchanged interval. The Input owner applies its setting and coordinate range.',
  },
  {
    ids: [454, 577, 651, 694],
    value:
      'Own 2.6.1.23 FES context copy 0x47b8b0 and task wrappers 0x47ba40, 0x48a8c0 and 0x48a8f0 preserve control 2. Top raw 37 and Base raw 23 and 28 write the selected task fields.',
  },
  {
    ids: [29, 30, 31, 32],
    value:
      'Own 2.6.1.23 file wrappers at 0x48aeb0–0x48aff0 scan the formatted mode bytes and dispatch the wrapped byte count to the opened file owner',
  },
  {
    ids: [683, 684, 685],
    value:
      'Own 2.6.1.23 section-table wrappers at 0x477c00–0x477e1c read the CP932 resource, match byte-exact headings and keys, and write the selected ordinal value',
  },
  {
    ids: [853, 854, 856],
    value:
      'Own 2.6.1.23 WipeMosaic and FadeMosaic raw 447, 448 and 450 use five-word initializers, private captures and the original mode and timing selectors',
  },
  {
    ids: [860],
    value:
      'Own 2.6.1.23 WBreak initializer raw 452 copies seven words and projects the seeded shards using the padded capture extent',
  },
  {
    ids: [855, 857, 861],
    value:
      'Own 2.6.1.23 Mosaic, FadeMosaic and WBreak start receivers use raw 449, 451 and 453 to set the active word; zero retains the effective clock range',
  },
  {
    ids: [521, 522, 523, 524],
    value:
      'Own 2.6.1.23 kind-35/36 screen effects use raw 343–346 with the 88-byte matrix and 36-byte rectangle initializer packets',
  },
  {
    ids: [83, 86, 87],
    value:
      'Own 2.6.1.23 Plane raw 63 releases the graph and its tracked input, while raw 57 and 58 return the selected base and position vectors into VM outputs',
  },
  {
    ids: [89, 90, 91],
    value:
      'Own 2.6.1.23 Plane raw 57 returns the selected model priority. Raw 49 stores three parent offsets and applies the original selected parent base and position when the renderer is attached. Raw 50 clears inheritance without changing the retained pose or offsets.',
  },
  {
    ids: [74, 75, 77],
    value:
      'Own 2.6.1.23 Main 0x48a710, 0x48a760 and 0x48a880 read Base raw 12 flags, count signed registry keys with a directly owned branch, and query membership through Top raw 30.',
  },
  {
    ids: [82],
    value:
      'Own 2.6.1.23 Main 0x47ecf0 sends the formatted CP932 KX2 path through Plane raw 65. The mode-1 renderer copies the packed colored triangles into a new owner. Declined and repeated registrations preserve the existing model.',
  },
  {
    ids: [107],
    value:
      'Own 2.6.1.23 Main 0x48a280 selects Input through Top raw 31, then sends the region key through Input raw 126 to read its full activity word. An absent region leaves the original output scratch unchanged.',
  },
  {
    ids: [96, 97, 98],
    value:
      'Own 2.6.1.23 Plane raw 67 copies the four 12-byte button states and registers Input only once. Raw 68 selects the low halfword and sets the independent blocked bit. Raw 69 writes both parts of the button state.',
  },
  {
    ids: [102, 103],
    value:
      'Own 2.6.1.23 Plane raw 72 stores the selected task DWORD and sends raw 43 to hide it. Raw 73 stores the complete hint attribute DWORD.',
  },
  {
    ids: [611, 612, 613, 614, 615, 617, 618, 619, 620, 621, 695],
    value:
      'Own 2.6.1.23 kind-48 STRING receiver 0x426cf0, raw 407–411, 413–417 and 419, with the 188-byte CP932 configuration',
  },
  {
    ids: [271, 272, 273, 274, 275, 426, 427, 693],
    value:
      'Own 2.6.1.23 wrappers use kind 16 raw messages 285–292 with the 656-byte load packet and 128-byte register record',
  },
  {
    ids: [33, 34],
    value:
      'Own 2.6.1.23 Main 0x48cbb0/0x48cbd0 share the Particle integer and real MT19937 streams and always write the result',
  },
  {
    ids: [119, 363],
    value:
      'Own 2.6.1.23 0x488cf0 and 0x489020 write bitmap size and offset pairs to mapped VM outputs',
  },
  {
    ids: [369],
    value:
      'Own 2.6.1.23 0x489580 multiplies four channels by packed bytes divided by 255 for a four-byte bitmap',
  },
  {
    ids: [372, 373],
    value:
      'Own 2.6.1.23 0x4896f0 and 0x489730 set bitmap canvas dimensions or offset, returning zero for a null bitmap',
  },
  {
    ids: [718, 719, 720],
    value:
      'Own 2.6.1.23 0x4767e0, 0x476830 and 0x476880 write the owned bitmap canvas, offset and base fields through independent pairs',
  },
  {
    ids: [4],
    value: 'Own 2.6.1.23 Main 0x47b390 returns the WINMM timeGetTime DWORD',
  },
  {
    ids: [25],
    value: 'Own 2.6.1.23 Main 0x48add0 formats a VM CP932 string and uses integer parser 0x4b1f30',
  },
  {
    ids: [786],
    value: 'Own 2.6.1.23 Main 0x47bdc0 applies the signed integer calendar helper at 0x4b18d0',
  },
  {
    ids: [51, 52, 54],
    value:
      'Own 2.6.1.23 Main 0x481510/0x481540/0x481570 share the initialized CRT cosine, tangent and arccosine with the Generic and Particle wrappers',
  },
  {
    ids: [57, 397],
    value:
      'Own 2.6.1.23 Main 0x48c560 loads one f32 and applies x87 FABS; 0x48c530 loads y and x with the same CRT atan2 target as Generic 7 and Particle 12',
  },
  {
    ids: [80, 81],
    value:
      'Own 2.6.1.23 Plane wrappers 0x47ec10 and 0x47ec50 and raw 41/64 receivers 0x46ac21 and 0x46acb3, retaining the mounted KX2 triangle resource',
  },
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
  {
    ids: [207, 294, 295, 296, 586],
    value:
      'Own 2.6.1.23 identity matrix writer, motion owner constructor 0x597780, clear and release, and full flag word at +0x134',
  },
  {
    ids: [78, 84, 85, 93, 94],
    value:
      'Own 2.6.1.23 Plane wrappers 0x47eaa0, 0x47ee70, 0x47eed0, 0x47f1e0 and 0x47f240: raw messages 38, 47, 57/45, 51 and 59',
  },
  {
    ids: [101, 343, 344, 345, 402, 466],
    value:
      'Own 2.6.1.23 Plane receiver 0x46a940 switches raw scale 61, bounds 70–71, matrix 53, blend 76 and live model coordinates 77',
  },
  {
    ids: [297, 305, 306],
    value:
      'Own 2.6.1.23 manager removes instance keys, updates one or all start words and replaces up to 256 x87 Float32 registers through the same writer as Motion add',
  },
  {
    ids: [298, 299, 300, 301, 302, 303, 304, 307, 308, 535],
    value:
      'Own 2.6.1.23 Motion 0x481d70–0x482580 and 0x4828c0: owned group removal, 0x90-byte transfers, x87 elapsed frames and formatted archive add',
  },
  {
    ids: [541, 542],
    value:
      'Own 2.6.1.23 wrappers 0x47fa30 and 0x47fa80 release intersecting pages at 0x4d1260 or allocate missing configured pages at 0x4d1370',
  },
  {
    ids: [323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 336, 338, 608],
    value:
      'Own 2.6.1.23 scene owner and CP932 reader at 0x480b40–0x481490; authored scene file markers and path history',
  },
  {
    ids: taskSceneOperations,
    value:
      'Own 2.6.1.23 task Scene wrappers 0x485220–0x485d40 use the same CP932 CST reader and independent seen/path owner; text requires a mapped destination and readable descriptor, and parsed string captures dereference the existing caller bank.',
  },
  {
    ids: crossTaskSceneOperations,
    value:
      'Own 2.6.1.23 wrappers 0x485a30/0x485bf0 route raw 162 through the original task tree to Script 0x45377b, then expand retained strings or copy both compact history lists independently of the source interpreter.',
  },
  {
    ids: explicitHistoryStringOperations,
    value:
      'Own 2.6.1.23 explicit Scene wrappers 0x4810a0/0x481120/0x481290 retain five-word string set/get and four-word expansion, clamped path selection, raw CP932 bytes, null-owner short circuits and saved-string isolation.',
  },
  {
    ids: taskSceneCSSOperations,
    value:
      'Own 2.6.1.23 wrappers 0x483c10/0x484680 take four words, query raw 162 through the real Script tree and save/load one compact history side through the original in-memory CSS owner while preserving the other side.',
  },
  {
    ids: [322],
    value:
      'Own 2.6.1.23 wrapper 0x485d70 formats the guest CP932 name, resolves the scene category and reports whether the virtual-file open succeeds; an existing empty file succeeds without parsing CatScene data.',
  },
  {
    ids: historyCursorOperations,
    value:
      'Own 2.6.1.23 wrappers 0x47c860–0x47cd44 retain the borrowed Scene history, rotating 20-byte reader slots, single-slot endpoint rule, CP932 text/commands, conditional mapped outputs and owned cursor destruction without CSTL reads.',
  },
  {
    ids: [385, 386],
    value:
      'Own 2.6.1.23 four-word CSS scene history wrappers and 0x5a39e0 headerless 40-byte records',
  },
  {
    ids: [255],
    value:
      'Own 2.6.1.23 wrapper 0x484be0 resolves a caller-relative CP932 CSS path, checks its four-byte magic and writes five local timestamp DWORDs.',
  },
  {
    ids: [242, 248, 252, 389, 390],
    value:
      'Own 2.6.1.23 CSS entries, tag, clear and clone at 0x483fc0, 0x484650, 0x484910 and 0x484c90–0x484cd0',
  },
  {
    ids: [515, 516, 517, 518, 519],
    value:
      'Own 2.6.1.23 narrow dictionary wrappers 0x477e20/0x477e90 and 0x479d60/0x479ee0 and grouped word selector 0x47a000',
  },
  {
    ids: [863, 864, 865, 866, 867, 868],
    value:
      'Own 2.6.1.23 record stack 0x474810–0x474a60: five-word owner, signed reserve, LIFO copy/pop and full-capacity assignment',
  },
  {
    ids: [633, 634, 635, 636, 637, 638, 639, 640],
    value:
      'Own 2.6.1.23 name-table wrappers 0x478530–0x4788c0, fes lookup and 32-byte narrow records from 0x4f3b00',
  },
  {
    ids: [315, 316, 317, 387, 388],
    value:
      'Own 2.6.1.23 motion save wrappers 0x482690–0x4827a0, 0x4841d0 and 0x484ab0, serializer 0x596780 and reload 0x597ba0',
  },
  {
    ids: [143],
    value:
      'Own 2.6.1.23 load wrapper 0x487980 formats the kcs name, sends raw 147 then raw 158 to bind caller memory, and selects control 2 or 4',
  },
  {
    ids: [403, 404],
    value:
      'Own 2.6.1.23 Input gates 0x4878d0 and 0x487930; Root 31 resolves the owner for raw Input 143 and 144',
  },
  {
    ids: [155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 168, 284],
    value:
      'Own 2.6.1.23 Sound wrappers 0x47dc40–0x47e260: Root 32, filename load, raw 166–176 and 180, and the formatted Sound file probe',
  },
  {
    ids: [696, 697, 698, 700, 785],
    value:
      'Own 2.6.1.23 display-log wrappers 0x4771b0–0x4778e0 and append helper 0x5a2c20: CP932 rows, speaker names and block limit',
  },
  {
    ids: [258, 261, 455],
    value:
      'Own 2.6.1.23 Draw wrappers 0x47fdd0, 0x47ff60 and 0x480220 send raw removal 255, bitmap query 259 and base image 270',
  },
  {
    ids: [21, 45, 278, 540],
    value:
      'Own 2.6.1.23 narrow compare 0x48ac50, live replace 0x48b610, own-bank expansion 0x483040 and raw space token offset 0x47a0c0',
  },
  {
    ids: [434, 435, 436, 437, 438],
    value:
      'Own 2.6.1.23 file-server preload wrappers 0x47bee0–0x47bfc0 clear, queue, start, poll and age the mounted file records',
  },
  {
    ids: [570, 571, 572],
    value:
      'Own 2.6.1.23 directed task notifications 0x482eb0/0x482ee0/0x482f40 send raw 400/403/402; 403 copies one host word or zero',
  },
  {
    ids: [243, 253],
    value:
      'Own 2.6.1.23 CSS string-bank wrappers 0x484060 and 0x484990 look up the current bank or the saved entry before creating a bank',
  },
  {
    ids: [111, 112, 114, 115, 118, 362, 364, 365, 366, 367, 368],
    value:
      'Own 2.6.1.23 bitmap and packed image wrappers 0x488260–0x489520; sized file data, frame metadata, cropped copies and independent image owners',
  },
  {
    ids: [50, 257],
    value:
      'Own 2.6.1.23 scalar sine wrapper 0x48c4d0 and Draw bitmap packet 0x47fcc0 through raw 254',
  },
  {
    ids: [35],
    value: 'Own 2.6.1.23 memory copy 0x48b000 maps both operands and copies the requested span',
  },
  {
    ids: [309, 310, 311, 312, 313, 314, 440],
    value:
      'Own 2.6.1.23 motion status, skip and finish wrappers 0x4825a0–0x482670 and 0x482800, with instance/group/manager selection',
  },
  {
    ids: [649, 650],
    value:
      'Own 2.6.1.23 wrappers 0x4842e0 and 0x484e70 use raw FES 314 and 315 for the selected 512-word CSS bank',
  },
  {
    ids: [285, 286],
    value:
      'Own 2.6.1.23 Root 31 Input wrappers 0x4876e0/0x487750; raw 137 ORs four source words and raw 138 resets region activity and cursor position',
  },
  {
    ids: [392],
    value:
      'Own 2.6.1.23 wrapper 0x48b880 formats CP932 and invokes parser 0x4e2150 and plain writer 0x4e25c0',
  },
  {
    ids: [212, 213, 609, 610, 658, 659],
    value:
      'Own 2.6.1.23 variable-bank wrappers 0x486360–0x4864f0, trailing percentage handling, byte-count backup and selected 512-word private context',
  },
  {
    ids: [16, 17, 18, 19, 20, 22, 23, 24],
    value:
      'Own 2.6.1.23 narrow string primitives 0x48aa90–0x48adc5, 0x4b1220 pair classification and descending formatter scratch',
  },
  {
    ids: [40, 47, 48, 49],
    value:
      'Own 2.6.1.23 narrow character helpers 0x48b3c0 and 0x48b710–0x48b87a use the standard pair classifier at 0x4b1220',
  },
  {
    ids: [347, 348, 604],
    value:
      'Own 2.6.1.23 spatial and sound group wrappers 0x47e2f0–0x47e3be and 0x47e880–0x47ea9c; receiver 0x44bf20 uses raw 182–183 and 190–195',
  },
  {
    ids: [358],
    value:
      'Own 2.6.1.23 wrapper 0x47dc00 maps both VM pointers; 0x4ca510 transforms into a temporary before writing the four-word vector',
  },
  {
    ids: [605, 606, 607],
    value:
      'Own 2.6.1.23 Settings wrappers 0x47d850, 0x47d890 and 0x47d8f0: raw group gain and 88-byte rows selected by narrow filename',
  },
  {
    ids: [565, 566, 567],
    value:
      'Own 2.6.1.23 recording getters 0x47b6f0/0x47b710 read view words at +0x84/+0x88; 0x47b910 writes a CP932 formatted line and CRLF',
  },
  {
    ids: [674, 844],
    value:
      'Own 2.6.1.23 Main 0x47da40 returns the narrow voice row at 0x5c2be0; 0x47bbc0 searches 48 archive categories through 0x5c2ca0',
  },
  {
    ids: [113, 116, 241, 251],
    value:
      'Own 2.6.1.23 0x488620 captures the view and 0x4889c0 clips bitmap copies; 0x483ef0/0x484820 store and restore HG image data through CSS',
  },
  {
    ids: [850, 851],
    value:
      'Own 2.6.1.23 0x4844e0/0x484ff0 write and read the four display-log sections and two cursor bases through CSS',
  },
  {
    ids: [675, 676],
    value: 'Own 2.6.1.23 dictionary slots 675/676 share the exact handlers of Main 515/516',
  },
  {
    ids: [677, 678, 679, 680],
    value:
      'Own 2.6.1.23 wrappers 0x477ec0–0x478360 support the ordered CP932 dictionary, raw DWORD replacement, formatted lookup and first matching key output.',
  },
  {
    ids: [568, 858, 859],
    value:
      'Own 2.6.1.23 Main wrappers at 0x479ab0, 0x479c60 and 0x479c80 prepare and capture the caller priority range into a retained target',
  },
  {
    ids: [539],
    value:
      'Own 2.6.1.23 Main 0x485df0 evaluates scalar, comma-list or signed inclusive range arguments in the caller bank and writes a bounded word count',
  },
  {
    ids: [46, 62, 63],
    value:
      'Own 2.6.1.23 Main 0x48b680 scales signed integer percentages from an unsigned base; 0x48c5c0 and 0x48c5e0 use the native x87 angle constants in inverse order',
  },
  {
    ids: [525, 526, 527, 528, 529],
    value:
      'Own 2.6.1.23 Shade 0x451640 and Draw 0x468670 receive raw347–351. Shade clamps its signed radius, initializes the exact padded-capture vertices and stores the whole active word. Draw retimes on active initialization, preserves its clocks on stop, and latches finish through raw351. All five wrappers return control 2 with untouched result words.',
  },
  {
    ids: [520, 530, 531],
    value:
      'Own 2.6.1.23 wrappers 0x479670/0x4799d0/0x479a30 send Wipe raw342/352/353 to the receiver at 0x456d00. Main530 quiets two F32 priorities and sends the four-word initializer. The task copies the borrowed 32-bit mask into its private texture, resets working alpha, and preserves the two clocks on stop. Main520 returns control 1. Main530/531 return control 2 without writing a result.',
  },
  {
    ids: [38, 39, 41, 42, 43, 44],
    value:
      'Own 2.6.1.23 Main 0x48b1c0–0x48b520 preserve live byte reads and copy counts, tab escapes, grouped tokens and NUL-list ownership',
  },
  {
    ids: [339, 340, 341, 342, 534],
    value:
      'Own 2.6.1.23 Draw wrappers 0x480060–0x480180 and 0x480300 send raw 263–266 and 278 to the retained receiver at 0x4277e0',
  },
  {
    ids: [218, 653, 654, 655],
    value:
      'Own 2.6.1.23 rectangle wrapper 0x486200 intersects a guest RECT; Plane wrappers 0x47fac0–0x47fc1f send raw 79–81 to 0x46a940',
  },
  {
    ids: [852],
    value:
      'Own 2.6.1.23 getter 0x47da80 reads the startup GAME/log/static word via the configuration view at +0x210',
  },
  {
    ids: [699],
    value:
      'Own 2.6.1.23 rebuild at 0x477340–0x4777fa takes backlog and scene owners plus two formatted command names and traverses the saved path',
  },
  {
    ids: [598, 710, 711, 714, 732, 733, 736],
    value:
      'Own 2.6.1.23 image selection 0x489dc0, Script bitmap owners 0x476380–0x477100 and the 60-byte Draw packet through raw 256 at 0x4809e0',
  },
  {
    ids: [712, 715, 717, 724, 726, 730, 737],
    value:
      'Own 2.6.1.23 Script images 0x4765a0–0x476b1c and 0x477110 read geometry and attributes and apply authored blur, resize and filter',
  },
  {
    ids: [625, 728],
    value:
      'Own 2.6.1.23 0x4805f0 uses raw Draw 269 to enable the selected animation; 0x476ab0 writes the owned image mask DWORD',
  },
  {
    ids: [265, 266, 267, 268, 269, 270, 417, 787, 788],
    value:
      'Own 2.6.1.23 movie window wrappers 0x483790–0x483bc3 use Root 31 and raw Input 136; 0x47be50 reads the drawing rectangle',
  },
  {
    ids: [320],
    value:
      'Own 2.6.1.23 spline wrapper 0x4816b0 updates the five-float point records with x87 intermediates and returns control 2',
  },
  {
    ids: [124, 125, 418, 557],
    value:
      'Own 2.6.1.23 narrow Text wrappers 0x487b80, 0x487d00, 0x487d50 and 0x4881a0 use raw kind-8 messages 94, 96, 97 and 114 at 0x41bc80',
  },
  {
    ids: [76, 536],
    value:
      'Own 2.6.1.23 task parent 0x48a860 and bitmap attribute 0x489c30 write the parent ID or five selected metadata words',
  },
  {
    ids: [149],
    value:
      'Own 2.6.1.23 0x487420 resolves Root 31 and sends raw Input 118 with the two mapped coordinate destinations',
  },
  {
    ids: [862],
    value:
      'Own 2.6.1.23 wrapper 0x480ae0 sends Draw raw 284 with a four-word RECT; 0x427d4e marks dirty and renders that extent',
  },
  {
    ids: [196, 197, 200, 203],
    value:
      'Own 2.6.1.23 Area wrappers 0x486780, 0x4869e0, 0x486aa0 and 0x486c10 use the legacy kind dispatch, raw 231/233/235, and the 56-byte kind 26 initializer through raw 248',
  },
];
const auxiliaryLoggerEvidence = {
  ids: [0],
  value:
    'Own complete Generic and both Particle zero wrappers reach the owning formatter and actual CRT logger through the original GCALL dispatcher. The Particle tables share one exact receiver, and no receiver field is read or written. Seven cases per table retain CP932 bytes, two-stage percent handling, mapped zero-width and ignored-tail arguments, 499-byte termination, control2 without a result store, full guest/owner and original writable-data effects. Existing five-build formatter and Main1/Main14 evidence is reused. OS debug-window transport is captured only. See tests/fixtures/native-legacy-aux-logger-golden.json and docs/kcs-vm.md.',
};

const particleInterpreterEvidence = [
  auxiliaryLoggerEvidence,
  {
    ids: [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 37, 38, 39],
    value:
      'Own true ApplicationRoot and loaded v2 kind16 bank execute finite quad rotation/translation/scale, mapped attachment-to-position, raw quad copies, UV diagonals, distance, inverse bounds and visibility. Complete words and real Root/View DrawPrimitive triangles/atlas match across restart and cold. Both tables point to these exact bodies; v1 reuse is an explicit same-body/context bridge, not a new native v1 geometry capture. See tests/fixtures/sdk23-particle-lifecycle-golden.json; undefined owner and arithmetic domains remain guarded.',
  },
  {
    ids: [1, 2, 3, 4, 5, 9, 10, 14, 19, 20, 21, 32, 35, 36, 40, 41, 42],
    value:
      'Own loaded Main66 kind16/Main271 sized4x4 HG3 and KCS header-selected v1/v2 VM tables each execute seventeen finite calls for both particles through the original dispatcher. Full arguments, control1/2/4 and written outputs match; exit in the first particle still permits the second invocation. Native idle copies current into before after the loop; register replacement, stop and normal child retirement are observed. Six independent current cold points per table recreate the existing device port. See tests/fixtures/sdk23-particle-tables-golden.json; this does not generalize all operands, physical GPU output or unwritten constructor domains.',
  },
  {
    ids: [18],
    value:
      'Own 2.6.1.23 Particle v1 and v2 slot 18 alias Main 61 at 0x48C590. The initialized SSE2 CRT writes one float32 result word.',
  },
  {
    ids: [6, 7, 8, 11, 12, 13, 15, 16, 17],
    value:
      'Own 2.6.1.23 remaining trigonometric, ceil/floor, remainder and square-root bodies match their MOT peers',
  },
  {
    ids: [33, 34],
    value:
      'Own 2.6.1.23 Particle 0x48cbb0/0x48cbd0 share the integer and real MT19937 streams with MOT 0x595af0/0x595ad0',
  },
  {
    ids: [43],
    value: 'Own 2.6.1.23 Particle 0x48cfc0 shares the x87 triangle wave body with MOT 0x595490',
  },
];
const particleInterpreterSignatures = [
  {
    ids: [29],
    fields: {
      parameters: NATIVE_SEMANTICS['particle-v1'][29].signature.parameters.map((parameter, i) => ({
        ...parameter,
        description: i % 2 ? 'Unused input word' : 'Float32 diagonal texture coordinate',
        type: i % 2 ? { kind: 'ignored' } : { kind: 'float', bits: 32 },
      })),
      resultWritten: false,
    },
  },
  {
    ids: [38],
    fields: {
      parameters: NATIVE_SEMANTICS['particle-v1'][38].signature.parameters.map((parameter) =>
        parameter.type.kind === 'pointer'
          ? {
              ...parameter,
              type: { ...parameter.type, addressSpace: 'vm', direction: 'out' },
            }
          : parameter,
      ),
    },
  },
  {
    ids: [
      1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 33, 34, 36, 37, 40,
      41, 42, 43,
    ],
    fields: { resultWritten: true },
  },
];
const toMessage = (min, offset = 0) => ({ min, max: min, offset });
const legacyControlInput = [
  [5, 6],
  [8, 9],
  [9, 10],
  [60, 64],
];
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
  { ids: [145, 152, 396], value: [0] },
  { ids: [151, 153, 401], value: [1] },
  { ids: [146, 147, 148, 154], value: [2] },
  { ids: [395], value: [3] },
  { ids: [144], value: [4] },
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
  166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184,
  185, 187, 188, 190, 191, 192, 193, 194, 195, 196, 197,
];
const toSound = (id) => toMessage(id + 13, -13);
const tables = (count, evidence = [], stubs = {}) => {
  const stubIds = Object.values(stubs).flat();
  const recovered = evidence.flatMap(({ ids }) => ids).sort((a, b) => a - b),
    known = new Set([...recovered, ...stubIds]),
    unknown = Array.from({ length: count }, (_, id) => id).filter((id) => !known.has(id));
  return {
    count,
    slots: {
      ...(unknown.length ? { unknown } : {}),
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
  framePacing: 'observed-cooperative-wait',
  tileGame: {
    seedFromLocalClock: true,
    preActionNotificationUsesResult: true,
    readyIncludesScoredHand: true,
  },
  executableSha256: '9f3a5ad0ed22074420685f1e2a3bc92436d68289c7bac854d5f7d7331dc3ef67',
  xmlEncoding: 'Shift_JIS',
  text: {
    debugPrintByteLimit: 500,
    legacyConfigurationBytes: 1128,
    legacyClearPublishes: true,
    legacyTaskWordOperations,
    legacyTextServices,
    legacyGraphRegistration: true,
    legacyGlyphBottomUp: true,
    remainingTaskKinds: [48],
    gdiSBCSUsesMeasuredWidth: true,
    gdiFixedGlyphHalfCell: true,
    legacyGlyphAtlas: true,
    legacyInitializerBitmapBpp: 4,
    settingsCharacterBytes: 1,
    pathBytes: 260,
    clipboardUsesCP932: true,
    recordingPrefix: { units: 'bytes', limit: 32 },
    plainSyntax: 'legacy-narrow',
    formattedComparisonSecondBeforeFirst: true,
    percentProduct: 'x87-integer',
    formattedTokenBackslashT: true,
    tokenLiveCopy: true,
    tokenSplitBytewise: true,
    plainParenthesisTokens: true,
    listEntryLiveCopy: true,
    listJoinLiveCopy: true,
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
      first: { cp932: 407, nv: 420, utf8: null },
      clearCategory: false,
      cp932UsesNativeMessages: true,
      maxOperation: 12,
    },
    nvResetKeepsView: true,
    nvResetKeepsColors: true,
    nvFesSecondaryUsesDefaults: true,
    nvEndPositionRequiresSection: true,
  },
  configuration: {
    systemVoiceIncludesPreferenceBlocks: true,
    systemVoiceQueryWordIndex: -2555,
    blockSizes: [2856, 56, 28, 12],
    keyHide: false,
    extendedPreferences: false,
    preferenceOmittedFields: [
      'GAME/autoselect',
      'MESSAGE/read_color',
      'MESSAGE/enable_read',
      'KEY/enable_joypad',
      'FULL_SCREEN/no_full_res',
      'ETC/waitd3dcommand',
      'ETC/disablepixelshader',
      'ETC/imgimport',
    ],
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
  calendar: {
    weekdayAlgorithm: 'century-integer',
    localDateReadsFrame: true,
    localDateUsesSystemTimeWords: true,
  },
  rectangles: { strictArity: true },
  fileIO: { rawModeAndBoundedBuffer: true },
  globalFile: {
    growthBytes: 524288,
    hostDataRequiresExplicitZeroRecord: true,
    optionalTaskRecords: true,
    timestampMinimumBytes: 4,
    timestampRequiresMappedOutputs: true,
  },
  nameTable: { legacyFieldBytes: 32, fixedPairs: true, pairByteLimit: 64 * 1024 * 1024 },
  math: {
    anglesUseX87: true,
    atan2UsesX87: true,
    powUsesSSE2Identities: true,
    trigUsesNativeReduction: true,
    d3dxUsesNativeReduction: true,
    remainderUsesX87: true,
    randomFloatUsesX87: true,
    interpreterUsesNativeScalarMath: true,
    lerpUsesX87: true,
    triangleWaveUsesX87: true,
    roundIntegerResult: 'int64-low-word',
    strictGeometryArity: true,
    matrixCopyChunkBytes: 4,
    vectorLengthUsesX87: true,
    vectorWordArithmeticUsesX87: true,
    vectorTransformRequiresFinite: true,
    vectorTransformWFirst: true,
  },
  motion: {
    managerLifetime: 'explicit-delete',
    sourceCacheRelease: 'manager-delete',
    activeQueryUsesRawWord: true,
    workingStartsUninitialized: true,
    recordStartsUninitialized: true,
    addUsesFormat: true,
    nativeFilenameQuery: true,
    elapsedUsesX87: true,
    splineUsesX87: true,
    currentMatrixFallback: true,
    orderedScalarRotations: true,
    matrixMemoryOperationsUseNativeOrder: true,
    matrixVectorUseScalarD3DX: true,
    vectorOperationsUseNativeGeometry: true,
    vectorComponentsUseX87: true,
    registerWordsUseX87: true,
  },
  particle: {
    externalScriptLoad: true,
    externalScriptLoadKinds: [0, 16],
    debugUsesNativeLogger: true,
    scriptVersionFallback: 'particle-v1',
    frameScale: 'x87-uint32',
    beforeFrameUpdatedByIdle: true,
    scriptUsesTaskFrameRate: true,
    scriptStartPreservesState: true,
    drawPortEnabledByIdle: true,
    drawPortRequiresStart: true,
    drawPortPersistsAfterExit: true,
    quadUsesX87: true,
    textureCoordinatesUseX87: true,
    distanceUsesX87: true,
    projectionBoundsUseX87: true,
    attachmentPositionRequiresOwner: true,
    attachmentReadsRegistrationWord: true,
    taskMessageStart: 285,
    deferGraphAttachment: true,
  },
  movie: { alwaysUseBgmVolume: true },
  scene: {
    translations: false,
    legacyHistoryRecords: true,
    historyCaptureUsesExistingBank: true,
    implicitHistoryCaptureRequiresBank: true,
    implicitReaderUsesDirectBehavior: true,
    implicitTextDestinationRequired: true,
    cstFileMarkers: true,
    directTextNull: 'reject',
    directPathResult: 'success',
  },
  stringBank: { emptyGetResult: 1, expandUsesExistingBank: true, cssOwnerLookupOnly: true },
  database: {
    nullExportPolicy: null,
    questionIdentitySignedIndex: true,
    questionFormatRequired: true,
    questionLoadSkipsKnownFiles: true,
    questionGenrePlaceholderContinues: true,
    missionCharacterQueryRequiresEntry: true,
    missionFilenameRequired: true,
    selectionFormatRequired: true,
    selectionReadSizesFirst: true,
    selectionRedistributeUsesRandom: true,
    compiledFormatRequired: true,
    compiledIndexRequiresNonnegative: true,
    rawHeapAllocationFailureReturnsZero: true,
  },
  sound: {
    banks: 32,
    load3DPositionFromPan: true,
    bufferCompletionNotifications: true,
    unwrittenQueryBanks: [587],
    firstMessage: 166,
    lastMessage: 197,
    delegateFrom: 198,
    legacyTypes: ['bgm', 'se', 'voice'],
    legacyVolumeAliases: { bgm: 0, se: 1, voice: 2 },
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
    spatialRequiresLoadedBuffer: true,
    groupGainUsesMute: false,
    categoryLookupUsesFlatVoice: true,
  },
  resources: { categoryCount: 48 },
  language: {
    storage: null,
    singleTable: null,
    resetOnReload: null,
    archiveFallback: null,
    switchWindowProtocol: null,
    dynamicMenus: null,
  },
  plugins: { emoteDriver: null, requiredRenderer: null },
  registry: { keyFormatBytes: 250, valueFormatBytes: 255 },
  moduleVersion: { fieldByteLimit: 255, commaOnly: true, finalComponentUsesThirdWidth: true },
  capabilities: {
    effekseerTask: false,
    embeddedJavaScript: false,
    nameTableAliases: false,
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
    areaAdditionalServices,
    areaServiceKinds: { 198: [26, 27], 199: [0, 26, 27] },
    channels: {
      taskQueries: {
        unmapped: 'reject',
        raw: [{ ...toMessage(162, 13), kinds: [12] }],
        canonical: [{ ...toMessage(175, -13), kinds: [12] }],
      },
      base: {
        unmapped: 'reject',
        raw: [
          ...baseMessages,
          ...[13, 23, 24, 29].map((id) => toMessage(id, -1)),
          { ...toMessage(262, -26), kinds: [0] },
        ],
        canonical: [
          ...baseMessages,
          ...[12, 22, 23, 28].map((id) => toMessage(id, 1)),
          { ...toMessage(236, 26), kinds: [0] },
        ],
      },
      control: {
        unmapped: 'reject',
        raw: [
          { min: 353, max: 358, offset: -31, kinds: [40] },
          { min: 368, max: 374, offset: -33, kinds: [41] },
          ...legacyControlInput.map(([raw, canonical]) => ({
            ...toMessage(canonical, raw - canonical),
            kinds: [40, 41],
          })),
          { min: 328, max: 334, offset: 31, kinds: [42] },
          ...legacyControlInput.map(([raw, canonical]) => ({
            ...toMessage(raw, canonical - raw),
            kinds: [42],
          })),
        ],
        canonical: [
          { min: 322, max: 327, offset: 31, kinds: [40] },
          { min: 335, max: 341, offset: 33, kinds: [41] },
          ...legacyControlInput.map(([raw, canonical]) => ({
            ...toMessage(raw, canonical - raw),
            kinds: [40, 41],
          })),
          { min: 359, max: 365, offset: -31, kinds: [42] },
          ...legacyControlInput.map(([raw, canonical]) => ({
            ...toMessage(canonical, raw - canonical),
            kinds: [42],
          })),
        ],
      },
      screen: {
        unmapped: 'reject',
        raw: [
          { ...toMessage(389, -35), kinds: [0, 39] },
          { min: 377, max: 388, offset: -35 },
          ...[516, 517, 518, 519, 520, 521, 522].map((id) => toMessage(id, -69)),
        ],
        canonical: [
          { ...toMessage(354, 35), kinds: [0, 39] },
          { min: 342, max: 353, offset: 35 },
          ...[447, 448, 449, 450, 451, 452, 453].map((id) => toMessage(id, 69)),
        ],
      },
      planeMesh: {
        unmapped: 'reject',
        raw: [{ ...toMessage(83, -5), kinds: [2] }],
        canonical: [{ ...toMessage(78, 5), kinds: [2] }],
      },
      area: {
        unmapped: 'reject',
        raw: [
          ...[257, 258, 259, 261, 263, 264, 273, 274].map((id) => toMessage(id, -26)),
          { ...toMessage(260, -26), kinds: [26, 27] },
          { ...toMessage(262, -26), kinds: [0, 26, 27] },
          { ...toMessage(275, -26), kinds: [27] },
        ],
        canonical: [
          ...[231, 232, 233, 235, 237, 238, 247, 248].map((id) => toMessage(id, 26)),
          { ...toMessage(234, 26), kinds: [26, 27] },
          { ...toMessage(236, 26), kinds: [0, 26, 27] },
          { ...toMessage(249, 26), kinds: [27] },
        ],
      },
      planeMovie: {
        unmapped: 'reject',
        raw: [toMessage(43, -3), toMessage(87, -5)],
        canonical: [toMessage(40, 3), toMessage(82, 5)],
      },
      sound: {
        unmapped: 'reject',
        canonical: [
          toMessage(19),
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
    root: { start: 29, captionWide: false, soundReset: 181, declinedTaskKinds: [43] },
    movieInput: { query: 31, gate: 143 },
    cursorVisibility,
    soundBaseOnly: [22],
    areaQueriesRequireReply: true,
    scriptForward: [9, 10, 19, cursorVisibility, 64],
    screenEvent: 18,
    tilePlaneCommand: 42,
    windowClosePreparation: false,
    windowTitleConfirmation: {
      caption: 'タイトル画面に戻る',
      message: 'タイトル画面に戻ってよろしいですか？',
      prepare: false,
    },
    windowCloseConfirmation: { caption: '終了', template: '%s を終了してよろしいですか？' },
  },
  floatingPoint: {
    precisionBits: 24,
    rounding: 'nearest',
    x87ControlWord: null,
    mxcsr: null,
  },
  fes: {
    motionUpdateAfterDecode: true,
    nativeQueueYieldStopsNotification: true,
    emptyExecReturnsZero: true,
    shellErrorText: { storage: 'inline', caption: 'エラー' },
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
    ],
    localAccessUsesNativeTypes: true,
    variableBankOffset: 436,
    frameDecodeResources: true,
    objectHeadsFirst: true,
    endChildYieldsFrame: true,
    windowedCapability: true,
    controlResources: {
      kinds: [40, 41, 42],
      scrollProtocol: 'legacy',
      scroll2Protocol: 'legacy',
      scroll2RangeReloadsResource: true,
      scroll2Skin: 'state-direct',
      scroll2SkinPieces: 3,
      scrollUsesRawTransport: true,
      skinTables: false,
      sliderProtocol: 'legacy',
    },
    commonHeads: engine23CommonHeads,
    configurationOperandOrder: 'value-extras-key',
    configurationMessage: {
      liveObjects: false,
      notification: null,
      filenameComparison: null,
    },
    fileList: { patternEncoding: null, keyEncoding: null },
    macroLiterals: { string: 'unescape-quote', character: 'wrap-raw' },
  },
  graphics: {
    cameraNearRequiresMode1: true,
    dividedMesh: { receiverKinds: [2], rejectOccupiedModel: true },
    areaBlankWorkKinds: [27],
    bitmapAlphaQueryRequiresOwner: true,
    imageOwnerAlphaQueryRequiresBitmap: true,
    bitmapResizeUsesLegacyCells: true,
    bitmapToneSkipsNeutralOwner: true,
    bitmapCompositeUsesLegacyRows: true,
    imageCompositePreservesRGB24: true,
    imageCompositeBlendTypes: [0, 1, 2, 3, 4, 5],
    imageCompositeFormats: ['HG2', 'HG3'],
    imageCompositePlainFormats: ['HG2', 'HG3', 'BMP', 'PSD', 'KCF'],
    imageCompositeRejectedPlainFormats: ['PNG'],
    imageCompositeBmpHeaders: [40],
    imageCompositeBmpCompressions: [0],
    imageCompositePsd: { depth: 8, mode: 3, channels: [3, 4], compression: [0, 1], rleChannels: 3 },
    imageCompositeKcfPixelDepth: true,
    bitmapOrdinalRejectedFormats: ['BMP', 'PNG', 'PSD', 'KCF'],
    ninePieceEmptyFormats: ['BMP', 'PNG', 'PSD', 'KCF'],
    formattedBitmapPhysical: true,
    bitmapBlitUsesSourceSize: true,
    sameSizeBitmapCopyClips: true,
    imageOwnerCopyPhysicalRows: true,
    imageOwnerBlendPhysicalRows: true,
    imageOwnerBlendRGB24: true,
    imageOwnerBlendTypes: [0, 1, 2, 3, 4, 5],
    retainedScalarRows: true,
    drawRetirementRetainsResources: true,
    drawRetainsImageOwner: true,
    drawCountAndLayerRequireRenderer: true,
    drawLayerChangeInvalidates: false,
    drawEncodedBindingRebuildsFrames: true,
    renderSourcesDeferProgram: true,
    renderSourceFrameFormats: ['HG2', 'HG3'],
    renderSourceEmptyFrameFormats: ['BMP', 'PSD', 'KCF', 'PNG'],
    retainedEmptySources: true,
    retainedAllImageFrames: true,
    retainedSourcesUseStoredLayer: true,
    renderSources: { stride: 72, bytes: 276 },
    retainedBytes: 196,
    screenCaptureOpaque: true,
    recordingRequiresFrame: true,
    screenEffectRetimesOnActiveInit: [38, 39, 50, 51, 52],
    drawEnablePendingPolicy: 'rising-edge',
    emptyImageSizeWritesZero: true,
    positionedAreaWipeKinds: [26, 29, 30],
    areaRasterX87: true,
    textureCapsPolicy: 'virtual-d3d9',
    texturedBoundsQuery: null,
    planeAlphaFlags: 1,
    coordinateModeRequiresGraph: true,
    planePoseQueriesRequireReply: true,
    planePoseUsesRawWords: true,
    planeInheritanceUsesRenderer: true,
    planeResetReleasesTrackedInput: true,
    planeUsesLegacyButtonStates: true,
    planeImageSelectorHidesTarget: true,
    planeTrailUsesScalarWords: true,
    planeUsesLegacyColoredKX2: true,
    planeKx3UsesLegacyReceiver: true,
    planeMovieLegacy: true,
    tilePlaneRequiresEmptyOwner: true,
    screenEffectPreserveStoppedClockKinds: [38, 39, 50, 51, 52],
    screenEffectFadeUsesEndClamp: true,
    screenEffectShadeUsesPaddedCapture: true,
    screenEffectWipeBorrowsMask: true,
    screenEffectWipeInitializerWords: 4,
    screenEffectUnchangedActionKinds: [0, 39],
    screenEffectBreakUsesPaddedCapture: true,
    screenEffectMosaic: { fadeInitializerWords: 5, retainShortWipe: true },
    screenEffectFloatArguments: {
      520: [],
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
      531: [],
      853: [2, 3],
      854: [],
      855: [],
      856: [2, 3],
      857: [],
      860: [2, 3, 6, 7],
      861: [],
    },
  },
  input: {
    activeQueryUsesRawWord: true,
    bitmapMaskNativeRows: true,
    cursorWarpNativeBounds: true,
    legacyPlaneRegistration: true,
    planeSourceUsesRawWord: true,
  },
  task: {
    childQueryUsesRouteEntries: true,
    kindQueryRejectsRetiringOwner: true,
  },
  gallery: { listVariantWidth: 64, legacyTableReads: true },
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
          ids: [532],
          fields: {
            review: 'reviewed',
            resultWritten: false,
            parameters: [
              {
                name: 'task',
                description: 'Reviewed Base0 or Wipe39 native task ID; zero skips routing',
                type: { kind: 'object-id', objectKind: 'Base or Wipe' },
              },
            ],
          },
        },
        { ids: [669], fields: { review: 'reviewed', resultWritten: true } },
        ...[622, 623, 624, 703, 704, 706, 707, 708, 709].map((id) => ({
          ids: [id],
          fields: {
            review: 'reviewed',
            resultWritten: [703, 706, 709].includes(id),
            ...(id === 709
              ? { result: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' } }
              : {}),
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) => {
              if ([622, 623, 624, 707, 708].includes(id) && index === 0)
                return { ...parameter, type: { kind: 'object-id', objectKind: 'Draw' } };
              if ([622, 623, 707, 708].includes(id) && index === 2)
                return {
                  ...parameter,
                  type: {
                    kind: 'handle',
                    handleKind: id < 700 ? 'image-data' : 'render-source',
                    ownership: 'borrowed',
                  },
                };
              if ([706, 709].includes(id) && index === 0)
                return {
                  ...parameter,
                  type: { kind: 'handle', handleKind: 'render-source', ownership: 'borrowed' },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              const formatted = (id === 624 && index === 2) || (id === 703 && index === 0);
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: formatted ? 'in' : id === 704 ? 'inout' : 'out',
                  target: formatted
                    ? { kind: 'format-string', encoding: 'CP932' }
                    : {
                        kind: 'record',
                        name: id === 706 ? 'nine-word image metadata' : '72-byte render source',
                      },
                },
              };
            }),
          },
        })),
        { ids: [663], fields: { review: 'reviewed' } },
        ...[259, 263, 264, 462, 463, 657].map((id) => ({
          ids: [id],
          fields: {
            review: 'reviewed',
            resultWritten: [264, 462, 657].includes(id),
            ...(id === 657
              ? { result: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' } }
              : {}),
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? { ...parameter, type: { kind: 'object-id', objectKind: 'Draw' } }
                : id === 259 && index === 2
                  ? {
                      ...parameter,
                      type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                    }
                  : id === 259 && index >= 3 && index <= 9
                    ? { ...parameter, type: { kind: 'float', bits: 32 } }
                    : parameter,
            ),
          },
        })),
        ...[375, 431].map((id) => ({
          ids: [id],
          fields: {
            review: 'reviewed',
            resultWritten: true,
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) => ({
              ...parameter,
              type:
                index === 0
                  ? id === 375
                    ? {
                        kind: 'pointer',
                        addressSpace: 'vm',
                        direction: 'in',
                        target: { kind: 'format-string', encoding: 'CP932' },
                      }
                    : { kind: 'handle', handleKind: 'image-data', ownership: 'borrowed' }
                  : {
                      kind: 'pointer',
                      addressSpace: 'vm',
                      direction: 'out',
                      target: { kind: 'record', name: 'nine-word image metadata' },
                    },
            })),
          },
        })),
        ...[376, 446, 468, 537, 538, 558, 564, 641].map((id) => ({
          ids: [id],
          fields: {
            review: 'reviewed',
            resultWritten: id === 446 || id === 537,
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) =>
              parameter.type.kind === 'handle'
                ? {
                    ...parameter,
                    type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                  }
                : parameter.type.kind === 'pointer'
                  ? {
                      ...parameter,
                      type: {
                        kind: 'pointer',
                        addressSpace: 'vm',
                        direction: 'in',
                        target: { kind: 'record', name: 'RECT' },
                      },
                    }
                  : parameter,
            ),
          },
        })),
        { ids: [428, 648], fields: { review: 'reviewed' } },
        ...[370, 371, 374, 377, 378].map((id) => ({
          ids: [id],
          fields: {
            review: 'reviewed',
            resultWritten: id !== 378,
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) =>
              parameter.type.kind === 'handle'
                ? {
                    ...parameter,
                    type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                  }
                : parameter.type.kind === 'pointer'
                  ? {
                      ...parameter,
                      type: {
                        kind: 'pointer',
                        addressSpace: 'vm',
                        direction: 'out',
                        target: { kind: 'integer', bits: 32, signed: true },
                      },
                    }
                  : parameter,
            ),
          },
        })),
        { ids: [629], fields: { review: 'reviewed', resultWritten: false } },
        {
          ids: [738],
          fields: {
            parameters: [
              {
                name: 'fes',
                description: 'Target FES task ID',
                type: { kind: 'object-id', objectKind: 'FES' },
              },
              {
                name: 'name',
                description: 'CP932 cache key format',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
              {
                name: 'imageData',
                description: 'Borrowed encoded ImageData descriptor; retained only for a new key',
                type: { kind: 'handle', handleKind: 'image-data', ownership: 'borrowed' },
              },
            ],
            resultWritten: false,
            review: 'reviewed',
          },
        },
        ...[631, 632].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? { ...parameter, type: { kind: 'object-id', objectKind: 'FES' } }
                : id === 632 && index === 2
                  ? {
                      name: 'ignored',
                      description: 'Incoming word not read by the original wrapper',
                      type: { kind: 'bits', bits: 32 },
                    }
                  : parameter.type.kind === 'pointer'
                    ? {
                        ...parameter,
                        type: {
                          kind: 'pointer',
                          addressSpace: 'vm',
                          direction: 'in',
                          target: { kind: 'format-string', encoding: 'CP932' },
                        },
                      }
                    : parameter,
            ),
            resultWritten: false,
            review: 'reviewed',
          },
        })),
        ...[664, 665, 666, 667, 668].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? { ...parameter, type: { kind: 'object-id', objectKind: 'FES' } }
                : index === 1
                  ? {
                      ...parameter,
                      type: {
                        kind: 'pointer',
                        addressSpace: 'vm',
                        direction: 'in',
                        target: { kind: 'format-string', encoding: 'CP932' },
                      },
                    }
                  : parameter,
            ),
            resultWritten: id === 667,
            review: 'reviewed',
          },
        })),
        {
          ids: [144, 145, 146, 147, 148, 151, 153, 154, 395, 401],
          fields: { review: 'reviewed' },
        },
        { ids: [152, 396], fields: { review: 'reviewed', resultWritten: true } },
        { ids: [11], fields: { review: 'reviewed', resultWritten: false } },
        { ids: [444], fields: { review: 'reviewed', resultWritten: false } },
        { ids: [192, 193, 194, 195], fields: { review: 'reviewed', resultWritten: true } },
        { ids: [166, 167], fields: { review: 'reviewed' } },
        { ids: [165, 349, 569, 587], fields: { review: 'reviewed' } },
        ...nativePreferenceDataSignatures([589]),
        { ids: [361, 533], fields: { review: 'reviewed' } },
        ...NATIVE_TILE_GAME_SIGNATURES,

        ...rawDataSignatures(),
        ...nativeContentDatabaseSignatures(questionDatabaseOperations),
        ...nativeContentDatabaseSignatures(missionDatabaseOperations),
        ...nativeContentDatabaseSignatures(selectionDatabaseOperations),
        ...nativeContentDatabaseSignatures(compiledDatabaseOperations),
        ...geometrySignatures('main', mainGeometryOperations),
        {
          ids: [255],
          fields: {
            parameters: NATIVE_SEMANTICS.main[255].signature.parameters.map((parameter, index) => ({
              ...parameter,
              type: {
                ...parameter.type,
                addressSpace: 'vm',
                direction: index ? 'out' : 'in',
                target: index
                  ? parameter.type.target
                  : { kind: 'format-string', encoding: 'CP932' },
              },
            })),
            resultWritten: true,
          },
        },
        ...[297, 305, 306].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) => {
              if (index === 0)
                return {
                  ...parameter,
                  type: { kind: 'handle', handleKind: 'motion-manager', ownership: 'borrowed' },
                };
              if (index === 1)
                return {
                  ...parameter,
                  description: id === 305 ? 'u32 motion ID or zero for all' : 'u32 motion ID',
                  type: { kind: 'integer', bits: 32, signed: false },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'float', bits: 32 },
                },
              };
            }),
          },
        })),
        { ids: [27, 28], fields: { resultWritten: true } },
        {
          ids: [237],
          fields: {
            parameters: [
              {
                description: 'VMptr block',
                name: 'block',
                type: {
                  kind: 'pointer',
                  direction: 'in',
                  addressSpace: 'vm',
                  target: { kind: 'integer', bits: 8, signed: false },
                },
              },
            ],
            resultWritten: true,
          },
        },
        ...rectangleOperations.map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) => {
              if (parameter.type.kind === 'handle')
                return {
                  ...parameter,
                  type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              const direction =
                parameter.name !== 'destination' ? 'in' : id === 214 ? 'out' : 'inout';
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  direction,
                  addressSpace: 'vm',
                  target: { kind: 'record', name: 'signed 16-byte RECT' },
                },
              };
            }),
            resultWritten: id === 217,
          },
        })),
        {
          ids: [289],
          fields: {
            result: {
              kind: 'handle',
              handleKind: 'name-pairs',
              ownership: 'owned',
              description: 'Owned array of name-pair rows',
            },
            resultWritten: true,
          },
        },
        ...[290, 291, 292, 293].map((id) => ({
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
          },
        })),
        {
          ids: [26],
          fields: {
            parameters: [
              {
                ...NATIVE_SEMANTICS.main[26].signature.parameters[0],
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
            ],
            resultWritten: true,
          },
        },
        {
          ids: [37],
          fields: {
            parameters: [
              {
                ...NATIVE_SEMANTICS.main[37].signature.parameters[0],
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'character', bits: 8, encoding: 'CP932' },
                },
              },
              ...NATIVE_SEMANTICS.main[37].signature.parameters.slice(1),
            ],
            resultWritten: false,
          },
        },
        {
          ids: [123],
          fields: {
            parameters: [
              { kind: 'object-id', objectKind: 'legacy-text' },
              {
                kind: 'pointer',
                addressSpace: 'vm',
                direction: 'in',
                target: { kind: 'record', name: '96-byte legacy text definition' },
              },
              {
                kind: 'pointer',
                addressSpace: 'vm',
                direction: 'in',
                target: { kind: 'character', bits: 8, encoding: 'CP932' },
              },
            ].map((type, index) => ({
              ...NATIVE_SEMANTICS.main[123].signature.parameters[index],
              type,
            })),
            resultWritten: false,
          },
        },
        ...legacyTaskWordOperations.map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? { ...parameter, type: { kind: 'object-id', objectKind: 'legacy-text' } }
                : parameter,
            ),
            resultWritten: id === 129,
          },
        })),
        ...legacyTextServices.map((id) => ({
          ids: [id],
          fields: {
            review: 'reviewed',
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? { ...parameter, type: { kind: 'object-id', objectKind: 'legacy-text' } }
                : id === 134 && index === 2
                  ? {
                      ...parameter,
                      type: {
                        kind: 'pointer',
                        addressSpace: 'vm',
                        direction: 'in',
                        target: { kind: 'character', bits: 8, encoding: 'CP932' },
                      },
                    }
                  : parameter,
            ),
            resultWritten: id === 391,
            ...(id === 391
              ? { result: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' } }
              : {}),
          },
        })),
        {
          ids: [12],
          fields: { review: 'reviewed', resultWritten: false },
        },
        {
          ids: [467],
          fields: {
            review: 'reviewed',
            resultWritten: false,
            parameters: NATIVE_SEMANTICS.main[467].signature.parameters.map((parameter, index) =>
              index === 0
                ? { ...parameter, type: { kind: 'object-id', objectKind: 'Plane' } }
                : index === 1
                  ? {
                      ...parameter,
                      type: {
                        kind: 'pointer',
                        addressSpace: 'vm',
                        direction: 'in',
                        target: {
                          kind: 'record',
                          name: '64B texture ID and five columns of three finite f32 values',
                        },
                      },
                    }
                  : parameter,
            ),
          },
        },
        ...areaAdditionalServices.map((id) => ({
          ids: [id],
          fields: {
            review: 'reviewed',
            resultWritten: false,
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? {
                    ...parameter,
                    type: {
                      kind: 'object-id',
                      objectKind:
                        id === 202 ? 'Task' : id === 198 ? 'area-effect' : 'Base-or-area-effect',
                    },
                  }
                : {
                    ...parameter,
                    type: {
                      kind: 'pointer',
                      addressSpace: 'vm',
                      direction: 'in',
                      target: {
                        kind: 'record',
                        name:
                          id === 199
                            ? '64-byte local matrix packet'
                            : 'five DWORDs with source and destination bitmap handles',
                      },
                    },
                  },
            ),
          },
        })),
        {
          ids: [616],
          fields: {
            review: 'reviewed',
            parameters: [
              {
                ...NATIVE_SEMANTICS.main[616].signature.parameters[0],
                type: { kind: 'object-id', objectKind: 'STRING' },
              },
            ],
            resultWritten: true,
          },
        },
        ...[136, 137].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) => {
              if (parameter.name === 'task')
                return { ...parameter, type: { kind: 'object-id', objectKind: 'legacy-text' } };
              if (parameter.name === 'bitmap')
                return {
                  ...parameter,
                  type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                };
              return parameter;
            }),
            resultWritten: false,
          },
        })),
        {
          ids: [120],
          fields: {
            parameters: NATIVE_SEMANTICS.main[120].signature.parameters.map((parameter) => {
              if (parameter.name === 'destination')
                return {
                  ...parameter,
                  type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              const name = parameter.name === 'rectangle' ? 'RECT' : 'bitmap-handle and XY records';
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'record', name },
                },
              };
            }),
            resultWritten: false,
          },
        },
        ...[121, 122, 705].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) =>
              parameter.name === 'bitmap'
                ? {
                    ...parameter,
                    type: { kind: 'handle', handleKind: 'bitmap', ownership: 'borrowed' },
                  }
                : parameter,
            ),
            resultWritten: false,
          },
        })),
        {
          ids: [713],
          fields: {
            parameters: [
              {
                description: 'handle image',
                name: 'image',
                type: { kind: 'handle', handleKind: 'image-owner', ownership: 'borrowed' },
              },
              ...NATIVE_SEMANTICS.main[121].signature.parameters.slice(1),
            ],
            resultWritten: false,
          },
        },
        ...Array.from({ length: 12 }, (_, i) => {
          const id = 405 + i,
            signature = NATIVE_SEMANTICS.main[id].signature;
          return {
            ids: [id],
            fields: {
              parameters: signature.parameters.map((parameter) => {
                const { type } = parameter;
                if (type.kind === 'handle') {
                  const ownership = id === 406 || id === 413 ? 'unknown' : 'borrowed';
                  return {
                    ...parameter,
                    type: { ...type, handleKind: 'gallery-table', ownership },
                  };
                }
                if (type.kind !== 'pointer') return parameter;
                const output = parameter.name === 'destination';
                return {
                  ...parameter,
                  type: {
                    kind: 'pointer',
                    addressSpace: 'vm',
                    direction: output ? 'out' : 'in',
                    target: output
                      ? { kind: 'character', bits: 8, encoding: 'CP932' }
                      : { kind: 'format-string', encoding: 'CP932' },
                  },
                };
              }),
              result:
                signature.result.kind === 'handle'
                  ? { ...signature.result, handleKind: 'gallery-table' }
                  : signature.result,
              resultWritten: id !== 406 && id !== 413,
            },
          };
        }),
        { ids: [7, 53, 55, 56, 58, 59, 60, 61, 321], fields: { resultWritten: true } },
        { ids: [109], fields: { resultWritten: true } },
        { ids: [701], fields: { resultWritten: false } },
        { ids: [702], fields: { resultWritten: true } },
        {
          ids: [346],
          fields: {
            parameters: NATIVE_SEMANTICS.main[346].signature.parameters.map((parameter, index) =>
              index === 1
                ? {
                    ...parameter,
                    type: {
                      kind: 'pointer',
                      addressSpace: 'vm',
                      direction: 'in',
                      target: { kind: 'format-string', encoding: 'CP932' },
                    },
                  }
                : parameter,
            ),
          },
        },
        {
          ids: [399],
          fields: {
            parameters: NATIVE_SEMANTICS.main[399].signature.parameters.map((parameter, index) =>
              index >= 1 && index <= 4
                ? {
                    ...parameter,
                    type: {
                      kind: 'pointer',
                      addressSpace: 'vm',
                      direction: 'in',
                      target: { kind: 'record', name: index === 4 ? 'matrix4' : 'vector3' },
                    },
                  }
                : parameter,
            ),
          },
        },
        ...[204, 205, 206].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, index) =>
              index === 0
                ? {
                    ...parameter,
                    type: {
                      kind: 'pointer',
                      addressSpace: 'vm',
                      direction: 'inout',
                      target: { kind: 'record', name: 'matrix4' },
                    },
                  }
                : parameter,
            ),
          },
        })),
        {
          ids: [735],
          fields: {
            parameters: NATIVE_SEMANTICS.main[735].signature.parameters.map((parameter, index) =>
              index === 0 || index === 5
                ? {
                    ...parameter,
                    type: { kind: 'handle', handleKind: 'image-owner', ownership: 'borrowed' },
                  }
                : parameter,
            ),
          },
        },
        {
          ids: [723, 727],
          fields: {
            resultWritten: false,
            parameters: [
              {
                name: 'image',
                description: 'Borrowed image owner',
                type: { kind: 'handle', handleKind: 'image-owner', ownership: 'borrowed' },
              },
              {
                name: 'mode',
                description: 'Rotation angle or reflection axis',
                type: { kind: 'integer', bits: 32, signed: true },
              },
            ],
          },
        },
        {
          ids: [681],
          fields: {
            parameters: [
              {
                name: 'filename',
                description: 'NUL-terminated image filename format',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
            ],
          },
        },
        {
          ids: [514],
          fields: {
            resultWritten: true,
            parameters: [
              {
                name: 'manager',
                description: 'Borrowed motion manager',
                type: { kind: 'handle', handleKind: 'motion-manager', ownership: 'borrowed' },
              },
              {
                name: 'filename',
                description: 'NUL-terminated MOT filename format',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
            ],
          },
        },
        {
          ids: [521, 522, 523, 524, 853, 854, 855, 857, 860, 861],
          fields: { resultWritten: false },
        },
        {
          ids: [856],
          fields: {
            argumentWords: 6,
            parameters: NATIVE_SEMANTICS.main[856].signature.parameters.slice(0, 6),
            resultWritten: false,
          },
        },
        { ids: [83, 86, 87], fields: { resultWritten: false } },
        { ids: [74, 75, 77, 89, 98, 107], fields: { resultWritten: true } },
        { ids: [90, 91, 102, 103], fields: { resultWritten: false } },
        { ids: [29, 30, 31, 683, 685], fields: { resultWritten: true } },
        { ids: [32, 684], fields: { resultWritten: false } },
        {
          ids: [454],
          fields: {
            parameters: [
              {
                name: 'destination',
                description: 'NUL-terminated FES context name',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target: { kind: 'character', bits: 8, encoding: 'CP932' },
                },
              },
            ],
            resultWritten: false,
          },
        },
        { ids: [577, 651, 694], fields: { resultWritten: false } },
        { ids: [99, 106, 110, 150, 394], fields: { resultWritten: false } },
        ...[
          [10, 0],
          [441, 1],
        ].map(([id, index]) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter, i) =>
              i === index
                ? {
                    ...parameter,
                    type: {
                      kind: 'pointer',
                      addressSpace: 'vm',
                      direction: 'in',
                      target: { kind: 'format-string', encoding: 'CP932' },
                    },
                  }
                : parameter,
            ),
            resultWritten: false,
          },
        })),
        { ids: [445, 845, 846, 847], fields: { resultWritten: false } },
        {
          ids: [611, 612, 613, 614, 615, 617, 618, 619, 620, 621, 695],
          fields: { resultWritten: false },
        },
        { ids: [4, 33, 34, 372, 373, 718, 719, 720, 786], fields: { resultWritten: true } },
        { ids: [119, 363, 369], fields: { resultWritten: false } },
        { ids: [271, 274, 693], fields: { resultWritten: true } },
        { ids: [272, 273, 275, 426, 427], fields: { resultWritten: false } },
        {
          ids: [25],
          fields: {
            parameters: [
              {
                name: 'text',
                description: 'Narrow VM format string',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
            ],
            resultWritten: true,
          },
        },
        { ids: [51, 52, 54, 57, 397], fields: { resultWritten: true } },
        { ids: [76, 536], fields: { resultWritten: true } },
        { ids: [80, 81, 149, 196, 197, 203, 862], fields: { resultWritten: false } },
        {
          ids: [201],
          fields: {
            parameters: [
              {
                name: 'task',
                description: 'Native task ID queried for its kind in the caller Top',
                type: { kind: 'object-id', objectKind: 'Task' },
              },
              {
                name: 'selector',
                description: 'Zero selects the Raster or Hydro live parameter message',
                type: { kind: 'integer', bits: 32, signed: false },
              },
              {
                name: 'parameters',
                description: 'Borrowed VM packet with Raster amplitude, frequency and period',
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'record', name: 'Raster parameters' },
                },
              },
            ],
            resultWritten: false,
          },
        },
        { ids: [200], fields: { resultWritten: true } },
        { ids: [124, 125, 418, 557], fields: { resultWritten: false } },
        { ids: [320], fields: { resultWritten: false } },
        { ids: [265, 266, 267, 268, 269], fields: { resultWritten: true } },
        { ids: [270, 417, 787, 788], fields: { resultWritten: false } },
        { ids: [625, 728], fields: { resultWritten: false } },
        { ids: [717, 724], fields: { resultWritten: true } },
        { ids: [712, 715, 726, 730, 737], fields: { resultWritten: false } },
        { ids: [598, 710, 733], fields: { resultWritten: true } },
        { ids: [711, 714, 732, 736], fields: { resultWritten: false } },
        { ids: [699], fields: { resultWritten: false } },
        { ids: [852], fields: { resultWritten: true } },
        { ids: [218, 653, 654, 655], fields: { resultWritten: false } },
        { ids: [339, 340, 341, 342, 534], fields: { resultWritten: false } },
        { ids: [38, 39, 42], fields: { resultWritten: true } },
        { ids: [41, 43, 44], fields: { resultWritten: false } },
        { ids: [520], fields: { resultWritten: true } },
        { ids: [525, 526, 527, 528, 529], fields: { review: 'reviewed', resultWritten: false } },
        { ids: [530, 531], fields: { resultWritten: false } },
        { ids: [46], fields: { resultWritten: false } },
        { ids: [62, 63], fields: { resultWritten: true } },
        { ids: [568, 858, 859], fields: { resultWritten: false } },
        {
          ids: [675],
          fields: {
            result: {
              kind: 'handle',
              handleKind: 'dictionary',
              ownership: 'owned',
              description: 'Owned ordered dictionary',
            },
            resultWritten: true,
          },
        },
        ...[676, 677, 678, 679, 680].map((id) => ({
          ids: [id],
          fields: {
            resultWritten: id === 679 || id === 680,
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) => {
              if (parameter.type.kind === 'handle')
                return {
                  ...parameter,
                  type: {
                    kind: 'handle',
                    handleKind: 'dictionary',
                    ownership: id === 676 ? 'owned' : 'borrowed',
                  },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: id === 680 ? 'out' : 'in',
                  target:
                    id === 680
                      ? { kind: 'character', bits: 8, encoding: 'CP932' }
                      : { kind: 'format-string', encoding: 'CP932' },
                },
              };
            }),
          },
        })),
        { ids: [113, 241, 251, 850, 851], fields: { resultWritten: true } },
        { ids: [674, 844], fields: { resultWritten: true } },
        { ids: [565, 566], fields: { resultWritten: true } },
        { ids: [567], fields: { resultWritten: false } },
        { ids: [605, 606, 607], fields: { resultWritten: true } },
        { ids: [347, 348], fields: { resultWritten: false } },
        { ids: [602, 603], fields: { resultWritten: false, review: 'reviewed' } },
        { ids: [604], fields: { resultWritten: true } },
        { ids: [40, 47, 48, 49], fields: { resultWritten: true } },
        { ids: [16, 17, 18, 19, 20, 22, 23, 24], fields: { resultWritten: true } },
        { ids: [212, 609, 610, 659], fields: { resultWritten: false } },
        { ids: [213, 658], fields: { resultWritten: true } },
        { ids: [392], fields: { resultWritten: true } },
        { ids: [285], fields: { resultWritten: true } },
        { ids: [286], fields: { resultWritten: false } },
        { ids: [649, 650], fields: { resultWritten: true } },
        { ids: [309, 310, 311, 440], fields: { resultWritten: true } },
        { ids: [312, 313, 314], fields: { resultWritten: false } },
        { ids: [35], fields: { resultWritten: false } },
        { ids: [50], fields: { resultWritten: true } },
        { ids: [257], fields: { resultWritten: false } },
        { ids: [111, 112, 118, 364, 365, 368], fields: { resultWritten: true } },
        { ids: [114, 115, 362, 366, 367], fields: { resultWritten: false } },
        { ids: [243, 253], fields: { resultWritten: true } },
        { ids: [570, 571, 572], fields: { resultWritten: false } },
        { ids: [437], fields: { resultWritten: true } },
        { ids: [434, 435, 436, 438], fields: { resultWritten: false } },
        { ids: [21, 539, 540], fields: { resultWritten: true } },
        { ids: [45, 278], fields: { resultWritten: false } },
        { ids: [261], fields: { resultWritten: true } },
        { ids: [258, 455], fields: { resultWritten: false } },
        { ids: [696], fields: { resultWritten: true } },
        { ids: [697, 698, 700, 785], fields: { resultWritten: false } },
        { ids: [155, 160, 162, 284], fields: { resultWritten: true } },
        { ids: [156, 157, 158, 159, 161, 163, 164, 168], fields: { resultWritten: false } },
        { ids: [403, 404], fields: { resultWritten: false } },
        { ids: [143], fields: { resultWritten: false } },
        { ids: [315, 316, 387, 388], fields: { resultWritten: true } },
        { ids: [317], fields: { resultWritten: false } },
        { ids: [633, 635, 636, 637, 638, 639, 640], fields: { resultWritten: true } },
        { ids: [634], fields: { resultWritten: false } },
        { ids: [863, 865, 866, 867], fields: { resultWritten: true } },
        { ids: [864, 868], fields: { resultWritten: false } },
        { ids: [515, 518, 519], fields: { resultWritten: true } },
        { ids: [516, 517], fields: { resultWritten: false } },
        ...historyCursorOperations.map((id) => ({
          ids: [id],
          fields: {
            resultWritten: id !== 380,
            ...(id === 379
              ? { result: { kind: 'handle', handleKind: 'history-cursor', ownership: 'owned' } }
              : {}),
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) => {
              if (parameter.type.kind === 'handle')
                return {
                  ...parameter,
                  type: {
                    kind: 'handle',
                    handleKind: id === 379 ? 'scene-data' : 'history-cursor',
                    ownership: id === 380 ? 'owned' : 'borrowed',
                  },
                };
              if (parameter.type.kind !== 'pointer') return parameter;
              return {
                ...parameter,
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'out',
                  target:
                    id === 384
                      ? { kind: 'bits', bits: 32 }
                      : { kind: 'character', bits: 8, encoding: 'CP932' },
                },
              };
            }),
          },
        })),
        {
          ids: [322],
          fields: {
            resultWritten: true,
            parameters: [
              {
                ...NATIVE_SEMANTICS.main[322].signature.parameters[0],
                type: {
                  kind: 'pointer',
                  addressSpace: 'vm',
                  direction: 'in',
                  target: { kind: 'format-string', encoding: 'CP932' },
                },
              },
            ],
          },
        },
        {
          ids: [238],
          fields: {
            resultWritten: true,
            result: { kind: 'handle', handleKind: 'global-file', ownership: 'owned' },
          },
        },
        ...taskSceneCSSOperations.map((id) => ({
          ids: [id],
          fields: {
            argumentWords: 4,
            resultWritten: true,
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters
              .slice(0, 4)
              .map((parameter) =>
                parameter.type.kind !== 'handle'
                  ? parameter
                  : {
                      ...parameter,
                      type: {
                        kind: 'handle',
                        handleKind: parameter.name === 'globalFile' ? 'global-file' : 'task',
                        ownership: 'borrowed',
                      },
                    },
              ),
          },
        })),
        ...[
          ...taskSceneOperations,
          ...crossTaskSceneOperations,
          ...explicitHistoryStringOperations,
        ].map((id) => ({
          ids: [id],
          fields: {
            resultWritten: NATIVE_SEMANTICS.main[id].signature.controlCodes.includes(1),
            parameters: NATIVE_SEMANTICS.main[id].signature.parameters.map((parameter) =>
              parameter.type.kind === 'handle'
                ? {
                    ...parameter,
                    type: {
                      kind: 'handle',
                      handleKind: explicitHistoryStringOperations.includes(id)
                        ? 'scene-data'
                        : 'task',
                      ownership: 'borrowed',
                    },
                  }
                : parameter.type.kind !== 'pointer'
                  ? parameter
                  : {
                      ...parameter,
                      type: {
                        ...parameter.type,
                        addressSpace: 'vm',
                        direction: [222, 228, 230, 235, 335].includes(id)
                          ? 'out'
                          : id === 232 || id === 233 || id === 337
                            ? 'inout'
                            : 'in',
                        target:
                          parameter.type.target.kind === 'bits'
                            ? parameter.type.target
                            : { ...parameter.type.target, encoding: 'CP932' },
                      },
                    },
            ),
          },
        })),
        {
          ids: [
            6, 15, 64, 69, 70, 242, 248, 252, 294, 304, 307, 318, 319, 323, 325, 326, 327, 328, 329,
            332, 333, 338, 386, 389, 390, 419, 423, 424, 425, 450, 535, 594, 596, 597, 608, 646,
            741, 790,
          ],
          fields: { resultWritten: true },
        },
        { ids: mainConstantZero, fields: { resultWritten: true } },
        {
          ids: [
            65, 78, 84, 85, 93, 94, 101, 207, 295, 296, 298, 299, 300, 301, 302, 303, 308, 324, 330,
            331, 336, 343, 344, 345, 402, 420, 421, 422, 451, 453, 458, 459, 466, 541, 542, 586,
            595, 630, 645, 647, 739, 740,
          ],
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
        {
          ids: [385],
          fields: {
            argumentWords: 4,
            parameters: NATIVE_SEMANTICS.main[385].signature.parameters.slice(0, 4),
            resultWritten: true,
          },
        },
      ],
    },
    generic: {
      ...tables(45, [
        auxiliaryLoggerEvidence,
        {
          ids: motionGeometryOperations,
          value:
            'Own 2.6.1.23 MOT matrix and vector wrappers retain mapped VM records, the current matrix fallback on inverse, sequential DWORD overlap behavior and the scalar PC24 D3DX arithmetic.',
        },
        {
          ids: [1, 8, 9, 10, 12],
          value: 'Own 2.6.1.23 MOT sin, ceil, absolute, floor and sqrt match the Particle bodies',
        },
        {
          ids: [2, 3, 4, 5, 6, 7],
          value:
            'Own 2.6.1.23 CRT trigonometry has the same wrappers in each interpreter and its own atan2 classification table',
        },
        {
          ids: [11],
          value:
            'Own 2.6.1.23 MOT and PTCL remainder share 0x5736da, the CRT classification and FPREM loop',
        },
        {
          ids: [13],
          value:
            'Own 2.6.1.23 MOT 0x595670 invokes the Main 61 initialized CRT power body with the same result and domain words',
        },
        {
          ids: motionComponentOperations,
          value:
            'Own 2.6.1.23 MOT 0x595f50–0x596150 map three writable DWORDs; rotate snapshots the vector and translate/scale read the overlapping words in write order',
        },
        {
          ids: [14, 15],
          value: 'Own 2.6.1.23 MOT 0x595470/0x595450 match the Main/Particle x87 angle bodies',
        },
        { ids: [16], value: 'Own 2.6.1.23 Generic 0x595650 writes the signed absolute value word' },
        {
          ids: [23, 24, 25, 26],
          value:
            'Own 2.6.1.23 MOT 0x595de0–0x595f00 share the Main XYZ rotation, translation, scale and identity helpers and the current matrix',
        },
        { ids: [17, 38, 41], value: 'Own 2.6.1.23 MOT handlers and fixed-base logo motion calls' },
        {
          ids: [39, 40],
          value:
            'Own 2.6.1.23 MOT 0x595af0/0x595ad0 draw from the shared integer and real MT19937 streams',
        },
        {
          ids: [42],
          value:
            'Own 2.6.1.23 MOT 0x595490 shares the x87 triangle wave body with Particle 0x48cfc0',
        },
        {
          ids: [43, 44],
          value:
            'Own 2.6.1.23 MOT 0x595EA0 and 0x595900 preserve their local/shared in-place matrix writes with the PE scalar PC24 D3DX dispatch.',
        },
      ]),
      signatures: [
        ...geometrySignatures('generic', motionGeometryOperations),
        ...[...motionComponentOperations, 24, 25].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.generic[id].signature.parameters.map((parameter) =>
              parameter.type.kind === 'pointer'
                ? {
                    ...parameter,
                    type: { ...parameter.type, addressSpace: 'vm', direction: 'inout' },
                  }
                : parameter,
            ),
          },
        })),
        {
          ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 39, 40, 41, 42],
          fields: { resultWritten: true },
        },
        ...[43, 44].map((id) => ({
          ids: [id],
          fields: {
            parameters: NATIVE_SEMANTICS.generic[id].signature.parameters.map((parameter, index) =>
              parameter.type.kind === 'pointer'
                ? {
                    ...parameter,
                    type: {
                      ...parameter.type,
                      addressSpace: 'vm',
                      direction: index === 0 ? 'inout' : 'in',
                    },
                  }
                : parameter,
            ),
          },
        })),
      ],
    },
    'particle-v1': {
      ...tables(44, particleInterpreterEvidence),
      signatures: particleInterpreterSignatures,
    },
    'particle-v2': {
      ...tables(51, [
        ...particleInterpreterEvidence,
        {
          ids: [44, 45],
          value:
            'Own 2.6.1.23 PTCL v2 0x48C0B0 and 0x48C0E0 copy every owned 112-byte quad between the active and backup spans. Initial allocation seeds the backup with the active span. The true loaded v2 VM now proves full-bank backup/reset around an intervening ordinary quad mutation and normal restart/cold.',
        },
        {
          ids: [46],
          value:
            'Own 2.6.1.23 PTCL v2 0x48C110 returns the complete retained attachment DWORD without querying a renderer or model. The true loaded v2 VM captures this return after Main427 attaches a real registered kind2 graph.',
        },
        {
          ids: [47],
          value:
            'Own 2.6.1.23 PTCL v2 0x48C130 returns the renderer registration DWORD or initialized zero. Main 92 and Plane raw 43/44 preserve the old DWORD for requests on the same side of zero. The true v2 VM reads the actual registered graph in the quad lifecycle fixture.',
        },
        {
          ids: [48],
          value:
            'Own 2.6.1.23 PTCL v2 0x48C180 writes the selected live model base X/Y. The renderer gates produce zero for a disabled device or empty attachment. A stale active model leaves undefined scratch words. The true loaded v2 VM consumes the live model base X/Y in quad translation; stale shapes are not promoted.',
        },
        {
          ids: [49],
          value:
            'Own 2.6.1.23 PTCL v2 0x48C1F0 writes three coordinates from the selected model. The native renderer gates produce zero for a disabled device or absent attachment. The true loaded v2 VM consumes live coordinates in SetPos and real projected quad output.',
        },
        {
          ids: [50],
          value:
            'Own 2.6.1.23 Particle v2 blend mode stores 1–5 or zero; the loaded v2 fixture sets mode2 before actual DrawPrimitive and current cold continuation',
        },
      ]),
      signatures: [
        ...particleInterpreterSignatures,
        {
          ids: [44, 45],
          fields: {
            parameters: [
              {
                name: 'ignored',
                description: 'unused DWORD',
                type: { kind: 'ignored', bits: 32 },
              },
            ],
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
      ],
    },
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
        configSize: 184,
        packetSize: 188,
        nativeConfig: { size: 172, offsetInParser: 4 },
      },
      nv: {
        configSize: 408,
        packetSize: 432,
        // Surface and main rectangle, main parser, secondary rectangle, secondary parser.
        nativeConfig: {
          size: 384,
          parts: [
            [0, 24],
            [28, 172],
            [208, 16],
            [228, 172],
          ],
        },
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
      'floatingPoint.x87ControlWord',
      'floatingPoint.mxcsr',
      'graphics.texturedBoundsQuery',
    ].map((path) => [path, 'Outside the verified 2.6.1.23 startup and title bindings']),
  ),
};
