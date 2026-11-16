// SPDX-License-Identifier: MPL-2.0
// Fresh startup author verification uses the existing random/file/config owners.
import { nativeFileTime, nativeSystemTime } from './file-time.mjs';
import { findNativeXML, nativeXMLTextBytes } from './xml.mjs';
import { StartupBlowfish } from './startup-blowfish.mjs';

const DEBUG_SUFFIX = new TextEncoder().encode('@@--cs2-debug-key--@@');
const CREDENTIAL = 'cs2_debug_key.dat';

export function nativeStartupSeed(clock) {
  const now = Math.trunc(clock.utcNow()),
    local = nativeFileTime(now - new Date(now).getTimezoneOffset() * 60000),
    words = nativeSystemTime(local);
  if (!words) throw new Error('Application startup requires a valid local clock');
  return words.reduce((sum, word, index) => (index === 2 ? sum : (sum + word) >>> 0), 0);
}

export function nativeStartupCode(document, verification) {
  const encoding = verification?.codeEncoding;
  if (!['cp932', 'utf8'].includes(encoding))
    throw new Error('Startup code requires its reviewed narrow encoding');
  const node = document && findNativeXML(document, 'APP/v_code');
  let bytes;
  if (node) bytes = nativeXMLTextBytes(node);
  else {
    const defaults = verification.defaultCodeBytes;
    if (!Array.isArray(defaults)) throw new Error('Startup code default is not reviewed');
    if (defaults.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255))
      throw new Error('Startup code default requires narrow bytes');
    bytes = Uint8Array.from(defaults);
  }
  const nul = bytes.indexOf(0),
    code = bytes.subarray(0, nul < 0 ? bytes.length : nul);
  if (node && node.encoding !== (encoding === 'utf8' ? 'UTF-8' : 'Shift_JIS'))
    throw new Error('Startup v_code does not match its registered narrow encoding');
  // The original unbounded strcpy writes into a 260-byte narrow field.
  // Reject its undefined overflow domain, rather than claiming truncation.
  if (code.length >= 260) throw new RangeError('Startup v_code exceeds its 260-byte field');
  return code;
}

export function seedNativeStartupRandom(random, seed) {
  random.real.seed(seed);
  random.integer.seed(seed);
}

export async function checkNativeStartupAuthor(world, code) {
  // The existing virtual C: Windows directory/volume gates succeed.
  // Both registered startup callers pass includeSerial=0.
  let crc = 0xffffffff;
  for (const bytes of [code, DEBUG_SUFFIX])
    for (const byte of bytes) {
      crc ^= byte << 24;
      for (let bit = 0; bit < 8; bit++)
        crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
      // Both originals complement after each byte, not once at the end.
      crc = ~crc >>> 0;
    }
  seedNativeStartupRandom(world.random, crc);
  const words = new Uint32Array(32);
  for (let i = 0; i < words.length; i++) words[i] = world.random.integer.nextUint32();
  seedNativeStartupRandom(world.random, nativeStartupSeed(world.clock));
  if (typeof world.storage.size !== 'function')
    throw new Error('Startup author requires native file length metadata');
  const size = await world.storage.size(CREDENTIAL);
  if (size !== null && (!Number.isSafeInteger(size) || size < 0))
    throw new Error('Startup author received invalid file length metadata');
  let author = false;
  if (size === 64) {
    let input;
    // Only ordinary file read failures follow the original false result.
    // Cipher errors and malformed provider results are outside this catch.
    try {
      input = await world.storage.read(CREDENTIAL);
    } catch {
      input = null;
    }
    if (input !== null && !(input instanceof Uint8Array))
      throw new TypeError('Startup author file read requires bytes or null');
    if (input?.length === 64) {
      const key = new Uint8Array(64),
        keyView = new DataView(key.buffer),
        plain = new Uint8Array(64);
      for (let i = 0; i < 16; i++) keyView.setUint32(i * 4, words[i], true);
      // The key is all64 binary bytes, including NUL; no CString/56byte cap.
      new StartupBlowfish(key).decryptInto(input, plain);
      const decoded = new DataView(plain.buffer);
      author = true;
      for (let i = 0; i < 16; i++)
        if (decoded.getUint32(i * 4, true) !== words[i + 16]) {
          author = false;
          break;
        }
    }
  }
  world.configuration.authorMode = author ? 1 : 0;
  return author;
}
