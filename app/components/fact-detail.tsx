"use client";
import { useEffect, useState } from "react";
import type { Query, QueryableSource, Result } from "@/lib/model";
import Grid from "./grid";
export default function FactDetail({
  query,
  datasetId,
  onClose,
}: {
  query: Query;
  datasetId: string;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{
    source: QueryableSource;
    result: Result;
  }>();
  const [error, setError] = useState("");
  const [loadedOffset, setLoadedOffset] = useState<number>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/fact-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { ...query, offset }, datasetId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const next = await response.json();
        if (!response.ok) throw Error(next.error);
        if (!controller.signal.aborted) {
          setData(next);
          setError("");
          setLoadedOffset(offset);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoadedOffset(offset);
        }
      });
    return () => controller.abort();
  }, [query, datasetId, offset, retry]);
  const busy = loadedOffset !== offset;
  return (
    <div className="overlay">
      <section
        className="dialog owner fact-detail"
        role="dialog"
        aria-modal="true"
        aria-label="元データの明細"
      >
        <div className="dialog-title">
          <h2>この数字の元データ</h2>
          <button onClick={onClose} aria-label="明細を閉じる">
            ×
          </button>
        </div>
        <p className="muted">
          集計表を残したまま、選んだ行と検索条件に対応する明細を表示します。
        </p>
        {data && (
          <>
            <p>
              {data.source.database} / {data.source.schema} / {data.source.name}
            </p>
            <Grid
              result={data.result}
              label={(id) =>
                data.source.fields.find((f) => f.id === id)?.label || id
              }
              sort={[]}
              readOnly
              busy={busy}
              onSort={() => {}}
              onCell={() => {}}
            />
          </>
        )}
        {busy && <p role="status">明細を取得中…</p>}
        {error && (
          <p role="alert">
            {error}
            <button
              onClick={() => {
                setLoadedOffset(undefined);
                setRetry((r) => r + 1);
              }}
            >
              再取得
            </button>
          </p>
        )}
        <div className="dialog-footer">
          <button
            disabled={busy || offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - query.limit))}
          >
            前のページ
          </button>
          <span>{Math.floor(offset / query.limit) + 1}</span>
          <button
            disabled={busy || !data?.result.hasMore}
            onClick={() => setOffset((n) => n + query.limit)}
          >
            次のページ
          </button>
          <button onClick={onClose}>集計表に戻る</button>
        </div>
      </section>
    </div>
  );
}
