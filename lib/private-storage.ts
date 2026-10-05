import { identifier } from "./compiler";

export function appObject(
  name:
    | "METADATA"
    | "DATASETS"
    | "PERSONAL_TABLES"
    | "WRITE_PRIVATE_STATE"
    | "CURRENT_PRINCIPAL"
    | "WRITE_DATASET",
) {
  return [
    process.env.SNOWLENS_METADATA_DATABASE || "SNOWFLAKE_APPS",
    process.env.SNOWLENS_METADATA_SCHEMA || "APP",
    name,
  ]
    .map(identifier)
    .join(".");
}
export function currentPrincipal() {
  return `${appObject("CURRENT_PRINCIPAL")}()`;
}

export function privateWrite(
  action: string,
  id: string,
  payload: unknown,
  expectedVersion = 0,
) {
  if (
    ![
      "saved",
      "favorite",
      "favorite_delete",
      "recent",
      "personal",
      "personal_delete",
    ].includes(action)
  )
    throw Error("Unsupported private storage action");
  return {
    sql: `CALL ${appObject("WRITE_PRIVATE_STATE")}(?, ?, ?, ?)`,
    binds: [action, id, JSON.stringify(payload), expectedVersion] as (
      string | number | boolean
    )[],
  };
}
