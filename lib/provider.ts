import { createHash } from "node:crypto";
import {
  CatalogCache,
  catalogPage,
  catalogRequest,
  catalogCommands,
  literal,
  type CatalogRequest,
  type CatalogPage,
} from "./catalog";
import { readFile, writeFile, rename } from "node:fs/promises";
import {
  type AppState,
  type QueryableSource,
  type Result,
  type Value,
  type Query,
  type Dataset,
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
const browsingCache = new CatalogCache();
export async function browseCatalog(
  input: CatalogRequest,
): Promise<CatalogPage> {
  const o = catalogRequest.parse(input);
  if (mockMode()) {
    const relevant = mockSources.filter(
      (s) =>
        (!o.database || s.database === o.database) &&
        (!o.schema || s.schema === o.schema) &&
        (!o.kind || s.kind === o.kind),
    );
    const names = [
      ...new Set(
        relevant.map((s) =>
          o.kind ? s.name : o.database ? s.schema : s.database,
        ),
      ),
    ]
      .sort()
      .filter((name) => !o.after || name > o.after)
      .slice(0, 100);
    return {
      names,
      sources: o.kind ? relevant.filter((s) => names.includes(s.name)) : [],
      next: names.length === 100 ? names.at(-1) : undefined,
    };
  }
  return withSnowflake(async (exec) => {
    const context = await exec(
      "SELECT CURRENT_USER() AS U, CURRENT_ROLE() AS R, CURRENT_SECONDARY_ROLES() AS S",
    );
    if (!context[0]?.U || !context[0]?.R)
      throw Error("Caller context unavailable");
    const h = await headers();
    const token = h.get("Sf-Context-Current-User-Token");
    if (!token) throw Error("Caller context unavailable");
    const scope = createHash("sha256")
      .update(JSON.stringify([token, context[0]]))
      .digest("hex");
    return browsingCache.get(scope, o, () => catalogPage(o, exec));
  });
}
export async function discover(): Promise<QueryableSource[]> {
  // Live catalogs are navigated lazily by database/schema; mock keeps the demo overview.
  return mockMode() ? mockSources : [];
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
  // Only inspect the requested schema/name, always using fresh caller metadata.
  let parts: unknown;
  try {
    parts = JSON.parse(id);
  } catch {
    throw Error("Source not accessible");
  }
  if (
    !Array.isArray(parts) ||
    parts.length !== 3 ||
    parts.some((p) => typeof p !== "string" || !p || p.length > 255)
  )
    throw Error("Source not accessible");
  const [database, schema, name] = parts as string[];
  const sources: QueryableSource[] = [];
  for (const kind of [
    "table",
    "view",
    "dynamic_table",
    "semantic_view",
  ] as const) {
    const cmd = `${catalogCommands[kind]} LIKE ${literal(name)} IN SCHEMA ${[database, schema].map(identifier).join(".")} STARTS WITH ${literal(name)} LIMIT 100`;
    sources.push(
      ...(await exec(cmd))
        .map((r) => parseSource(r, kind))
        .filter((s) => s.id === id),
    );
  }
  const s = sources.at(-1);
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
export async function semanticConstraints(
  s: QueryableSource,
  metrics: string[],
  exec: (sql: string, binds?: (string | number | boolean)[]) => Promise<Rows>,
): Promise<QueryableSource> {
  if (s.kind !== "semantic_view") return s;
  const fields = s.fields.map((f) => ({ ...f }));
  for (const id of [...new Set(metrics)]) {
    const metric = fields.find((f) => f.id === id && f.semantic === "metric");
    if (!metric) throw Error("Unknown field: " + id);
    const name = (metric.expression || metric.id)
      .split(".")
      .map(identifier)
      .join(".");
    const rows = await exec(
      `SHOW SEMANTIC DIMENSIONS IN ${relation(s)} FOR METRIC ${name}`,
    );
    const dimId = (r: Record<string, unknown>) =>
      r.table_name
        ? String(r.table_name) + "." + String(r.name)
        : String(r.name);
    metric.compatibleDimensions = rows.map(dimId);
    metric.requiredDimensions = rows
      .filter((r) => String(r.required).toLowerCase() === "true")
      .map(dimId);
  }
  return { ...s, fields };
}
export async function resolveMetricSource(id: string, metric: string) {
  if (mockMode()) return resolveSource(id);
  return withSnowflake(async (exec) =>
    semanticConstraints(await resolveSource(id, exec), [metric], exec),
  );
}
function restrictSource(s: QueryableSource, fields: string[]) {
  return { ...s, fields: s.fields.filter((f) => fields.includes(f.id)) };
}
export function validateFactMapping(
  d: Dataset,
  source: QueryableSource,
  target: QueryableSource,
) {
  const detail = d.factDetail;
  if (
    !detail ||
    source.kind !== "semantic_view" ||
    target.kind === "semantic_view" ||
    detail.source !== target.id
  )
    throw Error("Invalid fact detail source");
  const published = new Set(d.fields.map((f) => f.id));
  const targetIds = new Set(target.fields.map((f) => f.id));
  if (
    new Set(detail.fields).size !== detail.fields.length ||
    detail.fields.some((id) => !targetIds.has(id))
  )
    throw Error("Invalid fact detail fields");
  if (
    !Object.keys(detail.mapping).length ||
    Object.entries(detail.mapping).some(
      ([from, to]) =>
        !published.has(from) ||
        source.fields.find((f) => f.id === from)?.semantic !== "dimension" ||
        !targetIds.has(to),
    )
  )
    throw Error("Invalid fact detail mapping");
}
export function factQuery(
  q: Query,
  d: Dataset,
  s: QueryableSource,
  target: QueryableSource,
): Query {
  validateFactMapping(d, s, target);
  validateQuery(
    q,
    restrictSource(
      s,
      d.fields.map((f) => f.id),
    ),
  );
  const detail = d.factDetail!;
  const filters = q.filters.map((f) => {
    const to = detail.mapping[f.field];
    if (!to) throw Error("Invalid unmapped detail condition: " + f.field);
    return { ...f, field: to };
  });
  const mapped = {
    ...q,
    source: target.id,
    filters,
    detail: true,
    dimensions: [],
    metrics: [],
    sort: [],
  };
  // Filter fields may be hidden in detail output, but must still be valid target metadata.
  validateQuery(mapped, target);
  return mapped;
}
export async function runFactDetail(
  input: unknown,
  datasetId: string,
  signal?: AbortSignal,
) {
  const q = (await import("./model")).querySchema.parse(input);
  const run = async (
    exec?: (
      sql: string,
      binds?: (string | number | boolean)[],
    ) => Promise<Rows>,
  ) => {
    const state = await loadState(exec);
    const d = state.datasets.find(
      (d) => d.id === datasetId && d.source === q.source,
    );
    if (!d?.factDetail) throw Error("Dataset detail unavailable");
    const source = await resolveSource(d.source, exec);
    const target = await resolveSource(d.factDetail.source, exec);
    const mapped = factQuery(q, d, source, target);
    const exposed = restrictSource(target, d.factDetail.fields);
    // Compile with all validated filter columns; project only owner-published detail fields.
    const output = {
      ...target,
      fields: target.fields.filter(
        (f) =>
          d.factDetail!.fields.includes(f.id) ||
          mapped.filters.some((x) => x.field === f.id),
      ),
    };
    const compiled = compileQuery(mapped, output);
    const started = performance.now();
    const result = exec
      ? {
          rows: (await exec(compiled.sql, compiled.binds)).map((r) =>
            Object.fromEntries(
              compiled.columns.map((c) => [c, normalize(r[c])]),
            ),
          ),
          columns: compiled.columns,
          hasMore: false,
          elapsedMs: Math.round(performance.now() - started),
        }
      : executeMock(mapped, output);
    const hasMore = exec ? result.rows.length > q.limit : result.hasMore;
    return {
      source: exposed,
      result: {
        ...result,
        hasMore,
        columns: exposed.fields.map((f) => f.id),
        rows: result.rows
          .slice(0, q.limit)
          .map((row) =>
            Object.fromEntries(exposed.fields.map((f) => [f.id, row[f.id]])),
          ),
      },
    };
  };
  return mockMode() ? run() : withSnowflake(run, signal);
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
    if (exec)
      s = await semanticConstraints(
        s,
        parsed.detail ? [] : parsed.metrics.map((m) => m.field),
        exec,
      );
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
      if (raw.factDetail)
        validateFactMapping(
          raw,
          s,
          await resolveSource(raw.factDetail.source, exec),
        );
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
