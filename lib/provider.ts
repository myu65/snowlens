import { z } from "zod";
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
  type RelationJoin,
  type PersonalTable,
  validateDataset,
  datasetSchema,
  savedSchema,
} from "./model";
import { parseColumn, parseSource, callerToken } from "./metadata";
import { mockSources, mockRows, executeMock, defaultDatasets } from "./mock";
import { compileQuery, validateQuery, relation, identifier } from "./compiler";
import { headers } from "next/headers";
import { validatePersonalTable } from "./personal";
import { validateFieldOverrides } from "./definitions";
import { semanticDraft } from "./semantic-draft";
import { appObject, privateWrite, currentPrincipal } from "./private-storage";
import {
  compileJoinedQuery,
  joinedSource,
  joinMockRows,
  matchField,
} from "./personal-join";
import {
  compileRelationQuery,
  relationJoinedSource,
  relationCountsSql,
  mockRelationCounts,
  joinRelationRows,
  type JoinCounts,
} from "./relation-join";
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
    let output = s;
    let compile = (q: Query) => compileQuery(q, s);
    let data: Record<string, Value>[] | undefined;
    if (parsed.join && "rightSource" in parsed.join) {
      const join = parsed.join;
      const right = await resolveSource(join.rightSource, exec);
      output = relationJoinedSource(s, right, join);
      validateQuery(parsed, output);
      const counts = await relationCounts(s, right, join, exec);
      if (counts.duplicateKeys)
        throw Error(
          "結合先のキーが重複しています。重複がないキーやViewを選んでください。",
        );
      compile = (q) => compileRelationQuery(q, s, right);
      if (!exec)
        data = joinRelationRows(mockRows(s), mockRows(right), s, right, join);
    }
    const personalJoin =
      parsed.join && "tableId" in parsed.join ? parsed.join : undefined;
    const table = personalJoin
      ? await loadPersonalTable(personalJoin.tableId, exec)
      : undefined;
    if (personalJoin && !table)
      throw Error("個人テーブルにアクセスできません。");
    if (table) {
      output = joinedSource(s, personalJoin!, table);
      compile = (q) => compileJoinedQuery(q, s, table);
      if (!exec) data = joinMockRows(mockRows(s), s, personalJoin!, table);
    }
    const start = performance.now();
    const execute = async (q: Query): Promise<Result> => {
      const compiled = compile(q);
      if (!exec) return executeMock(q, output, data);
      const raw = await exec(compiled.sql, compiled.binds);
      if (
        compiled.validationColumn &&
        raw.some((r) => Number(r[compiled.validationColumn!]) !== 0)
      )
        throw Error(
          "結合先のキーが重複しています。重複がないキーやViewを選んでください。",
        );
      const page = raw.slice(0, q.limit);
      return {
        columns: compiled.columns,
        rows: page.map((r) =>
          Object.fromEntries(compiled.columns.map((c) => [c, normalize(r[c])])),
        ),
        hasMore: raw.length > q.limit,
        elapsedMs: Math.round(performance.now() - start),
        ...(compiled.levelColumn
          ? {
              rowLevels: page.map((r) => Number(r[compiled.levelColumn!])),
              dimensionCount: q.dimensions.length,
            }
          : {}),
      };
    };
    const result = await execute(parsed);
    if (!parsed.detail && parsed.metrics.length && parsed.totals !== "off") {
      const required = output.fields.filter(
        (f) =>
          parsed.metrics.some((m) => m.field === f.id) &&
          f.requiredDimensions?.length,
      );
      if (required.length) {
        result.summaryNotice =
          "この指標には行項目が必要なため、総計を表示できません。";
      } else if (!parsed.dimensions.length) {
        result.grandTotal = result.rows[0];
      } else {
        try {
          const total = await execute({
            ...parsed,
            dimensions: [],
            sort: [],
            offset: 0,
            limit: 1,
            totals: "off",
          });
          result.grandTotal = total.rows[0];
        } catch (e) {
          if (signal?.aborted) throw e;
          result.summaryNotice =
            "総計を計算できません。指標の定義や権限を確認して再実行してください。";
        }
      }
    }
    result.elapsedMs = Math.round(performance.now() - start);
    return result;
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
  return appObject(
    kind === "dataset"
      ? "DATASETS"
      : kind === "personal"
        ? "PERSONAL_TABLES"
        : "METADATA",
  );
}
export async function loadState(
  exec?: (sql: string, binds?: (string | number | boolean)[]) => Promise<Rows>,
  includePersonalRows = false,
): Promise<AppState> {
  if (mockMode()) {
    try {
      const stored = JSON.parse(
        await readFile(/* turbopackIgnore: true */ file, "utf8"),
      );
      const state: AppState = {
        datasets: z.array(datasetSchema).parse(stored.datasets),
        saved: z.array(savedSchema).parse(stored.saved),
        favorites: z.array(z.string().min(1).max(1000)).parse(stored.favorites),
        recent: z.array(z.string().min(1).max(1000)).parse(stored.recent),
        personalTables: (stored.personalTables || []).map((t: unknown) =>
          validatePersonalTable(t),
        ),
      };
      return includePersonalRows ? state : stateForBrowser(state);
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
        personalTables: [],
      };
    }
  }
  if (!exec) return withSnowflake((e) => loadState(e, includePersonalRows));
  const rows = await exec(
    `SELECT KIND, ID, PAYLOAD, UPDATED_AT, 0 PERSONAL_ROWS FROM ${metadataTable("saved")} WHERE OWNER = ${currentPrincipal()} UNION ALL SELECT KIND, ID, ${includePersonalRows ? "PAYLOAD" : "OBJECT_INSERT(OBJECT_DELETE(PAYLOAD, 'rows'), 'rows', PARSE_JSON('[]'), TRUE)"} PAYLOAD, UPDATED_AT, ARRAY_SIZE(PAYLOAD:rows) PERSONAL_ROWS FROM ${metadataTable("personal")} WHERE OWNER = ${currentPrincipal()} UNION ALL SELECT KIND, ID, PAYLOAD, UPDATED_AT, 0 PERSONAL_ROWS FROM ${metadataTable("dataset")} ORDER BY UPDATED_AT DESC`,
  );
  const state: AppState = {
    datasets: [],
    saved: [],
    favorites: [],
    recent: [],
    personalTables: [],
  };
  const seen = new Set<string>();
  rows.forEach((r) => {
    const key = JSON.stringify([r.KIND, r.ID]);
    if (seen.has(key))
      throw Error("保存内容が重複しています。管理者に確認してください。");
    seen.add(key);
    const p = typeof r.PAYLOAD === "string" ? JSON.parse(r.PAYLOAD) : r.PAYLOAD;
    switch (r.KIND) {
      case "personal": {
        const table = validatePersonalTable(p);
        const rowCount = Number(r.PERSONAL_ROWS);
        if (
          table.id !== r.ID ||
          !Number.isInteger(rowCount) ||
          rowCount < 0 ||
          rowCount > 1000
        )
          throw Error("Invalid personal metadata");
        state.personalTables!.push({
          ...table,
          rowCount,
        });
        break;
      }
      case "dataset": {
        const d = datasetSchema.parse(p);
        if (d.id !== r.ID) throw Error("Invalid Dataset metadata");
        state.datasets.push(d);
        break;
      }
      case "saved": {
        const saved = savedSchema.parse(p);
        if (saved.id !== r.ID) throw Error("Invalid Saved View metadata");
        state.saved.push(saved);
        break;
      }
      case "favorite":
        if (typeof p !== "string" || p !== r.ID || p.length > 1000)
          throw Error("Invalid favorite metadata");
        state.favorites.push(p);
        break;
      case "recent":
        if (typeof p !== "string" || p !== r.ID || p.length > 1000)
          throw Error("Invalid recent metadata");
        state.recent.push(p);
        break;
    }
  });
  return state;
}
export type StateAction = {
  kind:
    | "dataset"
    | "saved"
    | "favorite"
    | "recent"
    | "personal"
    | "personal_delete";
  payload: unknown;
};
export async function mutateState(action: StateAction): Promise<AppState> {
  const mutate = async (
    exec?: (
      sql: string,
      binds?: (string | number | boolean)[],
    ) => Promise<Rows>,
  ) => {
    const state = await loadState(exec, mockMode());
    let payload: unknown = action.payload,
      id: string;
    let expectedVersion = 0;
    if (action.kind === "personal") {
      const raw = validatePersonalTable(payload);
      const existing = state.personalTables?.find((t) => t.id === raw.id);
      if (!existing && (state.personalTables?.length || 0) >= 50)
        throw Error("個人テーブルは50個までです。");
      if (existing && raw.version !== existing.version)
        throw Error(
          "個人テーブルが更新されています。画面を再読み込みしてから保存してください。",
        );
      expectedVersion = existing?.version || 0;
      const table = { ...raw, version: (existing?.version || 0) + 1 };
      payload = table;
      id = raw.id;
      state.personalTables = [
        table,
        ...(state.personalTables || []).filter((t) => t.id !== id),
      ];
    } else if (action.kind === "personal_delete") {
      const deletion = z
        .object({ id: z.string(), version: z.number().int().positive() })
        .strict()
        .parse(payload);
      const existing = state.personalTables?.find((t) => t.id === deletion.id);
      if (!existing) throw Error("個人テーブルにアクセスできません。");
      if (existing.version !== deletion.version)
        throw Error(
          "個人テーブルが更新されています。画面を再読み込みしてから削除してください。",
        );
      id = existing.id;
      expectedVersion = existing.version;
      state.personalTables = state.personalTables!.filter((t) => t.id !== id);
    } else if (action.kind === "dataset") {
      const raw = (await import("./model")).datasetSchema.parse(payload);
      if (raw.defaultView.join)
        throw Error(
          "結合した表示は共有Datasetに公開できません。表示を個人用に保存してください。",
        );
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
      let source = await resolveSource(v.query.source, exec);
      if (v.datasetId) {
        const d = state.datasets.find(
          (d) => d.id === v.datasetId && d.source === source.id,
        );
        if (!d) throw Error("Dataset unavailable");
        source = restrictSource(
          source,
          d.fields.map((f) => f.id),
        );
      }
      if (v.query.join && "tableId" in v.query.join) {
        const table = await loadPersonalTable(v.query.join.tableId, exec);
        if (!table) throw Error("個人テーブルにアクセスできません。");
        source = joinedSource(source, v.query.join, table);
      } else if (v.query.join && "rightSource" in v.query.join) {
        source = relationJoinedSource(
          source,
          await resolveSource(v.query.join.rightSource, exec),
          v.query.join,
        );
      }
      validateQuery(v.query, source);
      validateFieldOverrides(v.fieldOverrides || [], source.fields);
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
      if (action.kind === "dataset") {
        await exec(`CALL ${appObject("WRITE_DATASET")}(?, ?)`, [
          id,
          JSON.stringify(payload),
        ]);
      } else {
        const write = privateWrite(
          action.kind === "favorite" && !state.favorites.includes(id)
            ? "favorite_delete"
            : action.kind,
          id,
          payload,
          expectedVersion,
        );
        await exec(write.sql, write.binds);
      }
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

export async function previewPersonalJoin(
  input: unknown,
  datasetId?: string,
  signal?: AbortSignal,
) {
  const q = (await import("./model")).querySchema.parse(input);
  if (!q.join) throw Error("結合設定がありません。");
  const run = async (
    exec?: (
      sql: string,
      binds?: (string | number | boolean)[],
    ) => Promise<Rows>,
  ) => {
    let source = await resolveSource(q.source, exec);
    if (datasetId) {
      const state = await loadState(exec);
      const d = state.datasets.find(
        (d) => d.id === datasetId && d.source === q.source,
      );
      if (!d) throw Error("Dataset unavailable");
      source = restrictSource(
        source,
        d.fields.map((f) => f.id),
      );
    }
    if (q.join && "rightSource" in q.join)
      return relationCounts(
        source,
        await resolveSource(q.join.rightSource, exec),
        q.join,
        exec,
      );
    if (!q.join || !("tableId" in q.join))
      throw Error("結合設定がありません。");
    const table = await loadPersonalTable(q.join.tableId, exec);
    if (!table) throw Error("個人テーブルにアクセスできません。");
    const statistics: Query = {
      ...q,
      join: { ...q.join!, type: "left" },
      detail: false,
      dimensions: [],
      metrics: [
        { field: matchField, aggregation: "COUNT" },
        { field: matchField, aggregation: "SUM" },
      ],
      sort: [],
      offset: 0,
      limit: 1,
    };
    const compiled = compileJoinedQuery(statistics, source, table, true);
    const rows = exec
      ? await exec(compiled.sql, compiled.binds)
      : executeMock(
          statistics,
          joinedSource(source, q.join, table, true),
          joinMockRows(mockRows(source), source, q.join, table),
        ).rows;
    const totalRows = Number(rows[0]?.[matchField + "__COUNT"] || 0),
      matchedRows = Number(rows[0]?.[matchField + "__SUM"] || 0);
    return {
      totalRows,
      matchedRows,
      unmatchedRows: totalRows - matchedRows,
      personalRows: table.rows.length,
    };
  };
  return mockMode() ? run() : withSnowflake(run, signal);
}

async function relationCounts(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
  exec?: (sql: string, binds?: (string | number | boolean)[]) => Promise<Rows>,
): Promise<JoinCounts> {
  const sql = relationCountsSql(left, right, join);
  if (!exec) return mockRelationCounts(mockRows(left), mockRows(right), join);
  const rows = await exec(sql);
  const result = rows[0];
  const normalized = Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, Number(v)]),
  ) as JoinCounts;
  if (Object.values(normalized).some((v) => !Number.isSafeInteger(v) || v < 0))
    throw Error("結合の行数を正確に確認できません。");
  return normalized;
}
export async function loadPersonalTable(
  id: string,
  exec?: (sql: string, binds?: (string | number | boolean)[]) => Promise<Rows>,
): Promise<PersonalTable | undefined> {
  if (mockMode())
    return (await loadState(undefined, true)).personalTables?.find(
      (t) => t.id === id,
    );
  if (!exec) return withSnowflake((e) => loadPersonalTable(id, e));
  const rows = await exec(
    `SELECT PAYLOAD FROM ${appObject("PERSONAL_TABLES")} WHERE OWNER=${currentPrincipal()} AND KIND='personal' AND ID=?`,
    [id],
  );
  if (rows.length > 1)
    throw Error(
      "個人テーブルの保存内容が重複しています。管理者に確認してください。",
    );
  if (!rows.length) return undefined;
  const p = rows[0].PAYLOAD;
  return validatePersonalTable(typeof p === "string" ? JSON.parse(p) : p);
}
export function stateForBrowser(state: AppState): AppState {
  return {
    ...state,
    personalTables: state.personalTables?.map((t) => ({
      ...t,
      rowCount: t.rowCount ?? t.rows.length,
      rows: [],
    })),
  };
}

export async function prepareSemanticDraft(
  input: unknown,
  target: [string, string, string],
  datasetId?: string,
  signal?: AbortSignal,
) {
  const q = (await import("./model")).querySchema.parse(input);
  const run = async (
    exec?: (
      sql: string,
      binds?: (string | number | boolean)[],
    ) => Promise<Rows>,
  ) => {
    let source = await resolveSource(q.source, exec);
    if (datasetId) {
      const d = (await loadState(exec)).datasets.find(
        (d) => d.id === datasetId && d.source === source.id,
      );
      if (!d) throw Error("Dataset unavailable");
      source = restrictSource(
        source,
        d.fields.map((f) => f.id),
      );
    }
    const right =
      q.join && "rightSource" in q.join
        ? await resolveSource(q.join.rightSource, exec)
        : undefined;
    if (right && q.join && "rightSource" in q.join) {
      const counts = await relationCounts(source, right, q.join, exec);
      if (counts.duplicateKeys)
        throw Error("公開できません。結合先のキーが重複しています。");
    }
    return semanticDraft(q, source, target, right);
  };
  return mockMode() ? run() : withSnowflake(run, signal);
}
