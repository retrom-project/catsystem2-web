// SPDX-License-Identifier: MPL-2.0
// Compare offline observations. Neither the score nor a chosen alignment proves semantics.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const featureWeights = Object.freeze({
  argumentRead: 1,
  control: 2,
  stub: 2,
  importAPI: 6,
  string: 6,
  immediate: 1,
});

function importName(value) {
  const at = value.indexOf('!');
  return at < 0 ? value : value.slice(0, at).toLowerCase() + value.slice(at);
}

export function handlerTokens(entry) {
  const tokens = new Map();
  const add = (kind, values, transform = (value) => value) => {
    for (const value of values ?? [])
      tokens.set(`${kind}:${transform(value)}`, featureWeights[kind]);
  };
  add('argumentRead', entry.prefixArgReadOffsets);
  add('control', entry.controlCodes);
  add('stub', entry.stub ? [entry.stub] : []);
  add('importAPI', entry.facts?.importAPIs, importName);
  add('string', entry.facts?.strings);
  add('immediate', entry.facts?.immediatePushes);
  return { tokens, weight: [...tokens.values()].reduce((sum, value) => sum + value, 0) };
}

function similarity(left, right) {
  if (!left.weight || !right.weight) return 0;
  let shared = 0;
  const [small, large] = left.tokens.size < right.tokens.size ? [left, right] : [right, left];
  for (const [token, weight] of small.tokens) if (large.tokens.has(token)) shared += weight;
  return Math.round((200 * shared) / (left.weight + right.weight));
}

function checkEntries(entries) {
  if (!Array.isArray(entries) || entries.some((entry, index) => entry.id !== index))
    throw new Error('Main table observations must contain every contiguous ID in order');
}

/** Global alignment of weak observations; equal native IDs are never a scoring feature. */
export function alignHandlerObservations(left, right, { gapPenalty = 60 } = {}) {
  checkEntries(left);
  checkEntries(right);
  if (!Number.isInteger(gapPenalty) || gapPenalty <= 0)
    throw new Error('Alignment gap penalty must be a positive integer');
  const n = left.length,
    m = right.length,
    columns = m + 1,
    leftTokens = left.map(handlerTokens),
    rightTokens = right.map(handlerTokens),
    scores = new Int32Array((n + 1) * columns),
    directions = new Uint8Array(scores.length),
    ways = new Uint8Array(scores.length);
  ways[0] = 1;
  for (let i = 1; i <= n; i++) {
    scores[i * columns] = -i * gapPenalty;
    directions[i * columns] = 2;
    ways[i * columns] = 1;
  }
  for (let j = 1; j <= m; j++) {
    scores[j] = -j * gapPenalty;
    directions[j] = 4;
    ways[j] = 1;
  }
  let sameIDScore = -Math.abs(n - m) * gapPenalty;
  for (let i = 0; i < Math.min(n, m); i++) sameIDScore += similarity(leftTokens[i], rightTokens[i]);
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const at = i * columns + j,
        diagonal = at - columns - 1,
        up = at - columns,
        back = at - 1,
        a = scores[diagonal] + similarity(leftTokens[i - 1], rightTokens[j - 1]),
        b = scores[up] - gapPenalty,
        c = scores[back] - gapPenalty,
        best = Math.max(a, b, c);
      scores[at] = best;
      directions[at] = (a === best ? 1 : 0) | (b === best ? 2 : 0) | (c === best ? 4 : 0);
      ways[at] = Math.min(
        2,
        (a === best ? ways[diagonal] : 0) +
          (b === best ? ways[up] : 0) +
          (c === best ? ways[back] : 0),
      );
    }
  const pairs = [],
    onlyLeft = [],
    onlyRight = [];
  let i = n,
    j = m;
  while (i || j) {
    const direction = directions[i * columns + j];
    // This chooses one reproducible path; ties remain explicitly reported below.
    if (direction & 1) pairs.push({ left: --i, right: --j });
    else if (direction & 2) onlyLeft.push(--i);
    else if (direction & 4) onlyRight.push(--j);
    else throw new Error('Incomplete alignment path');
  }
  pairs.reverse();
  onlyLeft.reverse();
  onlyRight.reverse();
  const bestScore = scores[n * columns + m];
  return {
    gapPenalty,
    bestScore,
    sameIDScore,
    sameIDIsOptimal: bestScore === sameIDScore,
    optimalAlignmentUnique: ways[n * columns + m] === 1,
    pairs,
    shiftedPairs: pairs.filter((pair) => pair.left !== pair.right),
    onlyLeft,
    onlyRight,
    pairsWithoutSharedFeatures: pairs.filter(
      (pair) => !similarity(leftTokens[pair.left], rightTokens[pair.right]),
    ),
    review: 'candidate-only',
  };
}

function equalValues(left, right) {
  const canonical = (values) => [...new Set(values ?? [])].sort();
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function mainObservations(input) {
  if (Array.isArray(input.entries)) return input;
  const main = input.tables?.find((table) => table.name === 'main');
  if (!main) throw new Error('Offline observations have no main table');
  return {
    version: input.engineVersion,
    sourceSha256: input.sha256,
    limitations: input.limitations ?? [],
    entries: main.entries.map((entry) => {
      const handler = entry.handler ?? {},
        pattern = handler.pattern ?? [],
        stub =
          handler.complete &&
          pattern.length === 2 &&
          pattern[0] === 'mov eax,0x2' &&
          pattern[1] === 'ret 0x10'
            ? 'noop-control2'
            : null;
      return {
        id: entry.id,
        stub,
        prefixArgReadOffsets: handler.signature?.directArgumentByteOffsets,
        controlCodes: handler.signature?.controlCodes,
        controlsComplete: handler.signature?.controlsComplete,
        boundedCFGComplete: handler.complete,
        facts: {
          importAPIs: handler.importAPIs ?? [],
          strings: handler.strings ?? [],
          immediatePushes: pattern.flatMap((instruction) => {
            const match = /^push (0x[\da-f]+)$/i.exec(instruction);
            return match ? [Number(match[1])] : [];
          }),
        },
      };
    }),
  };
}

export function compareIDObservations(leftInput, rightInput, options) {
  const left = mainObservations(leftInput),
    right = mainObservations(rightInput);
  const alignment = alignHandlerObservations(left.entries, right.entries, options),
    sameID = [];
  for (let id = 0; id < Math.min(left.entries.length, right.entries.length); id++) {
    const a = left.entries[id],
      b = right.entries[id],
      completeControls = a.controlsComplete === true && b.controlsComplete === true;
    sameID.push({
      id,
      stubTransition: (a.stub ?? null) !== (b.stub ?? null),
      leftStub: a.stub ?? null,
      rightStub: b.stub ?? null,
      prefixArgumentReadsEqual: equalValues(a.prefixArgReadOffsets, b.prefixArgReadOffsets),
      completeControlConflict: completeControls && !equalValues(a.controlCodes, b.controlCodes),
      completeControlsComparable: completeControls,
      importAPIsEqual: equalValues(
        a.facts?.importAPIs?.map(importName),
        b.facts?.importAPIs?.map(importName),
      ),
      stringsEqual: equalValues(a.facts?.strings, b.facts?.strings),
      leftCFGComplete: a.boundedCFGComplete === true,
      rightCFGComplete: b.boundedCFGComplete === true,
    });
  }
  return {
    left: { version: left.version, sha256: left.sourceSha256, slots: left.entries.length },
    right: { version: right.version, sha256: right.sourceSha256, slots: right.entries.length },
    featureWeights,
    summary: {
      comparedSameIDs: sameID.length,
      prefixArgumentReadsEqual: sameID.filter((entry) => entry.prefixArgumentReadsEqual).length,
      completeControlsComparable: sameID.filter((entry) => entry.completeControlsComparable).length,
      completeControlConflicts: sameID.filter((entry) => entry.completeControlConflict).length,
      stubTransitions: sameID.filter((entry) => entry.stubTransition).length,
      importAPIsEqual: sameID.filter((entry) => entry.importAPIsEqual).length,
      stringsEqual: sameID.filter((entry) => entry.stringsEqual).length,
    },
    sameID,
    alignment,
    inputLimitations: { left: left.limitations ?? [], right: right.limitations ?? [] },
    limitations: [
      'Scores compare weak static observations, not semantic names or exact signatures.',
      'Direct argv reads are a prefix lower bound; absence is not proof that an argument is unused.',
      'Import and string observations retain their producer bounds and unresolved indirect calls.',
      'Internal message constants may change while a native ID keeps its semantics.',
      'A chosen optimal path, including a unique path, is not proof of stable or moved native IDs.',
      'Semantic conclusions require independent handler and script-call review.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [leftPath, rightPath, output] = process.argv.slice(2);
  if (!leftPath || !rightPath || !output)
    throw new Error(
      'Usage: node scripts/native-id-stability.mjs LEFT_FEATURES RIGHT_FEATURES OUTPUT',
    );
  const read = async (path) => {
    const bytes = await readFile(path);
    return {
      data: JSON.parse(bytes.toString('utf8')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const left = await read(leftPath),
    right = await read(rightPath),
    result = compareIDObservations(left.data, right.data);
  result.featureInputs = {
    left: { path: resolve(leftPath), sha256: left.sha256 },
    right: { path: resolve(rightPath), sha256: right.sha256 },
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
}
