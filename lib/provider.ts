import { readFile, writeFile, rename } from "node:fs/promises";
import {
  type AppState,
  type QueryableSource,
  type Result,
  type Value,
  validateDataset,
  savedSchema,
} from "./model";
import { parseColumn, parseSource, callerToken } from "./metadata";
import { mockSources, executeMock, defaultDatasets } from "./mock";
import { compileQuery, validateQuery, relation, identifier } from "./compiler";
import { headers } from "next/headers";
import snowflake from "snowflake-sdk";
export const mockMode = () => process.env.SNOWLENS_MODE !== "snowflake";
type Rows = Record<string, unknown>[];
// One connection per HTTP request. No global session/role pooling across users.
export async function withSnowflake<T>(
  fn: (
    execute: (
      sql: string,
      binds?: (string | number | boolean)[],
    ) => Promise<Rows>,
  ) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const h = await headers();
  const caller = h.get("Sf-Context-Current-User-Token");
  const service = await readFile("/snowflake/session/token", "utf8").catch(
    () => null,
  );
  if (!service || !caller)
    throw Error(
      "Caller credentials unavailable. Snowflake mode requires trusted App Runtime ingress.",
    );
  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    host: process.env.SNOWFLAKE_HOST,
    authenticator: "OAUTH",
    token: callerToken(service, caller),
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  });
  await new Promise<void>((resolve, reject) =>
    connection.connect((err) => (err ? reject(err) : resolve())),
  );
  try {
    const execute = (sql: string, binds: (string | number | boolean)[] = []) =>
      new Promise<Rows>((resolve, reject) => {
        if (signal?.aborted) {
          reject(Error("Query cancelled"));
          return;
        }
        const stmt = connection.execute({
          sqlText: sql,
          binds,
          complete: (err, _stmt, rows) => {
            signal?.removeEventListener("abort", cancel);
            if (err) reject(err);
            else resolve(rows || []);
          },
        });
        const cancel = () => {
          stmt.cancel(() => {});
          reject(Error("Query cancelled"));
        };
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    await execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 60");
    return await fn(execute);
  } finally {
    await new Promise<void>((resolve) => connection.destroy(() => resolve()));
  }
}
export async function discover(): Promise<QueryableSource[]> {
  if (mockMode()) return mockSources;
  return withSnowflake(async (exec) => {
    const all: QueryableSource[] = [];
    // SHOW returns only the caller-visible catalog. No persistent metadata mirror.
    for (const [command, kind] of [
      ["SHOW TABLES IN ACCOUNT LIMIT 10000", "table"],
      ["SHOW VIEWS IN ACCOUNT LIMIT 10000", "view"],
      ["SHOW DYNAMIC TABLES IN ACCOUNT LIMIT 10000", "dynamic_table"],
      ["SHOW SEMANTIC VIEWS IN ACCOUNT LIMIT 10000", "semantic_view"],
    ] as const) {
      const rows = await exec(command);
      all.push(...rows.map((r) => parseSource(r, kind)));
    }
    return [...new Map(all.map((s) => [s.id, s])).values()];
  });
}
export async function resolveSource(
  id: string,
  exec?: (sql: string, binds?: (string | number | boolean)[]) => Promise<Rows>,
): Promise<QueryableSource> {
  if (mockMode()) {
    const s = mockSources.find((s) => s.id === id);
    if (!s) throw Error("Source not accessible");
    return s;
  }
  if (!exec) return withSnowflake((e) => resolveSource(id, e));
  // Resolve requested object against caller catalog; browser names never reach SQL.
  const sources: QueryableSource[] = [];
  for (const [cmd, kind] of [
    ["SHOW TABLES IN ACCOUNT LIMIT 10000", "table"],
    ["SHOW VIEWS IN ACCOUNT LIMIT 10000", "view"],
    ["SHOW DYNAMIC TABLES IN ACCOUNT LIMIT 10000", "dynamic_table"],
    ["SHOW SEMANTIC VIEWS IN ACCOUNT LIMIT 10000", "semantic_view"],
  ] as const) {
    sources.push(...(await exec(cmd)).map((r) => parseSource(r, kind)));
  }
  const s = [...sources].reverse().find((s) => s.id === id);
  if (!s) throw Error("Source not accessible");
  if (s.kind === "semantic_view") {
    const fields: QueryableSource["fields"] = [];
    for (const role of ["dimension", "metric"] as const) {
      const rows = await exec(
        `SHOW SEMANTIC ${role === "dimension" ? "DIMENSIONS" : "METRICS"} IN ${relation(s)}`,
      );
      rows
        .filter((r) => String(r.is_private || "false").toLowerCase() !== "true")
        .forEach((r) => {
          const name = String(r.name),
            table = String(r.table_name || "");
          const id = table ? table + "." + name : name;
          fields.push({
            id,
            label: name,
            type: String(r.data_type || "NUMBER"),
            description: String(r.comment || ""),
            category: table || "定義済み",
            suggested: role,
            semantic: role,
            expression: id,
          });
        });
    }
    s.fields = fields;
  } else {
    s.fields = (
      await exec(
        `SHOW COLUMNS IN ${s.kind === "view" ? "VIEW" : "TABLE"} ${relation(s)}`,
      )
    ).map(parseColumn);
  }
  if (!s.fields.length) throw Error("No accessible columns");
  return s;
}
export async function runQuery(
  input: unknown,
  datasetId?: string,
  signal?: AbortSignal,
): Promise<Result> {
  const parsed = (await import("./model")).querySchema.parse(input);
  const run = async (
    s: QueryableSource,
    exec?: (
      sql: string,
      binds?: (string | number | boolean)[],
    ) => Promise<Rows>,
  ) => {
    if (datasetId) {
      const state = await loadState(exec);
      const d = state.datasets.find(
        (d) => d.id === datasetId && d.source === s.id,
      );
      if (!d) throw Error("Dataset unavailable");
      s = {
        ...s,
        fields: s.fields.filter((f) => d.fields.some((df) => df.id === f.id)),
      };
    }
    const compiled = compileQuery(parsed, s);
    if (!exec) return executeMock(parsed, s);
    const start = performance.now();
    const raw = await exec(compiled.sql, compiled.binds);
    return {
      columns: compiled.columns,
      rows: raw
        .slice(0, parsed.limit)
        .map((r) =>
          Object.fromEntries(compiled.columns.map((c) => [c, normalize(r[c])])),
        ),
      hasMore: raw.length > parsed.limit,
      elapsedMs: Math.round(performance.now() - start),
    };
  };
  if (mockMode()) return run(await resolveSource(parsed.source));
  return withSnowflake(
    async (exec) => run(await resolveSource(parsed.source, exec), exec),
    signal,
  );
}
function normalize(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return v;
  return JSON.stringify(v);
}
const file = process.env.SNOWLENS_MOCK_FILE || ".snowlens-mock.json";
let queue: Promise<unknown> = Promise.resolve();
function metadataTable(kind = "personal") {
  return [
    process.env.SNOWLENS_METADATA_DATABASE || "SNOWFLAKE_APPS",
    "APP",
    kind === "dataset" ? "DATASETS" : "METADATA",
  ]
    .map(identifier)
    .join(".");
}
export async function loadState(
  exec?: (sql: string, binds?: (string | number | boolean)[]) => Promise<Rows>,
): Promise<AppState> {
  if (mockMode()) {
    try {
      return JSON.parse(
        await readFile(/* turbopackIgnore: true */ file, "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error(
          "Mock metadata is unreadable; restore the local file before saving.",
        );
      return {
        datasets: defaultDatasets(),
        saved: [],
        favorites: [],
        recent: [],
      };
    }
  }
  if (!exec) return withSnowflake((e) => loadState(e));
  const rows = await exec(
    `SELECT KIND, PAYLOAD, UPDATED_AT FROM ${metadataTable()} WHERE OWNER = CURRENT_USER() UNION ALL SELECT KIND, PAYLOAD, UPDATED_AT FROM ${metadataTable("dataset")} ORDER BY UPDATED_AT DESC`,
  );
  const state: AppState = {
    datasets: [],
    saved: [],
    favorites: [],
    recent: [],
  };
  rows.forEach((r) => {
    const p = typeof r.PAYLOAD === "string" ? JSON.parse(r.PAYLOAD) : r.PAYLOAD;
    switch (r.KIND) {
      case "dataset":
        state.datasets.push(p);
        break;
      case "saved":
        state.saved.push(p);
        break;
      case "favorite":
        state.favorites.push(p);
        break;
      case "recent":
        state.recent.push(p);
        break;
    }
  });
  return state;
}
export type StateAction = {
  kind: "dataset" | "saved" | "favorite" | "recent";
  payload: unknown;
};
export async function mutateState(action: StateAction): Promise<AppState> {
  const mutate = async (
    exec?: (
      sql: string,
      binds?: (string | number | boolean)[],
    ) => Promise<Rows>,
  ) => {
    const state = await loadState(exec);
    let payload: unknown = action.payload,
      id: string;
    if (action.kind === "dataset") {
      const raw = (await import("./model")).datasetSchema.parse(payload);
      const s = await resolveSource(raw.source, exec);
      payload = validateDataset(raw, s);
      validateQuery(raw.defaultView, {
        ...s,
        fields: s.fields.filter((f) => raw.fields.some((df) => df.id === f.id)),
      });
      id = raw.id;
      state.datasets = [raw, ...state.datasets.filter((d) => d.id !== id)];
    } else if (action.kind === "saved") {
      const v = savedSchema.parse(payload);
      validateQuery(v.query, await resolveSource(v.query.source, exec));
      payload = v;
      id = v.id;
      state.saved = [v, ...state.saved.filter((s) => s.id !== id)];
    } else {
      if (typeof payload !== "string") throw Error("Invalid source");
      await resolveSource(payload, exec);
      id = payload;
      if (action.kind === "favorite")
        state.favorites = state.favorites.includes(id)
          ? state.favorites.filter((f) => f !== id)
          : [id, ...state.favorites];
      else
        state.recent = [id, ...state.recent.filter((r) => r !== id)].slice(
          0,
          20,
        );
    }
    if (exec) {
      if (action.kind === "favorite" && !state.favorites.includes(id)) {
        await exec(
          `DELETE FROM ${metadataTable()} WHERE OWNER = CURRENT_USER() AND KIND = ? AND ID = ?`,
          [action.kind, id],
        );
      } else {
        // Dataset writes are also caller-rights: INSERT/UPDATE grants are the owner capability.
        const foreign =
          action.kind === "dataset"
            ? await exec(
                `SELECT ID FROM ${metadataTable("dataset")} WHERE ID = ? AND OWNER <> CURRENT_USER()`,
                [id],
              )
            : [];
        if (foreign.length)
          throw Error("Only the dataset owner may update this definition");
        await exec(
          `MERGE INTO ${metadataTable(action.kind)} t USING (SELECT CURRENT_USER() OWNER, ? KIND, ? ID, PARSE_JSON(?) PAYLOAD) s ON t.OWNER=s.OWNER AND t.KIND=s.KIND AND t.ID=s.ID WHEN MATCHED THEN UPDATE SET PAYLOAD=s.PAYLOAD, UPDATED_AT=CURRENT_TIMESTAMP() WHEN NOT MATCHED THEN INSERT (OWNER,KIND,ID,PAYLOAD,UPDATED_AT) VALUES (s.OWNER,s.KIND,s.ID,s.PAYLOAD,CURRENT_TIMESTAMP())`,
          [action.kind, id, JSON.stringify(payload)],
        );
      }
      if (action.kind === "recent")
        await exec(
          `DELETE FROM ${metadataTable()} WHERE OWNER=CURRENT_USER() AND KIND='recent' AND ID NOT IN (SELECT ID FROM ${metadataTable()} WHERE OWNER=CURRENT_USER() AND KIND='recent' ORDER BY UPDATED_AT DESC LIMIT 20)`,
        );
    } else {
      await writeFile(file + ".tmp", JSON.stringify(state), "utf8");
      await rename(file + ".tmp", file);
    }
    return state;
  };
  if (!mockMode()) return withSnowflake((e) => mutate(e));
  // Serialize read/modify/write in mock mode without waiting on this same promise.
  const work = queue.then(() => mutate());
  queue = work.catch(() => {});
  return work;
}
