import { z } from "zod";
import { querySchema, fieldOverrideSchema } from "./model";
import { catalogRequest } from "./catalog";

const id = z.string().min(1).max(1000);
const privateId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const exploreDialogs = [
  "download",
  "save",
  "fields",
  "semantic",
  "dataset",
  "personal",
  "personal-delete",
  "personal-join",
  "table-join",
  "dimension",
  "metric",
  "filter",
  "drill",
  "cell",
  "fact",
] as const;
const cellSchema = z
  .object({
    row: z.number().int().min(0).max(999),
    column: z.string().min(1).max(255),
  })
  .strict();
export const exploreLocationSchema = z
  .object({
    source: id.optional(),
    dataset: privateId.optional(),
    saved: privateId.optional(),
    q: querySchema.optional(),
    fields: z.array(fieldOverrideSchema).max(500).optional(),
    dialog: z.enum(exploreDialogs).optional(),
    personal: privateId.optional(),
    afterJoin: z.literal(true).optional(),
    right: id.optional(),
    cell: cellSchema.optional(),
    fact: querySchema.optional(),
    tab: z.enum(["all", "favorite", "recent"]).optional(),
    search: z.string().max(200).optional(),
    catalog: catalogRequest.optional(),
    side: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const target = v.source || v.dataset || v.saved;
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (v.q && (!target || (v.source && v.q.source !== v.source)))
      bad("表示条件とデータの指定が一致しません。");
    if (v.dataset && v.saved)
      bad("Datasetと保存した表示は別々に指定してください。");
    if (
      v.dialog &&
      !["personal", "personal-delete"].includes(v.dialog) &&
      !target
    )
      bad("この画面にはデータの指定が必要です。");
    if (
      v.personal &&
      !["personal", "personal-delete", "personal-join"].includes(v.dialog || "")
    )
      bad("個人テーブルの画面を指定してください。");
    if (v.dialog === "personal-delete" && !v.personal)
      bad("削除する個人テーブルを指定してください。");
    if (v.afterJoin && (v.dialog !== "personal" || !target))
      bad("結合元のデータを指定してください。");
    if (v.right && v.dialog !== "table-join")
      bad("結合画面を指定してください。");
    if (
      (v.cell || v.dialog === "cell" || v.dialog === "drill") &&
      (!["cell", "drill"].includes(v.dialog || "") || !v.cell)
    )
      bad("操作するセルを指定してください。");
    if ((v.fact || v.dialog === "fact") && (v.dialog !== "fact" || !v.fact))
      bad("明細の条件を指定してください。");
    if (v.fact && v.source && v.fact.source !== v.source)
      bad("明細とデータの指定が一致しません。");
    if (v.fields && !target) bad("個人の項目名にはデータの指定が必要です。");
    if (v.catalog && target)
      bad("カタログとデータの画面は別々に指定してください。");
  });
export type ExploreLocation = z.infer<typeof exploreLocationSchema>;
export const maxExploreUrlLength = 32768;
const jsonKeys = new Set(["q", "fields", "cell", "fact", "catalog"]);
const booleanKeys = new Set(["side", "afterJoin"]);
export function parseExploreLocation(url: URL): ExploreLocation {
  if (url.pathname !== "/" || url.search.length > maxExploreUrlLength)
    throw Error("URLが長すぎるか、画面の指定が違います。");
  const raw: Record<string, unknown> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(raw, key)) throw Error("URLの指定が重複しています。");
    if (jsonKeys.has(key)) raw[key] = JSON.parse(value);
    else if (booleanKeys.has(key)) {
      if (value !== "1" && value !== "0")
        throw Error("URLの指定を確認してください。");
      raw[key] = value === "1";
    } else raw[key] = value;
  }
  return exploreLocationSchema.parse(raw);
}
export function exploreHref(input: ExploreLocation) {
  const value = exploreLocationSchema.parse(input);
  const params = new URLSearchParams();
  for (const [key, v] of Object.entries(value)) {
    if (
      v === undefined ||
      (key === "tab" && v === "all") ||
      (key === "search" && v === "") ||
      (key === "side" && v === true) ||
      (key === "fields" && Array.isArray(v) && !v.length)
    )
      continue;
    params.set(
      key,
      jsonKeys.has(key)
        ? JSON.stringify(v)
        : booleanKeys.has(key)
          ? v
            ? "1"
            : "0"
          : String(v),
    );
  }
  if (params.toString().length > maxExploreUrlLength)
    throw Error(
      "この表示はURLに収まりません。表示を保存して、そのリンクを使ってください。",
    );
  return params.size ? "/?" + params : "/";
}
