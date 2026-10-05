import type { Result } from "./model";
import { exportColumns, isSubtotal, type ExportContext } from "./export-model";

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (
    typeof value === "string" &&
    (/^[\u0000-\u0020]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function exportDataCsv(
  context: ExportContext,
  headers: "labels" | "ids" = "labels",
  includeSubtotals = false,
) {
  const columns = exportColumns(context);
  const kind = includeSubtotals && !!context.result.rowLevels;
  return (
    "\ufeff" +
    [
      [
        ...(kind ? ["行の種類"] : []),
        ...columns.map((c) => (headers === "ids" ? c.id : c.label)),
      ]
        .map(csvCell)
        .join(","),
      ...context.result.rows.flatMap((row, i) => {
        if (!includeSubtotals && isSubtotal(context, i)) return [];
        return [
          [
            ...(kind ? [isSubtotal(context, i) ? "小計" : "集計行"] : []),
            ...columns.map((c) => row[c.id]),
          ]
            .map(csvCell)
            .join(","),
        ];
      }),
    ].join("\r\n")
  );
}
export function exportCsv(result: Result): string {
  const cell = (v: unknown) => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      [...(result.rowLevels ? ["行の種類"] : []), ...result.columns]
        .map(cell)
        .join(","),
      ...result.rows.map((r, index) =>
        [
          ...(result.rowLevels
            ? [
                result.rowLevels[index] < (result.dimensionCount || 0)
                  ? "小計"
                  : "集計行",
              ]
            : []),
          ...result.columns.map((c) => r[c]),
        ]
          .map(cell)
          .join(","),
      ),
    ].join("\r\n")
  );
}
