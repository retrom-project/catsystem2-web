// SPDX-License-Identifier: MPL-2.0
// Reviewed native FES common membership. Name crossrefs are navigation only;
// they do not establish semantic equivalence or bind a handler.
import { engine23TitleCommonHeads } from './2.6.1.23.mjs';
import engine63 from './2.6.1.63.mjs';
import engine67 from './2.6.1.67.mjs';
const shared = {
  _redirect: [],
  _redirect_clear: [],
  _redirect_erase: [],
  automove: ['fes.reference.cn.automove'],
  automoveex: ['fes-extension.automoveex'],
  basebtnpri: ['fes.reference.cn.basebtnpri'],
  baseimg: ['fes.reference.cn.baseimg'],
  baseimg_pri: [],
  bitcount: [],
  break: ['fes.reference.cn.break'],
  btnsimulate: ['fes-extension.drag---dragimg---draghelp---btnsimulate'],
  call: ['fes.reference.cn.call'],
  cgreg: [],
  cgreg_init: ['fes.reference.cn.cgreg_init'],
  cgreg_t: ['fes.reference.cn.cgreg_t'],
  cgregmax: ['fes.reference.cn.cgregmax'],
  cgregnum: ['fes.reference.cn.cgregnum'],
  cgregtbl: ['fes.reference.cn.cgregtbl'],
  check_install: [],
  checktitle: [],
  clipboard: ['fes.reference.cn.clipboard'],
  config: ['fes.reference.cn.config'],
  config_open: ['fes.reference.cn.config_open'],
  cursormove: [],
  datasave: ['fes.reference.cn.datasave'],
  dbgstr: ['fes.reference.cn.dbgstr'],
  dbgtime: [],
  debug: ['fes.reference.cn.debug'],
  decode: ['fes.reference.cn.decode'],
  deletebgbutton: ['fes.reference.cn.deletebgbutton'],
  deletetask: [],
  dic_appear: [],
  dic_find: [],
  dic_id: [],
  dic_ind: [],
  dic_max_appear: [],
  dic_title: [],
  dic_update: [],
  dic_update_clear: [],
  enablebgbutton: [],
  endfes: ['fes.reference.cn.endfes'],
  endif: ['fes.reference.cn.if'],
  endkcs: ['fes.reference.cn.endkcs'],
  execfes: ['fes.reference.cn.execfes'],
  execkcs: ['fes.reference.cn.execkcs'],
  exit: ['fes.reference.cn.exit'],
  exit_boot: [],
  fileexist: ['fes.reference.cn.fileexist'],
  fontcom: ['fes.reference.cn.fontcom'],
  force_redraw: ['fes.reference.cn.force_redraw'],
  fps_enable: [],
  fps_get: [],
  fw_actcode: [],
  fw_activate: [],
  fw_auth: [],
  fw_destroy: [],
  fw_hash: [],
  fw_init: [],
  fw_limitpos: [],
  fw_status: [],
  fw_uniquecode: [],
  getconf: ['fes.reference.cn.getconf'],
  getexvar: [],
  getsndconfex: ['fes.reference.cn.getsndconfex'],
  getstbl: ['fes.reference.cn.getstbl'],
  gettime: ['fes.reference.cn.gettime'],
  getweek: ['fes.reference.cn.getweek'],
  if: ['fes.reference.cn.if'],
  input_text: ['fes.reference.cn.input_text'],
  inputdevice: [],
  isdebug: [],
  keyskip: ['fes.reference.cn.keyskip'],
  lockactive: ['fes.reference.cn.lockactive'],
  maketask: [],
  messagebox: ['fes.reference.cn.messagebox'],
  newsave: ['fes.reference.cn.newsave'],
  next: ['fes.reference.cn.next'],
  opensite: ['fes.reference.cn.opensite'],
  opensiteenc: [],
  psversion: [],
  rand: ['fes.reference.cn.rand'],
  randtbl: ['fes.reference.cn.randtbl'],
  rdraw: ['fes.reference.cn.rdraw'],
  react: ['fes.reference.cn.react'],
  replacespace: [],
  reset_frame: ['fes.reference.cn.reset_frame'],
  resetactive: ['fes.reference.cn.resetactive'],
  restoremove: ['fes.reference.cn.restoremove'],
  result: [],
  rettitle: ['fes.reference.cn.rettitle'],
  rfmos: ['fes.native-command.rfmos'],
  rwipe: ['fes.reference.cn.rwipe'],
  rwmos: ['fes.native-command.rwmos'],
  saveapend_str: ['fes.reference.cn.saveapend_str'],
  savecopy: ['fes.reference.cn.savecopy'],
  savedelete: ['fes.reference.cn.savedelete'],
  saveexchg: ['fes.reference.cn.saveexchg'],
  saveexist: ['fes.reference.cn.saveexist'],
  saveget_date: ['fes.native-command.saveget_date'],
  saveget_str: ['fes.reference.cn.saveget_str'],
  send: ['fes.reference.cn.send'],
  sendbtn: ['fes.reference.cn.sendbtn'],
  setconf: ['fes.reference.cn.setconf'],
  setexvar: [],
  setsndconfex: ['fes.reference.cn.setsndconfex'],
  setstbl: ['fes.reference.cn.setstbl'],
  sortsave: ['fes.native-command.sortsave'],
  sortsave2: ['fes.native-command.sortsave2'],
  strcmp: [],
  strvar: ['fes.reference.cn.strvar'],
  sysvoice: ['fes.reference.cn.sysvoice'],
  sysvoiceex: ['fes-extension.sysvoiceex'],
  touch_enable: [],
  touch_kill: [],
  vram_get: [],
  wait: ['fes.reference.cn.wait'],
  wbreak: ['fes.native-command.wbreak'],
  wndmenu: ['fes.reference.cn.wndmenu'],
  xchgcursor: [],
};

const gameOnly = {
  cgreg_getlist: [],
  dbgstru8: [],
  m2_getconf: ['fes-extension.m2_getconf---m2_setconf'],
  m2_resetview: [],
  m2_setconf: ['fes-extension.m2_getconf---m2_setconf'],
  m2_waiteff: [],
  steam_achievement: [],
  steam_achievement_reset: [],
  steam_enablescreenshot: [],
  steam_init: [],
  steam_isbroadcast: [],
  steam_isenable: [],
};

const sdkOnly = {
  calljs: [],
  endjs: ['fes.reference.cn.endjs'],
  execjs: ['fes.reference.cn.execjs'],
};

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const FES_COMMON_HEAD_CATALOGUE = freeze(
  Object.fromEntries(
    Object.entries({ ...shared, ...gameOnly, ...sdkOnly }).map(([keyword, references]) => [
      keyword,
      {
        keyword,
        semanticLink: null,
        dispatchBinding: null,
        nameCrossrefs: references.map((contractId) => ({ contractId, kind: 'name-crossref-only' })),
      },
    ]),
  ),
);

const sharedNames = freeze(Object.keys(shared).sort()),
  gameAdditions = freeze(Object.keys(gameOnly).sort()),
  sdkAdditions = freeze(Object.keys(sdkOnly).sort());

// A common meaning is defined once; an engine must separately register its proof.
const commonBindings = freeze({
  'active-reference-null': {
    keyword: 'resetactive',
    semanticLink: 'fes.reference.cn.resetactive',
  },
  'active-lock-int32': {
    keyword: 'lockactive',
    semanticLink: 'fes.reference.cn.lockactive',
  },
  'native-wait': { keyword: 'wait', semanticLink: 'fes.reference.cn.wait' },
});
const sdkResetReview = 'sdk74-common-resetactive-null',
  gameResetReview = 'game76-common-resetactive-null',
  sdkLockReview = 'sdk74-common-lockactive-int32',
  gameLockReview = 'game76-common-lockactive-int32',
  sdkWaitReview = 'sdk74-common-wait-owned-parameters',
  gameWaitReview = 'game76-common-wait-owned-parameters',
  engine23WaitReview = 'engine23-common-wait-frame-reference',
  engine63WaitReview = 'engine63-common-wait-owned-parameters',
  engine67WaitReview = 'engine67-common-wait-owned-parameters';
export const FES_COMMON_HEAD_BINDING_REVIEWS = freeze({
  [engine23WaitReview]: {
    binding: 'native-wait',
    selectors: ['frame'],
    operandBytes: 260,
    referenceDefaultIndex: -1,
  },
  [engine63WaitReview]: {
    binding: 'native-wait',
    selectors: ['frame', 'tag'],
    tagRecordCode: 32,
    tagBytes: 32,
    referenceDefaultIndex: -1,
  },
  [engine67WaitReview]: {
    binding: 'native-wait',
    selectors: ['frame', 'tag'],
    tagRecordCode: 32,
    tagBytes: 32,
    referenceDefaultIndex: -1,
  },
  [sdkWaitReview]: {
    binding: 'native-wait',
    selectors: ['frame', 'tag'],
    tagRecordCode: 35,
    tagBytes: 32,
    referenceDefaultIndex: -1,
  },
  [gameWaitReview]: {
    binding: 'native-wait',
    selectors: ['frame', 'tag', 'string', 'privateflag'],
    tagRecordCode: 32,
    tagBytes: 32,
    referenceDefaultIndex: -1,
  },
  [sdkResetReview]: {
    binding: 'active-reference-null',
    operandGetters: 0,
    returnWord: 0,
    recordCode: 14,
    referenceBytes: 36,
    reference: 'null',
  },
  [gameResetReview]: {
    binding: 'active-reference-null',
    operandGetters: 0,
    returnWord: 0,
    recordCode: 11,
    referenceBytes: 36,
    reference: 'null',
  },
  [sdkLockReview]: {
    binding: 'active-lock-int32',
    operandGetters: 1,
    returnWord: -3,
    recordCode: 25,
    scalar: 'signed-int32',
    defaultValue: 0,
  },
  [gameLockReview]: {
    binding: 'active-lock-int32',
    operandGetters: 1,
    returnWord: -3,
    recordCode: 22,
    scalar: 'signed-int32',
    defaultValue: 0,
  },
});
const boundEntries = freeze(
  Object.fromEntries(
    Object.entries(commonBindings).map(([id, binding]) => [
      id,
      {
        ...FES_COMMON_HEAD_CATALOGUE[binding.keyword],
        semanticLink: binding.semanticLink,
        dispatchBinding: id,
      },
    ]),
  ),
);
const reviewRegistrations = freeze([
  {
    shared: engine23TitleCommonHeads.shared,
    additions: engine23TitleCommonHeads.additions,
    complete: false,
    reviews: [engine23WaitReview],
  },
  {
    shared: engine63.fes.commonHeads.shared,
    additions: engine63.fes.commonHeads.additions,
    reviews: [engine63WaitReview],
  },
  {
    shared: engine67.fes.commonHeads.shared,
    additions: engine67.fes.commonHeads.additions,
    reviews: [engine67WaitReview],
  },
  {
    shared: sharedNames,
    additions: sdkAdditions,
    reviews: [sdkResetReview, sdkLockReview, sdkWaitReview],
  },
  {
    shared: sharedNames,
    additions: gameAdditions,
    reviews: [gameResetReview, gameLockReview, gameWaitReview],
  },
]);

export const FES_COMMON_HEAD_REGISTRATIONS = freeze({
  sdk: {
    shared: sharedNames,
    additions: sdkAdditions,
    count: 122,
    complete: true,
    comparison: 'byte-exact-cstring',
    reviewedBindings: [sdkResetReview, sdkLockReview, sdkWaitReview],
  },
  game: {
    shared: sharedNames,
    additions: gameAdditions,
    count: 131,
    complete: true,
    comparison: 'byte-exact-cstring',
    reviewedBindings: [gameResetReview, gameLockReview, gameWaitReview],
  },
});

function sameNames(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

function validNames(names, allowed) {
  return (
    Array.isArray(names) &&
    names.every((name, index) => allowed.includes(name) && (index === 0 || names[index - 1] < name))
  );
}

const additionNames = [...gameAdditions, ...sdkAdditions];

const registrationFields = new Set([
  'shared',
  'additions',
  'count',
  'complete',
  'comparison',
  'reviewedBindings',
]);

export function validateFESCommonHeads(registration) {
  const coverage = reviewRegistrations.find(
    (group) =>
      sameNames(registration?.shared, group.shared) &&
      sameNames(registration?.additions, group.additions),
  );
  if (
    !registration ||
    Object.getPrototypeOf(registration) !== Object.prototype ||
    Object.keys(registration).length !== registrationFields.size ||
    Object.keys(registration).some((key) => !registrationFields.has(key)) ||
    registration.complete !== (coverage?.complete ?? true) ||
    registration.comparison !== 'byte-exact-cstring' ||
    !validNames(registration.shared, sharedNames) ||
    !validNames(registration.additions, additionNames) ||
    !Number.isSafeInteger(registration.count) ||
    registration.count <= 0 ||
    registration.count !== registration.shared.length + registration.additions.length ||
    !Array.isArray(registration.reviewedBindings) ||
    registration.reviewedBindings.some(
      (id, index, list) =>
        typeof id !== 'string' || list.indexOf(id) !== index || !coverage?.reviews.includes(id),
    )
  )
    throw new Error('Invalid FES common head registration');
  return registration;
}

const absent = freeze({ kind: 'absent' }),
  unreviewed = freeze({ kind: 'unreviewed' });

// The ABI entry point supplies a registered profile. This helper only queries
// its reviewed membership; it never expands a head or decides execution.
export function lookupFESCommonHead(registration, bytes) {
  validateFESCommonHeads(registration);
  if (!(bytes instanceof Uint8Array))
    throw new TypeError('FES common head query requires narrow bytes');
  let keyword = '';
  for (const byte of bytes) {
    if (!byte) break;
    keyword += String.fromCharCode(byte);
  }
  if (
    !Object.hasOwn(FES_COMMON_HEAD_CATALOGUE, keyword) ||
    (!registration.shared.includes(keyword) && !registration.additions.includes(keyword))
  )
    return registration.complete ? absent : unreviewed;
  const review = registration.reviewedBindings
      .map((id) => FES_COMMON_HEAD_BINDING_REVIEWS[id])
      .find((item) => boundEntries[item.binding].keyword === keyword),
    qualified = review && boundEntries[review.binding],
    entry = review?.binding === 'native-wait' ? { ...qualified, waitPolicy: review } : qualified;
  return freeze({ kind: 'present', entry: entry ?? FES_COMMON_HEAD_CATALOGUE[keyword] });
}

// Check the shared data without deriving execution support from a contract's
// spelling or status. The two ABI modules must still register their own set.
const allNames = [...sharedNames, ...gameAdditions, ...sdkAdditions];
if (
  sharedNames.length !== 119 ||
  gameAdditions.length !== 12 ||
  sdkAdditions.length !== 3 ||
  allNames.length !== 134 ||
  new Set(allNames).size !== allNames.length ||
  Object.keys(FES_COMMON_HEAD_CATALOGUE).length !== 134 ||
  Object.entries(FES_COMMON_HEAD_CATALOGUE).some(
    ([keyword, entry]) =>
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyword) ||
      keyword.length > 31 ||
      entry.keyword !== keyword ||
      entry.semanticLink !== null ||
      entry.dispatchBinding !== null ||
      entry.nameCrossrefs.some(
        (crossref) =>
          typeof crossref.contractId !== 'string' ||
          !/^fes[.-]/.test(crossref.contractId) ||
          crossref.kind !== 'name-crossref-only',
      ),
  )
)
  throw new Error('Invalid shared FES common head catalogue');
