// SPDX-License-Identifier: MPL-2.0
import engine74 from './2.6.1.74.mjs';
import engine76 from './2.6.1.76.mjs';

export function validateABI(abi) {
  if (!abi || abi.id !== `cs2-${abi.engineVersion}` || typeof abi.profile !== 'string')
    throw new Error('Invalid CatSystem2 ABI identity');
  if (!['Shift_JIS', 'UTF-8'].includes(abi.xmlEncoding) || !Number.isInteger(abi.sound?.banks))
    throw new Error(`Invalid ABI services ${abi.id}`);
  for (const table of ['main', 'generic', 'particle-v1', 'particle-v2']) {
    const definition = abi.tables?.[table];
    if (
      !Number.isInteger(definition?.count) ||
      definition.count <= 0 ||
      definition.entries?.length !== definition.count
    )
      throw new Error(`Incomplete ABI table ${abi.id}/${table}`);
    definition.entries.forEach((entry, id) => {
      if (
        entry.id !== id ||
        !['unknown', 'declared', 'recovered', 'reserved', 'constant-zero'].includes(entry.status) ||
        !Array.isArray(entry.controlCodes) ||
        entry.controlCodes.some((code) => !Number.isInteger(code) || code < 0 || code > 5) ||
        !entry.signature ||
        (entry.name !== null && typeof entry.name !== 'string')
      )
        throw new Error(`Invalid ABI entry ${abi.id}/${table}/${id}`);
    });
  }
  return abi;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const NATIVE_ABIS = freeze(
  Object.fromEntries([engine74, engine76].map((abi) => [abi.profile, validateABI(abi)])),
);

export function nativeABI(profile) {
  const abi = NATIVE_ABIS[profile];
  if (!abi)
    throw new Error(
      `Unregistered CatSystem2 ABI ${profile}; provide reviewed per-version ABI data`,
    );
  return abi;
}

export function abiForEngineVersion(version) {
  const abi = Object.values(NATIVE_ABIS).find((candidate) => candidate.engineVersion === version);
  if (!abi)
    throw new Error(
      `Unregistered CatSystem2 engine ${version}; provide reviewed per-version ABI data`,
    );
  return abi;
}
