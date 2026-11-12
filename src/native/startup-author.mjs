// SPDX-License-Identifier: MPL-2.0
// Fresh startup's no-credential branch; an existing credential requires VC3.
import { nativeFileTime, nativeSystemTime } from './file-time.mjs';
import { findNativeXML, nativeXMLTextBytes } from './xml.mjs';

const DEBUG_SUFFIX = new TextEncoder().encode('@@--cs2-debug-key--@@');
const CREDENTIAL = 'cs2_debug_key.dat';

export function nativeStartupSeed(clock) {
  const now = Math.trunc(clock.utcNow()),
    local = nativeFileTime(now - new Date(now).getTimezoneOffset() * 60000),
    words = nativeSystemTime(local);
  if (!words) throw new Error('Application startup requires a valid local clock');
  return words.reduce((sum, word, index) => (index === 2 ? sum : (sum + word) >>> 0), 0);
}

export function nativeStartupCode(document, encoding) {
  const node = document && findNativeXML(document, 'APP/v_code'),
    bytes = node ? nativeXMLTextBytes(node) : new TextEncoder().encode('open_cs2'),
    nul = bytes.indexOf(0),
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
  // One canonical integer stream, not 16 draws from each MT stream. VC3 will
  // consume these words as key/expected data; absence still performs all draws.
  for (let i = 0; i < 32; i++) world.random.integer.nextUint32();
  seedNativeStartupRandom(world.random, nativeStartupSeed(world.clock));
  if (typeof world.storage.has !== 'function')
    throw new Error('Startup author requires native file metadata');
  if (await world.storage.has(CREDENTIAL)) {
    const error = new Error('Unimplemented startup author credential verification (VC3)');
    error.name = 'UnsupportedStartupAuthorCredential';
    throw error;
  }
  world.configuration.authorMode = 0;
  return false;
}
