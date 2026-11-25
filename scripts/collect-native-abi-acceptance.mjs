// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { compareNativeTables } from './compare-native-abi.mjs';
import { surveyContainer } from './survey-native-corpus.mjs';

const tables = ['main', 'generic', 'particle-v1', 'particle-v2'];
const receiptKinds = new Set(['original', 'vm', 'guard', 'product']);
const guardScopes = [
  'ordinary-runtime',
  'original-undefined-input',
  'desktop-author-or-export',
  'unclassified-evidence',
];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const slotKey = (table, id) => `${table}:${id}`;
const validSHA = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const validRevision = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const compareNames = (a, b) => a.localeCompare(b, 'en');
const entriesSorted = (values) => [...values].sort(compareNames);

async function checkedBytes(path, expected) {
  if (!path || !validSHA(expected)) throw new Error('Expected a file and its SHA-256');
  const bytes = await readFile(path);
  if (digest(bytes) !== expected) throw new Error(`SHA-256 mismatch for ${path}`);
  return bytes;
}

export async function verifyWorkExecutable(work, executableSha256) {
  if (work.executableSha256 !== executableSha256)
    throw new Error(`Work ${work.id} requires the exact executable SHA-256`);
  if (typeof work.executablePath !== 'string' || !work.executablePath)
    throw new Error(`Work ${work.id} requires its executablePath`);
  await checkedBytes(work.executablePath, executableSha256);
}

async function readSurvey({ survey, surveySha256, executableSha256 }) {
  const image = JSON.parse(await checkedBytes(survey, surveySha256));
  if (!validSHA(executableSha256) || image.sha256 !== executableSha256)
    throw new Error('Extractor output does not identify the requested executable');
  return image;
}

function exactTables(image, abi) {
  if (abi.executableSha256 && image.sha256 !== abi.executableSha256)
    throw new Error(`The executable SHA-256 differs from the registered build ${abi.profile}`);
  if (image.status !== 'candidate' || image.engineVersion !== abi.engineVersion)
    throw new Error('The exact executable survey must expose the declared build tables');
  const names = image.tables.map(({ name }) => name);
  if (names.length !== tables.length || tables.some((name) => !names.includes(name)))
    throw new Error('Expected four executable tables');
  for (const { name, count, entries } of image.tables) {
    if (
      count !== abi.tables[name].count ||
      entries.length !== count ||
      entries.some((entry, id) => entry.id !== id || !/^0x[0-9a-f]{8}$/i.test(entry.handlerVA))
    )
      throw new Error(`Incomplete executable table ${name}`);
  }
}

async function listAlternateDiffs(alternates, image) {
  const results = [];
  const seen = new Set([image.sha256]);
  for (const entry of alternates) {
    const peer = await readSurvey(entry);
    if (peer.engineVersion !== image.engineVersion || seen.has(peer.sha256))
      throw new Error(
        'An alternate build must use the same version and a distinct executable SHA-256',
      );
    seen.add(peer.sha256);
    results.push({
      executableSha256: peer.sha256,
      surveySha256: entry.surveySha256,
      status: peer.status,
      reason: peer.reason ?? null,
      diff: peer.status === 'candidate' ? compareNativeTables(peer, image) : null,
      coverage: 'unverified',
    });
  }
  return results;
}

async function loadCallShapes(input) {
  if (!input) return new Map();
  const origins = JSON.parse(await checkedBytes(input.path, input.sha256)),
    shapes = new Map();
  for (const { scripts } of origins) {
    for (const script of scripts) {
      if (!validSHA(script.sha256)) throw new Error('Call-shape evidence requires script SHA-256');
      const facts = script.sites.map(({ pc, id, argumentWords, arguments: args, resultUse }) => ({
        pc,
        id,
        argumentWords,
        operands: args.map(({ kind }) => kind),
        resultUse: resultUse.state,
      }));
      const key = script.sha256,
        old = shapes.get(key);
      if (old && JSON.stringify(old) !== JSON.stringify(facts))
        throw new Error(`Conflicting call-shape evidence for script ${key}`);
      shapes.set(key, facts);
    }
  }
  return shapes;
}

function kcsCalls(script, facts) {
  if (facts && facts.length !== script.calls.length)
    throw new Error(`Call-shape evidence has a different site count for ${script.sha256}`);
  return script.calls.map((call, index) => {
    const fact = facts?.[index];
    if (fact && ['pc', 'id', 'argumentWords'].some((field) => call[field] !== fact[field]))
      throw new Error(
        `Call-shape evidence disagrees with the script at ${script.sha256}/${call.pc}`,
      );
    return { ...call, operands: fact?.operands ?? null, resultUse: fact?.resultUse ?? 'unknown' };
  });
}

function describeScript(script, facts, particleFallback) {
  if (script.kind === 'kcs')
    return {
      kind: script.kind,
      table:
        script.table === 'particle-unknown' ? (particleFallback ?? script.table) : script.table,
      scriptVersion: script.scriptVersion,
      calls: kcsCalls(script, facts.get(script.sha256)),
    };
  if (script.kind === 'cst')
    return {
      kind: script.kind,
      lines: script.lines,
      calls: script.commandSites,
      commandErrors: script.commandErrors.map(({ line, reason }) => ({ line, reason })),
    };
  return {
    kind: script.kind,
    includes: script.includes,
    calls: script.callShapes,
    objects: script.objects,
    unresolvedDefinitions: script.unresolvedDefinitions.length,
  };
}

function callShape(kind, call) {
  if (kind === 'fes') return JSON.stringify(['fes', call.type, call.command, call.argumentTokens]);
  if (kind === 'cst') return JSON.stringify(['cst', call.command]);
  return JSON.stringify([
    'kcs',
    call.table,
    call.id,
    call.argumentWords,
    call.operands,
    call.resultUse,
  ]);
}

function scriptDelta(works, scripts, receipts) {
  const [baseline] = works;
  const firstScripts = new Set(baseline.scripts),
    firstContexts = new Set(baseline.contexts),
    workShapes = (work) =>
      new Set(
        work.contexts.flatMap((key) => {
          const [sha256, context] = key.split('/');
          const { kind, table, calls } = scripts[sha256].contexts[context];
          return calls.map((call) => callShape(kind, { table, ...call }));
        }),
      );
  const firstShapes = workShapes(baseline);
  return works.slice(1).map((work) => {
    const newScripts = work.scripts.filter((key) => !firstScripts.has(key)),
      productReceipts = new Map();
    for (const [id, receipt] of receipts) {
      if (receipt.kind !== 'product' || receipt.contentIdentity !== work.contentIdentity) continue;
      for (const sha256 of receipt.scripts ?? []) {
        if (!productReceipts.has(sha256)) productReceipts.set(sha256, []);
        productReceipts.get(sha256).push(id);
      }
    }
    return {
      work: work.id,
      sharedScripts: work.scripts.filter((key) => firstScripts.has(key)).length,
      newScripts,
      newScriptsWithProductReceipts: newScripts
        .filter((sha256) => productReceipts.has(sha256))
        .map((sha256) => ({ sha256, receipts: productReceipts.get(sha256) })),
      absentBaselineScripts: baseline.scripts.filter((key) => !work.scripts.includes(key)),
      newContexts: work.contexts.filter((key) => !firstContexts.has(key)),
      newCallShapes: entriesSorted(
        [...workShapes(work)].filter((shape) => !firstShapes.has(shape)),
      ).map((shape) => JSON.parse(shape)),
    };
  });
}

async function collectScripts(workInputs, executableSha256, facts, particleFallback) {
  if (!Array.isArray(workInputs) || !workInputs.length)
    throw new Error('At least one exact-build work is required');
  const scripts = {},
    works = [],
    ids = new Set();
  for (const work of workInputs) {
    if (!work.id || ids.has(work.id)) throw new Error('Every work must have a unique ID');
    await verifyWorkExecutable(work, executableSha256);
    if (work.contentIdentity != null && !validSHA(work.contentIdentity))
      throw new Error(`Invalid content identity for ${work.id}`);
    if (!Array.isArray(work.containers) || !work.containers.length)
      throw new Error(`Expected script containers for ${work.id}`);
    ids.add(work.id);
    const added = new Set(),
      contexts = new Set(),
      containers = [],
      unresolved = [];
    for (const container of work.containers) {
      const { logicalPath, role, sha256 } = container;
      if (
        !logicalPath ||
        logicalPath !== posix.normalize(logicalPath) ||
        posix.isAbsolute(logicalPath) ||
        logicalPath.startsWith('../') ||
        !role ||
        !validSHA(sha256)
      )
        throw new Error('An archive requires a normalized logical path, role and SHA-256');
      const report = await surveyContainer(container);
      containers.push({
        logicalPath,
        role,
        sha256,
        status: report.status,
        memberCount: report.memberCount ?? null,
      });
      if (report.status !== 'parsed') unresolved.push({ logicalPath, reason: report.reason });
      for (const member of report.entries) {
        if (!['kcs', 'fes', 'cst'].includes(member.kind)) continue;
        if (member.status !== 'parsed') {
          unresolved.push({ logicalPath, name: member.name, reason: member.reason });
          continue;
        }
        const missing = Object.entries(member.includes ?? {})
          .filter(([, sha256]) => sha256 === null)
          .map(([name]) => name);
        if (missing.length)
          unresolved.push({ logicalPath, name: member.name, missingIncludes: missing });
        if (member.commandErrors?.length)
          unresolved.push({
            logicalPath,
            name: member.name,
            undecodedCommandLines: member.commandErrors.map(({ line }) => line),
          });
        const content = (scripts[member.sha256] ??= { contexts: {} }),
          context = describeScript(member, facts, particleFallback),
          key = digest(JSON.stringify(context)),
          view = (content.contexts[key] ??= { ...context, sources: [] });
        view.sources.push({ work: work.id, logicalPath, name: member.name, role });
        added.add(member.sha256);
        contexts.add(`${member.sha256}/${key}`);
      }
    }
    works.push({
      id: work.id,
      executableSha256,
      contentIdentity: work.contentIdentity ?? null,
      scripts: entriesSorted(added),
      contexts: entriesSorted(contexts),
      containers,
      unresolved,
    });
  }
  return { scripts, works };
}

async function collectReceipts(inputs, build, works) {
  const receipts = new Map();
  for (const {
    id,
    kind,
    path,
    sha256,
    executableSha256,
    contentIdentity,
    coreRevision,
    scripts,
  } of inputs) {
    if (
      !id ||
      receipts.has(id) ||
      !receiptKinds.has(kind) ||
      executableSha256 !== build.executableSha256
    )
      throw new Error('Every receipt must identify its kind and exact executable');
    if (kind !== 'original' && !validRevision(coreRevision))
      throw new Error(`Receipt ${id} requires an exact core revision`);
    const contentWorks = works.filter((work) => work.contentIdentity === contentIdentity);
    if (kind === 'product' && (!validSHA(contentIdentity) || !contentWorks.length))
      throw new Error(`Product receipt ${id} requires an included content identity`);
    if (
      scripts !== undefined &&
      (kind !== 'product' ||
        !Array.isArray(scripts) ||
        new Set(scripts).size !== scripts.length ||
        scripts.some((sha256) => !contentWorks.some((work) => work.scripts.includes(sha256))))
    )
      throw new Error(`Receipt ${id} requires script SHA-256 values from its product content`);
    await checkedBytes(path, sha256);
    receipts.set(id, {
      kind,
      sha256,
      ...(coreRevision ? { coreRevision } : {}),
      ...(contentIdentity ? { contentIdentity } : {}),
      ...(scripts ? { scripts } : {}),
    });
  }
  return receipts;
}

function assertReviewReceipts(review, receipts, expectedKinds) {
  if (
    typeof review.reason !== 'string' ||
    !review.reason.trim() ||
    !Array.isArray(review.receipts) ||
    review.receipts.some((id) => !receipts.has(id)) ||
    expectedKinds.some((kind) => !review.receipts.some((id) => receipts.get(id).kind === kind))
  )
    throw new Error('Review requires a reason and receipts of the relevant kinds');
}

function validateGuardedShapes(shapes, receipts, key) {
  if (shapes === undefined) return;
  if (!Array.isArray(shapes)) throw new Error(`Invalid guarded SDK shapes for ${key}`);
  const seen = new Set();
  for (const shape of shapes) {
    if (
      !guardScopes.includes(shape?.sdkScope) ||
      typeof shape.shape !== 'string' ||
      !shape.shape.trim() ||
      seen.has(shape.shape)
    )
      throw new Error(`Invalid guarded SDK shape for ${key}`);
    seen.add(shape.shape);
    assertReviewReceipts(shape, receipts, ['original', 'guard']);
  }
}

function collectRows(image, abi, scripts, reviews, receipts) {
  const sites = new Map(),
    unresolvedCalls = [];
  for (const [sha256, script] of Object.entries(scripts))
    for (const [context, { kind, table, calls }] of Object.entries(script.contexts)) {
      if (kind !== 'kcs') continue;
      for (const { pc, id, argumentWords } of calls) {
        const site = { sha256, context, pc, argumentWords };
        if (id === null || argumentWords === null || !abi.tables[table]?.entries[id]) {
          unresolvedCalls.push({ ...site, table, id });
          continue;
        }
        const key = slotKey(table, id);
        if (!sites.has(key)) sites.set(key, []);
        sites.get(key).push(site);
      }
    }
  const handlerBodies = {};
  for (const { name, entries } of image.tables)
    for (const { id, handlerVA } of entries) {
      const body = (handlerBodies[handlerVA.toLowerCase()] ??= []);
      body.push({ table: name, id });
    }
  const reviewMap = new Map();
  for (const review of reviews) {
    const { table, id, handlerVA, disposition } = review,
      key = slotKey(table, id),
      declared = abi.tables[table]?.entries[id],
      observed = image.tables.find(({ name }) => name === table)?.entries[id];
    if (
      reviewMap.has(key) ||
      !declared ||
      observed?.handlerVA.toLowerCase() !== handlerVA?.toLowerCase()
    )
      throw new Error(`Review does not match the exact executable slot ${key}`);
    const guard = declared.status === 'unknown',
      stub = ['reserved', 'constant-zero'].includes(declared.status);
    if (
      (disposition === 'guarded' && !guard) ||
      (disposition === 'implemented' && (guard || stub)) ||
      (disposition === 'original-stub' && guard) ||
      !['guarded', 'implemented', 'original-stub'].includes(disposition)
    )
      throw new Error(`Review and current ABI declaration disagree at ${key}`);
    if (review.sdkScope !== undefined && (!guard || !guardScopes.includes(review.sdkScope)))
      throw new Error(`Invalid SDK scope for ${key}`);
    assertReviewReceipts(review, receipts, ['original', guard ? 'guard' : 'vm']);
    validateGuardedShapes(review.guardedShapes, receipts, key);
    reviewMap.set(key, review);
  }
  return {
    unresolvedCalls,
    handlerBodies,
    tables: Object.fromEntries(
      image.tables.map(({ name, tableVA, entries }) => [
        name,
        {
          tableVA,
          slots: entries.map(({ id, handlerVA, handler }) => ({
            id,
            handlerVA,
            original: { pattern: handler?.pattern ?? null, bounded: handler?.signature ?? null },
            declaration: abi.tables[name].entries[id],
            semanticCandidate: NATIVE_SEMANTICS[name][id]?.name ?? null,
            evidence: reviewMap.get(slotKey(name, id)) ?? null,
            calls: sites.get(slotKey(name, id)) ?? [],
          })),
        },
      ]),
    ),
  };
}

export function summarizeSDKCoverage({ tables }, works, receipts) {
  const guarded = Object.fromEntries(guardScopes.map((scope) => [scope, []])),
    guardedShapes = Object.fromEntries(guardScopes.map((scope) => [scope, []])),
    originalStubs = [];
  for (const [table, { slots }] of Object.entries(tables))
    for (const { id, declaration, evidence } of slots) {
      for (const { sdkScope, shape } of evidence?.guardedShapes ?? [])
        guardedShapes[sdkScope].push({ table, id, shape });
      if (declaration.status === 'unknown') {
        const scope = evidence?.sdkScope ?? 'unclassified-evidence';
        guarded[scope].push({ table, id });
      } else if (
        evidence?.disposition === 'original-stub' ||
        ['reserved', 'constant-zero'].includes(declaration.status)
      )
        originalStubs.push({ table, id });
    }
  const ordinaryOpen = guarded['ordinary-runtime'].length,
    unclassified = guarded['unclassified-evidence'].length,
    ordinaryOpenShapes = guardedShapes['ordinary-runtime'].length,
    unclassifiedShapes = guardedShapes['unclassified-evidence'].length;
  return {
    ordinaryRuntime:
      ordinaryOpen || unclassified || ordinaryOpenShapes || unclassifiedShapes
        ? 'incomplete'
        : 'no-identified-open-slot',
    ordinaryOpen,
    unclassified,
    ordinaryOpenShapes,
    unclassifiedShapes,
    guarded,
    guardedShapes,
    originalStubs,
    productReceiptsByWork: works.map(({ id, contentIdentity }) => ({
      work: id,
      receipts: [...receipts]
        .filter(
          ([, receipt]) =>
            receipt.kind === 'product' && receipt.contentIdentity === contentIdentity,
        )
        .map(([id]) => id),
    })),
  };
}

function checkRevision(revision, version) {
  if (!validRevision(revision)) throw new Error('An exact Core revision is required');
  const cwd = fileURLToPath(new URL('..', import.meta.url)),
    source = `src/native/abi/${version}.mjs`;
  const changed = execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      revision,
      '--',
      source,
      ...['index', 'tables', 'semantics', 'signature', 'fes-common-heads', 'messages'].map(
        (name) => `src/native/abi/${name}.mjs`,
      ),
    ],
    { cwd, encoding: 'utf8' },
  );
  if (changed.trim())
    throw new Error(`Live ABI sources differ from ${revision}: ${changed.trim()}`);
}

export async function collectNativeABIAcceptance(input) {
  const {
    build,
    alternates = [],
    works: workInputs,
    callShapeEvidence,
    reviews = [],
    receipts: receiptInputs = [],
    secondary = [],
  } = input;
  const abi = nativeABI(build.profile);
  checkRevision(build.coreRevision, abi.engineVersion);
  const image = await readSurvey(build);
  exactTables(image, abi);
  const alternateDiffs = await listAlternateDiffs(alternates, image);
  const facts = await loadCallShapes(callShapeEvidence),
    { scripts, works } = await collectScripts(
      workInputs,
      image.sha256,
      facts,
      abi.executableSha256 ? abi.particle?.scriptVersionFallback : undefined,
    );
  const receipts = await collectReceipts(receiptInputs, build, works);
  for (const review of secondary) assertReviewReceipts(review, receipts, ['original']);
  const secondaryABI = Object.fromEntries(Object.entries(abi).filter(([key]) => key !== 'tables'));
  const rows = collectRows(image, abi, scripts, reviews, receipts);
  return {
    build: {
      executableSha256: image.sha256,
      surveySha256: build.surveySha256,
      version: image.engineVersion,
      profile: abi.profile,
      coreRevision: build.coreRevision,
    },
    alternateDiffs,
    works,
    scripts,
    scriptDelta: scriptDelta(works, scripts, receipts),
    ...rows,
    sdkCoverage: summarizeSDKCoverage(rows, works, receipts),
    secondaryABI,
    secondary,
    receipts: Object.fromEntries(receipts),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifest, output] = process.argv.slice(2);
  if (!manifest || !output)
    throw new Error(
      'Usage: node scripts/collect-native-abi-acceptance.mjs RECEIPT_MANIFEST OUTPUT_JSON',
    );
  const input = JSON.parse(await readFile(manifest, 'utf8')),
    report = await collectNativeABIAcceptance(input);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
