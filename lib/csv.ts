import type { Result } from "./model";
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
