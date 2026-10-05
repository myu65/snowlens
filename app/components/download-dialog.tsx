"use client";
import { useState } from "react";
import type { FieldOverride, Query, Result } from "@/lib/model";

export default function DownloadDialog({
  query,
  result,
  datasetId,
  fieldOverrides,
  onClose,
  onDone,
}: {
  query: Query;
  result: Result;
  datasetId?: string;
  fieldOverrides: FieldOverride[];
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [headers, setHeaders] = useState<"labels" | "ids">("labels");
  const [subtotals, setSubtotals] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          query,
          datasetId,
          fieldOverrides,
          format,
          headers,
          includeSubtotals: subtotals,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw Error(data.error || "ダウンロードできません。");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = match
        ? decodeURIComponent(match[1])
        : `snowlens.${format}`;
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onDone(
        `現在のページを${format === "xlsx" ? "Excel" : "CSV"}に出力しました。`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ダウンロードできません。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <section
        className="dialog fixed-dialog download-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-title"
      >
        <div className="dialog-title">
          <h2 id="download-title">ダウンロード</h2>
          <button
            aria-label="ダウンロードを閉じる"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="download-scope">
            現在のページ{" "}
            {result.rows.length
              ? `${query.offset + 1}〜${query.offset + result.rows.length}行目`
              : "0行"}
            {result.hasMore ? " · 次のページあり" : ""}
          </p>
          <fieldset className="download-formats">
            <legend>ファイル形式</legend>
            <label className={format === "xlsx" ? "active" : ""}>
              <input
                autoFocus
                type="radio"
                name="download-format"
                value="xlsx"
                checked={format === "xlsx"}
                disabled={busy}
                onChange={() => setFormat("xlsx")}
              />
              <span>
                <strong>Excel（.xlsx）</strong>
                <small>条件付きの表示と、フィルターを使えるデータの表。</small>
              </span>
            </label>
            <label className={format === "csv" ? "active" : ""}>
              <input
                type="radio"
                name="download-format"
                value="csv"
                checked={format === "csv"}
                disabled={busy}
                onChange={() => setFormat("csv")}
              />
              <span>
                <strong>CSV（.csv）</strong>
                <small>1行の見出しとデータ。他のツールへの取り込みに。</small>
              </span>
            </label>
          </fieldset>
          {format === "xlsx" ? (
            <div className="download-description">
              <p>
                「表示」シートの上部に検索条件・集計方法を記載し、画面と同じ順番で表を出します。総計は条件に合う全行の値です。
              </p>
              <p>
                「データ」シートは小計・総計を除いたExcelテーブルです。列見出しには項目の表示名を使います。
              </p>
            </div>
          ) : (
            <>
              <label>
                CSVの列見出し
                <select
                  aria-label="CSVの列見出し"
                  value={headers}
                  disabled={busy}
                  onChange={(e) =>
                    setHeaders(e.target.value as "labels" | "ids")
                  }
                >
                  <option value="labels">表示名</option>
                  <option value="ids">項目ID</option>
                </select>
              </label>
              {!!result.rowLevels && (
                <label className="download-checkbox">
                  <input
                    type="checkbox"
                    checked={subtotals}
                    disabled={busy}
                    onChange={(e) => setSubtotals(e.target.checked)}
                  />
                  小計を含める（行の種類を追加）
                </label>
              )}
              <p className="muted">
                総計と検索条件はExcelに含めます。CSVは数値や日付の型・表示形式を持ちません。
              </p>
            </>
          )}
          <p className="muted">出力時にデータを読み直します。</p>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button disabled={busy} onClick={onClose}>
            閉じる
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void download()}
          >
            {busy
              ? "出力中…"
              : `${format === "xlsx" ? "Excel" : "CSV"}をダウンロード`}
          </button>
        </div>
      </section>
    </div>
  );
}
