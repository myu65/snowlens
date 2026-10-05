"use client";
import { useRef, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Result, Value, Query } from "@/lib/model";
export default function Grid({
  result,
  label,
  onSort,
  onCell,
  sort,
  busy,
  readOnly = false,
  selectableColumns = [],
  selectedColumns = [],
  onSelectColumn,
  onDragColumn,
  dimensions = [],
  sortableColumns,
}: {
  result: Result;
  label: (id: string) => string;
  onSort: (id: string) => void;
  onCell: (row: Record<string, Value>, column: string) => void;
  sort: Query["sort"];
  busy: boolean;
  readOnly?: boolean;
  selectableColumns?: string[];
  selectedColumns?: string[];
  onSelectColumn?: (id: string) => void;
  onDragColumn?: (event: DragEvent<HTMLElement>, id: string) => void;
  dimensions?: string[];
  sortableColumns?: string[];
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
              className={selectedColumns.includes(c) ? "column-selected" : ""}
              aria-sort={
                sort[0]?.field === c
                  ? sort[0].direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              {selectableColumns.includes(c) && onSelectColumn && (
                <input
                  type="checkbox"
                  aria-label={`${label(c)}の列を選択`}
                  checked={selectedColumns.includes(c)}
                  onChange={() => onSelectColumn(c)}
                />
              )}
              <button
                disabled={
                  readOnly ||
                  (!!sortableColumns && !sortableColumns.includes(c))
                }
                draggable={!readOnly && selectableColumns.includes(c)}
                onDragStart={(e) => onDragColumn?.(e, c)}
                title={
                  selectableColumns.includes(c)
                    ? "行・値へドラッグして追加"
                    : undefined
                }
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
            const level = result.rowLevels?.[v.index] ?? dimensions.length;
            const subtotal = level < dimensions.length;
            return (
              <div
                role="row"
                aria-rowindex={v.index + 2}
                key={v.key}
                className={"grid-row" + (subtotal ? " subtotal-row" : "")}
                aria-label={
                  subtotal
                    ? `${String(row[dimensions[level - 1]] ?? "空欄")} 小計`
                    : undefined
                }
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
                      disabled={busy || readOnly || subtotal}
                      className={typeof row[c] === "number" ? "numeric" : ""}
                      onClick={() => onCell(row, c)}
                      title={
                        readOnly || subtotal
                          ? undefined
                          : "クリックして絞り込み・掘り下げ"
                      }
                    >
                      {subtotal && c === dimensions[level] ? (
                        "小計"
                      ) : row[c] === null ? (
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
