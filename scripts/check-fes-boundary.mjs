// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { scanSource } from './check-no-exe-addresses.mjs';
import { FES_ROUTE_AUDIT, reviewFESIndirect } from './fes-route-audit.mjs';
import { nativeEntryGraph } from './check-native-entry.mjs';
import { transitionalRuntimeFiles } from './transitional-runtime.mjs';

const removed = new Set([
  'oracle/image-owner.mjs',
  'oracle/image-owner-projection.mjs',
  'oracle/hg3-delta.mjs',
  'oracle/text-log-projection.mjs',
  'oracle/fes-text-projection.mjs',
  'oracle/fes-draw-projection.mjs',
  'oracle/raster-kernel-projection.mjs',
  'oracle/fes-screen-effect-projection.mjs',
]);
export function validateFESInventory(board) {
  for (const profile of board.profiles) {
    const entries = profile.entries.filter((entry) => entry.domain === 7);
    if (
      entries.length !== FES_ROUTE_AUDIT.length ||
      entries.some(
        (entry) =>
          entry.implementation !== 'pure-js' ||
          entry.review !== 'traced' ||
          !entry.fesRoute?.label ||
          !FES_ROUTE_AUDIT.some((row) => row.id === entry.id) ||
          (!entry.semanticName && !entry.metadataNotes?.length),
      )
    )
      throw new Error(
        'FES native dispatch has an unresolved implementation/review: ' + profile.profile,
      );
    for (const entry of entries)
      for (const consumer of entry.fesRoute.consumerRoutes)
        if (consumer.domain !== 8 || consumer.removePhase !== 8 || !consumer.condition)
          throw new Error('FES foreign receiver lost its explicit D8 route');
  }
  for (const file of board.files.filter((entry) => entry.domain === 7))
    if (
      file.file.startsWith('oracle/') ||
      Object.values(file.exeDependencies).some(Boolean) ||
      file.executionSites.length ||
      file.indirectSites.some(
        (site) => site.review !== 'traced' || !reviewFESIndirect(file.file, site),
      )
    )
      throw new Error('FES file has an EXE dependency or unreviewed indirect route: ' + file.file);
  if (
    board.nonNativeEntries.some(
      (entry) =>
        entry.projection?.removePhase === 7 ||
        entry.projection?.consumers.some((consumer) => consumer.domain === 7),
    )
  )
    throw new Error('FES production projection remains');
  for (const key of ['profileIndexSites', 'addressSelections', 'versionGuards'])
    if (board.remainingProfileSelections[key].some((row) => row.domain === 7))
      throw new Error('FES profile/EXE selector remains');
}

function nativePointerGuard(node) {
  if (
    node?.type === 'MemberExpression' &&
    node.object.name === 'context' &&
    (node.computed ? node.property.value : node.property.name) === 'nativePointer'
  )
    return true;
  return (
    node?.type === 'LogicalExpression' &&
    node.operator === '&&' &&
    (nativePointerGuard(node.left) || nativePointerGuard(node.right))
  );
}
export function validateFESSource(source, file) {
  if (Object.values(scanSource(source, file)).some(Boolean))
    throw new Error('FES EXE dependency: ' + file);
  const forbidden = new Set([
    'call',
    'callAsync',
    'callFromHost',
    'invokeNative',
    'invokeRegion',
    'invokeOriginalNative',
    'emu_start',
    'runThread',
    'patch',
    'beforeInstruction',
    'ensureNativeEngine',
    'nativeEngine',
    'nativeObjectPointer',
    'registerNativeFeature',
  ]);
  const errors = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              fes: {
                create(context) {
                  const property = (node) =>
                    node.computed ? node.property.value : node.property.name;
                  return {
                    ImportDeclaration(node) {
                      if (
                        /(?:oracle\/|\/(?:engine-process|kcs-memory|transitional-exe|backend|exe-profiles)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        context.report({ node, message: 'FES imports an EXE capability' });
                    },
                    MemberExpression(node) {
                      if (forbidden.has(property(node)))
                        context.report({ node, message: 'FES references an EXE capability' });
                    },
                    Property(node) {
                      if (
                        node.parent.type === 'ObjectPattern' &&
                        forbidden.has(node.key.name ?? node.key.value)
                      )
                        context.report({ node, message: 'FES destructures an EXE capability' });
                    },
                    CallExpression(node) {
                      if (
                        node.callee.type !== 'MemberExpression' ||
                        property(node.callee) !== 'getNativeFeature'
                      )
                        return;
                      const feature = node.arguments[0]?.value;
                      let guarded = false;
                      for (let parent = node.parent; parent; parent = parent.parent)
                        if (
                          parent.type === 'IfStatement' &&
                          nativePointerGuard(parent.test) &&
                          parent.consequent.range[0] <= node.range[0] &&
                          parent.consequent.range[1] >= node.range[1]
                        )
                          guarded = true;
                      if (
                        !reviewFESIndirect(file, { method: 'getNativeFeature', feature }) ||
                        !guarded
                      )
                        context.report({
                          node,
                          message: 'FES constructs an implicit or unreviewed EXE feature',
                        });
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/fes': 'error' },
      },
    ],
    { filename: file },
  );
  if (errors.length) throw new Error('FES boundary: ' + file + ': ' + errors[0].message);
}
export async function checkFESBoundary(root) {
  const board = JSON.parse(await readFile(resolve(root, 'docs/b-migration.json'), 'utf8'));
  validateFESInventory(board);
  for (const file of board.files.filter((entry) => entry.domain === 7))
    validateFESSource(await readFile(resolve(root, file.file), 'utf8'), file.file);
  const includes = await transitionalRuntimeFiles(root),
    graph = await nativeEntryGraph(root, 'web/transitional-entry.mjs');
  if ([...includes, ...graph].some((file) => removed.has(file)))
    throw new Error('FES original producer is shipped or imported by the transitional entry');
  console.log(
    'FES boundary: reviewed JS dispatch/default receivers, explicit D8 pointer guard and no production D7 projection; interpreter contract gaps remain separately recorded.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkFESBoundary(fileURLToPath(new URL('..', import.meta.url)));
