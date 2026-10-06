import { z } from "zod";
import { ledgerIdSchema, ledgerSpaceIdSchema } from "./ledger-model";

const tableLocationSchema = z
  .object({
    row: z.union([ledgerIdSchema, z.literal("new")]).optional(),
    draft: ledgerIdSchema.optional(),
    search: z.string().max(200).default(""),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .multipleOf(50)
      .default(0),
  })
  .strict()
  .refine(
    (v) => !v.draft || v.row === "new",
    "新しい行だけに入力IDを指定できます。",
  );
export type LedgerTableLocation = z.infer<typeof tableLocationSchema>;
const hubLocationSchema = z
  .object({
    space: ledgerSpaceIdSchema.optional(),
  })
  .strict();
export type LedgerHubLocation = z.infer<typeof hubLocationSchema>;
function uniqueParams(url: URL) {
  if (url.search.length > 3000) throw Error("URLが長すぎます。");
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(values, key)) throw Error("URLの指定が重複しています。");
    values[key] = value;
  }
  return values;
}
export function parseLedgerTableLocation(url: URL) {
  return tableLocationSchema.parse(uniqueParams(url));
}
export function ledgerTableHref(path: string, input: LedgerTableLocation) {
  const value = tableLocationSchema.parse(input),
    params = new URLSearchParams();
  if (value.row) params.set("row", value.row);
  if (value.draft) params.set("draft", value.draft);
  if (value.search) params.set("search", value.search);
  if (value.offset) params.set("offset", String(value.offset));
  return path + (params.size ? "?" + params : "");
}
export function parseLedgerHubLocation(url: URL) {
  return hubLocationSchema.parse(uniqueParams(url));
}
export function ledgerHubHref(value: LedgerHubLocation) {
  const parsed = hubLocationSchema.parse(value);
  return (
    "/ledgers" +
    (parsed.space ? "?" + new URLSearchParams({ space: parsed.space }) : "")
  );
}
