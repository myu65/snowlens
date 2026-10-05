"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  type QueryableSource,
  type Query,
  type Result,
  type AppState,
  type Dataset,
  type Field,
  type Value,
  type SavedView,
  initialQuery,
  metricKey,
  isNumeric,
  aggregations,
  operators,
} from "@/lib/model";
import { recommendedQuery } from "@/lib/mock";
import Grid from "./components/grid";
import FilterValue from "./components/filter-value";
import FieldPicker from "./components/field-picker";
import OwnerEditor from "./components/owner-editor";
type Picker = "dimension" | "metric" | "filter" | "drill";
const emptyState: AppState = {
  datasets: [],
  saved: [],
  favorites: [],
  recent: [],
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
    [owner, setOwner] = useState(false),
    [save, setSave] = useState(false),
    [saveName, setSaveName] = useState(""),
    [cell, setCell] = useState<{
      row: Record<string, Value>;
      column: string;
    }>(),
    [history, setHistory] = useState<Query[]>([]),
    [intro, setIntro] = useState(false),
    [retry, setRetry] = useState(0),
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
  useEffect(() => {
    if (!query) return;
    const id = ++requestId.current,
      controller = new AbortController();
    const key = JSON.stringify([query, dataset?.id]);
    const cached = cache.current.get(key);
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
          cache.current.set(key, data);
          if (cache.current.size > 30)
            cache.current.delete(cache.current.keys().next().value!);
          setResult(data);
        }
      } catch (e) {
        if (!controller.signal.aborted && requestId.current === id)
          setError((e as Error).message);
      } finally {
        if (requestId.current === id) setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, dataset?.id, retry]);
  async function open(s: QueryableSource, d?: Dataset, saved?: SavedView) {
    const id = ++openId.current;
    setOpening(true);
    setError("");
    setNotice("");
    setCell(undefined);
    try {
      const full = await api<QueryableSource>(
        "/api/catalog?source=" + encodeURIComponent(s.id),
      );
      if (id !== openId.current) return;
      window.scrollTo(0, 0);
      setSource(full);
      setDataset(d);
      setQuery(saved?.query || d?.defaultView || initialQuery(full));
      setResult(undefined);
      setHistory([]);
      setIntro(!d && !saved);
      setSide(!!d || !!saved);
      void mutate("recent", s.id).catch((e) => setNotice(e.message));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id === openId.current) setOpening(false);
    }
  }
  function home() {
    window.scrollTo(0, 0);
    openId.current++;
    setSource(undefined);
    setQuery(undefined);
    setDataset(undefined);
    setError("");
    setNotice("");
    setOpening(false);
  }
  function change(patch: Partial<Query>, remember = false) {
    if (!query) return;
    setBusy(true);
    if (remember) setHistory((h) => [...h, query]);
    if (patch.dimensions || patch.metrics || patch.detail !== undefined)
      setIntro(false);
    setQuery({ ...query, ...patch, offset: patch.offset ?? 0 });
    setCell(undefined);
  }
  const fields =
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
  const label = (id: string) => {
    const metric = query?.metrics.find((m) => metricKey(m) === id);
    const field = fields.find((f) => f.id === (metric?.field || id));
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
  function choose(f: Field) {
    if (!query) return;
    setRecentFields((r) =>
      [f.id, ...r.filter((id) => id !== f.id)].slice(0, 12),
    );
    if (picker === "dimension") {
      change({
        detail: false,
        dimensions: [...new Set([...query.dimensions, f.id])],
        sort: [],
      });
    } else if (picker === "metric") {
      const aggregation =
        f.semantic === "metric" ? "SEMANTIC" : isNumeric(f) ? "SUM" : "COUNT";
      change({
        detail: false,
        metrics: [
          ...query.metrics.filter(
            (m) => !(m.field === f.id && m.aggregation === aggregation),
          ),
          { field: f.id, aggregation },
        ],
        sort: [],
      });
    } else if (picker === "filter") {
      change({
        filters: [
          ...query.filters,
          {
            field: f.id,
            operator: "eq",
            value: isNumeric(f) ? 0 : /DATE/.test(f.type) ? "2026-10-01" : "",
          },
        ],
      });
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
  async function csv() {
    if (!query) return;
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, datasetId: dataset?.id, csv: true }),
      });
      if (!response.ok) throw Error("CSVを出力できません");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "snowlens.csv";
      a.click();
      URL.revokeObjectURL(url);
      setNotice("現在のページをCSVに出力しました。");
    } catch (e) {
      setError((e as Error).message);
    }
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
                      if (s) void open(s, d);
                      else
                        setError("このDatasetの元データにアクセスできません。");
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
                      if (s) void open(s, d, v);
                    }}
                  >
                    ☆ {v.name}
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
                <span>{filtered.length} sources</span>
              </div>
              {opening ? (
                <div className="empty">データ一覧を読み込み中…</div>
              ) : !filtered.length ? (
                <div className="empty">
                  データが見つかりません。検索条件を変更してください。
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
              <button className="primary" onClick={() => setOwner(true)}>
                {dataset ? "Datasetを編集" : "Datasetとして公開"}
              </button>
            </div>
          </div>
          {query && (
            <>
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
                  <p className="muted">行でまとめて、値を集計します。</p>
                  <div className="settings-section">
                    <h3>
                      行 <span>グループ化</span>
                    </h3>
                    {query.dimensions.map((id) => (
                      <div className="selection" key={id}>
                        <span>{label(id)}</span>
                        <button
                          aria-label={`${label(id)}を行から削除`}
                          onClick={() =>
                            change({
                              dimensions: query.dimensions.filter(
                                (d) => d !== id,
                              ),
                              sort: [],
                            })
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
                  <div className="settings-section">
                    <h3>
                      値 <span>集計</span>
                    </h3>
                    {query.metrics.map((m, i) => (
                      <div className="metric-selection" key={i}>
                        <div>
                          <span>{label(m.field)}</span>
                          <button
                            aria-label={`${label(m.field)}を値から削除`}
                            onClick={() =>
                              change({
                                metrics: query.metrics.filter(
                                  (_, j) => j !== i,
                                ),
                                sort: [],
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                        <select
                          aria-label={`${label(m.field)}の集計方法`}
                          value={m.aggregation}
                          onChange={(e) =>
                            change({
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
                            })
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
                  </div>
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
                        onClick={() => void csv()}
                      >
                        ↓ CSV
                      </button>
                    </div>
                  </div>
                  {result ? (
                    <Grid
                      result={result}
                      label={label}
                      sort={query.sort}
                      busy={busy}
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
                  <div className="result-footer">
                    <span>セルをクリックして、絞り込み・掘り下げ・明細へ</span>
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
          onChoose={choose}
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
                change({ detail: true, filters: cellFilter(), sort: [] }, true)
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
      {owner && source && query && (
        <OwnerEditor
          source={source}
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
            <p className="muted">行・集計方法・条件・並べ替えを保存します。</p>
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
                disabled={!saveName.trim()}
                onClick={() =>
                  void mutate("saved", {
                    id: crypto.randomUUID(),
                    name: saveName,
                    query,
                    datasetId: dataset?.id,
                  })
                    .then(() => {
                      setSave(false);
                      setNotice("表示を保存しました。ホームから再び開けます。");
                    })
                    .catch((e) => setError(e.message))
                }
              >
                保存する
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
