// SPDX-License-Identifier: MPL-2.0
// Cursor visibility and per-key gates are separate native input-task fields.
import { nativeReply } from '../kcs/vm.mjs';
import { nativeEngineWord, NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';

export const NATIVE_INPUT_CONTROL_IDS = Object.freeze([0x191, 0x193, 0x194]);
export function nativeInputControlMessage(input, message, w, l, context, memory) {
  if (![136, 148, 149, 150, 151, 152, 159].includes(message)) return undefined;
  return input.message(message, w, l, { ...context, memory });
}

export async function nativeInputControl(id, args, _machine, task, world) {
  if (!NATIVE_INPUT_CONTROL_IDS.includes(id)) return undefined;
  const count = id === 0x191 ? 1 : id === 0x193 ? 2 : 0;
  if (args.length !== count)
    throw new Error(`Native input control 0x${id.toString(16)} expects ${count} arguments`);
  let input = await world.sendNativeEngine(0, task.id, world.engineMessages.layout.rootStart + 2);
  if (input === NATIVE_UNWRITTEN_WORD)
    input = await (await world.getNativeFeature('task-memory')).pointer(task.id);
  await world.sendNativeEngine(
    nativeEngineWord(input),
    task.id,
    id === 0x191 ? 149 : id === 0x193 ? 150 : 151,
    id === 0x193 ? args[0] : 0,
    id === 0x194 ? 0 : args.at(-1),
  );
  return nativeReply(2);
}
