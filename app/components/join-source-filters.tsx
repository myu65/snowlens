"use client";
import {
  initialQuery,
  isNumeric,
  type Filter,
  type QueryableSource,
} from "@/lib/model";
import FilterValue from "./filter-value";

const operators: [Filter["operator"], string][] = [
  ["eq", "等しい"],
  ["neq", "以外"],
  ["gt", "より大きい"],
  ["gte", "以上"],
  ["lt", "より小さい"],
  ["lte", "以下"],
  ["contains", "含む"],
  ["is_null", "空欄"],
  ["not_null", "空欄でない"],
];
export default function JoinSourceFilters({
  source,
  side,
  filters,
  datasetId,
  onChange,
}: {
  source: QueryableSource;
  side: "元データ" | "結合先";
  filters: Filter[];
  datasetId?: string;
  onChange: (filters: Filter[]) => void;
}) {
  const query = { ...initialQuery(source), filters };
  const labelPrefix = `${side}の条件`;
  const patch = (index: number, change: Partial<Filter>) =>
    onChange(
      filters.map((filter, i) =>
        i === index ? { ...filter, ...change } : filter,
      ),
    );
  const initialValue = (id: string) => {
    const field = source.fields.find((f) => f.id === id);
    return field?.type === "BOOLEAN"
      ? true
      : field && isNumeric(field)
        ? 0
        : "";
  };
  return (
    <details className="join-source-filters" open={filters.length > 0}>
      <summary>
        {side}の対象を絞る
        {filters.length > 0 ? `（${filters.length}件）` : "（任意）"}
      </summary>
      <p className="muted">
        結合する前に適用します。条件はすべて満たす行が対象です。
      </p>
      {filters.map((filter, i) => {
        const field = source.fields.find((f) => f.id === filter.field);
        return (
          <div className="join-filter-row" key={i}>
            <select
              aria-label={`${labelPrefix}${i + 1}の項目`}
              value={filter.field}
              onChange={(e) =>
                patch(i, {
                  field: e.target.value,
                  operator: "eq",
                  value: initialValue(e.target.value),
                })
              }
            >
              {source.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              aria-label={`${labelPrefix}${i + 1}の比較`}
              value={filter.operator}
              onChange={(e) =>
                patch(i, { operator: e.target.value as Filter["operator"] })
              }
            >
              {operators
                .filter(
                  ([op]) =>
                    op !== "contains" ||
                    /CHAR|TEXT|STRING/.test(field?.type || ""),
                )
                .map(([op, label]) => (
                  <option key={op} value={op}>
                    {label}
                  </option>
                ))}
            </select>
            {filter.operator === "is_null" || filter.operator === "not_null" ? (
              <span />
            ) : (
              <FilterValue
                field={field}
                query={query}
                index={i}
                datasetId={datasetId}
                labelPrefix={labelPrefix}
                onChange={(value) => patch(i, { value })}
              />
            )}
            <button
              aria-label={`${labelPrefix}${i + 1}を削除`}
              onClick={() => onChange(filters.filter((_, j) => i !== j))}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        disabled={filters.length >= 30 || !source.fields.length}
        onClick={() => {
          const field = source.fields[0].id;
          onChange([
            ...filters,
            { field, operator: "eq", value: initialValue(field) },
          ]);
        }}
      >
        {side}の条件を追加
      </button>
    </details>
  );
}
