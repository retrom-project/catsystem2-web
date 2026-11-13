// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../src/fes/program.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';

test('bare DEFINE counts use raw integer expressions without property units', () => {
  const program = parseProgram('#DEFINE\nCIMAGE n[3/2]\n#START\nbreak\n'),
    instance = new FESInstance('integer-count', program, new FESPlayer(null, null));
  assert.equal(program.definitions[0].count, '3/2');
  assert.equal(instance.declaredGroups.n, 1);
  assert.equal(instance.objects.length, 1);
  assert.equal(instance.objects[0].key, 'n[0]');
  assert.throws(
    () =>
      new FESInstance(
        'unsupported-unit',
        parseProgram('#DEFINE\nCIMAGE n[2%]\n#START\nbreak\n'),
        new FESPlayer(null, null),
      ),
    /Incomplete expression: 2%/,
    'count text must not use the property getter percentage-suffix convenience',
  );
});
