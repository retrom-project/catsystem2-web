// SPDX-License-Identifier: MPL-2.0
import { NATIVE_SEMANTICS, NATIVE_SLOT_DEFAULTS } from './semantics.mjs';
import { validateNativeSignature } from './signature.mjs';

const semanticStatuses = new Set(['recovered', 'declared']);
const registrationFields = new Set([
  'count',
  'slots',
  'signatures',
  'observedArgumentWords',
  'evidence',
  'migrationReview',
]);
const signatureFields = new Set([
  'argumentWords',
  'parameters',
  'result',
  'controlCodes',
  'resultWritten',
  'review',
  'reviewReason',
]);

function record(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function ids(value, count, label) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some(
      (id, index) =>
        !Number.isSafeInteger(id) || id < 0 || id >= count || (index && id <= value[index - 1]),
    )
  )
    throw new Error(`Invalid native registration IDs ${label}`);
  return value;
}

// Resolve only explicit profile registrations. Neither the table length nor a
// semantic catalog entry supplies a missing profile binding.
export function resolveNativeTables(tables) {
  if (
    !record(tables) ||
    Object.keys(tables).length !== Object.keys(NATIVE_SEMANTICS).length ||
    Object.keys(tables).some((name) => !Object.hasOwn(NATIVE_SEMANTICS, name))
  )
    throw new Error('Incomplete native table registration');
  return Object.fromEntries(
    Object.entries(tables).map(([table, registration]) => [
      table,
      resolveTable(table, registration),
    ]),
  );
}

function resolveTable(table, registration) {
  if (
    !record(registration) ||
    Object.keys(registration).some((key) => !registrationFields.has(key)) ||
    !Number.isSafeInteger(registration.count) ||
    registration.count <= 0 ||
    !record(registration.slots)
  )
    throw new Error(`Invalid native table registration ${table}`);
  const entries = new Array(registration.count),
    catalog = NATIVE_SEMANTICS[table];
  for (const [status, slots] of Object.entries(registration.slots)) {
    const semantic = semanticStatuses.has(status);
    if (!semantic && !Object.hasOwn(NATIVE_SLOT_DEFAULTS, status))
      throw new Error(`Invalid native slot status ${table}/${status}`);
    for (const id of ids(slots, registration.count, `${table}/${status}`)) {
      if (entries[id]) throw new Error(`Overlapping native registration ${table}/${id}`);
      if (semantic && !Object.hasOwn(catalog, id))
        throw new Error(`Unreviewed native semantic ${table}/${id}`);
      const definition = semantic ? catalog[id] : NATIVE_SLOT_DEFAULTS[status];
      entries[id] = { id, status, ...structuredClone(definition) };
    }
  }
  for (let id = 0; id < registration.count; id++)
    if (!entries[id]) throw new Error(`Uncovered native registration ${table}/${id}`);

  const applyGroups = (field, property, apply) => {
    const groups = registration[field],
      written = new Set();
    if (groups === undefined) return written;
    if (!Array.isArray(groups) || !groups.length)
      throw new Error(`Invalid native registration groups ${table}/${field}`);
    for (const group of groups) {
      if (
        !record(group) ||
        Object.keys(group).length !== 2 ||
        !Object.hasOwn(group, 'ids') ||
        !Object.hasOwn(group, property)
      )
        throw new Error(`Invalid native registration group ${table}/${field}`);
      for (const id of ids(group.ids, registration.count, `${table}/${field}`)) {
        if (written.has(id)) throw new Error(`Overlapping native ${field} ${table}/${id}`);
        written.add(id);
        apply(entries[id], structuredClone(group[property]));
      }
    }
    return written;
  };
  applyGroups('signatures', 'fields', (entry, fields) => {
    if (
      !record(fields) ||
      !Object.keys(fields).length ||
      Object.keys(fields).some((key) => !signatureFields.has(key))
    )
      throw new Error(`Invalid native signature differences ${table}/${entry.id}`);
    Object.assign(entry.signature, fields);
  });
  const observations = applyGroups('observedArgumentWords', 'value', (entry, value) => {
    if (!Array.isArray(value) || value.some((words) => !Number.isSafeInteger(words) || words < 0))
      throw new Error(`Invalid native argument observations ${table}/${entry.id}`);
    entry.observedArgumentWords = value;
  });
  if (registration.observedArgumentWords && observations.size !== registration.count)
    throw new Error(`Incomplete native argument observations ${table}`);
  applyGroups('evidence', 'value', (entry, value) => {
    if (typeof value !== 'string' || !value)
      throw new Error(`Invalid native evidence ${table}/${entry.id}`);
    entry.evidence = value;
  });
  applyGroups('migrationReview', 'value', (entry, value) => {
    if (!record(value)) throw new Error(`Invalid native migration review ${table}/${entry.id}`);
    entry.migrationReview = value;
  });
  for (const entry of entries) {
    if (semanticStatuses.has(entry.status) && !entry.evidence)
      throw new Error(`Missing native semantic evidence ${table}/${entry.id}`);
    validateNativeSignature(entry.signature);
    // Independent derived projections preserve mirror validation after a
    // caller clones an ABI. Only the signature is a maintained declaration.
    entry.parameters = structuredClone(entry.signature.parameters);
    entry.result = structuredClone(entry.signature.result);
    entry.controlCodes = [...entry.signature.controlCodes];
  }
  return { count: registration.count, entries };
}
