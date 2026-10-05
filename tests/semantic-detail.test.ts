import { it, expect } from "vitest";
import {
  semanticConstraints,
  factQuery,
  validateFactMapping,
} from "../lib/provider";
import { mockSources } from "../lib/mock";
import { initialQuery, type Dataset } from "../lib/model";
import { validateQuery } from "../lib/compiler";
const source = mockSources[5],
  target = mockSources[0];
const query = {
  ...initialQuery(source),
  detail: false,
  dimensions: ["PRODUCT"],
  metrics: [{ field: "SALES_AMOUNT", aggregation: "SEMANTIC" as const }],
  filters: [{ field: "PRODUCT", operator: "eq" as const, value: "A' OR 1=1" }],
};
const dataset: Dataset = {
  id: "semantic",
  name: "S",
  description: "",
  source: source.id,
  fields: source.fields.map((f) => ({
    id: f.id,
    label: f.label,
    description: "",
    recommended: false,
  })),
  defaultView: query,
  drill: {},
  factDetail: {
    source: target.id,
    fields: ["PRODUCT", "LOT_NO"],
    mapping: { PRODUCT: "PRODUCT" },
  },
};
it("maps every detail condition and rejects missing mappings and unknown targets", () => {
  const mapped = factQuery(query, dataset, source, target);
  expect(mapped.filters).toEqual(query.filters);
  expect(mapped.source).toBe(target.id);
  expect(mapped.detail).toBe(true);
  expect(() =>
    factQuery(
      {
        ...query,
        filters: [
          ...query.filters,
          { field: "REGION", operator: "eq", value: "R" },
        ],
      },
      dataset,
      source,
      target,
    ),
  ).toThrow("unmapped");
  expect(() =>
    validateFactMapping(
      {
        ...dataset,
        factDetail: { ...dataset.factDetail!, mapping: { PRODUCT: "nope" } },
      },
      source,
      target,
    ),
  ).toThrow();
  expect(() =>
    validateFactMapping(
      { ...dataset, factDetail: { ...dataset.factDetail!, fields: ["nope"] } },
      source,
      target,
    ),
  ).toThrow();
});
it("loads metric compatibility and required window dimensions from Snowflake metadata", async () => {
  let statement = "";
  const enriched = await semanticConstraints(
    source,
    ["SALES_AMOUNT"],
    async (sql) => {
      statement = sql;
      return [
        { name: "PRODUCT", required: "true" },
        { name: "REGION", required: false },
      ];
    },
  );
  expect(statement).toContain('FOR METRIC "ORDERS"."SALES_AMOUNT"');
  expect(validateQuery(query, enriched).dimensions).toEqual(["PRODUCT"]);
  expect(() => validateQuery({ ...query, dimensions: [] }, enriched)).toThrow(
    "Required",
  );
  expect(() =>
    validateQuery({ ...query, dimensions: ["LOT_NO"] }, enriched),
  ).toThrow("Invalid semantic");
  await expect(
    semanticConstraints(source, ["INJECT"], async () => []),
  ).rejects.toThrow("Unknown field");
});
