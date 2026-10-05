"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type DragEvent,
} from "react";
import {
  composeColumns,
  moveItem,
  type ComposeTarget,
  type ComposeAggregation,
} from "@/lib/compose";
import { fieldMime, readFieldDrag } from "./components/field-drag";
import {
  type QueryableSource,
  type Query,
  type Result,
  type AppState,
  type Dataset,
  type Field,
  type Value,
  type SavedView,
  type PersonalTable,
  type FieldOverride,
  initialQuery,
  metricKey,
  isNumeric,
  aggregations,
  operators,
} from "@/lib/model";
import { recommendedQuery } from "@/lib/mock";
import SemanticDraftEditor from "./components/semantic-draft-editor";
import TableJoinBuilder from "./components/table-join-builder";
import { relationJoinedSource, relationJoinKeys } from "@/lib/relation-join";
import PersonalFieldsEditor from "./components/personal-fields-editor";
import { applyFieldOverrides } from "@/lib/definitions";
import PersonalTableEditor from "./components/personal-table-editor";
import JoinBuilder from "./components/join-builder";
import { personalFields } from "@/lib/personal";
import FactDetail from "./components/fact-detail";
import Grid from "./components/grid";
import CatalogBrowser from "./components/catalog-browser";
import FilterValue from "./components/filter-value";
import FieldPicker from "./components/field-picker";
import OwnerEditor from "./components/owner-editor";
import DownloadDialog from "./components/download-dialog";
type Picker = "dimension" | "metric" | "filter" | "drill";
const emptyState: AppState = {
  datasets: [],
  saved: [],
  favorites: [],
  recent: [],
  personalTables: [],
};
const opLabels: Record<string, string> = {
  eq: "等しい",
  neq: "以外",
  gt: "より大きい",
  gte: "以上",
  lt: "より小さい",
  lte: "以下",
  contains: "含む",
  is_null: "空欄",
  not_null: "空欄でない",
};
const aggLabels: Record<string, string> = {
  SUM: "合計 SUM",
  AVG: "平均 AVG",
  MIN: "最小 MIN",
  MAX: "最大 MAX",
  COUNT: "件数 COUNT",
  COUNT_ROWS: "行数 COUNT *",
  COUNT_DISTINCT: "種類数 COUNT DISTINCT",
  SEMANTIC: "定義済み",
};
async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "通信できません");
  return data;
}
export default function SnowLens() {
  const [sources, setSources] = useState<QueryableSource[]>([]),
    [state, setState] = useState<AppState>(emptyState),
    [mode, setMode] = useState(""),
    [source, setSource] = useState<QueryableSource>(),
    [dataset, setDataset] = useState<Dataset>(),
    [query, setQuery] = useState<Query>(),
    [result, setResult] = useState<Result>(),
    [busy, setBusy] = useState(false),
    [opening, setOpening] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [side, setSide] = useState(true),
    [picker, setPicker] = useState<Picker>(),
    [recentFields, setRecentFields] = useState<string[]>([]),
    [personalEditor, setPersonalEditor] = useState<{
      table?: PersonalTable;
      afterJoin?: boolean;
    }>(),
    [fieldOverrides, setFieldOverrides] = useState<FieldOverride[]>([]),
    [editingFields, setEditingFields] = useState(false),
    [semanticDraftOpen, setSemanticDraftOpen] = useState(false),
    [downloading, setDownloading] = useState(false),
    [savingView, setSavingView] = useState(false),
    [joiningTables, setJoiningTables] = useState(false),
    [joinedRight, setJoinedRight] = useState<QueryableSource>(),
    [joining, setJoining] = useState(false),
    [joinTableHint, setJoinTableHint] = useState<string>(),
    [deletePersonal, setDeletePersonal] = useState<PersonalTable>(),
    [owner, setOwner] = useState(false),
    [save, setSave] = useState(false),
    [saveName, setSaveName] = useState(""),
    [cell, setCell] = useState<{
      row: Record<string, Value>;
      column: string;
    }>(),
    [factQuery, setFactQuery] = useState<Query>(),
    [history, setHistory] = useState<Query[]>([]),
    [intro, setIntro] = useState(false),
    [retry, setRetry] = useState(0),
    [selectedColumns, setSelectedColumns] = useState<string[]>([]),
    [composeAggregation, setComposeAggregation] =
      useState<ComposeAggregation>("auto"),
    [dropTarget, setDropTarget] = useState<"dimension" | "metric">(),
    [homeTab, setHomeTab] = useState("all");
  const cache = useRef(new Map<string, Result>()),
    requestId = useRef(0),
    openId = useRef(0);
  const bootstrap = useCallback(async () => {
    setOpening(true);
    setError("");
    try {
      const [catalog, s] = await Promise.allSettled([
        api<{ sources: QueryableSource[]; mode: string }>("/api/catalog"),
        api<AppState>("/api/state"),
      ]);
      if (catalog.status === "fulfilled") {
        setSources(catalog.value.sources);
        setMode(catalog.value.mode);
      } else setError(catalog.reason.message);
      if (s.status === "fulfilled") setState(s.value);
      else setNotice(s.reason.message + " データの直接探索は利用できます。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void bootstrap(), 0);
    return () => clearTimeout(timer);
  }, [bootstrap]);
  const mutate = useCallback(async (kind: string, payload: unknown) => {
    const next = await api<AppState>("/api/state", { kind, payload });
    setState(next);
    return next;
  }, []);
  const personalTableId =
    query?.join && "tableId" in query.join ? query.join.tableId : undefined;
  const personalVersion = state.personalTables?.find(
    (t) => t.id === personalTableId,
  )?.version;
  useEffect(() => {
    if (!query) return;
    const id = ++requestId.current,
      controller = new AbortController();
    const key = JSON.stringify([query, dataset?.id, personalVersion]);
    const cached = mode === "mock" ? cache.current.get(key) : undefined;
    if (cached) setResult(cached);
    setBusy(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const data =
          cached ||
          (await api<Result>(
            "/api/query",
            { query, datasetId: dataset?.id },
            controller.signal,
          ));
        if (requestId.current === id) {
          if (mode === "mock") cache.current.set(key, data);
          if (cache.current.size > 30)
            cache.current.delete(cache.current.keys().next().value!);
          setResult(data);
        }
      } catch (e) {
        if (!controller.signal.aborted && requestId.current === id) {
          setError((e as Error).message);
          if (mode === "snowflake") setResult(undefined);
        }
      } finally {
        if (requestId.current === id) setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, dataset?.id, retry, personalVersion, mode]);
  async function open(
    s: Pick<QueryableSource, "id">,
    d?: Dataset,
    saved?: SavedView,
  ) {
    const id = ++openId.current;
    setOpening(true);
    setError("");
    setNotice("");
    setCell(undefined);
    setFactQuery(undefined);
    setJoining(false);
    try {
      const full = await api<QueryableSource>(
        "/api/catalog?source=" + encodeURIComponent(s.id),
      );
      if (id !== openId.current) return;
      window.scrollTo(0, 0);
      if (saved?.datasetId && !d)
        throw Error("保存した表示のDatasetを利用できません。");
      const savedRight =
        saved?.query.join && "rightSource" in saved.query.join
          ? await api<QueryableSource>(
              "/api/catalog?source=" +
                encodeURIComponent(saved.query.join.rightSource),
            )
          : undefined;
      if (id !== openId.current) return;
      setJoinedRight(savedRight);
      setSource(full);
      setDataset(d);
      setFieldOverrides(saved?.fieldOverrides || []);
      setEditingFields(false);
      setQuery(saved?.query || d?.defaultView || initialQuery(full));
      setResult(undefined);
      setHistory([]);
      setIntro(!d && !saved);
      setSide(true);
      setSelectedColumns([]);
      void mutate("recent", s.id).catch((e) => setNotice(e.message));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id === openId.current) setOpening(false);
    }
  }
  async function editPersonal(id: string) {
    try {
      const table = await api<PersonalTable>(
        "/api/personal-table?id=" + encodeURIComponent(id),
      );
      setPersonalEditor({ table });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function home() {
    window.scrollTo(0, 0);
    openId.current++;
    setSource(undefined);
    setQuery(undefined);
    setDataset(undefined);
    setFieldOverrides([]);
    setEditingFields(false);
    setFactQuery(undefined);
    setJoining(false);
    setJoiningTables(false);
    setSemanticDraftOpen(false);
    setJoinedRight(undefined);
    setSelectedColumns([]);
    setError("");
    setNotice("");
    setOpening(false);
  }
  function change(patch: Partial<Query>, remember = false) {
    if (!query) return;
    setBusy(true);
    if (remember) setHistory((h) => [...h, query]);
    if (patch.dimensions || patch.metrics || patch.detail !== undefined) {
      setIntro(false);
      setSelectedColumns([]);
    }
    setQuery({ ...query, ...patch, offset: patch.offset ?? 0 });
    setCell(undefined);
  }
  const baseFields =
    source?.fields
      .filter((f) => !dataset || dataset.fields.some((df) => df.id === f.id))
      .map((f) => {
        const df = dataset?.fields.find((df) => df.id === f.id);
        return df
          ? {
              ...f,
              label: df.label,
              description: df.description,
              recommended: df.recommended,
            }
          : f;
      }) || [];
  const tableJoin =
    query?.join && "rightSource" in query.join ? query.join : undefined;
  const activeTable = state.personalTables?.find(
    (t) => t.id === personalTableId,
  );
  const originalFields = [
    ...baseFields,
    ...(activeTable
      ? personalFields(activeTable)
      : tableJoin && joinedRight?.id === tableJoin.rightSource
        ? relationJoinedSource(
            { ...source!, fields: baseFields },
            joinedRight,
            tableJoin,
          ).fields.slice(baseFields.length)
        : []),
  ];
  const fields = applyFieldOverrides(originalFields, fieldOverrides);
  const label = (id: string) => {
    const metric = query?.metrics.find((m) => metricKey(m) === id);
    const field = fields.find((f) => f.id === (metric?.field || id));
    if (metric?.aggregation === "COUNT_ROWS") return "行数";
    return (
      (field?.label || id) +
      (metric
        ? " · " +
          (metric.aggregation === "SEMANTIC"
            ? "定義済み"
            : metric.aggregation.replace("_", " "))
        : "")
    );
  };
  const selectedVisible = selectedColumns.filter(
    (id) => result?.columns.includes(id) && fields.some((f) => f.id === id),
  );
  async function compose(
    ids: string[],
    target: ComposeTarget,
    aggregation: ComposeAggregation = "auto",
    stage = false,
  ) {
    if (!query || !source) return;
    const opened = openId.current;
    const previous = query;
    const selectedRequest = requestId.current;
    try {
      let available = fields;
      const selectedMetrics = ids.filter(
        (id) => fields.find((f) => f.id === id)?.semantic === "metric",
      );
      if (target !== "dimension" && selectedMetrics.length) {
        const checked = await Promise.allSettled(
          selectedMetrics.map((id) =>
            api<QueryableSource>(
              "/api/catalog?source=" +
                encodeURIComponent(source.id) +
                "&metric=" +
                encodeURIComponent(id),
            ),
          ),
        );
        if (opened !== openId.current || selectedRequest !== requestId.current)
          return;
        const verified: Field[] = [];
        for (let i = 0; i < checked.length; i++) {
          const check = checked[i];
          if (check.status === "rejected")
            throw Error(
              "指標の組み合わせを確認できません。再度選択してください。",
            );
          const metric = check.value.fields.find(
            (f) => f.id === selectedMetrics[i],
          );
          if (!metric) throw Error("この指標を利用できません。");
          verified.push(metric);
        }
        available = fields.map((f) => ({
          ...f,
          ...verified.find((v) => v.id === f.id),
          label: f.label,
          description: f.description,
        }));
        setSource((s) =>
          s
            ? {
                ...s,
                fields: s.fields.map((f) => ({
                  ...f,
                  ...verified.find((v) => v.id === f.id),
                })),
              }
            : s,
        );
      }
      const next = composeColumns(
        previous,
        available,
        ids,
        target,
        aggregation,
      );
      if (stage && previous.detail) next.detail = true;
      change(next, true);
      setSide(true);
      setRecentFields((recent) =>
        [...new Set([...ids, ...recent])].slice(0, 12),
      );
      const requiredAdded = next.dimensions.filter(
        (id) => !previous.dimensions.includes(id) && !ids.includes(id),
      );
      setNotice(
        requiredAdded.length
          ? "指標に必要な行項目を追加しました: " +
              requiredAdded.map(label).join("、")
          : "",
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function startColumns(event: DragEvent<HTMLElement>, id: string) {
    const ids = selectedVisible.includes(id) ? selectedVisible : [id];
    event.dataTransfer.setData(
      fieldMime,
      JSON.stringify({ kind: "columns", ids }),
    );
    event.dataTransfer.effectAllowed = "copy";
    setSide(true);
  }
  function startItem(
    event: DragEvent<HTMLElement>,
    kind: "dimension" | "metric",
    index: number,
  ) {
    event.dataTransfer.setData(fieldMime, JSON.stringify({ kind, index }));
    event.dataTransfer.effectAllowed = "move";
  }
  function dragOver(
    event: DragEvent<HTMLElement>,
    target: "dimension" | "metric",
  ) {
    if (!event.dataTransfer.types.includes(fieldMime)) return;
    event.preventDefault();
    setDropTarget(target);
  }
  function dropFields(
    event: DragEvent<HTMLElement>,
    target: "dimension" | "metric",
    index?: number,
  ) {
    const dragged = readFieldDrag(event.dataTransfer);
    setDropTarget(undefined);
    if (!dragged || !query) return;
    event.preventDefault();
    event.stopPropagation();
    if (dragged.kind === "columns")
      void compose(dragged.ids, target, "auto", true);
    else if (dragged.kind === target && index !== undefined)
      change(
        target === "dimension"
          ? {
              dimensions: moveItem(query.dimensions, dragged.index, index),
              sort: [],
            }
          : {
              metrics: moveItem(query.metrics, dragged.index, index),
              sort: [],
            },
        true,
      );
  }
  function choose(f: Field) {
    if (!query) return;
    setRecentFields((recent) =>
      [f.id, ...recent.filter((id) => id !== f.id)].slice(0, 12),
    );
    if (picker === "filter") {
      change(
        {
          filters: [
            ...query.filters,
            {
              field: f.id,
              operator: "eq",
              value: isNumeric(f)
                ? 0
                : f.type === "BOOLEAN"
                  ? false
                  : /DATE/.test(f.type)
                    ? "2026-10-01"
                    : "",
            },
          ],
        },
        true,
      );
    } else if (picker === "drill") {
      change(
        { detail: false, dimensions: [f.id], filters: cellFilter(), sort: [] },
        true,
      );
    }
  }
  function cellFilter() {
    if (!query || !cell) return query?.filters || [];
    const ids = query.detail ? [cell.column] : query.dimensions;
    return [
      ...query.filters,
      ...ids
        .filter(
          (id) => fields.some((f) => f.id === id) && cell.row[id] !== undefined,
        )
        .map((id) => ({
          field: id,
          operator:
            cell.row[id] === null ? ("is_null" as const) : ("eq" as const),
          value: cell.row[id],
        })),
    ];
  }
  function focus(exclude = false) {
    if (!query || !cell) return;
    const column = fields.find((f) => f.id === cell.column);
    if (!column) {
      setNotice("集計値ではなく、製品や顧客などの行項目を選んでください。");
      setCell(undefined);
      return;
    }
    change(
      {
        filters: [
          ...query.filters,
          {
            field: cell.column,
            operator:
              cell.row[cell.column] === null
                ? exclude
                  ? "not_null"
                  : "is_null"
                : exclude
                  ? "neq"
                  : "eq",
            value: cell.row[cell.column],
          },
        ],
      },
      true,
    );
  }
  const filtered = sources.filter(
    (s) =>
      (s.name + " " + s.description + " " + s.database + " " + s.schema)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (homeTab === "all" ||
        state[homeTab === "favorite" ? "favorites" : "recent"].includes(s.id)),
  );
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={home}>
          <span className="brand-icon">❄</span> SnowLens{" "}
          <span className="version">0.1</span>
        </button>
        <span className="topbar-caption">データをすぐ、深く。</span>
        <span className="mode">
          <span className="status-dot" />
          {mode === "mock" ? "MOCK WORKSPACE" : "SNOWFLAKE"}
        </span>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            onClick={() => (source ? setRetry((r) => r + 1) : void bootstrap())}
          >
            再試行
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {!source ? (
        <main className="home">
          <div className="home-hero">
            <span className="eyebrow">YOUR DATA, WITHIN REACH</span>
            <h1>何を見ますか？</h1>
            <p>Snowflakeのデータを開いて、気になるところから探索。</p>
            <div className="search-wrap">
              <span>⌕</span>
              <input
                aria-label="データを検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="データ名・データベース・説明を検索…"
              />
              <kbd>/</kbd>
            </div>
          </div>
          <section>
            <div className="section-heading">
              <h2>よく使うデータ</h2>
              <span>業務に合わせたおすすめ表示</span>
            </div>
            <div className="dataset-cards">
              {state.datasets
                .filter((d) => (d.name + " " + d.description).includes(search))
                .map((d, i) => (
                  <button
                    key={d.id}
                    className="dataset-card"
                    onClick={() => {
                      const s = sources.find((s) => s.id === d.source);
                      void open(s || { id: d.source }, d);
                    }}
                  >
                    <span className={"card-icon tone-" + (i % 3)}>
                      {["▤", "◈", "⚗"][i % 3]}
                    </span>
                    <span className="badge">DATASET</span>
                    <h3>{d.name}</h3>
                    <p>{d.description}</p>
                    <span className="card-link">データを開く →</span>
                  </button>
                ))}
              {!state.datasets.length && !opening && (
                <p className="muted">
                  データを探索して「Datasetとして公開」すると、ここに表示されます。
                </p>
              )}
            </div>
          </section>
          <section>
            <div className="section-heading">
              <div>
                <h2>個人テーブル</h2>
                <span>自分の分類・目標値を作って結合</span>
              </div>
              <button onClick={() => setPersonalEditor({})}>
                ＋ 個人テーブルを作る
              </button>
            </div>
            <div className="personal-cards">
              {(state.personalTables || []).map((t) => (
                <div className="personal-card" key={t.id}>
                  <button onClick={() => void editPersonal(t.id)}>
                    <strong>{t.name}</strong>
                    <small>
                      {(t.rowCount ?? t.rows.length).toLocaleString()}行 ·{" "}
                      {t.columns.length}列 · 自分のみ
                    </small>
                  </button>
                  <button
                    aria-label={`${t.name}を削除`}
                    onClick={() => setDeletePersonal(t)}
                  >
                    削除
                  </button>
                </div>
              ))}
              {!state.personalTables?.length && (
                <p className="muted">
                  Excelからの貼り付けや手入力で、小さな表を作れます。
                </p>
              )}
            </div>
          </section>
          {state.saved.length > 0 && (
            <section>
              <div className="section-heading">
                <h2>保存した表示</h2>
              </div>
              <div className="saved-list">
                {state.saved.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      const s = sources.find((s) => s.id === v.query.source),
                        d = state.datasets.find((d) => d.id === v.datasetId);
                      void open(s || { id: v.query.source }, d, v);
                    }}
                  >
                    ☆ {v.name} <span className="private-scope">自分のみ</span>
                    <small>
                      {sources.find((s) => s.id === v.query.source)?.name}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <div className="section-heading">
              <h2>データを探す</h2>
              <span>Datasetの登録なしで開けます</span>
            </div>
            <div className="browser-panel">
              {mode === "snowflake" && (
                <CatalogBrowser
                  onOpen={(s) => {
                    setSources((old) => [
                      ...new Map([...old, s].map((x) => [x.id, x])).values(),
                    ]);
                    void open(s);
                  }}
                />
              )}
              <div className="browser-tabs">
                {[
                  ["all", "すべてのデータ"],
                  ["favorite", "お気に入り"],
                  ["recent", "最近開いたデータ"],
                ].map(([key, text]) => (
                  <button
                    key={key}
                    className={homeTab === key ? "active" : ""}
                    onClick={() => setHomeTab(key)}
                  >
                    {text}
                  </button>
                ))}
                <span>
                  {filtered.length}{" "}
                  {mode === "snowflake" ? "開いたデータ" : "sources"}
                </span>
              </div>
              {mode === "snowflake" && homeTab !== "all" && (
                <div className="saved-list">
                  {(homeTab === "favorite" ? state.favorites : state.recent)
                    .filter((id) => !sources.some((s) => s.id === id))
                    .map((id) => (
                      <button key={id} onClick={() => void open({ id })}>
                        {id}
                      </button>
                    ))}
                </div>
              )}
              {opening ? (
                <div className="empty">データ一覧を読み込み中…</div>
              ) : !filtered.length ? (
                <div className="empty">
                  {mode === "snowflake"
                    ? "上のデータベースからデータを開けます。検索は開いたデータが対象です。"
                    : "データが見つかりません。検索条件を変更してください。"}
                </div>
              ) : (
                [...new Set(filtered.map((s) => s.database))].map((db) => (
                  <div className="database" key={db}>
                    <h3>▱ {db}</h3>
                    {[
                      ...new Set(
                        filtered
                          .filter((s) => s.database === db)
                          .map((s) => s.schema),
                      ),
                    ].map((schema) => (
                      <details key={schema} open>
                        <summary>
                          {schema}
                          <span>
                            {
                              filtered.filter(
                                (s) => s.database === db && s.schema === schema,
                              ).length
                            }
                          </span>
                        </summary>
                        {filtered
                          .filter(
                            (s) => s.database === db && s.schema === schema,
                          )
                          .map((s) => (
                            <div className="source-row" key={s.id}>
                              <button
                                className="source-open"
                                onClick={() => void open(s)}
                              >
                                <span className="relation-icon">▦</span>
                                <span>
                                  <strong>{s.name}</strong>
                                  <small>{s.description}</small>
                                </span>
                                <span className="kind">
                                  {s.kind.replace("_", " ").toUpperCase()}
                                </span>
                                <span className="source-count">
                                  {s.rowCount?.toLocaleString()} rows
                                </span>
                                <span>→</span>
                              </button>
                              <button
                                aria-label={`${s.name}をお気に入り`}
                                className="star"
                                onClick={() =>
                                  void mutate("favorite", s.id).catch((e) =>
                                    setError(e.message),
                                  )
                                }
                              >
                                {state.favorites.includes(s.id) ? "★" : "☆"}
                              </button>
                            </div>
                          ))}
                      </details>
                    ))}
                  </div>
                ))
              )}
            </div>
          </section>
          <footer className="home-footer">
            SnowLens · SQLを書かずに、データから答えへ。
            <span>MIT Licensed · Snowflake専用</span>
          </footer>
        </main>
      ) : (
        <main className="explore">
          <div className="explore-heading">
            <div>
              <button className="breadcrumb" onClick={home}>
                データを探す
              </button>
              <span className="muted">
                {" "}
                / {source.database} / {source.schema}
              </span>
              <h1>
                {dataset?.name || source.name}
                <span className="badge">
                  {dataset
                    ? "DATASET"
                    : source.kind.replace("_", " ").toUpperCase()}
                </span>
              </h1>
              <p>
                {dataset?.description || source.description}
                {source.rowCount !== undefined && (
                  <span> · 約{source.rowCount.toLocaleString()}行</span>
                )}
              </p>
            </div>
            <div className="heading-actions">
              <button
                aria-label="お気に入り"
                onClick={() =>
                  void mutate("favorite", source.id).catch((e) =>
                    setError(e.message),
                  )
                }
              >
                {state.favorites.includes(source.id) ? "★" : "☆"}
              </button>
              <button
                onClick={() => {
                  setSaveName(dataset?.name || source.name);
                  setSave(true);
                }}
              >
                ☆ 表示を保存
              </button>
              <button onClick={() => setEditingFields(true)}>
                自分用の項目名
              </button>
              <button
                disabled={source.kind === "semantic_view" || !query}
                title={
                  source.kind === "semantic_view"
                    ? "結合には元のTable / View / Dynamic Tableを開いてください"
                    : undefined
                }
                onClick={() => {
                  setJoinTableHint(undefined);
                  setJoining(true);
                }}
              >
                個人テーブルを結合
              </button>
              <button
                disabled={source.kind === "semantic_view" || !query}
                onClick={() => setJoiningTables(true)}
              >
                テーブル同士を結合
              </button>
              <button onClick={() => setSemanticDraftOpen(true)}>
                Semantic Viewの下書き
              </button>
              <button
                className="primary"
                disabled={!!query?.join}
                title={
                  query?.join ? "結合は「表示を保存」で保存できます" : undefined
                }
                onClick={() => setOwner(true)}
              >
                {dataset ? "Datasetを編集" : "Datasetとして公開"}
              </button>
            </div>
          </div>
          {query && (
            <>
              {query.join && (
                <div className="join-banner">
                  <strong>
                    ▦ {activeTable?.name || joinedRight?.name || "結合先"}
                  </strong>
                  <span>
                    {"tableField" in query.join
                      ? `${label(query.join.sourceField)} = ${
                          activeTable?.columns.find(
                            (c) =>
                              c.id ===
                              ("tableField" in query.join!
                                ? query.join.tableField
                                : ""),
                          )?.label || query.join.tableField
                        }`
                      : relationJoinKeys(query.join)
                          .map(
                            (key) =>
                              `${label(key.sourceField)} = ${joinedRight?.fields.find((f) => f.id === key.rightField)?.label || key.rightField}`,
                          )
                          .join("、かつ ")}{" "}
                    ·{" "}
                    {query.join.type === "left"
                      ? "元データをすべて残す"
                      : "一致する行だけ"}
                    {"rightSource" in query.join &&
                    (query.join.leftFilters?.length ||
                      query.join.rightFilters?.length)
                      ? ` · 結合前の条件 ${query.join.leftFilters?.length || 0}＋${query.join.rightFilters?.length || 0}件`
                      : ""}
                  </span>
                  <button
                    onClick={() => {
                      if (tableJoin) setJoiningTables(true);
                      else {
                        setJoinTableHint(undefined);
                        setJoining(true);
                      }
                    }}
                  >
                    結合を変更
                  </button>
                  {activeTable && (
                    <button onClick={() => void editPersonal(activeTable.id)}>
                      個人テーブルを編集
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const allowed = new Set(baseFields.map((f) => f.id));
                      change(
                        {
                          join: undefined,
                          dimensions: query.dimensions.filter((id) =>
                            allowed.has(id),
                          ),
                          metrics: query.metrics.filter((m) =>
                            allowed.has(m.field),
                          ),
                          filters: query.filters.filter((f) =>
                            allowed.has(f.field),
                          ),
                          sort: [],
                          detail: true,
                        },
                        true,
                      );
                    }}
                  >
                    結合を外す
                  </button>
                </div>
              )}
              <div className="filterbar">
                <span className="filter-label">検索条件</span>
                {query.filters.map((f, i) => {
                  const field = fields.find((x) => x.id === f.field);
                  return (
                    <div className="filter-chip" key={i}>
                      <span>{label(f.field)}</span>
                      <select
                        aria-label={`条件${i + 1}の比較`}
                        value={f.operator}
                        onChange={(e) =>
                          change({
                            filters: query.filters.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    operator: e.target
                                      .value as typeof f.operator,
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        {operators.map((o) => (
                          <option key={o} value={o}>
                            {opLabels[o]}
                          </option>
                        ))}
                      </select>
                      {!["is_null", "not_null"].includes(f.operator) && (
                        <FilterValue
                          field={field}
                          query={query}
                          index={i}
                          datasetId={dataset?.id}
                          personalVersion={personalVersion}
                          onChange={(value) =>
                            change({
                              filters: query.filters.map((x, j) =>
                                j === i ? { ...x, value } : x,
                              ),
                            })
                          }
                        />
                      )}
                      <button
                        aria-label={`条件${i + 1}を削除`}
                        onClick={() =>
                          change({
                            filters: query.filters.filter((_, j) => j !== i),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <button className="dashed" onClick={() => setPicker("filter")}>
                  ＋ 条件
                </button>
                {!!query.filters.length && (
                  <button
                    className="text-button"
                    onClick={() => change({ filters: [] }, true)}
                  >
                    条件をクリア
                  </button>
                )}
              </div>
              {intro && (
                <div className="recommendations">
                  <div>
                    <strong>まず、どの切り口で見ますか？</strong>
                    <p>おすすめ表示を選ぶか、項目を自由に選べます。</p>
                  </div>
                  <div>
                    {fields
                      .filter(
                        (f) =>
                          f.suggested === "dimension" &&
                          f.semantic !== "metric",
                      )
                      .slice(0, 3)
                      .map((f) => (
                        <button
                          key={f.id}
                          onClick={() => {
                            change(recommendedQuery(source, f.id));
                            setSide(true);
                          }}
                        >
                          {f.label}別 →
                        </button>
                      ))}
                    <button
                      className="primary"
                      onClick={() => {
                        setIntro(false);
                        setSide(true);
                        setPicker("dimension");
                      }}
                    >
                      表示を組み立てる
                    </button>
                  </div>
                </div>
              )}
              <div className={"workspace " + (!side ? "wide" : "")}>
                <aside className="settings" hidden={!side}>
                  <div className="settings-heading">
                    <h2>表示を組み立てる</h2>
                    <button
                      aria-label="設定を折りたたむ"
                      onClick={() => setSide(false)}
                    >
                      ‹
                    </button>
                  </div>
                  <p className="muted">
                    表の列をここへドラッグ。置き終えたら集計します。
                  </p>
                  <div
                    className={
                      "settings-section field-drop" +
                      (dropTarget === "dimension" ? " drag-over" : "")
                    }
                    aria-label="行項目のドロップ先"
                    data-testid="row-drop-zone"
                    onDragOver={(e) => dragOver(e, "dimension")}
                    onDragLeave={() => setDropTarget(undefined)}
                    onDrop={(e) => dropFields(e, "dimension")}
                  >
                    <h3>
                      行 <span>グループ化</span>
                    </h3>
                    {query.dimensions.map((id, index) => (
                      <div
                        className="selection"
                        key={id}
                        draggable
                        onDragStart={(e) => startItem(e, "dimension", index)}
                        onDragOver={(e) => dragOver(e, "dimension")}
                        onDrop={(e) => dropFields(e, "dimension", index)}
                      >
                        <span>{label(id)}</span>
                        <span className="field-order">
                          <button
                            aria-label={`${label(id)}を行で上へ`}
                            disabled={index === 0}
                            onClick={() =>
                              change(
                                {
                                  dimensions: moveItem(
                                    query.dimensions,
                                    index,
                                    index - 1,
                                  ),
                                  sort: [],
                                },
                                true,
                              )
                            }
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`${label(id)}を行で下へ`}
                            disabled={index === query.dimensions.length - 1}
                            onClick={() =>
                              change(
                                {
                                  dimensions: moveItem(
                                    query.dimensions,
                                    index,
                                    index + 1,
                                  ),
                                  sort: [],
                                },
                                true,
                              )
                            }
                          >
                            ↓
                          </button>
                        </span>
                        <button
                          aria-label={`${label(id)}を行から削除`}
                          onClick={() =>
                            change(
                              {
                                dimensions: query.dimensions.filter(
                                  (d) => d !== id,
                                ),
                                sort: [],
                              },
                              true,
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      className="add-field"
                      onClick={() => setPicker("dimension")}
                    >
                      ＋ 行の項目を追加
                    </button>
                    <small>ロット番号など、数値も使えます。</small>
                  </div>
                  <div
                    className={
                      "settings-section field-drop" +
                      (dropTarget === "metric" ? " drag-over" : "")
                    }
                    aria-label="集計する値のドロップ先"
                    data-testid="value-drop-zone"
                    onDragOver={(e) => dragOver(e, "metric")}
                    onDragLeave={() => setDropTarget(undefined)}
                    onDrop={(e) => dropFields(e, "metric")}
                  >
                    <h3>
                      値 <span>集計</span>
                    </h3>
                    {query.metrics.map((m, i) => (
                      <div
                        className="metric-selection"
                        key={metricKey(m)}
                        draggable
                        onDragStart={(e) => startItem(e, "metric", i)}
                        onDragOver={(e) => dragOver(e, "metric")}
                        onDrop={(e) => dropFields(e, "metric", i)}
                      >
                        <div>
                          <span>
                            {m.aggregation === "COUNT_ROWS"
                              ? "行数"
                              : label(m.field)}
                          </span>
                          <span className="field-order">
                            <button
                              aria-label={`${label(metricKey(m))}を値で上へ`}
                              disabled={i === 0}
                              onClick={() =>
                                change(
                                  {
                                    metrics: moveItem(query.metrics, i, i - 1),
                                    sort: [],
                                  },
                                  true,
                                )
                              }
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`${label(metricKey(m))}を値で下へ`}
                              disabled={i === query.metrics.length - 1}
                              onClick={() =>
                                change(
                                  {
                                    metrics: moveItem(query.metrics, i, i + 1),
                                    sort: [],
                                  },
                                  true,
                                )
                              }
                            >
                              ↓
                            </button>
                          </span>
                          <button
                            aria-label={`${label(m.field)}を値から削除`}
                            onClick={() =>
                              change(
                                {
                                  metrics: query.metrics.filter(
                                    (_, j) => j !== i,
                                  ),
                                  sort: [],
                                },
                                true,
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                        <select
                          aria-label={`${label(m.field)}の集計方法`}
                          value={m.aggregation}
                          onChange={(e) =>
                            change(
                              {
                                metrics: query.metrics.map((x, j) =>
                                  j === i
                                    ? {
                                        ...x,
                                        aggregation: e.target
                                          .value as typeof m.aggregation,
                                      }
                                    : x,
                                ),
                                sort: [],
                              },
                              true,
                            )
                          }
                        >
                          {aggregations
                            .filter((a) =>
                              fields.find((f) => f.id === m.field)?.semantic ===
                              "metric"
                                ? a === "SEMANTIC"
                                : a !== "SEMANTIC" &&
                                  (!["SUM", "AVG"].includes(a) ||
                                    isNumeric(
                                      fields.find((f) => f.id === m.field)!,
                                    )),
                            )
                            .map((a) => (
                              <option key={a} value={a}>
                                {aggLabels[a]}
                              </option>
                            ))}
                        </select>
                      </div>
                    ))}
                    <button
                      className="add-field"
                      onClick={() => setPicker("metric")}
                    >
                      ＋ 値を追加
                    </button>
                    {source.kind !== "semantic_view" && fields.length > 0 && (
                      <button
                        className="add-field"
                        onClick={() =>
                          void compose([fields[0].id], "metric", "COUNT_ROWS")
                        }
                      >
                        ＋ 行数を追加
                      </button>
                    )}
                  </div>
                  {query.detail &&
                    (query.dimensions.length > 0 ||
                      query.metrics.length > 0) && (
                      <button
                        className="primary compose-apply"
                        onClick={() =>
                          change({ detail: false, sort: [] }, true)
                        }
                      >
                        この項目で集計
                      </button>
                    )}
                  <button
                    className={
                      query.detail ? "detail-toggle selected" : "detail-toggle"
                    }
                    onClick={() =>
                      change({ detail: !query.detail, sort: [] }, true)
                    }
                  >
                    {query.detail ? "✓ 明細を表示中" : "明細表示に切り替える"}
                  </button>
                  {source.kind === "semantic_view" && (
                    <p className="muted">
                      Semantic
                      Viewの明細は定義済みディメンションの組み合わせです。
                    </p>
                  )}
                </aside>
                <section className="results">
                  <div className="result-toolbar">
                    <div>
                      {!side && (
                        <button
                          aria-label="設定を開く"
                          onClick={() => setSide(true)}
                        >
                          ☰ 表示
                        </button>
                      )}
                      <span className="result-title">
                        {query.detail ? "明細" : "集計結果"}
                      </span>
                      {history.length > 0 && (
                        <button
                          onClick={() => {
                            const prev = history[history.length - 1];
                            setHistory(history.slice(0, -1));
                            setQuery(prev);
                            setCell(undefined);
                          }}
                        >
                          ← 元に戻る
                        </button>
                      )}
                    </div>
                    <div>
                      <span className="query-status" role="status">
                        {busy
                          ? "更新中…"
                          : result
                            ? `${result.rows.length.toLocaleString()}行 · ${result.elapsedMs} ms`
                            : opening
                              ? "読み込み中…"
                              : ""}
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => {
                          cache.current.clear();
                          setRetry((r) => r + 1);
                        }}
                      >
                        ↻ 更新
                      </button>
                      <button
                        disabled={!result || busy}
                        onClick={() => setDownloading(true)}
                      >
                        ↓ ダウンロード
                      </button>
                    </div>
                  </div>
                  {result && (
                    <div
                      className="column-actions"
                      aria-label="選択した列の操作"
                    >
                      {selectedVisible.length ? (
                        <>
                          <strong>{selectedVisible.length}列を選択中</strong>
                          <button
                            className="primary"
                            onClick={() =>
                              void compose(selectedVisible, "auto")
                            }
                          >
                            選択列で集計
                          </button>
                          <button
                            onClick={() =>
                              void compose(selectedVisible, "dimension")
                            }
                          >
                            行に追加
                          </button>
                          <select
                            aria-label="選択列の集計方法"
                            value={composeAggregation}
                            onChange={(e) =>
                              setComposeAggregation(
                                e.target.value as ComposeAggregation,
                              )
                            }
                          >
                            <option value="auto">おすすめの集計</option>
                            {aggregations
                              .filter(
                                (a) => a !== "SEMANTIC" && a !== "COUNT_ROWS",
                              )
                              .map((a) => (
                                <option key={a} value={a}>
                                  {aggLabels[a]}
                                </option>
                              ))}
                          </select>
                          <button
                            onClick={() =>
                              void compose(
                                selectedVisible,
                                "metric",
                                composeAggregation,
                              )
                            }
                          >
                            値に追加
                          </button>
                          <button onClick={() => setSelectedColumns([])}>
                            選択を解除
                          </button>
                        </>
                      ) : (
                        <span>
                          列のチェックでまとめて選択 · 列名を行・値へドラッグ
                        </span>
                      )}
                      {!query.detail && query.metrics.length > 0 && (
                        <div className="totals-controls">
                          <label>
                            <input
                              type="checkbox"
                              aria-label="総計を表示"
                              checked={query.totals !== "off"}
                              onChange={(e) =>
                                change(
                                  {
                                    totals: e.target.checked ? "grand" : "off",
                                  },
                                  true,
                                )
                              }
                            />
                            総計
                          </label>
                          <label
                            title={
                              source.kind === "semantic_view"
                                ? "定義済みの指標は総計で確認できます"
                                : "行項目の順番に沿って小計を表示"
                            }
                          >
                            <input
                              type="checkbox"
                              aria-label="小計を表示"
                              disabled={
                                source.kind === "semantic_view" ||
                                query.dimensions.length < 2
                              }
                              checked={query.totals === "subtotals"}
                              onChange={(e) =>
                                change(
                                  {
                                    totals: e.target.checked
                                      ? "subtotals"
                                      : "grand",
                                    sort: [],
                                  },
                                  true,
                                )
                              }
                            />
                            小計
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                  {result ? (
                    <Grid
                      result={result}
                      label={label}
                      sort={query.sort}
                      busy={busy}
                      dimensions={query.dimensions}
                      selectableColumns={fields.map((f) => f.id)}
                      selectedColumns={selectedVisible}
                      sortableColumns={
                        query.totals === "subtotals"
                          ? query.dimensions
                          : undefined
                      }
                      onSelectColumn={(id) => {
                        setSelectedColumns((ids) =>
                          ids.includes(id)
                            ? ids.filter((c) => c !== id)
                            : ids.length >= 24
                              ? ids
                              : [...ids, id],
                        );
                        setSide(true);
                      }}
                      onDragColumn={startColumns}
                      onSort={(id) =>
                        change({
                          sort: [
                            {
                              field: id,
                              direction:
                                query.sort[0]?.field === id &&
                                query.sort[0]?.direction === "asc"
                                  ? "desc"
                                  : "asc",
                            },
                          ],
                        })
                      }
                      onCell={(row, column) => setCell({ row, column })}
                    />
                  ) : (
                    <div className="empty">
                      <h3>
                        {busy
                          ? "データを読み込み中…"
                          : "表示する項目を選んでください"}
                      </h3>
                      <p>おすすめ表示から始めることもできます。</p>
                    </div>
                  )}
                  {!query.detail &&
                    query.metrics.length > 0 &&
                    query.totals !== "off" &&
                    result && (
                      <section
                        className="summary-bar"
                        aria-label="条件に合う全行の総計"
                        aria-busy={busy}
                      >
                        <div>
                          <strong>総計</strong>
                          <small>
                            {busy ? "総計を更新中…" : "条件に合う全行"}
                          </small>
                        </div>
                        {result.grandTotal ? (
                          query.metrics.map((m) => {
                            const key = metricKey(m),
                              value = result.grandTotal![key];
                            return (
                              <div key={key}>
                                <small>{label(key)}</small>
                                <output>
                                  {value === null || value === undefined
                                    ? "—"
                                    : typeof value === "number"
                                      ? value.toLocaleString("ja-JP", {
                                          maximumFractionDigits: 2,
                                        })
                                      : String(value)}
                                </output>
                              </div>
                            );
                          })
                        ) : (
                          <p>{result.summaryNotice || "総計を読み込み中…"}</p>
                        )}
                      </section>
                    )}
                  <div className="result-footer">
                    <span>
                      {query.totals === "subtotals"
                        ? "行項目の順番で小計を表示 · 小計もページの行数に含みます"
                        : "セルをクリックして、絞り込み・掘り下げ・明細へ"}
                    </span>
                    <div>
                      <select
                        aria-label="ページあたりの行数"
                        value={query.limit}
                        onChange={(e) =>
                          change({ limit: Number(e.target.value) })
                        }
                      >
                        <option value={200}>200行</option>
                        <option value={500}>500行</option>
                        <option value={1000}>1,000行</option>
                      </select>
                      <button
                        aria-label="前のページ"
                        disabled={!query.offset || busy}
                        onClick={() =>
                          change({
                            offset: Math.max(0, query.offset - query.limit),
                          })
                        }
                      >
                        ‹
                      </button>
                      <span>{Math.floor(query.offset / query.limit) + 1}</span>
                      <button
                        aria-label="次のページ"
                        disabled={!result?.hasMore || busy}
                        onClick={() =>
                          change({ offset: query.offset + query.limit })
                        }
                      >
                        ›
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      )}
      {picker && source && (
        <FieldPicker
          title={
            picker === "dimension"
              ? "行の項目を選ぶ"
              : picker === "metric"
                ? "集計する値を選ぶ"
                : picker === "filter"
                  ? "検索条件の項目を選ぶ"
                  : "別の項目で掘り下げる"
          }
          fields={fields.filter((f) =>
            picker === "metric"
              ? source.kind === "semantic_view"
                ? f.semantic === "metric"
                : true
              : f.semantic !== "metric",
          )}
          recent={recentFields}
          onChoose={(f) =>
            picker === "dimension" || picker === "metric"
              ? void compose([f.id], picker)
              : void choose(f)
          }
          onChooseMany={
            picker === "dimension" || picker === "metric"
              ? (selected) =>
                  void compose(
                    selected.map((f) => f.id),
                    picker,
                  )
              : undefined
          }
          onClose={() => setPicker(undefined)}
        />
      )}
      {cell && query && !picker && (
        <div className="overlay" onClick={() => setCell(undefined)}>
          <section
            className="dialog cell-menu"
            role="dialog"
            aria-label="セル操作"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title">
              <div>
                <small>{label(cell.column)}</small>
                <h2>{String(cell.row[cell.column] ?? "空欄")}</h2>
              </div>
              <button aria-label="閉じる" onClick={() => setCell(undefined)}>
                ×
              </button>
            </div>
            {fields.some(
              (f) => f.id === cell.column && f.semantic !== "metric",
            ) && (
              <>
                <button onClick={() => focus()}>この値だけ見る</button>
                <button onClick={() => focus(true)}>この値を除外</button>
              </>
            )}
            <button
              onClick={() =>
                dataset?.factDetail && source?.kind === "semantic_view"
                  ? (setFactQuery({
                      ...query,
                      filters: cellFilter(),
                      offset: 0,
                    }),
                    setCell(undefined))
                  : change(
                      { detail: true, filters: cellFilter(), sort: [] },
                      true,
                    )
              }
            >
              {query.metrics.some((m) => metricKey(m) === cell.column)
                ? "この数字の明細を見る"
                : "明細を見る"}
            </button>
            {fields.some(
              (f) => f.id === cell.column && f.semantic !== "metric",
            ) && (
              <button
                onClick={() =>
                  change(
                    { detail: false, dimensions: [cell.column], sort: [] },
                    true,
                  )
                }
              >
                これでグループ化
              </button>
            )}
            <hr />
            {(dataset?.drill[cell.column] || []).map((id) => (
              <button
                key={id}
                onClick={() =>
                  change(
                    {
                      detail: false,
                      dimensions: [id],
                      filters: cellFilter(),
                      sort: [],
                    },
                    true,
                  )
                }
              >
                {label(id)}別に見る →
              </button>
            ))}
            <button onClick={() => setPicker("drill")}>別の項目で掘る →</button>
            <button
              onClick={() => {
                void navigator.clipboard
                  .writeText(String(cell.row[cell.column] ?? ""))
                  .then(() => {
                    setNotice("値をコピーしました");
                    setCell(undefined);
                  })
                  .catch(() =>
                    setNotice(
                      "ブラウザでクリップボードへのアクセスを許可してください",
                    ),
                  );
              }}
            >
              コピー
            </button>
          </section>
        </div>
      )}
      {semanticDraftOpen && source && query && (
        <SemanticDraftEditor
          source={source}
          query={query}
          datasetId={dataset?.id}
          onClose={() => setSemanticDraftOpen(false)}
        />
      )}
      {editingFields && (
        <PersonalFieldsEditor
          fields={originalFields}
          overrides={fieldOverrides}
          onClose={() => setEditingFields(false)}
          onApply={setFieldOverrides}
        />
      )}
      {personalEditor && (
        <PersonalTableEditor
          existing={personalEditor.table}
          onClose={() => setPersonalEditor(undefined)}
          onSave={async (table) => {
            await mutate("personal", table);
            cache.current.clear();
            setRetry((r) => r + 1);
            setNotice("個人テーブルを保存しました。");
            if (personalEditor.afterJoin) {
              setJoinTableHint(table.id);
              setJoining(true);
            }
          }}
        />
      )}
      {joiningTables && source && query && (
        <TableJoinBuilder
          source={{ ...source, fields: baseFields }}
          query={query}
          sources={sources}
          initialRight={joinedRight}
          datasetId={dataset?.id}
          onClose={() => setJoiningTables(false)}
          onApply={(next, right) => {
            setHistory((h) => [...h, query]);
            setJoinedRight(right);
            setQuery(next);
            setIntro(false);
            setSide(true);
            setBusy(true);
            setCell(undefined);
          }}
        />
      )}
      {joining && source && query && (
        <JoinBuilder
          source={{ ...source, fields: baseFields }}
          query={query}
          tables={state.personalTables || []}
          datasetId={dataset?.id}
          initialTableId={joinTableHint}
          onClose={() => setJoining(false)}
          onCreate={() => {
            setJoining(false);
            setPersonalEditor({ afterJoin: true });
          }}
          onApply={(next) => {
            setHistory((h) => [...h, query]);
            setQuery(next);
            setIntro(false);
            setSide(true);
            setBusy(true);
            setCell(undefined);
          }}
        />
      )}
      {deletePersonal && (
        <div className="overlay">
          <section
            className="dialog compact"
            role="dialog"
            aria-label="個人テーブルを削除"
          >
            <h2>「{deletePersonal.name}」を削除</h2>
            <p>このテーブルを使う保存した表示は、結合を開けなくなります。</p>
            <div className="dialog-footer">
              <button onClick={() => setDeletePersonal(undefined)}>
                キャンセル
              </button>
              <button
                onClick={() => {
                  void mutate("personal_delete", {
                    id: deletePersonal.id,
                    version: deletePersonal.version,
                  })
                    .then(() => {
                      cache.current.clear();
                      setRetry((r) => r + 1);
                      setDeletePersonal(undefined);
                    })
                    .catch((e) => setError(e.message));
                }}
              >
                この個人テーブルを削除
              </button>
            </div>
          </section>
        </div>
      )}
      {factQuery && dataset && (
        <FactDetail
          query={factQuery}
          datasetId={dataset.id}
          onClose={() => setFactQuery(undefined)}
        />
      )}
      {owner && source && query && (
        <OwnerEditor
          source={source}
          sources={sources}
          query={query}
          existing={dataset}
          onClose={() => setOwner(false)}
          onPublish={async (d) => {
            await mutate("dataset", d);
            setDataset(d);
            cache.current.clear();
            setRetry((r) => r + 1);
            setNotice("Datasetを公開しました。ホームから開けます。");
          }}
        />
      )}
      {downloading && query && result && (
        <DownloadDialog
          query={query}
          result={result}
          datasetId={dataset?.id}
          fieldOverrides={fieldOverrides.filter((f) =>
            fields.some((field) => field.id === f.id),
          )}
          onClose={() => setDownloading(false)}
          onDone={setNotice}
        />
      )}
      {save && query && (
        <div className="overlay">
          <section
            className="dialog compact"
            role="dialog"
            aria-label="表示を保存"
          >
            <div className="dialog-title">
              <h2>現在の表示を保存</h2>
              <button aria-label="閉じる" onClick={() => setSave(false)}>
                ×
              </button>
            </div>
            <p className="muted">
              結合・項目名・説明・集計・条件・並び順を、自分用の定義として保存します。
            </p>
            <p className="muted">
              元データは保存せず、開くたびに現在の権限で読み込みます。個人テーブルの変更は保存した表示にも反映されます。
            </p>
            <input
              autoFocus
              aria-label="保存する表示名"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <div className="dialog-footer">
              <button onClick={() => setSave(false)}>キャンセル</button>
              <button
                className="primary"
                disabled={savingView || !saveName.trim()}
                onClick={() => {
                  setSavingView(true);
                  void mutate("saved", {
                    id: crypto.randomUUID(),
                    name: saveName,
                    query,
                    datasetId: dataset?.id,
                    fieldOverrides: fieldOverrides.filter((f) =>
                      fields.some((available) => available.id === f.id),
                    ),
                  })
                    .then(() => {
                      setSave(false);
                      setNotice("表示を保存しました。ホームから再び開けます。");
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setSavingView(false));
                }}
              >
                {savingView ? "保存中…" : "保存する"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
