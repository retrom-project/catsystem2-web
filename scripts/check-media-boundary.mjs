// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { scanSource } from './check-no-exe-addresses.mjs';

export function validateMediaInventory(board) {
  const rows = board.profiles.flatMap((p) => p.entries.filter((e) => e.domain === 5));
  if (
    !rows.length ||
    rows.some((e) => e.implementation !== 'pure-js' || e.review === 'needs-review')
  )
    throw Error('Media native has an EXE implementation or unresolved review');
  for (const file of board.files.filter((f) => f.domain === 5))
    if (Object.values(file.exeDependencies).some(Boolean) || file.executionSites.length)
      throw Error('Media EXE dependency ' + file.file);
  const selections = board.remainingProfileSelections;
  if (
    ['profileIndexSites', 'addressSelections', 'versionGuards'].some((k) =>
      selections[k].some((r) => r.domain === 5),
    )
  )
    throw Error('Media profile/VA selector remains');
  for (const name of [
    'js-bitmap-to-exe-consumers',
    'js-image-owner-to-exe-consumers',
    'js-log-to-exe-fes-consumer',
    'js-text-to-exe-fes-consumers',
    'js-image-data-to-exe-consumers',
  ]) {
    const entry = board.nonNativeEntries.find((e) => e.name === name),
      p = entry?.projection;
    if (!p?.authority || !p.consumers.length || p.removePhase <= 5 || entry.domain <= 5)
      throw Error('Media consumer projection lacks ownership/removal record: ' + name);
  }
}
export function validateMediaSource(source, file) {
  if (Object.values(scanSource(source, file)).some(Boolean))
    throw Error('Media EXE dependency ' + file);
  const forbidden = new Set([
    'call',
    'callFromHost',
    'callAsync',
    'invokeNative',
    'invokeRegion',
    'invokeOriginalNative',
    'runThread',
    'emu_start',
    'patch',
    'ensureNativeEngine',
  ]);
  const messages = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              media: {
                create(context) {
                  return {
                    ImportDeclaration(node) {
                      if (
                        /(?:oracle\/|\/(?:engine-process|kcs-memory|catalog|transitional-exe|backend)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        context.report({ node, message: 'Media imports an EXE capability' });
                    },
                    MemberExpression(node) {
                      const name = node.computed ? node.property.value : node.property.name;
                      if (forbidden.has(name))
                        context.report({
                          node,
                          message: 'Media references EXE capability ' + name,
                        });
                    },
                    CallExpression(node) {
                      const callee = node.callee,
                        name = callee.computed ? callee.property?.value : callee.property?.name;
                      if (name !== 'registerNativeFeature' || node.arguments[0]?.value !== 'text')
                        return;
                      const walk = (n) => {
                        if (!n?.type) return;
                        if (
                          n.type === 'CallExpression' &&
                          n.callee.type === 'MemberExpression' &&
                          n.callee.property.name === 'getNativeFeature' &&
                          ['data-buffers', 'engine-files'].includes(n.arguments[0]?.value)
                        )
                          context.report({
                            node: n,
                            message: 'JS text factory constructs an EXE projection',
                          });
                        for (const [k, v] of Object.entries(n)) {
                          if (['parent', 'loc', 'range', 'tokens', 'comments'].includes(k))
                            continue;
                          if (Array.isArray(v)) v.forEach(walk);
                          else if (v?.type) walk(v);
                        }
                      };
                      walk(node.arguments[1]);
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/media': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw Error(file + ': ' + messages[0].message);
}
export async function checkMediaBoundary(root) {
  const board = JSON.parse(await readFile(resolve(root, 'docs/b-migration.json'), 'utf8'));
  validateMediaInventory(board);
  for (const [profile, count] of [
    ['sdk-4.01-engine-2.6.1.74', 110],
    ['nekopara-vol3-engine-2.6.1.76', 113],
  ])
    if (
      board.profiles.find((p) => p.profile === profile)?.entries.filter((e) => e.domain === 5)
        .length !== count
    )
      throw Error('Media domain ownership changed: ' + profile);
  for (const file of board.files.filter((f) => f.domain === 5))
    validateMediaSource(await readFile(resolve(root, file.file), 'utf8'), file.file);
  console.log(
    'Media boundary checked: JS owns domain 5; remaining consumer projections belong to domains 6–9.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkMediaBoundary(fileURLToPath(new URL('..', import.meta.url)));
