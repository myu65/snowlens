import ExcelJS from "exceljs";
import { metricKey, type Value } from "./model";
import {
  aggregationNames,
  exportColumns,
  exportConditions,
  exportJoinKeys,
  formatConditions,
  exportDataRows,
  exportScope,
  exportTitle,
  isSubtotal,
  type ExportColumn,
  type ExportContext,
} from "./export-model";

const teal = "176B63",
  pale = "E7F2EF",
  ink = "243B40",
  muted = "617579";
const numberFormat = "#,##0.##";

function cellValue(
  value: Value | undefined,
  column?: ExportColumn,
): ExcelJS.CellValue {
  if (typeof value === "string") {
    if (
      value.length > 32767 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value)
    )
      throw Error(
        "Excelに出力できない長さや文字を含むセルがあります。CSVで出力してください。",
      );
    if (
      column?.field?.type === "DATE" &&
      /^\d{4}-\d{2}-\d{2}(?:T00:00:00\.000Z)?$/.test(value)
    ) {
      const date = new Date(value.slice(0, 10) + "T00:00:00.000Z");
      if (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value.slice(0, 10)
      )
        return date;
    }
  }
  if (typeof value === "number" && !Number.isFinite(value))
    throw Error("Excelに出力できない数値があります。CSVで出力してください。");
  // Strings, including '=...' and numeric identifiers, are always literal cells.
  return value ?? null;
}
function span(
  sheet: ExcelJS.Worksheet,
  row: number,
  first: number,
  last: number,
  value: string,
) {
  if (first < last) sheet.mergeCells(row, first, row, last);
  const cell = sheet.getCell(row, first);
  cell.value = cellValue(value);
  cell.alignment = { vertical: "middle", wrapText: true };
  return cell;
}
function sheetBase(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: ExportColumn[],
) {
  const sheet = workbook.addWorksheet(name, {
    properties: { defaultRowHeight: 24, tabColor: { argb: teal } },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: columns.length > 5 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: columns.length > 12 ? 0 : 1,
      fitToHeight: 0,
    },
  });
  const count = Math.max(4, columns.length);
  for (let c = 1; c <= count; c++) sheet.getColumn(c).width = 24;
  sheet.getColumn(1).width = 30;
  return sheet;
}
function title(sheet: ExcelJS.Worksheet, text: string, count: number) {
  const cell = span(sheet, 1, 1, count, text);
  cell.font = {
    name: "Yu Gothic",
    size: 18,
    bold: true,
    color: { argb: teal },
  };
  const width = (30 + 24 * (count - 1)) * 0.7;
  const length = [...text].reduce(
    (n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1),
    0,
  );
  sheet.getRow(1).height = Math.max(36, 24 * Math.ceil(length / width));
}
function metadata(
  sheet: ExcelJS.Worksheet,
  row: number,
  label: string,
  value: string,
  count: number,
) {
  const width = sheet.getColumn(2).width! * (count - 1);
  const chunks: string[] = [];
  let chunk = "",
    weight = 0;
  for (const char of value) {
    const size = char === "\n" ? width : char.charCodeAt(0) > 255 ? 2 : 1;
    if (weight + size > width * 6 && chunk) {
      chunks.push(chunk);
      chunk = "";
      weight = 0;
    }
    chunk += char;
    weight += size;
  }
  chunks.push(chunk);
  for (const [index, text] of chunks.entries()) {
    const key = sheet.getCell(row, 1);
    key.value = index ? "続き" : label;
    key.font = {
      name: "Yu Gothic",
      size: 10,
      bold: true,
      color: { argb: muted },
    };
    key.alignment = { vertical: "middle", wrapText: true };
    const cell = span(sheet, row, 2, count, text);
    cell.font = { name: "Yu Gothic", size: 10, color: { argb: ink } };
    sheet.getRow(row).height = Math.max(
      24,
      16 *
        Math.ceil(
          [...text].reduce(
            (n, ch) =>
              n + (ch === "\n" ? width : ch.charCodeAt(0) > 255 ? 2 : 1),
            0,
          ) / width,
        ),
    );
    row++;
  }
  return row;
}
function header(
  sheet: ExcelJS.Worksheet,
  row: number,
  columns: ExportColumn[],
) {
  columns.forEach((column, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = cellValue(column.label);
    cell.font = {
      name: "Yu Gothic",
      size: 11,
      bold: true,
      color: { argb: "FFFFFF" },
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.getRow(row).height = Math.max(
    32,
    ...columns.map((c) => 16 * Math.ceil((c.label.length * 2) / 24)),
  );
}
function putRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  data: Record<string, Value>,
  columns: ExportColumn[],
  highlight = false,
) {
  columns.forEach((column, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = cellValue(data[column.id], column);
    cell.font = {
      name: "Yu Gothic",
      size: 11,
      bold: highlight,
      color: { argb: ink },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: typeof data[column.id] === "number" ? "right" : "left",
    };
    cell.numFmt =
      (column.metric && /COUNT/.test(column.metric.aggregation)) ||
      (typeof data[column.id] === "number" && Number.isInteger(data[column.id]))
        ? "#,##0"
        : column.field?.type === "DATE"
          ? "yyyy-mm-dd"
          : numberFormat;
    if (highlight || row % 2 === 0)
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: highlight ? pale : "F5F8F7" },
      };
  });
}

export async function exportExcel(context: ExportContext): Promise<Uint8Array> {
  const { query, result, source } = context;
  if (
    !result.columns.length ||
    result.columns.length > 16384 ||
    result.rows.length * result.columns.length > 500000
  )
    throw Error(
      "Excelの出力範囲が大きすぎます。項目やページの行数を減らしてください。",
    );
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SnowLens";
  workbook.created = context.exportedAt;
  workbook.modified = context.exportedAt;
  const columns = exportColumns(context),
    count = Math.max(4, columns.length);
  const label = (id: string) =>
    source.fields.find((f) => f.id === id)?.label || id;
  const report = sheetBase(workbook, "表示", columns);
  title(report, exportTitle(context), count);
  let row = 3;
  row = metadata(
    report,
    row,
    "元データ",
    `${source.database}.${source.schema}.${source.name}`,
    count,
  );
  row = metadata(
    report,
    row,
    "出力日時（UTC）",
    context.exportedAt
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, ""),
    count,
  );
  row = metadata(report, row, "出力範囲", exportScope(context), count);
  if (context.joinName) {
    row = metadata(
      report,
      row,
      "結合",
      `${context.joinName}${context.joinVersion ? `（個人テーブル・版${context.joinVersion}）` : ""}。${query.join?.type === "left" ? "元データをすべて残す" : "一致する行だけ"}`,
      count,
    );
    for (const key of exportJoinKeys(context))
      row = metadata(report, row, "結合キー（すべて一致）", key, count);
    if (query.join && "rightSource" in query.join) {
      for (const condition of formatConditions(
        query.join.leftFilters || [],
        source,
      ))
        row = metadata(
          report,
          row,
          "元データの対象条件（結合前）",
          condition,
          count,
        );
      for (const condition of formatConditions(
        query.join.rightFilters || [],
        context.joinSource || source,
      ))
        row = metadata(
          report,
          row,
          "結合先の対象条件（結合前）",
          condition,
          count,
        );
    }
  }
  row = metadata(report, row, "表示", query.detail ? "明細" : "集計", count);
  if (!query.detail) {
    row = metadata(
      report,
      row,
      "行項目",
      query.dimensions.map(label).join("、") || "なし",
      count,
    );
    for (const metric of query.metrics) {
      const column = columns.find((c) => c.id === metricKey(metric))!;
      row = metadata(
        report,
        row,
        "集計方法",
        `${column.label}：${aggregationNames[metric.aggregation]}${metric.aggregation === "COUNT_ROWS" ? "（元データの行数）" : ""}`,
        count,
      );
    }
  }
  const conditions = exportConditions(context);
  for (const condition of conditions.length ? conditions : ["指定なし"])
    row = metadata(report, row, "検索条件", condition, count);
  row = metadata(
    report,
    row,
    "並び順",
    query.sort
      .map(
        (s) =>
          `${columns.find((c) => c.id === s.field)?.label || label(s.field)} ${s.direction === "asc" ? "昇順" : "降順"}`,
      )
      .join("、") || "指定なし",
    count,
  );
  if (result.grandTotal)
    row = metadata(
      report,
      row,
      "総計の範囲",
      "検索条件に合う全行。ページの行数による集計ではありません。",
      count,
    );
  if (result.summaryNotice)
    row = metadata(report, row, "総計", result.summaryNotice, count);
  const reportHeader = ++row;
  header(report, row++, columns);
  result.rows.forEach((data, index) => {
    const subtotal = isSubtotal(context, index);
    putRow(report, row, data, columns, subtotal);
    columns.forEach((column, c) => {
      if (subtotal && column.id === query.dimensions[result.rowLevels![index]])
        report.getCell(row, c + 1).value = "小計";
      else if (data[column.id] === null) report.getCell(row, c + 1).value = "—";
    });
    row++;
  });
  if (!result.rows.length)
    span(report, row++, 1, count, "条件に一致するデータがありません。");
  if (result.grandTotal) {
    row++;
    span(report, row++, 1, count, "総計（検索条件に合う全行）").font = {
      name: "Yu Gothic",
      size: 11,
      bold: true,
      color: { argb: teal },
    };
    const metrics = columns.filter((c) => c.metric);
    header(report, row++, metrics);
    putRow(report, row, result.grandTotal, metrics, true);
  }
  report.pageSetup.printTitlesRow = `${reportHeader}:${reportHeader}`;
  // A long filter block must not freeze the entire visible Excel viewport.
  if (reportHeader <= 14)
    report.views = [
      { state: "frozen", ySplit: reportHeader, showGridLines: false },
    ];

  const data = sheetBase(workbook, "データ", columns);
  title(data, exportTitle(context), count);
  let dataRow = metadata(
    data,
    3,
    "元データ",
    `${source.database}.${source.schema}.${source.name}`,
    count,
  );
  dataRow = metadata(data, dataRow, "出力範囲", exportScope(context), count);
  dataRow = metadata(
    data,
    dataRow,
    "条件・集計方法",
    "表示シートの上部に記載。小計・総計は表示シートで確認できます。",
    count,
  );
  const dataHeader = dataRow + 1,
    rows = exportDataRows(context);
  if (rows.length) {
    data.addTable({
      name: "SnowLensData",
      ref: `A${dataHeader}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium4", showRowStripes: true },
      columns: columns.map((c) => ({ name: c.label, filterButton: true })),
      rows: rows.map((r) => columns.map((c) => cellValue(r[c.id], c))),
    });
    rows.forEach((r, i) => putRow(data, dataHeader + i + 1, r, columns));
  } else
    span(
      data,
      dataHeader + 1,
      1,
      count,
      "このページに通常のデータ行はありません。",
    );
  header(data, dataHeader, columns);
  const frozenHeight = Array.from(
    { length: dataHeader },
    (_, i) => data.getRow(i + 1).height || 24,
  ).reduce((a, b) => a + b, 0);
  if (frozenHeight <= 400)
    data.views = [
      { state: "frozen", ySplit: dataHeader, showGridLines: false },
    ];
  data.pageSetup.printTitlesRow = `${dataHeader}:${dataHeader}`;
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
