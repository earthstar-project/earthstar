import { Path as WillowPath } from "../../deps.ts";
import { isValidPath } from "../paths/paths.ts";
import { Path } from "../store/types.ts";
import { isErr, ValidationError } from "./errors.ts";

export function willowToEarthstarPath(path: WillowPath): Path {
  const decoder = new TextDecoder();

  const esPath = [];

  for (const component of path) {
    esPath.push(decoder.decode(component));
  }

  return esPath;
}

export function earthstarToWillowPath(
  esPath: Path,
): WillowPath | ValidationError {
  const result = isValidPath(esPath);

  const encoder = new TextEncoder();

  if (isErr(result)) {
    return result;
  }

  const path: WillowPath = [];

  for (const component of esPath) {
    path.push(encoder.encode(component));
  }

  return path;
}
