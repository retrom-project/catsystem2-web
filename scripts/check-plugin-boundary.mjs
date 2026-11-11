// SPDX-License-Identifier: MPL-2.0
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { scanSource } from './check-no-exe-addresses.mjs';
import { reviewRenderIndirect } from './render-route-audit.mjs';

export function validatePluginInventory(board) {
  const entries = board.profiles.flatMap((p) => p.entries.filter((e) => e.domain === 9));
  if (
    entries.length !== 37 ||
    entries.some(
      (e) => e.implementation !== 'pure-js' || e.review === 'needs-review' || !e.semanticName,
    )
  )
    throw new Error('Plugin native ownership or implementation is incomplete');
  const files = board.files.filter((f) => f.domain === 9);
  if (
    !files.length ||
    files.some(
      (f) =>
        Object.values(f.exeDependencies).some(Boolean) ||
        f.executionSites.length ||
        f.review === 'needs-review',
    )
  )
    throw new Error('Plugin runtime retains execution or unresolved routes');
  for (const e of board.nonNativeEntries)
    if (e.projection?.removePhase === 9 || e.projection?.consumers.some((c) => c.domain === 9))
      throw new Error('Plugin consumer projection remains: ' + e.name);
  if (board.nonNativeEntries.some((e) => e.name === 'ppi-and-dll-host'))
    throw new Error('Original PPI DLL host remains in the runtime inventory');
  if (board.nonNativeEntries.find((e) => e.name === 'js-ppi-host')?.review !== 'traced')
    throw new Error('JS PPI owner lost its traced registration');
  for (const key of ['profileIndexSites', 'addressSelections', 'versionGuards'])
    if (board.remainingProfileSelections[key].some((r) => r.domain === 9))
      throw new Error('Plugin runtime retains a profile/VA selector');
}
export function validatePluginSource(source, file) {
  if (Object.values(scanSource(source, file)).some(Boolean))
    throw new Error('Plugin EXE dependency: ' + file);
  const forbidden = new Set([
    'call',
    'callAsync',
    'callFromHost',
    'patch',
    'beforeInstruction',
    'invokeNative',
    'invokeRegion',
    'invokeOriginalNative',
    'loadModule',
    'loadExecutable',
    'emu_start',
    'runThread',
    'ensureNativeEngine',
  ]);
  const messages = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              plugin: {
                create(context) {
                  const report = (node, message) => context.report({ node, message }),
                    property = (n) => (n.computed ? n.property.value : n.property.name);
                  return {
                    ImportDeclaration(node) {
                      if (
                        /(?:oracle\/|\/(?:engine-process|kcs-memory|transitional-exe|backend|pe32|native-services|catalog)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        report(node, 'Plugin imports an execution capability');
                    },
                    ImportExpression(node) {
                      if (
                        typeof node.source.value !== 'string' ||
                        /(?:oracle\/|\/(?:backend|pe32|native-services)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        report(node, 'Plugin dynamically imports an execution capability');
                    },
                    MemberExpression(node) {
                      if (
                        forbidden.has(property(node)) &&
                        (property(node) !== 'patch' ||
                          (node.parent.type === 'CallExpression' && node.parent.callee === node))
                      )
                        report(node, 'Plugin references ' + property(node));
                    },
                    Property(node) {
                      if (
                        node.parent.type === 'ObjectPattern' &&
                        forbidden.has(node.key.name ?? node.key.value)
                      )
                        report(node, 'Plugin destructures an execution capability');
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
                        report(node, 'Plugin constructs an unreviewed EXE consumer');
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/plugin': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(file + ': ' + messages[0].message);
}
export function validatePluginDistribution(files) {
  for (const file of files) {
    const name = typeof file === 'string' ? file : file.path;
    if (
      /(?:^|\/)(?:ppi-(?:dll-loader|native-original|runtime-original)|m2-.*-original)\.mjs$/.test(
        name,
      ) ||
      /^src\/ppi\/(?:native|native-runtime)\.mjs$/.test(name)
    )
      throw new Error('Distribution contains a plugin DLL execution path: ' + name);
  }
}
export async function checkPluginBoundary(root) {
  const board = JSON.parse(await readFile(resolve(root, 'docs/b-migration.json'), 'utf8'));
  validatePluginInventory(board);
  for (const file of board.files.filter((f) => f.domain === 9))
    validatePluginSource(await readFile(resolve(root, file.file), 'utf8'), file.file);
  for (const file of ['src/ppi/native.mjs', 'src/ppi/native-runtime.mjs']) {
    let present = true;
    try {
      await access(resolve(root, file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      present = false;
    }
    if (present) throw new Error('Product retains the old PPI host: ' + file);
  }
  const particle = await readFile(resolve(root, 'src/particles.mjs'), 'utf8');
  if (/NativePPI|nativeThread|unicornFactory/.test(particle))
    throw new Error('Particles retains a DLL sandbox dependency');
  const cpu = await readFile(resolve(root, 'src/ppi/pe32.mjs'), 'utf8');
  if (/loadModule\(/.test(cpu)) throw new Error('Shared process retains its old DLL loader entry');
  console.log(
    'Plugin boundary: JS E-mote/PPI, explicit unsupported names, no runtime DLL execution or domain-9 projection.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkPluginBoundary(fileURLToPath(new URL('..', import.meta.url)));
