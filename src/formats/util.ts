import { FormatEs5 } from "./format_es5.ts";
import {
  DefaultFormat,
  DefaultFormats,
  FormatArg,
  FormatsArg,
} from "./format_types.ts";

export const DEFAULT_FORMAT = FormatEs5;
export const DEFAULT_FORMATS = [DEFAULT_FORMAT];

/** Returns the default format if no formats are given. */
export function getFormatWithFallback<F = DefaultFormat>(
  format?: FormatArg<F>,
): FormatArg<F> {
  return format || DEFAULT_FORMAT as unknown as FormatArg<F>;
}

/** Returns the default formats if no formats are given. */
export function getFormatsWithFallback<F = DefaultFormats>(
  formats?: FormatsArg<F>,
): FormatsArg<F> {
  return formats || DEFAULT_FORMATS as unknown as FormatsArg<F>;
}

/** Given an array of format names, and an array of `IFormat`, returns an array of `IFormat` restricted to those with matching names. */
export function getFormatIntersection<F>(
  formatNames: string[],
  formats: FormatsArg<F>,
): FormatsArg<F> {
  const intersection = [];

  for (const f of formats) {
    if (formatNames.includes(f.id)) {
      intersection.push(f);
    }
  }

  return intersection as FormatsArg<F>;
}

/** Returns an object with format names as keys, and corresponding `IFormat` as values. */
export function getFormatLookup<F = DefaultFormats>(
  formats?: FormatsArg<F>,
): Record<string, FormatArg<F>> {
  const f = formats || DEFAULT_FORMATS;

  const formatLookup: Record<string, FormatArg<F>> = {};

  for (const format of f) {
    formatLookup[format.id] = format as typeof formatLookup[string];
  }

  return formatLookup;
}
