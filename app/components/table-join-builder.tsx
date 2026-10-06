"use client";
import { useEffect, useRef, useState } from "react";
import { useDraftWarning } from "./ledger-ui";
import {
  maxJoinKeys,
  type Filter,
  type Query,
  type QueryableSource,
  type RelationJoin,
  type RelationKeyPair,
} from "@/lib/model";
import {
  relationJoinKeys,
  relationJoinedSource,
  type JoinCounts,
} from "@/lib/relation-join";
import JoinDiagram from "./join-diagram";
import CatalogBrowser from "./catalog-browser";
import JoinSourceFilters from "./join-source-filters";

export function queryForRelationJoin(
  query: Query,
  source: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
): Query {
  const fields = new Set(
    relationJoinedSource(source, right, join).fields.map((f) => f.id),
  );
  const dimensions = query.dimensions.filter((id) => fields.has(id)),
    metrics = query.metrics.filter((m) => fields.has(m.field));
  return {
    ...query,
    join,
    dimensions,
    metrics,
    filters: query.filters.filter((f) => fields.has(f.field)),
    detail: query.detail || (!dimensions.length && !metrics.length),
    sort: [],
    offset: 0,
  };
}
export default function TableJoinBuilder({
  source,
  query,
  sources,
  initialRight,
  datasetId,
  onApply,
  onClose,
}: {
  source: QueryableSource;
  query: Query;
  sources: QueryableSource[];
  initialRight?: QueryableSource;
  datasetId?: string;
  onApply: (query: Query, right: QueryableSource) => void;
  onClose: () => void;
}) {
  const current =
    query.join && "rightSource" in query.join ? query.join : undefined;
  const [right, setRight] = useState(initialRight);
  const [keys, setKeys] = useState<RelationKeyPair[]>(
    current
      ? relationJoinKeys(current)
      : [
          {
            sourceField: source.fields[0]?.id || "",
            rightField: initialRight?.fields[0]?.id || "",
          },
        ],
  );
  const [activeKey, setActiveKey] = useState(0);
  const [leftFilters, setLeftFilters] = useState<Filter[]>(
    current?.leftFilters || [],
  );
  const [rightFilters, setRightFilters] = useState<Filter[]>(
    current?.rightFilters || [],
  );
  const [type, setType] = useState<RelationJoin["type"]>(
    current?.type || "left",
  );
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<JoinCounts & { signature: string }>();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const join: RelationJoin = {
    rightSource: right?.id || "",
    keys,
    type,
    ...(leftFilters.length ? { leftFilters } : {}),
    ...(rightFilters.length ? { rightFilters } : {}),
  };
  const signature = JSON.stringify(join);
  const [baseline] = useState(signature);
  const dirty = signature !== baseline;
  const clearWarning = useDraftWarning(dirty);
  function close() {
    if (dirty && !window.confirm("未反映の結合を破棄して閉じますか？")) return;
    clearWarning();
    onClose();
  }
  function invalidate() {
    abort.current?.abort();
    setBusy(false);
    setLoading(false);
    setPreview(undefined);
    setError("");
  }
  function updateKeys(next: RelationKeyPair[]) {
    invalidate();
    setKeys(next);
  }
  async function select(s: QueryableSource) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setBusy(false);
    setPreview(undefined);
    setError("");
    try {
      const res = await fetch(
        "/api/catalog?source=" + encodeURIComponent(s.id),
        { signal: controller.signal, cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      if (controller.signal.aborted) return;
      setRight(data);
      setRightFilters([]);
      setActiveKey(0);
      const shared = source.fields.find((left) =>
        data.fields.some((f: { id: string }) => f.id === left.id),
      );
      setKeys([
        {
          sourceField: shared?.id || source.fields[0]?.id || "",
          rightField: shared?.id || data.fields[0]?.id || "",
        },
      ]);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function check() {
    if (!right) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setPreview(undefined);
    setError("");
    try {
      const next = queryForRelationJoin(query, source, right, join);
      const res = await fetch("/api/join-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: next, datasetId }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      if (!controller.signal.aborted) setPreview({ ...data, signature });
    } catch (e) {
      if (!controller.signal.aborted) {
        setPreview(undefined);
        setError((e as Error).message);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const checked = preview?.signature === signature ? preview : undefined;
  return (
    <div className="overlay">
      <section
        className="dialog owner fixed-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="テーブル同士を結合"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <div className="dialog-title">
          <h2>テーブル同士を結合</h2>
          <button aria-label="テーブル結合を閉じる" onClick={close}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="muted">
            表ごとに対象を絞り、キーをつないで結合後の行数を確認します。
          </p>
          <details open={!right}>
            <summary>結合先を選ぶ {loading && "読み込み中…"}</summary>
            {sources.length ? (
              <div className="join-source-list">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    disabled={s.kind === "semantic_view"}
                    title={
                      s.kind === "semantic_view"
                        ? "セマンティック指標の結合には粒度の定義が必要です"
                        : undefined
                    }
                    onClick={() => void select(s)}
                  >
                    {s.database}.{s.schema}.{s.name}
                    <small>
                      {s.kind} · {s.description}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <CatalogBrowser onOpen={(s) => void select(s)} />
            )}
          </details>
          {right && (
            <>
              <JoinDiagram
                left={source}
                right={right}
                keys={keys}
                activeKey={activeKey}
                onActiveKey={setActiveKey}
                onKeys={(l, r) => {
                  updateKeys(
                    keys.map((key, i) =>
                      i === activeKey ? { sourceField: l, rightField: r } : key,
                    ),
                  );
                }}
                leftRows={checked?.leftRows}
                rightRows={checked?.rightRows}
              />
              <p className="muted">
                キーを選んでからノード内の項目を押すと、そのキーを変えられます。
                文字列のキーは、大文字・小文字・空白を区別します。
              </p>
              <div className="join-key-pairs" aria-label="結合キーの組み合わせ">
                {keys.map((key, i) => (
                  <div
                    className={`join-key-pair ${i === activeKey ? "active" : ""}`}
                    key={i}
                  >
                    <button
                      aria-label={`キー${i + 1}を編集`}
                      aria-pressed={i === activeKey}
                      onClick={() => setActiveKey(i)}
                    >
                      {i + 1}
                    </button>
                    <label>
                      元データ
                      <select
                        aria-label={`キー${i + 1}の元データの項目`}
                        value={key.sourceField}
                        disabled={loading}
                        onFocus={() => setActiveKey(i)}
                        onChange={(e) =>
                          updateKeys(
                            keys.map((k, j) =>
                              j === i
                                ? { ...k, sourceField: e.target.value }
                                : k,
                            ),
                          )
                        }
                      >
                        <option value="">選んでください</option>
                        {source.fields.map((f) => (
                          <option
                            key={f.id}
                            value={f.id}
                            disabled={keys.some(
                              (k, j) => j !== i && k.sourceField === f.id,
                            )}
                          >
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="join-key-equals">＝</span>
                    <label>
                      結合先
                      <select
                        aria-label={`キー${i + 1}の結合先の項目`}
                        value={key.rightField}
                        disabled={loading}
                        onFocus={() => setActiveKey(i)}
                        onChange={(e) =>
                          updateKeys(
                            keys.map((k, j) =>
                              j === i
                                ? { ...k, rightField: e.target.value }
                                : k,
                            ),
                          )
                        }
                      >
                        <option value="">選んでください</option>
                        {right.fields.map((f) => (
                          <option
                            key={f.id}
                            value={f.id}
                            disabled={keys.some(
                              (k, j) => j !== i && k.rightField === f.id,
                            )}
                          >
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      aria-label={`キー${i + 1}を削除`}
                      disabled={keys.length === 1 || loading}
                      onClick={() => {
                        updateKeys(keys.filter((_, j) => j !== i));
                        setActiveKey(0);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  disabled={keys.length >= maxJoinKeys || loading}
                  onClick={() => {
                    updateKeys([...keys, { sourceField: "", rightField: "" }]);
                    setActiveKey(keys.length);
                  }}
                >
                  ＋ キーを追加
                </button>
                {keys.length > 1 && (
                  <p className="muted">
                    すべてのキーが一致する行を結合します。
                  </p>
                )}
              </div>
              <div className="join-input-filters">
                <JoinSourceFilters
                  source={source}
                  side="元データ"
                  filters={leftFilters}
                  datasetId={datasetId}
                  onChange={(next) => {
                    invalidate();
                    setLeftFilters(next);
                  }}
                />
                <JoinSourceFilters
                  source={right}
                  side="結合先"
                  filters={rightFilters}
                  onChange={(next) => {
                    invalidate();
                    setRightFilters(next);
                  }}
                />
              </div>
              <div className="join-types">
                <label>
                  <input
                    type="radio"
                    name="table-join-type"
                    checked={type === "left"}
                    onChange={() => {
                      invalidate();
                      setType("left");
                    }}
                  />
                  元データをすべて残す
                </label>
                <label>
                  <input
                    type="radio"
                    name="table-join-type"
                    checked={type === "inner"}
                    onChange={() => {
                      invalidate();
                      setType("inner");
                    }}
                  />
                  一致する行だけ見る
                </label>
              </div>
              <button
                disabled={
                  busy ||
                  loading ||
                  keys.some((key) => !key.sourceField || !key.rightField)
                }
                onClick={() => void check()}
              >
                {busy ? "確認中…" : "結合を確認"}
              </button>
              {checked && (
                <>
                  <div
                    className="join-stats"
                    role="status"
                    aria-label="結合の確認結果"
                  >
                    <span>元データ {checked.leftRows.toLocaleString()}行</span>
                    <span>結合先 {checked.rightRows.toLocaleString()}行</span>
                    <span>一致 {checked.matchedRows.toLocaleString()}行</span>
                    <span>
                      未一致 {checked.unmatchedRows.toLocaleString()}行
                    </span>
                    <strong>
                      結合後{" "}
                      {(type === "left"
                        ? checked.leftResultRows
                        : checked.innerResultRows
                      ).toLocaleString()}
                      行
                    </strong>
                  </div>
                  <p className={checked.duplicateKeys ? "error" : "muted"}>
                    {checked.duplicateKeys
                      ? `結合先で${checked.duplicateKeys.toLocaleString()}種類の${keys.length > 1 ? "キーの組み合わせ" : "キー"}が重複しています。行数と集計値が増えるため、キーを追加するか、結合先の対象を絞ってください。`
                      : "結合先のキーの組み合わせは重複していません。元データ1行に追加する行は最大1行です。"}
                  </p>
                  {checked.nullKeys > 0 && (
                    <p className="muted">
                      結合先でキーに空欄を含む
                      {checked.nullKeys.toLocaleString()}行は一致しません。
                    </p>
                  )}
                </>
              )}
              <p className="muted">
                件数は各テーブルの対象条件を適用して計算します。結合後の検索条件は含みません。現在の権限と確認時点の値が対象です。
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button onClick={close}>キャンセル</button>
          <button
            className="primary"
            disabled={
              !right || busy || loading || !checked || checked.duplicateKeys > 0
            }
            onClick={() => {
              clearWarning();
              onApply(
                queryForRelationJoin(query, source, right!, join),
                right!,
              );
              onClose();
            }}
          >
            この結合で見る
          </button>
        </div>
      </section>
    </div>
  );
}
