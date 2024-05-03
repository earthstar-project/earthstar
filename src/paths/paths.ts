import { isErr, ValidationError } from "../util/errors.ts";
import { pathScheme } from "../schemes/schemes.ts";

function isValidPathComponent(component: string): true | ValidationError {
  // is alphanumeric, _ - or .
  for (let i = 0; i < component.length; i++) {
    const asciiCode = component.charCodeAt(i);

    const isAlpha = asciiCode >= 0x61 && asciiCode <= 0x7a;
    const isUpperAlpha = asciiCode >= 0x41 && asciiCode <= 0x5a;
    const isNumeric = asciiCode >= 0x30 && asciiCode <= 0x39;
    const isUnderscore = asciiCode === 0x5f;
    const isHyphen = asciiCode === 0x2d;
    const isFullStop = asciiCode === 0x2e;

    if (
      !isAlpha && !isUpperAlpha && !isNumeric && !isUnderscore && !isHyphen &&
      !isFullStop
    ) {
      return new ValidationError(
        `Found invalid character in path (${
          component.charAt(i)
        }). Only lowercase alphanumeric characters, _, -, and . allowed.`,
      );
    }
  }

  return true;
}

export function isValidPath(esPath: string[]): true | ValidationError {
  if (esPath.length > pathScheme.maxComponentCount) {
    return new ValidationError(
      `Path has too many components (max ${pathScheme.maxComponentLength}`,
    );
  }

  const encoder = new TextEncoder();

  let totalLength = 0;

  for (let i = 0; i < esPath.length; i++) {
    const component = esPath[i];

    //	Check characters
    const result = isValidPathComponent(component);

    if (isErr(result)) {
      return new ValidationError(
        `Path component ${i} is invalid: ${result.message}`,
      );
    }

    // Check component length
    const asBytes = encoder.encode(component);

    if (asBytes.byteLength > pathScheme.maxComponentLength) {
      return new ValidationError(
        `Path component ${i} is too long (max ${pathScheme.maxComponentLength})`,
      );
    }

    totalLength += asBytes.byteLength;
  }

  if (totalLength > pathScheme.maxPathLength) {
    return new ValidationError(
      `Total path length is too long (max ${pathScheme.maxPathLength})`,
    );
  }

  return true;
}
