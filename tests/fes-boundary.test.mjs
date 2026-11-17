// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateFESSource, checkFESBoundary } from '../scripts/check-fes-boundary.mjs';

test('FES rejects direct, imported and hidden EXE capabilities', () => {
  for (const source of [
    "import old from '../../oracle/fes-objects-original.mjs';",
    'engine.call(handler);',
    'world.ensureNativeEngine();',
    'const {callFromHost}=engine;',
    'object.nativeObjectPointer=record;',
    "world.getNativeFeature('fes-objects');",
    "world.getNativeFeature('task-memory');",
    "if(!context.nativePointer)world.getNativeFeature('task-memory');",
    "if(context.nativePointer||force)world.getNativeFeature('task-memory');",
  ])
    assert.throws(() => validateFESSource(source, 'src/native/fes-task.mjs'), /FES/);
  validateFESSource(
    "if(key===undefined&&context.nativePointer){world.getNativeFeature('task-memory');}",
    'src/native/fes-task.mjs',
  );
});
test('FES installed dispatch, defaults and production import boundary agree', () =>
  checkFESBoundary(fileURLToPath(new URL('..', import.meta.url))));
