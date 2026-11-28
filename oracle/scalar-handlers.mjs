// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../src/native/abi/index.mjs';
const handlers = {
  'cs2-2.6.1.74': {
    'math.sin': 5401376,
    'math.cos': 5401216,
    'math.tan': 5402992,
    'math.asin': 5420272,
    'math.acos': 5420224,
    'math.atan': 5401104,
    'math.ceil': 5401152,
    'math.abs': 5420352,
    'math.floor': 5401264,
    'math.fmod': 5420400,
    'math.sqrt': 5402944,
    'math.pow': 5420464,
    'math.degreeToRadian': 5418384,
    'math.radianToDegree': 5419648,
    'math.integerAbs': 5401008,
    'math.triangleWave': 5421328,
    'math.atan2': 5401040,
    'math.log10': 5401328,
    'math.packWords': 5400912,
    'math.unpackWords': 5400944,
  },
  'cs2-2.6.1.76': {
    'math.sin': 6658608,
    'math.cos': 6665712,
    'math.tan': 6666464,
    'math.asin': 6665600,
    'math.acos': 6665552,
    'math.atan': 6658192,
    'math.ceil': 6658240,
    'math.abs': 6665792,
    'math.floor': 6658304,
    'math.fmod': 6658368,
    'math.sqrt': 6660176,
    'math.pow': 6658480,
    'math.degreeToRadian': 6657824,
    'math.radianToDegree': 6658048,
    'math.integerAbs': 6658160,
    'math.triangleWave': 6666656,
    'math.atan2': 6665648,
    'math.log10': 6658432,
    'math.packWords': 6658016,
    'math.unpackWords': 6658096,
  },
};
export function scalarHandler(profile, operation) {
  const abi = nativeABI(profile);
  const name = Number.isInteger(operation) ? abi.tables.main.entries[operation]?.name : operation;
  const handler = handlers[abi.id]?.[name];
  if (!Number.isInteger(handler))
    throw new Error(`Unreviewed transitional scalar ${abi.id}/${name}`);
  return handler;
}
