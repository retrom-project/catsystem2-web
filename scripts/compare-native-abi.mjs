// SPDX-License-Identifier: MPL-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSignatureDifferences } from '../src/native/abi/signature.mjs';

export function compareNativeSignatures(source, reference) {
  if (
    !source.tables ||
    !reference.tables ||
    Array.isArray(source.tables) ||
    Array.isArray(reference.tables)
  )
    throw new Error('Signature comparison requires reviewed ABI table declarations');
  const tables = Object.entries(source.tables).map(([name, table]) => {
    const other = reference.tables[name],
      index = new Map(other?.entries.map((entry) => [entry.id, entry]) ?? []);
    const entries = table.entries.map((entry) => {
      const previous = index.get(entry.id);
      if (!previous)
        return { id: entry.id, name: entry.name, relation: 'additional-declared-slot' };
      if (!entry.name || !previous.name)
        return {
          id: entry.id,
          name: entry.name,
          referenceName: previous.name,
          relation: 'unresolved-semantic',
        };
      if (entry.name !== previous.name)
        return {
          id: entry.id,
          name: entry.name,
          referenceName: previous.name,
          relation: 'different-name-or-enablement',
        };
      const differences = nativeSignatureDifferences(previous.signature, entry.signature);
      return {
        id: entry.id,
        name: entry.name,
        relation: differences.length ? 'declaration-difference' : 'matching-declaration',
        differences,
      };
    });
    return {
      name,
      sourceCount: table.count,
      referenceCount: other?.count ?? null,
      entries,
      counts: Object.fromEntries(
        [...new Set(entries.map((entry) => entry.relation))].map((relation) => [
          relation,
          entries.filter((entry) => entry.relation === relation).length,
        ]),
      ),
    };
  });
  return {
    source: source.engineVersion,
    reference: reference.engineVersion,
    tables,
    limitations: [
      'Structured declarations are compared in place; this does not recover unknown semantics or register an engine.',
      'Descriptions and review notes are excluded. Explicit widths, spaces, direction, encoding, counts, controls and result-write knowledge remain comparable.',
      'A resultWritten null/boolean difference can describe knowledge rather than a proved behavior change.',
      'Binary extractor signature observations have a separate schema and supply no inferred precise ABI types.',
    ],
  };
}

export function compareNativeTables(source, reference) {
  const tables = source.tables.map((table) => {
    const other = reference.tables.find((candidate) => candidate.name === table.name);
    if (!other)
      return { name: table.name, review: 'needs-review', reason: 'Reference table absent' };
    const indexes = new Map(
      ['rawFingerprint', 'contextFingerprint', 'structuralFingerprint'].map((key) => [
        key,
        new Map(),
      ]),
    );
    for (const entry of other.entries)
      if (entry.handler?.complete)
        for (const [key, index] of indexes) {
          const fingerprint = entry.handler[key];
          if (!fingerprint) continue;
          if (!index.has(fingerprint)) index.set(fingerprint, []);
          index.get(fingerprint).push(entry.id);
        }
    const sameImage = typeof source.sha256 === 'string' && source.sha256 === reference.sha256;
    const entries = table.entries.map((entry) => {
      if (sameImage)
        return {
          id: entry.id,
          referenceIDs: [entry.id],
          method: 'same-image',
          relation: 'same-id',
        };
      if (!entry.handler?.complete)
        return { id: entry.id, method: 'incomplete', review: 'needs-review' };
      for (const key of ['contextFingerprint', 'structuralFingerprint', 'rawFingerprint']) {
        const ids = indexes.get(key).get(entry.handler[key]);
        if (!ids) continue;
        if (ids.length !== 1)
          return { id: entry.id, referenceIDs: ids, method: 'ambiguous', review: 'needs-review' };
        if (key !== 'contextFingerprint')
          return {
            id: entry.id,
            referenceIDs: ids,
            method: key,
            review: 'needs-review',
            reason: 'Only local body similarity. Callee or referenced-string context differs.',
          };
        return {
          id: entry.id,
          referenceIDs: ids,
          method: key,
          relation: ids[0] === entry.id ? 'same-id-candidate' : 'moved-id-candidate',
          review: 'needs-review',
        };
      }
      return { id: entry.id, method: 'unmatched', review: 'needs-review' };
    });
    const matched = entries.filter((entry) => entry.relation),
      mapped = new Set(matched.flatMap((entry) => entry.referenceIDs));
    return {
      name: table.name,
      count: table.count,
      referenceCount: other.count,
      candidateMatches: matched.length,
      sameIDCandidates: matched.filter((entry) => entry.relation.startsWith('same-id')).length,
      movedIDCandidates: matched.filter((entry) => entry.relation === 'moved-id-candidate').length,
      unresolvedMappings: entries.length - matched.length,
      needsReview: entries.filter((entry) => entry.review === 'needs-review').length,
      ratio: matched.length / table.count,
      methods: Object.fromEntries(
        [...new Set(entries.map((entry) => entry.method))].map((method) => [
          method,
          entries.filter((entry) => entry.method === method).length,
        ]),
      ),
      unmatchedReferenceIDs: other.entries
        .filter((entry) => !mapped.has(entry.id))
        .map((entry) => entry.id),
      entries,
    };
  });
  return {
    source: source.sha256,
    reference: reference.sha256,
    tables,
    limitations: [
      'Matching does not use equal numeric IDs as semantic evidence.',
      'Unmatched handlers are unresolved. Additions and deletions require semantic review.',
      'Normalized pointers lose global-data identity. Unique structure matches are candidates.',
      'Shared handlers cannot identify individual aliased IDs.',
      'Equal instruction bytes alone can call different relocated helpers. Context agreement is required for automatic candidates.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    signatures = args[0] === '--signatures';
  const [source, reference, output] = signatures ? args.slice(1) : args;
  if (!source || !reference || !output)
    throw new Error(
      'Usage: node scripts/compare-native-abi.mjs [--signatures] SOURCE_JSON REFERENCE_JSON OUTPUT_JSON',
    );
  const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    output,
    `${JSON.stringify((signatures ? compareNativeSignatures : compareNativeTables)(await read(source), await read(reference)), null, 2)}\n`,
  );
}
