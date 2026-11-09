// SPDX-License-Identifier: MPL-2.0
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { nativeEntryGraph } from './check-native-entry.mjs';
import { oracleFixtureSet } from '../tests/fixtures/oracle-fixtures.mjs';

async function testFiles(root, directory = 'tests') {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await testFiles(root, file)));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(file);
  }
  return files.sort();
}

export async function nativeTestGroups(root) {
  const plan = JSON.parse(await readFile(resolve(root, 'tests/native-test-plan.json'), 'utf8'));
  if (
    plan.version !== 1 ||
    plan.files.length !== 107 ||
    new Set(plan.files.map((item) => item.file)).size !== 107
  )
    throw new Error('Native test migration plan must cover the original 107 distinct files');
  const targets = new Map(plan.files.map((item) => [item.file, item]));
  const expected = { oracle: 33, differential: 51, js: 23 };
  for (const [target, count] of Object.entries(expected))
    if (plan.files.filter((item) => item.target === target).length !== count)
      throw new Error(`Native test target count changed ${target}`);
  for (const item of plan.files) await readFile(resolve(root, item.file));
  const groups = { js: [], oracle: [], differential: [] },
    cache = new Map(),
    current = new Map();
  const needsOracle = (graph) =>
    graph.some(
      (file) =>
        file.startsWith('oracle/') ||
        file.endsWith('/engine-process.mjs') ||
        cache.get(file)?.privateFixtureReads,
    );
  for (const file of await testFiles(root)) {
    const graph = await nativeEntryGraph(root, file, cache);
    const target = targets.get(file)?.target;
    const group = file.startsWith('tests/differential/')
      ? 'differential'
      : target === 'oracle' || target === 'differential' || needsOracle(graph)
        ? 'oracle'
        : 'js';
    groups[group].push(file);
    current.set(file, group);
  }
  for (const item of plan.files.filter((item) => !current.has(item.file))) {
    const graph = await nativeEntryGraph(root, item.file, cache);
    current.set(
      item.file,
      item.file.startsWith('tests/browser/') || item.target !== 'js' || needsOracle(graph)
        ? 'oracle'
        : 'js',
    );
  }
  const original = plan.files.map((item) => ({
    ...item,
    role: item.file.startsWith('tests/fixtures/')
      ? 'fixture'
      : item.file.startsWith('tests/browser/')
        ? 'browser'
        : 'node',
    currentGroup: current.get(item.file) ?? 'supporting-file',
    state: current.get(item.file) === item.target ? 'current' : 'pending-domain-migration',
  }));
  return {
    targets: expected,
    counts: Object.fromEntries(Object.entries(groups).map(([name, files]) => [name, files.length])),
    groups,
    original,
  };
}

export async function runNativeTests(root, args) {
  const groupAt = args.indexOf('--group'),
    group = groupAt < 0 ? 'all' : args[groupAt + 1];
  const flags = args.filter(
    (_, index) => groupAt < 0 || (index !== groupAt && index !== groupAt + 1),
  );
  if (
    !['all', 'js', 'oracle', 'differential'].includes(group) ||
    flags.some((flag) => !['--list', '--check-plan', '--require-fixtures'].includes(flag))
  )
    throw new Error(
      'Usage: node scripts/test-native.mjs [--group all|js|oracle|differential] [--list|--check-plan] [--require-fixtures]',
    );
  const inventory = await nativeTestGroups(root);
  if (flags.includes('--check-plan')) {
    console.log(
      `Native test targets ${JSON.stringify(inventory.targets)}; executable groups ${JSON.stringify(inventory.counts)}`,
    );
    return 0;
  }
  if (flags.includes('--list')) {
    console.log(JSON.stringify(inventory, null, 2));
    return 0;
  }
  const files =
    group === 'all' ? Object.values(inventory.groups).flat().sort() : inventory.groups[group];
  if (!files.length) throw new Error(`No executable ${group} tests are implemented yet`);
  const env = { ...process.env };
  if (group === 'js') {
    for (const name of [
      'CATSYSTEM2_ENGINE_EXE',
      'CATSYSTEM2_SDK_EXE',
      'CATSYSTEM2_EMOTE_DLL',
      'CATSYSTEM2_PPI_FIXTURES',
    ])
      delete env[name];
  } else {
    for (const fixture of await oracleFixtureSet({
      required: flags.includes('--require-fixtures'),
    }))
      if (!fixture.available) console.log(`SKIP fixture ${fixture.reason}`);
  }
  console.log(
    `Node group ${group}, ${files.length} files. Original targets ${JSON.stringify(inventory.targets)}. Current groups ${JSON.stringify(inventory.counts)}.`,
  );
  const child = spawn(process.execPath, ['--test', ...files], { cwd: root, env, stdio: 'inherit' });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runNativeTests(
      fileURLToPath(new URL('..', import.meta.url)),
      process.argv.slice(2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
