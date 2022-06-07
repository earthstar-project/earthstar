import { DocEs5, FormatEs5 } from "./format_es5.ts";
import { FormatDocType, FormatInputType, IFormat } from "./format_types.ts";

export const DefaultFormat = FormatEs5;
export type DefaultDoc = DocEs5;

export type FormatsArg<Init> = Init extends
  IFormat<infer _N, infer _I, infer _O>[] ? Init : [typeof DefaultFormat];

export type FormatArg<Init> = Init extends IFormat<infer _N, infer _I, infer _O>
  ? Init
  : typeof DefaultFormat;

export type FormatArgInput<F> = F extends FormatArg<infer Format>
  ? FormatInputType<Format>
  : FormatInputType<typeof DefaultFormat>;

export type FormatArgDoc<F> = F extends FormatArg<infer Format>
  ? FormatDocType<Format>
  : FormatDocType<typeof DefaultFormat>;

export type FallbackDoc<
  FormatType,
> = FormatType extends IFormat<infer _N, infer _I, infer O>[] ? O
  : DefaultDoc;

export type FormatArgsInit<O> = [O] extends
  [IFormat<infer N, infer I, infer O>[]] ? IFormat<N, I, O> : never;

export function getFormatsWithFallback<F>(
  formats: FormatsArg<F> | undefined,
): FormatsArg<F> {
  return formats ? formats : ([DefaultFormat] as FormatsArg<F>);
}

export function getFormatIntersection<Init>(
  formatNames: string[],
  formats: FormatsArg<Init> | undefined,
) {
  if (formats === undefined) {
    return formatNames.includes("es.5")
      ? [DefaultFormat] as FormatsArg<[typeof DefaultFormat]>
      : [];
  }

  const intersection = [];

  for (const f of formats) {
    if (formatNames.includes(f.id)) {
      intersection.push(f);
    }
  }

  return intersection as FormatsArg<typeof intersection>;
}
