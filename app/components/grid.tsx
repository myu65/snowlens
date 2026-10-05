"use client";
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Result, Value, Query } from "@/lib/model";
export default function Grid({
  result,
  label,
  onSort,
  onCell,
  sort,
  busy,
}: {
  result: Result;
  label: (id: string) => string;
  onSort: (id: string) => void;
  onCell: (row: Record<string, Value>, column: string) => void;
  sort: Query["sort"];
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // TanStack Virtual manages measurements outside React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 44,
    overscan: 8,
  });
  const width = 170;
  return (
    <div ref={ref} className="grid-scroll" aria-busy={busy}>
      <div
        role="table"
        aria-label="検索結果"
        aria-rowcount={result.rows.length + 1}
        style={{ minWidth: width * result.columns.length }}
      >
        <div
          role="row"
          className="grid-header"
          style={{
            gridTemplateColumns: `repeat(${result.columns.length}, minmax(${width}px, 1fr))`,
          }}
        >
          {result.columns.map((c) => (
            <div
              role="columnheader"
              key={c}
              aria-sort={
                sort[0]?.field === c
                  ? sort[0].direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button
                onClick={() => onSort(c)}
                aria-label={`${label(c)}で並べ替え`}
              >
                {label(c)}
                <span>
                  {sort[0]?.field === c
                    ? sort[0].direction === "asc"
                      ? "↑"
                      : "↓"
                    : "↕"}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div
          role="rowgroup"
          style={{ height: virtual.getTotalSize(), position: "relative" }}
        >
          {virtual.getVirtualItems().map((v) => {
            const row = result.rows[v.index];
            return (
              <div
                role="row"
                aria-rowindex={v.index + 2}
                key={v.key}
                className="grid-row"
                style={{
                  position: "absolute",
                  top: 0,
                  width: "100%",
                  height: v.size,
                  transform: `translateY(${v.start}px)`,
                  gridTemplateColumns: `repeat(${result.columns.length}, minmax(${width}px, 1fr))`,
                }}
              >
                {result.columns.map((c) => (
                  <div role="cell" key={c}>
                    <button
                      disabled={busy}
                      className={typeof row[c] === "number" ? "numeric" : ""}
                      onClick={() => onCell(row, c)}
                      title="クリックして絞り込み・掘り下げ"
                    >
                      {row[c] === null ? (
                        <span className="muted">—</span>
                      ) : typeof row[c] === "number" ? (
                        row[c].toLocaleString("ja-JP", {
                          maximumFractionDigits: 2,
                        })
                      ) : (
                        String(row[c])
                      )}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {!result.rows.length && (
        <div className="empty">
          <h3>条件に一致するデータがありません</h3>
          <p>条件を減らすか、別の値を指定してください。</p>
        </div>
      )}
    </div>
  );
}
