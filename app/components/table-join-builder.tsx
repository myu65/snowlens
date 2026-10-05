"use client";
import { useEffect, useRef, useState } from "react";
import type { Query, QueryableSource, RelationJoin } from "@/lib/model";
import { relationJoinedSource, type JoinCounts } from "@/lib/relation-join";
import JoinDiagram from "./join-diagram";
import CatalogBrowser from "./catalog-browser";

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
  const [sourceField, setSourceField] = useState(
    current?.sourceField || source.fields[0]?.id || "",
  );
  const [rightField, setRightField] = useState(
    current?.rightField || initialRight?.fields[0]?.id || "",
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
    sourceField,
    rightField,
    type,
  };
  const signature = JSON.stringify(join);
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
      setRight(data);
      const shared = source.fields.find((left) =>
        data.fields.some((f: { id: string }) => f.id === left.id),
      );
      if (shared) {
        setSourceField(shared.id);
        setRightField(shared.id);
      } else setRightField(data.fields[0]?.id || "");
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
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="dialog-title">
          <h2>テーブル同士を結合</h2>
          <button aria-label="テーブル結合を閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="muted">
            結合先を選び、キーと結合後の行数を確認します。
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
                leftKey={sourceField}
                rightKey={rightField}
                onKeys={(l, r) => {
                  setSourceField(l);
                  setRightField(r);
                }}
                leftRows={checked?.leftRows}
                rightRows={checked?.rightRows}
              />
              <p className="muted">
                ノード内の項目を選ぶと、結合するキーを変えられます。
                文字列のキーは、大文字・小文字・空白を区別します。
              </p>
              <div className="join-types">
                <label>
                  <input
                    type="radio"
                    name="table-join-type"
                    checked={type === "left"}
                    onChange={() => setType("left")}
                  />
                  元データをすべて残す
                </label>
                <label>
                  <input
                    type="radio"
                    name="table-join-type"
                    checked={type === "inner"}
                    onChange={() => setType("inner")}
                  />
                  一致する行だけ見る
                </label>
              </div>
              <button disabled={busy || loading} onClick={() => void check()}>
                {busy ? "確認中…" : "結合を確認"}
              </button>
              {checked && (
                <>
                  <div className="join-stats" role="status">
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
                      ? `結合先で${checked.duplicateKeys.toLocaleString()}種類のキーが重複しています。行数と集計値が増えるため、重複がないキーやViewを選んでください。`
                      : "結合先のキーは重複していません。元データ1行に追加する行は最大1行です。"}
                  </p>
                  {checked.nullKeys > 0 && (
                    <p className="muted">
                      結合先の空欄キー {checked.nullKeys.toLocaleString()}
                      行は一致しません。
                    </p>
                  )}
                </>
              )}
              <p className="muted">
                件数は検索条件を適用する前のデータで計算します。現在の権限と確認時点の値が対象です。
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
          <button onClick={onClose}>キャンセル</button>
          <button
            className="primary"
            disabled={
              !right || busy || loading || !checked || checked.duplicateKeys > 0
            }
            onClick={() => {
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
