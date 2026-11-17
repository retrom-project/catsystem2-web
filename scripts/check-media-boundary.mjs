// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { actualSourceDependencies } from './check-no-exe-addresses.mjs';

export function validateMediaSource(source, file) {
  if (Object.values(actualSourceDependencies(source, file)).some(Boolean))
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
                      if (name === 'getNativeFeature' && node.arguments[0]?.value === 'text')
                        context.report({
                          node,
                          message: 'Media text implicitly constructs an EXE consumer',
                        });
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
const MEDIA_MODULES = Object.freeze([
  'src/formats/font.mjs',
  'src/formats/hg-codec.mjs',
  'src/formats/hg2.mjs',
  'src/formats/hg3.mjs',
  'src/formats/jpeg-ifast.mjs',
  'src/formats/jpeg.mjs',
  'src/formats/png.mjs',
  'src/formats/psb.mjs',
  'src/formats/psd.mjs',
  'src/formats/raster.mjs',
  'src/native/bitmap-factory.mjs',
  'src/native/bitmap-memory.mjs',
  'src/native/bitmap-operations.mjs',
  'src/native/bitmap-pixels.mjs',
  'src/native/fes-text-layout.mjs',
  'src/native/font-backend.mjs',
  'src/native/image-affine.mjs',
  'src/native/image-commands.mjs',
  'src/native/image-composite.mjs',
  'src/native/image-file.mjs',
  'src/native/image-owner-load.mjs',
  'src/native/image-owner-pixels.mjs',
  'src/native/image-owner.mjs',
  'src/native/image-persistence.mjs',
  'src/native/image.mjs',
  'src/native/legacy-text-state.mjs',
  'src/native/text-config.mjs',
  'src/native/text-core.mjs',
  'src/native/text-layout.mjs',
  'src/native/text-legacy.mjs',
  'src/native/text-log.mjs',
  'src/native/text-parser.mjs',
  'src/native/text-plain.mjs',
  'src/native/text-profile-data.mjs',
  'src/native/text-raster.mjs',
  'src/native/text-scanner.mjs',
  'src/native/text-task.mjs',
  'src/native/text.mjs',
  'src/native/zlib.mjs',
  'src/xml.mjs',
]);

export async function checkMediaBoundary(root) {
  for (const file of MEDIA_MODULES)
    validateMediaSource(await readFile(resolve(root, file), 'utf8'), file);
  console.log('Media source boundary checked against actual ordinary modules.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkMediaBoundary(fileURLToPath(new URL('..', import.meta.url)));
