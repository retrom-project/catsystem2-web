// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './index.mjs';

export function mapABIMessage(profile, channel, direction, message, kind) {
  const definition = nativeABI(profile).messages.channels[channel],
    rules = definition?.[direction];
  if (!rules) throw new Error(`Unknown ABI message channel ${channel}/${direction}`);
  for (const rule of rules) {
    if (
      (rule.min === null || message >= rule.min) &&
      (rule.max === null || message <= rule.max) &&
      (!rule.kinds || rule.kinds.includes(kind)) &&
      (!rule.exceptKinds || !rule.exceptKinds.includes(kind))
    )
      return message + rule.offset;
  }
  if (definition.unmapped === 'reject')
    throw new Error(`Unreviewed ABI message ${profile}/${channel}/${direction}/${message}`);
  return message;
}
