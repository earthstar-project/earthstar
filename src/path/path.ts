import { isPathPrefixed, isValidPath, Path as WillowPath } from "../../deps.ts";
import { decodeBase32, encodeBase32 } from "../encoding/base32.ts";
import { pathScheme } from "../schemes/schemes.ts";
import { ValidationError } from "../util/errors.ts";

/** A sequence of bytestrings. Every {@linkcode Document} is written to a corresponding path.
 */
export class Path {
  /** The empty path, which prefixes all other paths. */
  static empty = new Path([]);

  /** Determine whether a new {@linkcode Path} made of bytestrings would be a valid Earthstar path. */
  static isValidBytePath(...bytePath: Uint8Array[]): boolean {
    try {
      Path.fromBytes(...bytePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Determine whether a new {@linkcode Path} made of encoded ASCII components would be a valid Earthstar path. */
  static isValidStringPath(...stringPath: string[]): boolean {
    try {
      Path.fromStrings(...stringPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Determine whether a new {@linkcode Path} made of decoded Base32 strings would be a valid Earthstar path. */
  static isValidBase32Path(...b32Path: string[]): boolean {
    try {
      Path.fromBase32(...b32Path);
      return true;
    } catch {
      return false;
    }
  }

  /** Construct a new {@linkcode Path} from a series of {@linkcode Uint8Array}. */
  static fromBytes(...bytePath: Uint8Array[]): Path {
    return new Path(bytePath);
  }

  /** Construct a new {@linkcode Path} from a series of strings.
   *
   * Each component string can only contain alphanumeric characters (a-z, A-Z, 0-9) or the minus hyphen (-), underscore (_), or full stop (.).
   */
  static fromStrings(...stringPath: string[]): Path {
    const willowPath: WillowPath = [];

    const encoder = new TextEncoder();

    for (const component of stringPath) {
      if (!isValidStringPathComponent(component)) {
        throw new ValidationError("Invalid string path");
      }

      willowPath.push(encoder.encode(component));
    }

    return new Path(willowPath);
  }

  /** Construct a new {@linkcode Path} from a series of Base32 encoded paths. */
  static fromBase32(...b32Path: string[]): Path {
    const willowPath: WillowPath = [];

    for (const component of b32Path) {
      willowPath.push(decodeBase32(component));
    }

    return new Path(willowPath);
  }

  /** Construct a new {@linkcode Path} from an array of bytestrings.
   *
   * Throws if the resulting path is invalid.
   */
  constructor(readonly underlying: WillowPath) {
    if (!isValidPath(underlying, pathScheme)) {
      throw new ValidationError("Invalid path");
    }
  }

  /** Determine if this path is a prefix of the given path. */
  isPrefixOf(path: Path): boolean {
    return isPathPrefixed(this.underlying, path.underlying);
  }

  /** Determine if this path is prefixed by the given path. */
  isPrefixedBy(path: Path): boolean {
    return isPathPrefixed(path.underlying, this.underlying);
  }

  /** Return a new {@linkcode Path} with this path as its prefix. */
  withSuffix(suffix: Path): Path {
    return new Path([...this.underlying, ...suffix.underlying]);
  }

  /** Try to return this path as legible strings.
   *
   * @returns The path as an array of legible strings, or undefined if the path contains bytes which could not be decoded to alphanumeric characters, `-`, `_` or `.`.
   */
  asStrings(): string[] | undefined {
    const stringPath: string[] = [];

    const decoder = new TextDecoder();

    for (const component of this.underlying) {
      const decoded = decoder.decode(component);

      if (!isValidStringPathComponent(decoded)) {
        return undefined;
      }

      stringPath.push();
    }

    return stringPath;
  }

  /** The path with its components encoded in Base32. */
  asBase32(): string[] {
    const b32Path: string[] = [];

    for (const component of this.underlying) {
      b32Path.push(encodeBase32(component));
    }

    return b32Path;
  }

  format(format: "ascii"): string | undefined;
  format(format: "base32"): string;
  format(format: "ascii" | "base32"): string | undefined {
    if (format === "ascii") {
      return this.asStrings()?.join("/");
    }

    return this.asBase32().join("/");
  }
}

function isValidStringPathComponent(component: string) {
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
