// SPDX-License-Identifier: MPL-2.0
// DirectX diagnostics for the virtual Direct3D 9 device. Objects and their
// reference counts live in guest memory so native COM calls remain portable.
const PROVIDER_CLASS = [0xa65b8071, 0x42133bfe, 0x1d495b9a, 0xa71c46a4];
const PROVIDER = [0x9c6b4cb0, 0x49cc23f8, 0xa545eda3, 0xd2a60050];
const CONTAINER = [0x7d0f462f, 0x48624064, 0x3e937fbc, 0x0fc15850];
const IUNKNOWN = [0, 0, 0xc0, 0x46000000];
const E_POINTER = 0x80004003;
const E_NOINTERFACE = 0x80004002;
const E_INVALIDARG = 0x80070057;
const CO_E_NOTINITIALIZED = 0x800401f0;
const DXDIAG_E_INSUFFICIENT_BUFFER = 0x8007007a;
const VT_EMPTY = 0;
const VT_BSTR = 8;
const VT_UI4 = 19;
const SYSTEM_INFO = 'DxDiag_SystemInfo';
const PROPERTIES = new Map([
  ['dwDirectXVersionMajor', 9],
  ['dwDirectXVersionMinor', 0],
  ['szDirectXVersionLetter', 'c'],
]);

export function installNativeDxDiagnostics(engine) {
  const { kernel, process: p, refs } = engine,
    addRef = (pointer) => {
      const refs = p.load(pointer + 4) + 1;
      p.store(pointer + 4, refs);
      return refs;
    },
    release = (pointer) => {
      const refs = p.load(pointer + 4) - 1;
      if (refs) p.store(pointer + 4, refs);
      else {
        const owner = p.load(pointer + 12);
        p.free(pointer);
        if (owner) release(owner);
      }
      return refs;
    },
    supports = (iid, kind) =>
      iid && [IUNKNOWN, kind].some((guid) => guid.every((word, i) => p.load(iid + i * 4) === word)),
    create = (out, kind, flag, owner = 0) => {
      if (!out) return E_POINTER;
      const pointer = p.allocate(16, true);
      p.store(pointer, engine.refs.dxDiagnostics[kind]);
      p.store(pointer + 4, 1);
      p.store(pointer + 8, flag);
      p.store(pointer + 12, owner);
      if (owner) addRef(owner);
      p.store(out, pointer);
      return 0;
    },
    table = (kind, guid, methods) => {
      const slots = [
          [
            3,
            (pointer, iid, out) => {
              if (!out) return E_POINTER;
              p.store(out, 0);
              if (!supports(iid, guid)) return E_NOINTERFACE;
              addRef(pointer);
              p.store(out, pointer);
              return 0;
            },
          ],
          [1, addRef],
          [1, release],
          ...methods,
        ],
        address = p.allocate(slots.length * 4, true);
      slots.forEach(([count, fn], slot) => {
        p.store(
          address + slot * 4,
          p.trap(`DxDiag ${kind} slot ${slot}`, count, (args) => fn(...args)),
        );
      });
      return address;
    },
    count = (out, value) => {
      if (!out) return E_INVALIDARG;
      p.store(out, value);
      return 0;
    },
    enumerate = (out, length, name) => {
      if (!out || !length) return E_INVALIDARG;
      kernel.writeString(out, (name ?? '').slice(0, length - 1), true);
      return name === undefined
        ? E_INVALIDARG
        : length > name.length
          ? 0
          : DXDIAG_E_INSUFFICIENT_BUFFER;
    },
    isSystem = (pointer) => p.load(pointer + 8) === 1;
  refs.dxDiagnostics = {
    provider: table('provider', PROVIDER, [
      [
        2,
        (pointer, params) => {
          if (!params) return E_POINTER;
          if (p.load(params) !== 16 || p.load(params + 4) !== 111) return E_INVALIDARG;
          p.store(pointer + 8, 1);
          return 0;
        },
      ],
      [
        2,
        (pointer, out) =>
          p.load(pointer + 8) ? create(out, 'container', 0, pointer) : CO_E_NOTINITIALIZED,
      ],
    ]),
    container: table('container', CONTAINER, [
      [2, (pointer, out) => count(out, Number(!isSystem(pointer)))],
      [
        4,
        (pointer, index, out, length) =>
          enumerate(out, length, !isSystem(pointer) && !index ? SYSTEM_INFO : undefined),
      ],
      [
        3,
        (pointer, name, out) => {
          if (!name || !out) return E_INVALIDARG;
          p.store(out, 0);
          if (isSystem(pointer) || p.string(name, true) !== SYSTEM_INFO) return E_INVALIDARG;
          return create(out, 'container', 1, p.load(pointer + 12));
        },
      ],
      [2, (pointer, out) => count(out, isSystem(pointer) ? PROPERTIES.size : 0)],
      [
        4,
        (pointer, index, out, length) =>
          enumerate(out, length, isSystem(pointer) ? [...PROPERTIES.keys()][index] : undefined),
      ],
      [
        3,
        (pointer, name, out) => {
          if (!name || !out || !isSystem(pointer)) return E_INVALIDARG;
          const value = PROPERTIES.get(p.string(name, true));
          if (value === undefined) return E_INVALIDARG;
          p.zero(out, 16);
          if (typeof value === 'number') {
            p.store(out, VT_UI4);
            p.store(out + 8, value);
          } else {
            const bstr = p.allocate(4 + (value.length + 1) * 2, true);
            p.store(bstr, value.length * 2);
            kernel.writeString(bstr + 4, value, true);
            p.store(out, VT_BSTR);
            p.store(out + 8, bstr + 4);
          }
          return 0;
        },
      ],
    ]),
  };
  kernel.registerCOMClass(PROVIDER_CLASS, (iid, out) =>
    supports(iid, PROVIDER) ? create(out, 'provider', 0) : E_NOINTERFACE,
  );
  // Both original images import these OLE Automation routines by ordinal.
  const automation = (ordinal, fn) =>
    engine.registerWindows('OLEAUT32.dll', `#${ordinal}`, { count: 1, fn });
  automation(8, ([out]) => p.store(out, (p.load(out) & 0xffff0000) | VT_EMPTY)); // VariantInit
  automation(9, ([out]) => {
    if (!out) return E_INVALIDARG;
    const word = p.load(out),
      type = word & 0xffff;
    if (type === VT_BSTR) {
      const bstr = p.load(out + 8);
      if (bstr && !p.free(bstr - 4)) throw new Error('Native VARIANT owns an unknown BSTR');
    } else if (type !== VT_EMPTY && type !== VT_UI4) return 0x80020008; // DISP_E_BADVARTYPE
    p.store(out, word & 0xffff0000);
    return 0;
  }); // VariantClear
  automation(7, ([bstr]) => (bstr ? p.load(bstr - 4) / 2 : 0)); // SysStringLen
}

export function releaseNativeDxDiagnostics(engine) {
  for (const table of Object.values(engine.refs.dxDiagnostics ?? {})) engine.process.free(table);
  delete engine.refs.dxDiagnostics;
}
