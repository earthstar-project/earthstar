import { DocEs5, FormatEs5 } from "./format_es5.ts";
import { IFormat } from "./format_types.ts";

export type DefaultFormatType = typeof FormatEs5;
export type DefaultFormats = [DefaultFormatType];
export type DefaultDoc = DocEs5;

export const DEFAULT_FORMAT = FormatEs5;
export const DEFAULT_FORMATS = [DEFAULT_FORMAT];

export type FormatsArg<Init> = Init extends
  Array<IFormat<infer _N, infer _I, infer _O>> ? Init : never;

export type FormatArg<Init> = Init extends IFormat<infer _N, infer _I, infer _O>
  ? Init
  : never;

export function getFormatWithFallback<F = DefaultFormatType>(
  format?: FormatArg<F>,
): FormatArg<F> {
  return format || DEFAULT_FORMAT as unknown as FormatArg<F>;
}

export function getFormatsWithFallback<F = DefaultFormats>(
  formats?: FormatsArg<F>,
): FormatsArg<F> {
  return formats || DEFAULT_FORMATS as unknown as FormatsArg<F>;
}

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

// add lookup up method here

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
