// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { scanSource } from './check-no-exe-addresses.mjs';
import { reviewRenderIndirect } from './render-route-audit.mjs';

export function validateRenderInventory(board) {
  for (const profile of board.profiles) {
    const rows = profile.entries.filter((entry) => entry.domain === 6);
    if (
      rows.length !== 219 ||
      rows.some(
        (entry) =>
          entry.implementation !== 'pure-js' ||
          entry.review === 'needs-review' ||
          !entry.semanticName,
      )
    )
      throw new Error(
        'Render native ownership, implementation or review changed: ' + profile.profile,
      );
    for (const entry of rows)
      for (const consumer of entry.renderRoute?.consumerRoutes ?? [])
        if (
          ![7, 8, 9].includes(consumer.domain) ||
          consumer.removePhase !== consumer.domain ||
          !consumer.condition ||
          !consumer.module
        )
          throw new Error('Render foreign receiver lost its removal/dispatch evidence');
  }
  const files = board.files.filter((file) => file.domain === 6);
  if (
    !files.length ||
    files.some(
      (file) =>
        file.file.startsWith('oracle/') ||
        Object.values(file.exeDependencies).some(Boolean) ||
        file.executionSites.length ||
        file.review === 'needs-review' ||
        file.indirectSites.some(
          (site) => site.review !== 'traced' || !reviewRenderIndirect(file.file, site),
        ),
    )
  )
    throw new Error('Render file has an EXE dependency or unresolved indirect route');
  for (const key of ['profileIndexSites', 'addressSelections', 'versionGuards'])
    if (board.remainingProfileSelections[key].some((row) => row.domain === 6))
      throw new Error('Render profile/VA selection remains');
  for (const entry of board.nonNativeEntries) {
    const projection = entry.projection;
    if (entry.domain === 6 || projection?.consumers.some((consumer) => consumer.domain === 6))
      throw new Error('Render consumer/projection was not removed: ' + entry.name);
    if (
      projection &&
      (!projection.direction ||
        !projection.authority ||
        !projection.fields.length ||
        !projection.consumers.length ||
        projection.removePhase <= 6)
    )
      throw new Error('Remaining projection lacks ownership/removal evidence: ' + entry.name);
  }
  if (
    board.nonNativeEntries.some((entry) => entry.name === 'graphics-thread-and-application-tasks')
  )
    throw new Error('Render still registers the original graphics worker');
  if (board.nonNativeEntries.find((entry) => entry.name === 'js-ppi-host')?.domain !== 9)
    throw new Error('Render PPI lost its JavaScript owner');
}

export function validateRenderSource(source, file) {
  if (Object.values(scanSource(source, file)).some(Boolean))
    throw new Error('Render EXE dependency: ' + file);
  const forbidden = new Set([
    'call',
    'callAsync',
    'callFromHost',
    'invokeNative',
    'invokeRegion',
    'invokeOriginalNative',
    'runThread',
    'emu_start',
    'patch',
    'beforeInstruction',
    'ensureNativeEngine',
  ]);
  const messages = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              render: {
                create(context) {
                  const report = (node, message) => context.report({ node, message });
                  const property = (node) =>
                    node.computed ? node.property.value : node.property.name;
                  return {
                    ImportDeclaration(node) {
                      if (
                        /(?:oracle\/|\/(?:engine-process|kcs-memory|transitional-exe|backend|exe-profiles)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        report(node, 'Render imports an EXE capability');
                    },
                    MemberExpression(node) {
                      if (forbidden.has(property(node)))
                        report(node, 'Render references an EXE capability');
                    },
                    Property(node) {
                      if (
                        node.parent.type === 'ObjectPattern' &&
                        forbidden.has(node.key.name ?? node.key.value)
                      )
                        report(node, 'Render destructures an EXE capability');
                    },
                    CallExpression(node) {
                      if (
                        node.callee.type !== 'MemberExpression' ||
                        property(node.callee) !== 'getNativeFeature'
                      )
                        return;
                      if (
                        !reviewRenderIndirect(file, {
                          method: 'getNativeFeature',
                          feature: node.arguments[0]?.value,
                        })
                      )
                        report(node, 'Render constructs an unreviewed consumer feature');
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/render': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(file + ': ' + messages[0].message);
}

export async function checkRenderBoundary(root) {
  const board = JSON.parse(await readFile(resolve(root, 'docs/b-migration.json'), 'utf8'));
  validateRenderInventory(board);
  for (const file of board.files.filter((file) => file.domain === 6))
    validateRenderSource(await readFile(resolve(root, file.file), 'utf8'), file.file);
  console.log(
    'Render boundary checked: JS owns domain 6; explicit FES/media/plugin projections retain phases 7/8/9.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkRenderBoundary(fileURLToPath(new URL('..', import.meta.url)));
