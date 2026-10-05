import { it, expect } from "vitest";
import { catalogPage, CatalogCache, literal } from "../lib/catalog";

it("pages beyond 10,000 objects within one schema without account scans", async () => {
  const objects = Array.from({ length: 10001 }, (_, i) => ({
    name: "T" + String(i).padStart(5, "0"),
    database_name: "D",
    schema_name: "S",
  }));
  const statements: string[] = [];
  let after: string | undefined;
  const found: string[] = [];
  do {
    const page = await catalogPage(
      { database: "D", schema: "S", kind: "table", after },
      async (sql) => {
        statements.push(sql);
        const cursor = sql.match(/FROM '([^']+)'/)?.[1];
        return objects
          .filter((row) => !cursor || row.name > cursor)
          .slice(0, 100);
      },
    );
    found.push(...page.sources.map((s) => s.name));
    after = page.next;
  } while (after);
  expect(found).toHaveLength(10001);
  expect(new Set(found).size).toBe(10001);
  expect(
    statements.every((sql) => sql.includes('IN SCHEMA "D"."S" LIMIT 100')),
  ).toBe(true);
});
it("escapes quoted scope and cursor and rejects invalid scope", async () => {
  let statement = "";
  await catalogPage(
    {
      database: 'D"x',
      schema: "S",
      kind: "view",
      after: "x'; DROP TABLE t;--",
    },
    async (sql) => {
      statement = sql;
      return [];
    },
  );
  expect(statement).toContain('"D""x"."S"');
  expect(statement).toContain("FROM 'x''; DROP TABLE t;--'");
  expect(literal("\\'")).toBe("'\\\\'''");
  await expect(catalogPage({ schema: "S" }, async () => [])).rejects.toThrow();
});
it("isolates browsing caches by caller and role and expires them", async () => {
  const cache = new CatalogCache();
  let loads = 0;
  const load = async () => ({ names: [String(++loads)], sources: [] });
  expect((await cache.get("alice:role1", {}, load, 0)).names).toEqual(["1"]);
  expect((await cache.get("alice:role1", {}, load, 10)).names).toEqual(["1"]);
  expect((await cache.get("bob:role1", {}, load, 10)).names).toEqual(["2"]);
  expect((await cache.get("alice:role2", {}, load, 10)).names).toEqual(["3"]);
  expect((await cache.get("alice:role1", {}, load, 15000)).names).toEqual([
    "4",
  ]);
});
