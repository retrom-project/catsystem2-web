// SPDX-License-Identifier: MPL-2.0
// Reviewed metadata only. These records never coerce VM words or infer missing types.
const directions = new Set(['in', 'out', 'inout', 'unknown']);
const spaces = new Set(['vm', 'native', 'pe', 'unknown']);
const encodings = new Set(['unknown', 'bytes', 'CP932', 'UTF-8']);

function validType(type) {
  if (!type || typeof type !== 'object' || Array.isArray(type)) return false;
  if (type.description !== undefined && typeof type.description !== 'string') return false;
  if (type.meaning !== undefined && typeof type.meaning !== 'string') return false;
  switch (type.kind) {
    case 'unknown':
    case 'ignored':
      return true;
    case 'bits':
      return (
        type.bits === 32 &&
        (type.initialization === undefined || type.initialization === 'uninitialized')
      );
    case 'integer':
      return [8, 16, 32].includes(type.bits) && typeof type.signed === 'boolean';
    case 'float':
      return type.bits === 32;
    case 'boolean':
      return type.availability === undefined || type.availability === 'conditional';
    case 'void':
      return type.completion === undefined || type.completion === 'suspend';
    case 'pointer':
      return (
        spaces.has(type.addressSpace) && directions.has(type.direction) && validType(type.target)
      );
    case 'character':
      return type.bits === 8 && encodings.has(type.encoding);
    case 'format-string':
      return encodings.has(type.encoding);
    case 'record':
      return typeof type.name === 'string' && type.name.length > 0;
    case 'handle':
      return (
        typeof type.handleKind === 'string' &&
        type.handleKind.length > 0 &&
        ['unknown', 'borrowed'].includes(type.ownership)
      );
    case 'object-id':
      return typeof type.objectKind === 'string' && type.objectKind.length > 0;
    case 'variadic':
      return (
        ['format-arguments', 'ignored-arguments'].includes(type.role) && validType(type.elementType)
      );
    case 'union':
      return (
        Array.isArray(type.alternatives) &&
        type.alternatives.length >= 2 &&
        type.alternatives.every(validType)
      );
    default:
      return false;
  }
}

export function validateNativeSignature(signature) {
  if (!signature || typeof signature !== 'object' || Array.isArray(signature))
    throw new Error('Invalid native signature record');
  const { argumentWords, parameters, result, controlCodes, resultWritten } = signature;
  if (argumentWords !== null && (!Number.isSafeInteger(argumentWords) || argumentWords < 0))
    throw new Error('Invalid native argument-word count');
  if (Array.isArray(parameters)) {
    if (argumentWords !== null && parameters.length !== argumentWords)
      throw new Error('Native parameter records disagree with the explicit word count');
    for (const parameter of parameters)
      if (
        !parameter ||
        typeof parameter.name !== 'string' ||
        !parameter.name ||
        typeof parameter.description !== 'string' ||
        !validType(parameter.type)
      )
        throw new Error('Invalid structured native parameter');
  } else if (
    parameters !== null &&
    (!parameters || parameters.kind !== 'ignored' || typeof parameters.description !== 'string')
  ) {
    throw new Error('Invalid native parameter state');
  }
  if (!Array.isArray(parameters) && argumentWords !== null)
    throw new Error('Unknown or ignored parameters cannot declare a fixed word count');
  if (!validType(result)) throw new Error('Invalid structured native result');
  if (
    !Array.isArray(controlCodes) ||
    controlCodes.some((code) => !Number.isInteger(code) || code < 0 || code > 5)
  )
    throw new Error('Invalid native signature controls');
  if (![null, true, false].includes(resultWritten))
    throw new Error('Invalid result-write observation');
  return signature;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== 'description')
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export function nativeSignatureContract(signature) {
  validateNativeSignature(signature);
  return canonical(
    Object.fromEntries(
      ['argumentWords', 'parameters', 'result', 'controlCodes', 'resultWritten'].map((key) => [
        key,
        signature[key],
      ]),
    ),
  );
}

export function nativeSignatureDifferences(left, right) {
  const before = nativeSignatureContract(left),
    after = nativeSignatureContract(right);
  return Object.keys(before).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
