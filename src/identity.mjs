// SPDX-License-Identifier: MPL-2.0
const hex = (bytes) => [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
const hash = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
// A bounded-memory tree hash, shared by local directory and HTTP development inputs.
export async function sourceIdentity(files) {
  const lines = [];
  for (const [name, file] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const chunks = [];
    for (let at = 0; at < file.size; at += 4 * 1024 * 1024)
      chunks.push(await hash(await file.read(at, Math.min(4 * 1024 * 1024, file.size - at))));
    lines.push(
      JSON.stringify([name, file.size, await hash(new TextEncoder().encode(chunks.join('')))]),
    );
  }
  return hash(new TextEncoder().encode(lines.join('\n')));
}
