import type { Field, FieldOverride } from "./model";

export function validateFieldOverrides(
  overrides: FieldOverride[],
  fields: Field[],
) {
  const allowed = new Set(fields.map((f) => f.id));
  if (new Set(overrides.map((f) => f.id)).size !== overrides.length)
    throw Error("個人定義の項目が重複しています。");
  if (overrides.some((f) => !allowed.has(f.id)))
    throw Error("個人定義に利用できない項目があります。");
}

// Display metadata never adds fields or changes types, expressions or permissions.
export function applyFieldOverrides(
  fields: Field[],
  overrides: FieldOverride[],
) {
  const byId = new Map(overrides.map((f) => [f.id, f]));
  return fields.map((field) => {
    const override = byId.get(field.id);
    return override
      ? { ...field, label: override.label, description: override.description }
      : field;
  });
}
