import { z } from "zod";
import { identifier } from "./compiler";
import { parseSource } from "./metadata";
import type { QueryableSource } from "./model";

export type Execute = (
  sql: string,
  binds?: (string | number | boolean)[],
) => Promise<Record<string, unknown>[]>;
export const catalogRequest = z
  .object({
    database: z.string().min(1).max(255).optional(),
    schema: z.string().min(1).max(255).optional(),
    kind: z
      .enum(["table", "view", "dynamic_table", "semantic_view"])
      .optional(),
    after: z.string().max(255).optional(),
  })
  .strict()
  .refine(
    (o) => (!o.schema || !!o.database) && (!o.kind || !!o.schema),
    "Invalid catalog scope",
  );
export type CatalogRequest = z.infer<typeof catalogRequest>;
export type CatalogPage = {
  names: string[];
  sources: QueryableSource[];
  next?: string;
};
export const catalogCommands = {
  table: "SHOW TABLES",
  view: "SHOW VIEWS",
  dynamic_table: "SHOW DYNAMIC TABLES",
  semantic_view: "SHOW SEMANTIC VIEWS",
} as const;
// SHOW does not accept value binds. Escape literals independently of identifiers.
export function literal(value: string) {
  if (/[\x00-\x1f]/.test(value)) throw Error("Invalid catalog cursor");
  return "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
}
export async function catalogPage(
  input: unknown,
  exec: Execute,
): Promise<CatalogPage> {
  const o = catalogRequest.parse(input);
  const prefix = o.kind
    ? catalogCommands[o.kind] +
      " IN SCHEMA " +
      [o.database!, o.schema!].map(identifier).join(".")
    : o.database
      ? "SHOW SCHEMAS IN DATABASE " + identifier(o.database)
      : "SHOW DATABASES";
  const rows = await exec(
    prefix + " LIMIT 100" + (o.after ? " FROM " + literal(o.after) : ""),
  );
  const names = rows.map((r) => String(r.name));
  return {
    names,
    sources: o.kind ? rows.map((r) => parseSource(r, o.kind!)) : [],
    next: rows.length === 100 ? names.at(-1) : undefined,
  };
}

// In-memory, bounded, short-lived browsing cache. Never used to authorize a query.
export class CatalogCache {
  private entries = new Map<string, { expires: number; page: CatalogPage }>();
  async get(
    scope: string,
    request: CatalogRequest,
    load: () => Promise<CatalogPage>,
    now = Date.now(),
  ) {
    const key = JSON.stringify([scope, request]);
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.page;
    const page = await load();
    this.entries.set(key, { expires: now + 15000, page });
    if (this.entries.size > 200)
      this.entries.delete(this.entries.keys().next().value!);
    return page;
  }
}
