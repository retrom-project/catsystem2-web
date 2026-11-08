// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeFESSourceArena } from '../src/native/fes-source.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

test('FES command and object-name pointers address their actual CP932 source bytes', () => {
  const arena = new NativeFESSourceArena(),
    program = {
      blocks: { START: ['bgm[2] blend 120', 'if (1) sound play 1', '文字 str authored'] },
    },
    key = arena.register(4, 'authored', program),
    context = arena.context(key, 'START', 0, program.blocks.START[0], 'bgm');
  assert.ok(context.commandPointer > 0);
  assert.notEqual(context.commandPointer, context.objectNameAddress);
  assert.equal(arena.string(context.commandPointer), 'bgm[2] blend 120');
  assert.deepEqual(arena.read(context.commandPointer, 17), encodeCP932('bgm[2] blend 120\0'));
  assert.equal(arena.string(context.objectNameAddress), 'bgm');
  const inline = arena.context(key, 'START', 1, 'sound play 1', 'sound');
  assert.equal(arena.string(inline.commandPointer), 'sound play 1');
  assert.equal(
    arena.string(arena.context(key, 'START', 2, '文字 str authored', '文字').objectNameAddress),
    '文字',
  );
  assert.deepEqual(arena.context(key, 'START', 0, program.blocks.START[0], 'bgm'), context);
  assert.throws(() => arena.read(context.commandPointer - 1, 1), /not allocated/);
  assert.throws(() => arena.write(context.commandPointer, new Uint8Array(100000)), /not allocated/);
});

test('the world source arena preserves pointers, bytes and subsequent allocation order across a checkpoint', () => {
  const original = new NativeFESSourceArena(),
    program = { blocks: { START: ['sound blend 90'] } },
    key = original.register(1, 'shared', program),
    context = original.context(key, 'START', 0, 'sound blend 90', 'sound');
  const restored = new NativeFESSourceArena();
  restored.restore(original.snapshot());
  assert.equal(restored.register(1, 'shared', program), key);
  assert.deepEqual(restored.context(key, 'START', 0, 'sound blend 90', 'sound'), context);
  assert.deepEqual(
    restored.read(context.commandPointer, 15),
    original.read(context.commandPointer, 15),
  );
  assert.equal(restored.allocateString('next'), original.allocateString('next'));
  assert.notEqual(restored.register(2, 'shared', program), key);
  assert.throws(() => restored.register(1, 'shared', { blocks: {} }), /changed during/);
});
