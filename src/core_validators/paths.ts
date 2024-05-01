import { checkString } from "./checkers.ts";
import { pathChars } from "./characters.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { pathScheme } from "../parameters/schemes.ts";

function isValidPathComponent(component: string): true | ValidationError {
  const errorMessage = checkString({ allowedChars: pathChars })(component);

  if (errorMessage) {
    return new ValidationError(errorMessage);
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
