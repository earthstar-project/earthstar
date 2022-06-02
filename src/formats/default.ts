import { DocEs5, FormatEs5 } from "./format_es5.ts";
import { FormatEs4 } from "./format_es4.ts";
import { IFormat } from "./format_types.ts";

export const DefaultFormat = FormatEs5;
export type DefaultDoc = DocEs5;

export type OptionalFormatDefault = OptionalFormats<typeof DefaultFormat[]>;

export type OptionalFormats<Init> = Init extends
  IFormat<infer _N, infer _I, infer _O>[] ? Init : [typeof DefaultFormat];

export type FallbackDoc<
  FormatType,
> = FormatType extends IFormat<infer _N, infer _I, infer O>[] ? O
  : DefaultDoc;

export type OptionalOriginal<O> = [O] extends
  [IFormat<infer N, infer I, infer O>[]] ? IFormat<N, I, O> : never;

export function getFormatsWithFallback<F>(
  formats: OptionalFormats<F> | undefined,
): OptionalFormats<F> {
  return formats ? formats : ([DefaultFormat] as OptionalFormats<F>);
}
