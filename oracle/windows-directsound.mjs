// SPDX-License-Identifier: MPL-2.0
// The original kcSoundWaveDS startup negotiates a primary PCM format through COM.
const IUNKNOWN = [0, 0, 0xc0, 0x46000000];
const IDIRECTSOUND = [0x279afa83, 0x11ce4981, 0x200021a5, 0x60e50baf];
const IDIRECTSOUND8 = [0xc50a7e93, 0x4834f395, 0xa97ff69e, 0x6609e59d];
const IDIRECTSOUNDBUFFER = [0x279afa85, 0x11ce4981, 0x200021a5, 0x60e50baf];
const DEFAULT_PLAYBACK = [0xdef00000, 0x47ed9c6d, 0xda4df1aa, 0x035c2b8f];
const DEFAULT_VOICE_PLAYBACK = [0xdef00002, ...DEFAULT_PLAYBACK.slice(1)];
const E_NOINTERFACE = 0x80004002;
const E_POINTER = 0x80004003;
const DSERR_INVALIDPARAM = 0x80070057;
const DSERR_NOAGGREGATION = 0x80040110;
const DSERR_PRIOLEVELNEEDED = 0x88780046;
const DSERR_BADFORMAT = 0x88780064;
const DSERR_NODRIVER = 0x88780078;
const DSSCL_NORMAL = 1;
const DSBCAPS_PRIMARYBUFFER = 1;
const DSBCAPS_CTRLFX = 0x200;
const PCM_BYTES = 18;
const DEFAULT_PCM = [0x00020001, 22050, 44100, 0x00080002]; // Stereo, 8-bit PCM
const DEVICE_BYTES = 16 + PCM_BYTES;
const PRIMARY_BYTES = 12;
const REFCOUNT = 4;
const COOPERATIVE_LEVEL = 8;
const PRIMARY = 12;
const FORMAT = 16;
const DEVICE = 8;

export function installNativeDirectSound(engine, hasOutput) {
  const { process: p, kernel } = engine,
    matches = (pointer, guid) => guid.every((word, index) => p.load(pointer + index * 4) === word),
    references = (pointer) => p.load(pointer + REFCOUNT),
    addRef = (pointer) => {
      const count = references(pointer) + 1;
      p.store(pointer + REFCOUNT, count);
      return count;
    },
    query = (supported) => (pointer, iid, out) => {
      if (!out) return E_POINTER;
      p.store(out, 0);
      if (!iid) return E_POINTER;
      if (!supported.some((guid) => matches(iid, guid))) return E_NOINTERFACE;
      addRef(pointer);
      p.store(out, pointer);
      return 0;
    };
  // A primary buffer can be opened again through the same device. Keep its
  // backing memory until both the device and buffer references are released.
  const release = (isDevice) => (pointer) => {
    const count = references(pointer) - 1;
    p.store(pointer + REFCOUNT, count);
    if (!count) {
      const device = isDevice ? pointer : p.load(pointer + DEVICE),
        primary = p.load(device + PRIMARY);
      if (!references(device) && !(primary && references(primary))) {
        if (primary) p.free(primary);
        p.free(device);
      }
    }
    return count;
  };
  const table = (kind, length, bytes, methods) => {
    const address = p.allocate(length * 4, true);
    for (let slot = 0; slot < length; slot++) {
      const [count, method] = methods[slot] ?? [0];
      const entry = p.trap(`DirectSound ${kind} slot ${slot}`, count + 1, ([pointer, ...args]) => {
        if (!method) throw new Error(`Unimplemented DirectSound ${kind} slot ${slot}`);
        if (
          p.allocations.get(pointer) !== bytes ||
          p.load(pointer) !== engine.refs.directSound[kind] ||
          !references(pointer)
        )
          throw new Error(`Invalid DirectSound ${kind} interface`);
        return method(pointer, ...args);
      });
      p.store(address + slot * 4, entry);
    }
    return address;
  };
  const createPrimary = (device, desc, out, outer) => {
    if (!out) return DSERR_INVALIDPARAM;
    p.store(out, 0);
    if (outer) return DSERR_NOAGGREGATION;
    if (!desc || ![20, 36].includes(p.load(desc))) return DSERR_INVALIDPARAM;
    const flags = p.load(desc + 4);
    if (!(flags & DSBCAPS_PRIMARYBUFFER))
      throw new Error('Unimplemented DirectSound secondary buffer');
    if (p.load(desc + 8) || p.load(desc + 12) || p.load(desc + 16) || flags & DSBCAPS_CTRLFX)
      return DSERR_INVALIDPARAM;
    if (flags !== DSBCAPS_PRIMARYBUFFER)
      throw new Error(`Unimplemented DirectSound primary buffer flags 0x${flags.toString(16)}`);
    let primary = p.load(device + PRIMARY);
    if (!primary) {
      primary = p.allocate(PRIMARY_BYTES, true);
      p.store(primary, engine.refs.directSound.primary);
      p.store(primary + DEVICE, device);
      p.store(device + PRIMARY, primary);
    }
    addRef(primary);
    p.store(out, primary);
    return 0;
  };
  const setCooperativeLevel = (device, hwnd, level) => {
    if ((hwnd && !kernel.windowViews.windows.has(hwnd)) || level < 1 || level > 4)
      return DSERR_INVALIDPARAM;
    p.store(device + COOPERATIVE_LEVEL, level);
    return 0;
  };
  const getFormat = (buffer, output, capacity, written) => {
    if (!output && !written) return DSERR_INVALIDPARAM;
    if (output && capacity < PCM_BYTES) {
      if (written) p.store(written, 0);
      return DSERR_INVALIDPARAM;
    }
    if (output) p.write(output, p.read(p.load(buffer + DEVICE) + FORMAT, PCM_BYTES));
    if (written) p.store(written, PCM_BYTES);
    return 0;
  };
  const setFormat = (buffer, input) => {
    const device = p.load(buffer + DEVICE);
    if (p.load(device + COOPERATIVE_LEVEL) === DSSCL_NORMAL) return DSERR_PRIOLEVELNEEDED;
    if (!input) return DSERR_INVALIDPARAM;
    // PCM callers may supply the 16-byte PCMWAVEFORMAT without cbSize.
    const bytes = new Uint8Array(PCM_BYTES);
    bytes.set(p.read(input, PCM_BYTES - 2));
    const format = new DataView(bytes.buffer),
      tag = format.getUint16(0, true),
      channels = format.getUint16(2, true),
      rate = format.getUint32(4, true),
      bytesPerSecond = format.getUint32(8, true),
      alignment = format.getUint16(12, true),
      bits = format.getUint16(14, true);
    if (tag !== 1 || ![8, 16, 24, 32].includes(bits)) return DSERR_BADFORMAT;
    if (
      !channels ||
      !rate ||
      alignment !== (channels * bits) / 8 ||
      bytesPerSecond !== rate * alignment
    )
      return DSERR_INVALIDPARAM;
    p.write(device + FORMAT, bytes);
    return 0;
  };
  engine.refs.directSound = {
    device: table('device', 12, DEVICE_BYTES, {
      0: [2, query([IUNKNOWN, IDIRECTSOUND, IDIRECTSOUND8])],
      1: [0, addRef],
      2: [0, release(true)],
      3: [3, createPrimary],
      6: [2, setCooperativeLevel],
    }),
    primary: table('primary', 21, PRIMARY_BYTES, {
      0: [2, query([IUNKNOWN, IDIRECTSOUNDBUFFER])],
      1: [0, addRef],
      2: [0, release(false)],
      5: [3, getFormat],
      14: [1, setFormat],
    }),
  };
  const register = (name, ordinal, count, fn) => {
      const address = kernel.register('DSOUND.dll', name, { count, fn });
      exports.set(name, address);
      exports.set(ordinal, address);
    },
    exports = new Map();
  register('DirectSoundCreate8', 11, 3, ([guid, out, outer]) => {
    if (!out) return DSERR_INVALIDPARAM;
    p.store(out, 0);
    if (outer) return DSERR_NOAGGREGATION;
    if (
      !hasOutput() ||
      (guid && ![DEFAULT_PLAYBACK, DEFAULT_VOICE_PLAYBACK].some((value) => matches(guid, value)))
    )
      return DSERR_NODRIVER;
    const device = p.allocate(DEVICE_BYTES, true);
    p.store(device, engine.refs.directSound.device);
    p.store(device + REFCOUNT, 1);
    p.store(device + COOPERATIVE_LEVEL, DSSCL_NORMAL);
    DEFAULT_PCM.forEach((word, index) => p.store(device + FORMAT + index * 4, word));
    p.store(out, device);
    return 0;
  });
  for (const [suffix, ordinal] of [
    ['A', 2],
    ['W', 3],
  ]) {
    const wide = suffix === 'W';
    register(`DirectSoundEnumerate${suffix}`, ordinal, 2, async ([callback, context]) => {
      if (!callback) return DSERR_INVALIDPARAM;
      if (!hasOutput()) return 0;
      const label = 'Browser audio output',
        unit = wide ? 2 : 1,
        description = p.allocate((label.length + 1) * unit),
        driver = p.allocate(unit, true);
      try {
        kernel.writeString(description, label, wide);
        await engine.callFromHost(callback, [0, description, driver, context]);
      } finally {
        p.free(description);
        p.free(driver);
      }
      return 0;
    });
  }
  kernel.registerHostModule('dsound.dll', exports);
}
