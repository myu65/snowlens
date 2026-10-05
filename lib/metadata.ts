import { type QueryableSource, inferRole } from "./model";
export function callerToken(
  service: string | null,
  caller: string | null,
): string {
  if (!service?.trim() || !caller?.trim())
    throw Error("Caller credentials unavailable");
  return service.trim() + "." + caller.trim();
}
export function parseSource(
  r: Record<string, unknown>,
  kind: QueryableSource["kind"],
): QueryableSource {
  for (const key of ["database_name", "schema_name", "name"])
    if (typeof r[key] !== "string" || !r[key])
      throw Error("Invalid source metadata");
  const database = String(r.database_name),
    schema = String(r.schema_name),
    name = String(r.name);
  return {
    id: JSON.stringify([database, schema, name]),
    database,
    schema,
    name,
    kind,
    description: String(r.comment || ""),
    rowCount: r.rows == null ? undefined : Number(r.rows),
    fields: [],
  };
}
export function parseColumn(
  r: Record<string, unknown>,
): QueryableSource["fields"][number] {
  const id = String(r.column_name || r.name || "");
  if (!id) throw Error("Invalid column metadata");
  let data: unknown = r.data_type || r.type || "VARCHAR";
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {}
  }
  let type =
    typeof data === "object" && data !== null && "type" in data
      ? String(data.type)
      : String(data);
  type =
    (
      { FIXED: "NUMBER", TEXT: "VARCHAR", REAL: "FLOAT" } as Record<
        string,
        string
      >
    )[type] || type;
  return {
    id,
    label: id,
    type,
    description: String(r.comment || ""),
    category: type,
    suggested: inferRole(id, type),
  };
}
