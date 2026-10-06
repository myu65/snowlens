"use client";
import { useRef, useState, useEffect } from "react";
import { useDraftWarning } from "./ledger-ui";
import type {
  PersonalTable,
  PersonalJoin,
  QueryableSource,
  Query,
} from "@/lib/model";
import { personalFields } from "@/lib/personal";
import { validateJoin } from "@/lib/personal-join";
export function queryForJoin(
  query: Query,
  source: QueryableSource,
  table: PersonalTable,
  join: PersonalJoin,
): Query {
  const allowed = new Set(
    [...source.fields, ...personalFields(table)].map((f) => f.id),
  );
  const dimensions = query.dimensions.filter((id) => allowed.has(id));
  const metrics = query.metrics.filter((m) => allowed.has(m.field));
  return {
    ...query,
    detail: query.detail || (!dimensions.length && !metrics.length),
    join,
    dimensions,
    metrics,
    filters: query.filters.filter((f) => allowed.has(f.field)),
    sort: [],
    offset: 0,
  };
}
export default function JoinBuilder({
  source,
  query,
  tables,
  datasetId,
  initialTableId,
  onApply,
  onCreate,
  onClose,
}: {
  source: QueryableSource;
  query: Query;
  tables: (PersonalTable & { rowCount?: number })[];
  datasetId?: string;
  initialTableId?: string;
  onApply: (q: Query) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const current =
    query.join && "tableId" in query.join ? query.join : undefined;
  const [tableId, setTableId] = useState(
    initialTableId || current?.tableId || tables[0]?.id || "",
  );
  const table = tables.find((t) => t.id === tableId);
  const [sourceField, setSourceField] = useState(
    current?.sourceField || source.fields[0]?.id || "",
  );
  const [tableField, setTableField] = useState(
    current?.tableField || table?.columns[0]?.id || "",
  );
  const [type, setType] = useState<PersonalJoin["type"]>(
    current?.type || "left",
  );
  const [preview, setPreview] = useState<{
    totalRows: number;
    matchedRows: number;
    unmatchedRows: number;
    personalRows: number;
    signature: string;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const join = { tableId, sourceField, tableField, type };
  const signature = JSON.stringify([join, table?.version, query.filters]);
  const [baseline] = useState(signature);
  const dirty = signature !== baseline;
  const clearWarning = useDraftWarning(dirty);
  function close() {
    if (dirty && !window.confirm("未反映の結合を破棄して閉じますか？")) return;
    clearWarning();
    onClose();
  }
  async function check() {
    if (!table) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    try {
      const { id, name, columns, rows, version } = table;
      validateJoin(source, join, { id, name, columns, rows, version });
      const next = queryForJoin(query, source, table, join);
      const response = await fetch("/api/join-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: next, datasetId }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
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
  return (
    <div className="overlay">
      <section
        className="dialog owner fixed-dialog join-builder"
        role="dialog"
        aria-modal="true"
        aria-label="個人テーブルを結合"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <div className="dialog-title">
          <div>
            <span className="eyebrow">JOIN</span>
            <h2>個人テーブルを結合</h2>
          </div>
          <button aria-label="結合を閉じる" onClick={close}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="muted">
            共通の項目を選んで、個人テーブルの列を元データに追加します。
          </p>
          <label>
            個人テーブル
            <select
              aria-label="結合する個人テーブル"
              value={tableId}
              onChange={(e) => {
                setTableId(e.target.value);
                setTableField(
                  tables.find((t) => t.id === e.target.value)?.columns[0]?.id ||
                    "",
                );
              }}
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.rowCount ?? t.rows.length}行
                </option>
              ))}
            </select>
          </label>
          <button onClick={onCreate}>＋ 個人テーブルを作る</button>
          {table && (
            <>
              <div className="join-design">
                <div className="join-box">
                  <h3>{source.label || source.name}</h3>
                  <small>元データ</small>
                  <select
                    size={7}
                    aria-label="元データの結合キー"
                    value={sourceField}
                    onChange={(e) => setSourceField(e.target.value)}
                  >
                    {source.fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label} · {f.type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="join-line">
                  <span>多 → 1</span>
                  <svg viewBox="0 0 100 20" aria-hidden="true">
                    <path
                      d="M0 10H90M80 3L90 10L80 17"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                  <small>キーで結合</small>
                </div>
                <div className="join-box">
                  <h3>{table.name}</h3>
                  <small>自分の個人テーブル</small>
                  <select
                    size={7}
                    aria-label="個人テーブルの結合キー"
                    value={tableField}
                    onChange={(e) => setTableField(e.target.value)}
                  >
                    {table.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} · {c.type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="join-condition">
                {source.fields.find((f) => f.id === sourceField)?.label} ={" "}
                {table.columns.find((c) => c.id === tableField)?.label}
              </p>
              <div className="join-types">
                <label>
                  <input
                    type="radio"
                    name="join-type"
                    checked={type === "left"}
                    onChange={() => setType("left")}
                  />
                  元データをすべて残す <small>一致しない行の追加列は空欄</small>
                </label>
                <label>
                  <input
                    type="radio"
                    name="join-type"
                    checked={type === "inner"}
                    onChange={() => setType("inner")}
                  />
                  一致する行だけ見る
                </label>
              </div>
              <p className="muted">
                個人テーブルのキーは重複や空欄がない値を選びます。
                文字列のキーは、大文字・小文字・空白を区別します。
              </p>
              <button disabled={busy} onClick={() => void check()}>
                {busy ? "確認中…" : "結合を確認"}
              </button>
              {preview?.signature === signature && (
                <div className="join-stats" role="status">
                  <span>対象 {preview.totalRows.toLocaleString()}行</span>
                  <strong>一致 {preview.matchedRows.toLocaleString()}行</strong>
                  <span>未一致 {preview.unmatchedRows.toLocaleString()}行</span>
                  <strong>
                    結合後{" "}
                    {(type === "left"
                      ? preview.totalRows
                      : preview.matchedRows
                    ).toLocaleString()}
                    行
                  </strong>
                </div>
              )}
              <p className="muted">
                件数は現在の検索条件と、確認時点で見られる元データで計算します。
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
            disabled={!table || busy || preview?.signature !== signature}
            onClick={() => {
              clearWarning();
              onApply(queryForJoin(query, source, table!, join));
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
